from __future__ import annotations

import ast
from pathlib import Path

from cartographer_common import (
    add_unique_edge,
    add_unique_node,
    empty_contracts,
    make_contract,
    make_edge,
    make_evidence,
    make_node,
    stable_id,
)


# ============================================================
# AST HELPERS
# ============================================================

ROUTE_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}
IGNORED_PARAMETER_NAMES = {"self", "cls", "request", "response", "background_tasks"}
SCHEMA_BASE_NAMES = {"BaseModel", "TypedDict"}
PYDANTIC_BASE_NAMES = {"BaseModel"}
TYPED_DICT_BASE_NAMES = {"TypedDict"}
EXCEPTION_BASE_NAMES = {"Exception", "BaseException"}
DATA_NODE_KINDS = {"schema", "model", "dataclass", "pydantic_model", "typed_dict"}
SIDE_EFFECT_CALLS = {
    "open": "file",
    "connect": "database",
    "execute": "database",
    "executemany": "database",
    "fetchone": "database",
    "fetchall": "database",
    "commit": "database",
    "rollback": "database",
    "request": "network",
    "get": "network",
    "post": "network",
    "put": "network",
    "patch": "network",
    "delete": "network",
    "print": "logging",
    "debug": "logging",
    "info": "logging",
    "warning": "logging",
    "error": "logging",
    "exception": "logging",
    "getenv": "env",
}


def annotation_to_text(node: ast.AST | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def literal_to_text(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def get_name(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = get_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    if isinstance(node, ast.Subscript):
        return get_name(node.value)
    if isinstance(node, ast.Call):
        return get_name(node.func)
    return None


def get_call_name(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Call):
        return None
    raw_name = get_name(node.func)
    if not raw_name:
        return None
    return raw_name.split(".")[-1]


def base_names(class_node: ast.ClassDef) -> set[str]:
    names = set()
    for base in class_node.bases:
        name = get_name(base)
        if name:
            names.add(name)
            names.add(name.split(".")[-1])
    return names


def is_dataclass(class_node: ast.ClassDef) -> bool:
    for decorator in class_node.decorator_list:
        name = get_name(decorator)
        if name and name.split(".")[-1] == "dataclass":
            return True
    return False


def is_schema_class(class_node: ast.ClassDef) -> bool:
    return bool(base_names(class_node) & SCHEMA_BASE_NAMES) or is_dataclass(class_node)


def decorator_names(node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) -> list[str]:
    names = []
    for decorator in node.decorator_list:
        name = get_name(decorator)
        if name:
            names.append(name)
    return names


def node_kind_for_class(class_node: ast.ClassDef) -> str:
    names = base_names(class_node)
    if names & EXCEPTION_BASE_NAMES or any(name.endswith("Error") for name in names):
        return "exception"
    if names & PYDANTIC_BASE_NAMES:
        return "pydantic_model"
    if names & TYPED_DICT_BASE_NAMES:
        return "typed_dict"
    if is_dataclass(class_node):
        return "dataclass"
    return "class"


def literal_value(node: ast.AST | None) -> object:
    if node is None:
        return None
    if isinstance(node, ast.Constant):
        return node.value
    try:
        return ast.unparse(node)
    except Exception:
        return None


def extract_class_shape(class_node: ast.ClassDef) -> dict:
    fields = {}
    for child in class_node.body:
        if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
            fields[child.target.id] = {
                "type": annotation_to_text(child.annotation) or "unknown",
                "required": child.value is None,
                "default": literal_value(child.value),
            }
        elif isinstance(child, ast.Assign):
            for target in child.targets:
                if isinstance(target, ast.Name):
                    fields[target.id] = {
                        "type": "unknown",
                        "required": False,
                        "default": literal_value(child.value),
                    }
    return fields


def method_names(class_node: ast.ClassDef) -> list[str]:
    return [
        child.name
        for child in class_node.body
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]


def parameter_details(function_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict]:
    parameters = []
    all_args = list(function_node.args.posonlyargs) + list(function_node.args.args) + list(function_node.args.kwonlyargs)
    defaults = [None] * (len(function_node.args.args) - len(function_node.args.defaults)) + list(function_node.args.defaults)
    default_by_name = {
        arg.arg: literal_value(default)
        for arg, default in zip(function_node.args.args, defaults)
        if default is not None
    }
    for arg in all_args:
        parameters.append(
            {
                "name": arg.arg,
                "annotation": annotation_to_text(arg.annotation),
                "ignored_for_api_contract": arg.arg in IGNORED_PARAMETER_NAMES,
                "default": default_by_name.get(arg.arg),
            }
        )
    if function_node.args.vararg:
        parameters.append({"name": "*" + function_node.args.vararg.arg, "annotation": annotation_to_text(function_node.args.vararg.annotation), "default": None})
    if function_node.args.kwarg:
        parameters.append({"name": "**" + function_node.args.kwarg.arg, "annotation": annotation_to_text(function_node.args.kwarg.annotation), "default": None})
    return parameters


def called_names(function_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    names = []
    for child in ast.walk(function_node):
        if isinstance(child, ast.Call):
            name = get_call_name(child)
            if name:
                names.append(name)
    return sorted(set(names))


def raised_exceptions(function_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    raised = []
    for child in ast.walk(function_node):
        if isinstance(child, ast.Raise):
            name = get_name(child.exc) if child.exc else None
            if name:
                raised.append(name)
    return sorted(set(raised))


def side_effects(function_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict]:
    effects = []
    for child in ast.walk(function_node):
        if not isinstance(child, ast.Call):
            continue
        name = get_name(child.func)
        short_name = name.split(".")[-1] if name else None
        effect = SIDE_EFFECT_CALLS.get(short_name or "")
        if effect:
            effects.append({"kind": effect, "call": name, "line": getattr(child, "lineno", None)})
    unique = {}
    for effect in effects:
        unique[(effect["kind"], effect["call"])] = effect
    return list(unique.values())


def route_dependency_hints(function_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    hints = []
    positional_defaults = [None] * (len(function_node.args.args) - len(function_node.args.defaults)) + list(function_node.args.defaults)
    default_by_name = {
        arg.arg: default
        for arg, default in zip(function_node.args.args, positional_defaults)
        if default is not None
    }
    for arg, default in zip(function_node.args.kwonlyargs, function_node.args.kw_defaults):
        if default is not None:
            default_by_name[arg.arg] = default
    for arg in list(function_node.args.args) + list(function_node.args.kwonlyargs):
        annotation = annotation_to_text(arg.annotation)
        default = annotation_to_text(default_by_name.get(arg.arg))
        if annotation:
            hints.append(f"{arg.arg}: {annotation}")
        if default and ("Depends" in default or "Security" in default):
            hints.append(f"{arg.arg}: {default}")
    return sorted(set(hints))


def decorator_route(decorator: ast.AST) -> dict | None:
    if not isinstance(decorator, ast.Call):
        return None
    func_name = get_name(decorator.func)
    if not func_name:
        return None
    method = func_name.split(".")[-1].lower()
    is_flask_route = method == "route"
    is_websocket = method == "websocket"
    if method not in ROUTE_METHODS and not is_flask_route and not is_websocket:
        return None
    path = literal_to_text(decorator.args[0]) if decorator.args else None
    if not path:
        return None
    kwargs = {}
    for keyword in decorator.keywords:
        kwargs[keyword.arg or "unknown"] = annotation_to_text(keyword.value)
    if is_websocket:
        methods = ["WEBSOCKET"]
    elif is_flask_route and "methods" in kwargs:
        methods = [item.strip("'\" ").upper() for item in kwargs["methods"].strip("[]()").split(",") if item.strip()]
    elif is_flask_route:
        methods = ["GET"]
    else:
        methods = [method.upper()]
    return {
        "method": methods[0],
        "methods": methods,
        "path": path,
        "kwargs": kwargs,
        "kind": "websocket_endpoint" if is_websocket else "api_endpoint",
    }


def first_sentence(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return None
    for separator in [". ", "\n"]:
        if separator in cleaned:
            return cleaned.split(separator)[0].strip() + "."
    return cleaned


# ============================================================
# IMPORT RESOLUTION
# ============================================================

def build_python_module_map(records: list[dict]) -> dict[str, str]:
    module_map = {}
    for record in records:
        if record["language"] != "python":
            continue
        rel_path = record["rel_path"]
        path_no_ext = rel_path[:-3]
        if path_no_ext.endswith("/__init__"):
            module = path_no_ext[: -len("/__init__")].replace("/", ".")
        else:
            module = path_no_ext.replace("/", ".")
        module_map[module] = rel_path
    return module_map


def current_package(rel_path: str) -> str:
    parts = rel_path[:-3].split("/")[:-1]
    return ".".join(parts)


def resolve_import_from(record: dict, node: ast.ImportFrom, module_map: dict[str, str]) -> str | None:
    module = node.module or ""
    if node.level:
        package_parts = current_package(record["rel_path"]).split(".") if current_package(record["rel_path"]) else []
        if node.level > 1:
            package_parts = package_parts[: -(node.level - 1)]
        if module:
            package_parts.append(module)
        module = ".".join(part for part in package_parts if part)
    if module in module_map:
        return module_map[module]
    for alias in node.names:
        candidate = f"{module}.{alias.name}" if module else alias.name
        if candidate in module_map:
            return module_map[candidate]
    return None


def resolve_import(name: str, module_map: dict[str, str]) -> str | None:
    parts = name.split(".")
    while parts:
        candidate = ".".join(parts)
        if candidate in module_map:
            return module_map[candidate]
        parts.pop()
    return None


# ============================================================
# CONTRACTS
# ============================================================

def contract_shape_from_annotation(annotation: str | None, schema_shapes: dict[str, dict]) -> dict:
    if not annotation:
        return {}
    clean = annotation.replace("'", "").replace('"', "")
    short_name = clean.split("[")[0].split(".")[-1]
    if short_name in schema_shapes:
        return {
            "schema": short_name,
            "fields": schema_shapes[short_name],
        }
    for schema_name, fields in schema_shapes.items():
        if schema_name in clean:
            return {
                "schema": schema_name,
                "container": clean,
                "fields": fields,
            }
    return {
        "type": clean,
    }


def build_request_contract(function_node: ast.FunctionDef | ast.AsyncFunctionDef, schema_shapes: dict[str, dict], rel_path: str) -> dict:
    shape = {}
    evidence = []
    has_annotation = False
    has_schema = False
    all_args = list(function_node.args.posonlyargs) + list(function_node.args.args) + list(function_node.args.kwonlyargs)
    for arg in all_args:
        if arg.arg in IGNORED_PARAMETER_NAMES:
            continue
        annotation = annotation_to_text(arg.annotation)
        if annotation:
            has_annotation = True
        field_shape = contract_shape_from_annotation(annotation, schema_shapes)
        if "schema" in field_shape:
            has_schema = True
        shape[arg.arg] = field_shape or {"type": "unknown"}
    if shape:
        evidence.append(make_evidence("python_signature", rel_path, function_node.lineno, function_node.lineno, "route function parameters"))
    if has_schema:
        status = "complete"
    elif has_annotation or shape:
        status = "partial"
    else:
        status = "not_declared"
    return make_contract(status, shape, "annotation" if shape else "none", evidence)


def build_response_contract(
    function_node: ast.FunctionDef | ast.AsyncFunctionDef,
    route: dict | None,
    schema_shapes: dict[str, dict],
    rel_path: str,
) -> dict:
    response_model = None
    if route:
        response_model = route["kwargs"].get("response_model")
    annotation = response_model or annotation_to_text(function_node.returns)
    if not annotation:
        return make_contract("not_declared")
    shape = contract_shape_from_annotation(annotation, schema_shapes)
    status = "complete" if "schema" in shape else "partial"
    source = "decorator" if response_model else "annotation"
    evidence = [make_evidence(f"python_{source}", rel_path, function_node.lineno, function_node.lineno, "route response contract")]
    return make_contract(status, shape, source, evidence)


# ============================================================
# EXTRACTION
# ============================================================

def collect_python_definitions(records: list[dict]) -> tuple[dict[str, dict], dict[str, list[str]], dict[str, dict]]:
    nodes = {}
    symbol_lookup = {}
    schema_shapes = {}
    warnings = []
    for record in records:
        if record["language"] != "python":
            continue
        rel_path = record["rel_path"]
        try:
            tree = ast.parse(record["text"])
        except SyntaxError as exc:
            warnings.append(f"python parse failed: {rel_path}: {exc}")
            continue
        for child in ast.walk(tree):
            if isinstance(child, ast.ClassDef) and is_schema_class(child):
                schema_shapes[child.name] = extract_class_shape(child)
    for record in records:
        if record["language"] != "python":
            continue
        rel_path = record["rel_path"]
        file_id = stable_id("file", rel_path)
        try:
            tree = ast.parse(record["text"])
        except SyntaxError:
            continue
        stack = []
        visit_python_node(tree, record, file_id, stack, nodes, symbol_lookup, schema_shapes, warnings)
    return nodes, symbol_lookup, schema_shapes


def visit_python_node(
    node: ast.AST,
    record: dict,
    parent_id: str,
    stack: list[str],
    nodes: dict[str, dict],
    symbol_lookup: dict[str, list[str]],
    schema_shapes: dict[str, dict],
    warnings: list[str],
) -> None:
    rel_path = record["rel_path"]
    language = record["language"]
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.ClassDef):
            class_stack = stack + [child.name]
            node_kind = node_kind_for_class(child)
            class_id = stable_id(node_kind, rel_path, ".".join(class_stack))
            shape = schema_shapes.get(child.name, {})
            summary = first_sentence(ast.get_docstring(child)) or f"Python {node_kind} `{child.name}` declared in `{rel_path}`."
            contracts = empty_contracts()
            if node_kind in DATA_NODE_KINDS:
                contracts["response"] = make_contract(
                    "complete" if shape else "partial",
                    {"schema": child.name, "fields": shape},
                    "schema",
                    [make_evidence("python_schema", rel_path, child.lineno, getattr(child, "end_lineno", child.lineno), "schema class fields")],
                )
            details = {
                "overview": {
                    "kind": node_kind,
                    "symbol": child.name,
                    "bases": sorted(base_names(child)),
                    "decorators": decorator_names(child),
                    "docstring": first_sentence(ast.get_docstring(child)),
                },
                "fields": shape,
                "methods": method_names(child),
                "inheritance": {
                    "bases": sorted(base_names(child)),
                },
            }
            add_unique_node(
                nodes,
                make_node(
                    class_id,
                    node_kind,
                    child.name,
                    language,
                    rel_path,
                    child.lineno,
                    getattr(child, "end_lineno", child.lineno),
                    "complete" if shape or node_kind not in DATA_NODE_KINDS else "partial",
                    summary,
                    [make_evidence("python_ast", rel_path, child.lineno, getattr(child, "end_lineno", child.lineno), f"{node_kind} definition")],
                    contracts,
                    [node_kind],
                    {"symbol": child.name, "stack": class_stack, "parent_id": parent_id, "bases": sorted(base_names(child)), "decorators": decorator_names(child)},
                    details,
                ),
                warnings,
            )
            symbol_lookup.setdefault(child.name, []).append(class_id)
            visit_python_node(child, record, class_id, class_stack, nodes, symbol_lookup, schema_shapes, warnings)
        elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            function_stack = stack + [child.name]
            decorator_list = decorator_names(child)
            if stack and child.name == "__init__":
                node_kind = "constructor"
            elif stack:
                node_kind = "method"
            elif any(name.split(".")[-1] in {"task", "shared_task"} for name in decorator_list):
                node_kind = "background_task"
            elif any(name.split(".")[-1] in {"command", "group"} or name.startswith("click.") or name.startswith("typer.") for name in decorator_list):
                node_kind = "cli_command"
            else:
                node_kind = "function"
            function_id = stable_id(node_kind, rel_path, ".".join(function_stack))
            summary = first_sentence(ast.get_docstring(child)) or f"Python {node_kind} `{child.name}` declared in `{rel_path}`."
            function_details = {
                "overview": {
                    "kind": node_kind,
                    "symbol": child.name,
                    "async": isinstance(child, ast.AsyncFunctionDef),
                    "decorators": decorator_list,
                    "docstring": first_sentence(ast.get_docstring(child)),
                },
                "interface": {
                    "parameters": parameter_details(child),
                    "returns": annotation_to_text(child.returns),
                },
                "calls": called_names(child),
                "raises": raised_exceptions(child),
                "side_effects": side_effects(child),
            }
            add_unique_node(
                nodes,
                make_node(
                    function_id,
                    node_kind,
                    child.name,
                    language,
                    rel_path,
                    child.lineno,
                    getattr(child, "end_lineno", child.lineno),
                    "complete",
                    summary,
                    [make_evidence("python_ast", rel_path, child.lineno, getattr(child, "end_lineno", child.lineno), f"{node_kind} definition")],
                    empty_contracts(),
                    [node_kind],
                    {
                        "symbol": child.name,
                        "stack": function_stack,
                        "async": isinstance(child, ast.AsyncFunctionDef),
                        "parent_id": parent_id,
                        "decorators": decorator_list,
                        "calls": called_names(child),
                        "raises": raised_exceptions(child),
                        "side_effects": side_effects(child),
                    },
                    function_details,
                ),
                warnings,
            )
            symbol_lookup.setdefault(child.name, []).append(function_id)
            for decorator in child.decorator_list:
                route = decorator_route(decorator)
                if not route:
                    continue
                for method in route.get("methods") or [route["method"]]:
                    route_kind = route.get("kind") or "api_endpoint"
                    api_id = stable_id(route_kind, method, route["path"], rel_path, child.name)
                    route_for_contract = dict(route)
                    route_for_contract["method"] = method
                    contracts = {
                        "request": build_request_contract(child, schema_shapes, rel_path),
                        "response": build_response_contract(child, route_for_contract, schema_shapes, rel_path),
                    }
                    api_summary = f"Python route `{method} {route['path']}` handled by `{child.name}`."
                    api_details = {
                        "overview": {
                            "kind": route_kind,
                            "method": method,
                            "path": route["path"],
                            "handler": child.name,
                            "handler_id": function_id,
                        },
                        "request": contracts["request"],
                        "response": contracts["response"],
                        "auth_or_dependencies": route_dependency_hints(child),
                        "calls": called_names(child),
                        "raises": raised_exceptions(child),
                        "side_effects": side_effects(child),
                    }
                    add_unique_node(
                        nodes,
                        make_node(
                            api_id,
                            route_kind,
                            f"{method} {route['path']}",
                            language,
                            rel_path,
                            child.lineno,
                            getattr(child, "end_lineno", child.lineno),
                            "complete",
                            api_summary,
                            [make_evidence("python_route_decorator", rel_path, child.lineno, child.lineno, "route decorator")],
                            contracts,
                            ["api", method.lower()],
                            {
                                "method": method,
                                "methods": route.get("methods") or [method],
                                "path": route["path"],
                                "handler": child.name,
                                "handler_id": function_id,
                                "parent_id": function_id,
                                "route_kwargs": route.get("kwargs", {}),
                            },
                            api_details,
                        ),
                        warnings,
                    )
            visit_python_node(child, record, function_id, function_stack, nodes, symbol_lookup, schema_shapes, warnings)
        else:
            visit_python_node(child, record, parent_id, stack, nodes, symbol_lookup, schema_shapes, warnings)


def extract_python_edges(records: list[dict], nodes: dict[str, dict], symbol_lookup: dict[str, list[str]], module_map: dict[str, str]) -> dict[str, dict]:
    edges = {}
    by_file_and_symbol = {}
    for node in nodes.values():
        symbol = node["metadata"].get("symbol")
        if symbol:
            by_file_and_symbol[(node["file"], symbol)] = node["id"]
    for record in records:
        if record["language"] != "python":
            continue
        rel_path = record["rel_path"]
        file_id = stable_id("file", rel_path)
        try:
            tree = ast.parse(record["text"])
        except SyntaxError:
            continue
        add_python_import_edges(tree, record, file_id, module_map, edges)
        add_python_route_edges(tree, record, by_file_and_symbol, nodes, edges)
        add_python_call_edges(tree, record, by_file_and_symbol, symbol_lookup, nodes, edges)
        add_python_schema_edges(tree, record, by_file_and_symbol, symbol_lookup, nodes, edges)
    return edges


def add_python_import_edges(tree: ast.AST, record: dict, file_id: str, module_map: dict[str, str], edges: dict[str, dict]) -> None:
    for child in ast.walk(tree):
        target_rel_path = None
        detail = None
        if isinstance(child, ast.Import):
            for alias in child.names:
                target_rel_path = resolve_import(alias.name, module_map)
                detail = f"imports {alias.name}"
                if target_rel_path:
                    break
        elif isinstance(child, ast.ImportFrom):
            target_rel_path = resolve_import_from(record, child, module_map)
            detail = f"imports from {'.' * child.level}{child.module or ''}"
        if target_rel_path:
            target_id = stable_id("file", target_rel_path)
            add_unique_edge(
                edges,
                make_edge(
                    file_id,
                    target_id,
                    "imports",
                    detail or "imports local module",
                    [make_evidence("python_import", record["rel_path"], getattr(child, "lineno", None), getattr(child, "lineno", None), detail or "local import")],
                ),
            )


def add_python_route_edges(tree: ast.AST, record: dict, by_file_and_symbol: dict, nodes: dict[str, dict], edges: dict[str, dict]) -> None:
    rel_path = record["rel_path"]
    for child in ast.walk(tree):
        if not isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        handler_id = by_file_and_symbol.get((rel_path, child.name))
        if not handler_id:
            continue
        for decorator in child.decorator_list:
            route = decorator_route(decorator)
            if not route:
                continue
            route_kind = route.get("kind") or "api_endpoint"
            for method in route.get("methods") or [route["method"]]:
                api_id = stable_id(route_kind, method, route["path"], rel_path, child.name)
                if api_id in nodes:
                    add_unique_edge(
                        edges,
                        make_edge(
                            api_id,
                            handler_id,
                            "handled_by",
                            f"{method} {route['path']} is handled by {child.name}",
                            [make_evidence("python_route_decorator", rel_path, child.lineno, child.lineno, "route handler binding")],
                        ),
                    )


def add_python_call_edges(
    tree: ast.AST,
    record: dict,
    by_file_and_symbol: dict,
    symbol_lookup: dict[str, list[str]],
    nodes: dict[str, dict],
    edges: dict[str, dict],
) -> None:
    rel_path = record["rel_path"]
    for function_node in ast.walk(tree):
        if not isinstance(function_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        caller_id = by_file_and_symbol.get((rel_path, function_node.name))
        if not caller_id:
            continue
        for child in ast.walk(function_node):
            call_name = get_call_name(child)
            if not call_name or call_name == function_node.name:
                continue
            target_ids = symbol_lookup.get(call_name, [])
            target_id = None
            same_file_target = by_file_and_symbol.get((rel_path, call_name))
            if same_file_target:
                target_id = same_file_target
            elif len(target_ids) == 1:
                target_id = target_ids[0]
            if target_id and target_id in nodes and target_id != caller_id:
                add_unique_edge(
                    edges,
                    make_edge(
                        caller_id,
                        target_id,
                        "calls",
                        f"`{function_node.name}` calls `{call_name}`",
                        [make_evidence("python_call", rel_path, getattr(child, "lineno", None), getattr(child, "lineno", None), f"call to {call_name}")],
                    ),
                )


def add_python_schema_edges(
    tree: ast.AST,
    record: dict,
    by_file_and_symbol: dict,
    symbol_lookup: dict[str, list[str]],
    nodes: dict[str, dict],
    edges: dict[str, dict],
) -> None:
    rel_path = record["rel_path"]
    for function_node in ast.walk(tree):
        if not isinstance(function_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        source_id = by_file_and_symbol.get((rel_path, function_node.name))
        if not source_id:
            continue
        annotations = []
        all_args = list(function_node.args.posonlyargs) + list(function_node.args.args) + list(function_node.args.kwonlyargs)
        for arg in all_args:
            annotations.append(annotation_to_text(arg.annotation))
        annotations.append(annotation_to_text(function_node.returns))
        for annotation in annotations:
            if not annotation:
                continue
            short_name = annotation.replace("'", "").replace('"', "").split("[")[0].split(".")[-1]
            target_ids = symbol_lookup.get(short_name, [])
            for target_id in target_ids:
                if nodes.get(target_id, {}).get("kind") in DATA_NODE_KINDS:
                    add_unique_edge(
                        edges,
                        make_edge(
                            source_id,
                            target_id,
                            "uses_schema",
                            f"`{function_node.name}` references schema `{short_name}`",
                            [make_evidence("python_annotation", rel_path, function_node.lineno, function_node.lineno, f"annotation {annotation}")],
                        ),
                    )


def extract_python_graph(records: list[dict]) -> dict:
    module_map = build_python_module_map(records)
    nodes, symbol_lookup, schema_shapes = collect_python_definitions(records)
    edges = extract_python_edges(records, nodes, symbol_lookup, module_map)
    return {
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "symbol_lookup": symbol_lookup,
        "schema_shapes": schema_shapes,
    }

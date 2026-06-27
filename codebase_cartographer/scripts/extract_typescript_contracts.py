from __future__ import annotations

import re
from html.parser import HTMLParser
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
# REGEXES
# ============================================================

IMPORT_RE = re.compile(r"import\s+(?:[^'\"]+\s+from\s+)?['\"]([^'\"]+)['\"]")
INTERFACE_RE = re.compile(r"(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+[^{]+)?\{", re.MULTILINE)
TYPE_RE = re.compile(r"(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=", re.MULTILINE)
ENUM_RE = re.compile(r"(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{", re.MULTILINE)
CLASS_RE = re.compile(r"(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+([A-Za-z_$][\w$.]*))?\s*\{", re.MULTILINE)
FUNCTION_RE = re.compile(
    r"(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^{\n]+))?",
    re.MULTILINE,
)
CONST_FUNCTION_RE = re.compile(
    r"(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^=]+?))?\s*=>",
    re.MULTILINE,
)
CSS_BLOCK_RE = re.compile(r"(^|[}\n\r])\s*([^@}{][^}{]+?)\s*\{")
CSS_AT_RULE_RE = re.compile(r"@(media|container|supports|keyframes|font-face|layer)\s*([^{};]*)\{", re.MULTILINE)
CLASSNAME_RE = re.compile(r"className\s*=\s*(?:['\"]([^'\"]+)['\"]|\{['\"]([^'\"]+)['\"]\})")
CALL_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(")
JSX_COMPONENT_RE = re.compile(r"<([A-Z][A-Za-z0-9_$]*)\b")
FETCH_RE = re.compile(r"\b(?:fetch|axios\.(?:get|post|put|patch|delete)|api\.(?:get|post|put|patch|delete))\s*\(\s*['\"]([^'\"]+)['\"]")
JSX_TAG_RE = re.compile(r"<([a-z][A-Za-z0-9-]*)\b")
EVENT_RE = re.compile(r"\b(on[A-Z][A-Za-z0-9_]*)\s*=")
PROP_NAME_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\??\s*:")
WEB_LANGUAGES = {"typescript", "tsx", "javascript", "jsx"}


# ============================================================
# TEXT HELPERS
# ============================================================

def line_number_at(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def find_matching_brace(text: str, open_index: int) -> int:
    depth = 0
    for index in range(open_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return len(text) - 1


def slice_body(text: str, start_index: int) -> tuple[str, int]:
    open_index = text.find("{", start_index)
    if open_index == -1:
        line_end = text.find("\n", start_index)
        if line_end == -1:
            line_end = len(text)
        return text[start_index:line_end], line_end
    close_index = find_matching_brace(text, open_index)
    return text[open_index : close_index + 1], close_index


def parse_fields(body: str) -> dict:
    fields = {}
    for raw_line in body.splitlines():
        line = raw_line.strip().rstrip(";")
        if not line or line.startswith("//") or ":" not in line:
            continue
        name, field_type = line.split(":", 1)
        name = name.strip().strip("'\"")
        optional = name.endswith("?")
        name = name.rstrip("?")
        if re.match(r"^[A-Za-z_$][\w$-]*$", name):
            fields[name] = {
                "type": field_type.strip(),
                "required": not optional,
            }
    return fields


def parse_params(params: str) -> dict:
    shape = {}
    for raw_part in params.split(","):
        part = raw_part.strip()
        if not part or ":" not in part:
            continue
        name, param_type = part.split(":", 1)
        name = name.replace("readonly ", "").strip().strip("{} ")
        if name:
            shape[name] = {
                "type": param_type.strip(),
            }
    return shape


def response_type_from_annotation(annotation: str | None) -> str | None:
    if not annotation:
        return None
    clean = annotation.strip().rstrip("{").strip()
    return clean or None


def is_component(name: str, language: str, body: str) -> bool:
    return language == "tsx" and (name[:1].isupper() or "return <" in body or "return (" in body and "<" in body)


def is_hook(name: str) -> bool:
    return name.startswith("use") and len(name) > 3 and name[3].isupper()


def is_api_client(body: str) -> bool:
    return bool(FETCH_RE.search(body))


def type_status(shape: dict) -> str:
    return "complete" if shape else "partial"


def unique_sorted(values: list[str]) -> list[str]:
    return sorted(set(item for item in values if item))


def jsx_tags(body: str) -> list[str]:
    return unique_sorted([match.group(1) for match in JSX_TAG_RE.finditer(body)])


def event_handlers(body: str) -> list[str]:
    return unique_sorted([match.group(1) for match in EVENT_RE.finditer(body)])


def type_names_from_text(text: str) -> list[str]:
    return unique_sorted([match.group(1) for match in PROP_NAME_RE.finditer(text)])


def declaration_details(name: str, node_kind: str, body: str, params: str = "", response_annotation: str | None = None) -> dict:
    return {
        "overview": {
            "kind": node_kind,
            "symbol": name,
        },
        "interface": {
            "parameters": parse_params(params),
            "returns": response_type_from_annotation(response_annotation),
        },
        "react": {
            "jsx_tags": jsx_tags(body),
            "events": event_handlers(body),
            "hooks": unique_sorted([match.group(1) for match in CALL_RE.finditer(body) if is_hook(match.group(1))]),
            "rendered_components": unique_sorted([match.group(1) for match in JSX_COMPONENT_RE.finditer(body)]),
        },
        "api": {
            "paths": unique_sorted([api_match.group(1) for api_match in FETCH_RE.finditer(body)]),
        },
        "calls": unique_sorted([match.group(1) for match in CALL_RE.finditer(body)]),
    }


class MeaningfulHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.elements: list[dict] = []
        self.line = 1

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {name: value or "" for name, value in attrs}
        meaningful_tags = {"template", "form", "main", "section", "article", "nav", "header", "footer", "button", "input", "select", "textarea", "script", "link"}
        has_identity = "id" in attr_map or "class" in attr_map or any(name.startswith("data-") for name in attr_map)
        has_behavior = any(name.startswith("on") for name in attr_map) or tag in {"form", "script", "link"}
        if tag in meaningful_tags or has_identity or has_behavior:
            self.elements.append({"tag": tag, "attrs": attr_map, "line": self.getpos()[0]})


# ============================================================
# IMPORT RESOLUTION
# ============================================================

def build_file_lookup(records: list[dict]) -> dict[str, str]:
    lookup = {}
    for record in records:
        rel_path = record["rel_path"]
        path_no_ext = str(Path(rel_path).with_suffix("")).replace("\\", "/")
        lookup[rel_path] = rel_path
        lookup[path_no_ext] = rel_path
        lookup[path_no_ext + "/index"] = rel_path
    return lookup


def resolve_local_import(record: dict, import_path: str, file_lookup: dict[str, str]) -> str | None:
    if not import_path.startswith("."):
        return None
    base = Path(record["rel_path"]).parent
    candidate = (base / import_path).as_posix()
    candidate = str(Path(candidate)).replace("\\", "/")
    candidates = [
        candidate,
        candidate + ".ts",
        candidate + ".tsx",
        candidate + ".js",
        candidate + ".jsx",
        candidate + ".css",
        candidate + ".html",
        candidate + "/index.ts",
        candidate + "/index.tsx",
        candidate + "/index.js",
        candidate + "/index.jsx",
    ]
    for item in candidates:
        if item in file_lookup:
            return file_lookup[item]
    return None


# ============================================================
# CSS
# ============================================================

def extract_css_nodes(records: list[dict]) -> tuple[dict[str, dict], dict[str, str], dict[str, list[str]]]:
    nodes = {}
    class_lookup = {}
    warnings = []
    for record in records:
        if record["language"] != "css":
            continue
        rel_path = record["rel_path"]
        for match in CSS_AT_RULE_RE.finditer(record["text"]):
            rule_name = match.group(1)
            rule_value = match.group(2).strip()
            line_start = line_number_at(record["text"], match.start())
            body, end_index = slice_body(record["text"], match.end() - 1)
            line_end = line_number_at(record["text"], end_index)
            kind_map = {
                "media": "media_query",
                "container": "container_query",
                "supports": "supports_rule",
                "keyframes": "keyframes",
                "font-face": "font_face",
                "layer": "css_layer",
            }
            node_kind = kind_map.get(rule_name, "css_at_rule")
            label = f"@{rule_name} {rule_value}".strip()
            declarations = [line.strip() for line in body.splitlines() if ":" in line and not line.strip().startswith("/*")]
            node_id = stable_id(node_kind, rel_path, label)
            add_unique_node(
                nodes,
                make_node(
                    node_id,
                    node_kind,
                    label,
                    "css",
                    rel_path,
                    line_start,
                    line_end,
                    "complete",
                    f"CSS at-rule `{label}` declared in `{rel_path}`.",
                    [make_evidence("css_at_rule", rel_path, line_start, line_end, label)],
                    empty_contracts(),
                    ["style", node_kind],
                    {"at_rule": rule_name, "condition": rule_value, "declaration_count": len(declarations)},
                    {
                        "style": {
                            "at_rule": rule_name,
                            "condition": rule_value,
                            "declaration_count": len(declarations),
                            "important_declarations": declarations[:12],
                        }
                    },
                ),
                warnings,
            )
        for match in CSS_BLOCK_RE.finditer(record["text"]):
            selector = match.group(2).strip()
            if selector in {"from", "to"} or selector.startswith("@"):
                continue
            body, end_index = slice_body(record["text"], match.end() - 1)
            declarations = [line.strip().rstrip(";") for line in body.splitlines() if ":" in line and not line.strip().startswith("/*")]
            line_start = line_number_at(record["text"], match.start(2))
            line_end = line_number_at(record["text"], end_index)
            node_id = stable_id("style_rule", rel_path, selector)
            if node_id in nodes:
                continue
            evidence = [make_evidence("css_selector", rel_path, line_start, line_start, f"selector {selector}")]
            add_unique_node(
                nodes,
                make_node(
                    node_id,
                    "style_rule",
                    selector,
                    "css",
                    rel_path,
                    line_start,
                    line_end,
                    "complete",
                    f"CSS selector `{selector}` declared in `{rel_path}`.",
                    evidence,
                    empty_contracts(),
                    ["style", "style_rule"],
                    {"selector": selector, "declaration_count": len(declarations), "css_variables": [item for item in declarations if item.startswith("--")]},
                    {
                        "style": {
                            "selector": selector,
                            "declaration_count": len(declarations),
                            "important_declarations": declarations[:16],
                            "css_variables": [item for item in declarations if item.startswith("--")],
                        }
                    },
                ),
                warnings,
            )
            if selector.startswith("."):
                class_lookup[selector[1:]] = node_id
    return nodes, class_lookup, warnings


# ============================================================
# TYPE AND FUNCTION EXTRACTION
# ============================================================

def extract_type_nodes(record: dict, warnings: list[str]) -> dict[str, dict]:
    nodes = {}
    text = record["text"]
    rel_path = record["rel_path"]
    for match in INTERFACE_RE.finditer(text):
        name = match.group(1)
        body, end_index = slice_body(text, match.end() - 1)
        shape = parse_fields(body)
        line_start = line_number_at(text, match.start())
        line_end = line_number_at(text, end_index)
        node_kind = "schema" if name.lower().endswith(("request", "response", "payload", "dto", "model")) else "interface"
        node_id = stable_id(node_kind, rel_path, name)
        contracts = empty_contracts()
        contracts["response"] = make_contract(type_status(shape), {"type": name, "fields": shape}, "typescript_interface", [])
        add_unique_node(
            nodes,
            make_node(
                node_id,
                node_kind,
                name,
                record["language"],
                rel_path,
                line_start,
                line_end,
                type_status(shape),
                f"TypeScript interface `{name}` declared in `{rel_path}`.",
                [make_evidence("typescript_interface", rel_path, line_start, line_end, f"interface {name}")],
                contracts,
                [node_kind],
                {"symbol": name, "shape": shape, "construct": "interface"},
                {"fields": shape, "interface": {"extends": []}},
            ),
            warnings,
        )
    for match in TYPE_RE.finditer(text):
        name = match.group(1)
        body, end_index = slice_body(text, match.end())
        shape = parse_fields(body)
        line_start = line_number_at(text, match.start())
        line_end = line_number_at(text, end_index)
        node_kind = "schema" if name.lower().endswith(("request", "response", "payload", "dto", "model")) else "type_alias"
        node_id = stable_id(node_kind, rel_path, name)
        contracts = empty_contracts()
        contracts["response"] = make_contract(type_status(shape), {"type": name, "fields": shape}, "typescript_type", [])
        add_unique_node(
            nodes,
            make_node(
                node_id,
                node_kind,
                name,
                record["language"],
                rel_path,
                line_start,
                line_end,
                type_status(shape),
                f"TypeScript type `{name}` declared in `{rel_path}`.",
                [make_evidence("typescript_type", rel_path, line_start, line_end, f"type {name}")],
                contracts,
                [node_kind],
                {"symbol": name, "shape": shape, "construct": "type_alias"},
                {"fields": shape, "type_alias": {"referenced_types": type_names_from_text(body)}},
            ),
            warnings,
        )
    for match in ENUM_RE.finditer(text):
        name = match.group(1)
        body, end_index = slice_body(text, match.end() - 1)
        members = [
            item.strip().split("=")[0].strip()
            for item in body.strip("{} \n\r\t").split(",")
            if item.strip()
        ]
        line_start = line_number_at(text, match.start())
        line_end = line_number_at(text, end_index)
        node_id = stable_id("enum", rel_path, name)
        add_unique_node(
            nodes,
            make_node(
                node_id,
                "enum",
                name,
                record["language"],
                rel_path,
                line_start,
                line_end,
                "complete" if members else "partial",
                f"TypeScript enum `{name}` declared in `{rel_path}`.",
                [make_evidence("typescript_enum", rel_path, line_start, line_end, f"enum {name}")],
                empty_contracts(),
                ["enum"],
                {"symbol": name, "members": members, "construct": "enum"},
                {"fields": {"members": members}},
            ),
            warnings,
        )
    for match in CLASS_RE.finditer(text):
        name = match.group(1)
        base = match.group(2)
        body, end_index = slice_body(text, match.end() - 1)
        line_start = line_number_at(text, match.start())
        line_end = line_number_at(text, end_index)
        node_id = stable_id("class", rel_path, name)
        add_unique_node(
            nodes,
            make_node(
                node_id,
                "class",
                name,
                record["language"],
                rel_path,
                line_start,
                line_end,
                "complete",
                f"{record['language']} class `{name}` declared in `{rel_path}`.",
                [make_evidence("typescript_class", rel_path, line_start, line_end, f"class {name}")],
                empty_contracts(),
                ["class"],
                {"symbol": name, "extends": base, "construct": "class"},
                {"inheritance": {"extends": base}, "calls": unique_sorted([match.group(1) for match in CALL_RE.finditer(body)])},
            ),
            warnings,
        )
    return nodes


def function_node_kind(name: str, language: str, body: str) -> str:
    if "createContext" in body or name.endswith("Context"):
        return "context"
    if name.endswith("Provider"):
        return "provider"
    if name.lower() == "page" or name.endswith("Page"):
        return "page"
    if name.lower() == "layout" or name.endswith("Layout"):
        return "layout"
    if name.endswith("Reducer") or "useReducer" in body:
        return "reducer"
    if name.endswith("Store") or "createStore" in body or "configureStore" in body:
        return "store"
    if is_hook(name):
        return "hook"
    if is_api_client(body):
        return "api_client"
    if "<form" in body:
        return "form"
    if is_component(name, language, body):
        return "component"
    return "function"


def make_function_contracts(params: str, response_annotation: str | None, rel_path: str, line_start: int) -> dict:
    request_shape = parse_params(params)
    response_type = response_type_from_annotation(response_annotation)
    contracts = {
        "request": make_contract(
            "partial" if request_shape else "not_declared",
            request_shape,
            "typescript_annotation" if request_shape else "none",
            [make_evidence("typescript_params", rel_path, line_start, line_start, "function parameters")] if request_shape else [],
        ),
        "response": make_contract(
            "partial" if response_type else "not_declared",
            {"type": response_type} if response_type else {},
            "typescript_annotation" if response_type else "none",
            [make_evidence("typescript_return", rel_path, line_start, line_start, "function return type")] if response_type else [],
        ),
    }
    return contracts


def extract_function_nodes(record: dict, warnings: list[str]) -> dict[str, dict]:
    nodes = {}
    text = record["text"]
    rel_path = record["rel_path"]
    matches = []
    matches.extend(("function", match) for match in FUNCTION_RE.finditer(text))
    matches.extend(("const", match) for match in CONST_FUNCTION_RE.finditer(text))
    for match_kind, match in sorted(matches, key=lambda item: item[1].start()):
        name = match.group(1)
        params = match.group(2)
        response_annotation = match.group(3)
        body, end_index = slice_body(text, match.end())
        line_start = line_number_at(text, match.start())
        line_end = line_number_at(text, end_index)
        node_kind = function_node_kind(name, record["language"], body)
        api_call_paths = [api_match.group(1) for api_match in FETCH_RE.finditer(body)]
        node_id = stable_id(node_kind, rel_path, name)
        summary = f"{record['language']} {node_kind} `{name}` declared in `{rel_path}`."
        if api_call_paths:
            summary = f"{record['language']} API client `{name}` calls {', '.join(sorted(set(api_call_paths)))}."
        add_unique_node(
            nodes,
            make_node(
                node_id,
                node_kind,
                name,
                record["language"],
                rel_path,
                line_start,
                line_end,
                "complete",
                summary,
                [make_evidence(f"typescript_{match_kind}_function", rel_path, line_start, line_end, f"{node_kind} {name}")],
                make_function_contracts(params, response_annotation, rel_path, line_start),
                [node_kind],
                {
                    "symbol": name,
                    "api_call_paths": sorted(set(api_call_paths)),
                    "body": body[:0],
                    "construct": match_kind,
                    "jsx_tags": jsx_tags(body),
                    "events": event_handlers(body),
                    "rendered_components": unique_sorted([jsx_match.group(1) for jsx_match in JSX_COMPONENT_RE.finditer(body)]),
                },
                declaration_details(name, node_kind, body, params, response_annotation),
            ),
            warnings,
        )
    return nodes


# ============================================================
# HTML
# ============================================================

def extract_html_nodes(records: list[dict]) -> dict[str, dict]:
    nodes = {}
    warnings = []
    for record in records:
        if record["language"] != "html":
            continue
        rel_path = record["rel_path"]
        document_id = stable_id("html_document", rel_path)
        add_unique_node(
            nodes,
            make_node(
                document_id,
                "html_document",
                Path(rel_path).name,
                "html",
                rel_path,
                1,
                record["line_count"] or None,
                "complete",
                f"HTML document `{rel_path}`.",
                [make_evidence("html_document", rel_path, 1, record["line_count"] or None, "html document")],
                empty_contracts(),
                ["html_document"],
                {"parent_id": stable_id("file", rel_path)},
                {"html": {"element_count": record["text"].count("<")}},
            ),
            warnings,
        )
        parser = MeaningfulHtmlParser()
        parser.feed(record["text"])
        for index, element in enumerate(parser.elements):
            tag = element["tag"]
            attrs = element["attrs"]
            identity = attrs.get("id") or attrs.get("name") or attrs.get("class") or str(index)
            node_kind = "template" if tag == "template" else "html_element"
            node_id = stable_id(node_kind, rel_path, tag, identity, index)
            label = f"<{tag}> {identity}".strip()
            add_unique_node(
                nodes,
                make_node(
                    node_id,
                    node_kind,
                    label,
                    "html",
                    rel_path,
                    element["line"],
                    element["line"],
                    "complete",
                    f"Meaningful HTML `{tag}` element in `{rel_path}`.",
                    [make_evidence("html_element", rel_path, element["line"], element["line"], f"html element {tag}")],
                    empty_contracts(),
                    ["html", node_kind],
                    {"tag": tag, "attrs": attrs, "parent_id": document_id},
                    {"html": {"tag": tag, "attrs": attrs, "events": [name for name in attrs if name.startswith("on")]}},
                ),
                warnings,
            )
    return nodes


# ============================================================
# EDGE EXTRACTION
# ============================================================

def add_import_edges(records: list[dict], file_lookup: dict[str, str], edges: dict[str, dict]) -> None:
    for record in records:
        if record["language"] not in WEB_LANGUAGES:
            continue
        source_file_id = stable_id("file", record["rel_path"])
        for match in IMPORT_RE.finditer(record["text"]):
            import_path = match.group(1)
            target_rel_path = resolve_local_import(record, import_path, file_lookup)
            if not target_rel_path:
                continue
            target_file_id = stable_id("file", target_rel_path)
            add_unique_edge(
                edges,
                make_edge(
                    source_file_id,
                    target_file_id,
                    "imports",
                    f"`{record['rel_path']}` imports `{import_path}`",
                    [make_evidence("typescript_import", record["rel_path"], line_number_at(record["text"], match.start()), line_number_at(record["text"], match.start()), f"import {import_path}")],
                ),
            )


def add_symbol_edges(records: list[dict], nodes: dict[str, dict], symbol_lookup: dict[str, list[str]], edges: dict[str, dict]) -> None:
    node_by_file_symbol = {}
    for node in nodes.values():
        symbol = node["metadata"].get("symbol")
        if symbol:
            node_by_file_symbol[(node["file"], symbol)] = node
    for record in records:
        if record["language"] not in WEB_LANGUAGES:
            continue
        text = record["text"]
        rel_path = record["rel_path"]
        for source_node in [node for node in nodes.values() if node["file"] == rel_path and node["kind"] in {"function", "component", "hook", "api_client", "context", "provider", "page", "layout", "form", "store", "reducer"}]:
            line_start = source_node["line_start"] or 1
            line_end = source_node["line_end"] or line_start
            source_body = "\n".join(text.splitlines()[line_start - 1 : line_end])
            for call_match in CALL_RE.finditer(source_body):
                name = call_match.group(1)
                if name == source_node["label"]:
                    continue
                target_node = node_by_file_symbol.get((rel_path, name))
                if not target_node:
                    target_ids = symbol_lookup.get(name, [])
                    if len(target_ids) == 1:
                        target_node = nodes[target_ids[0]]
                if target_node and target_node["id"] != source_node["id"]:
                    add_unique_edge(
                        edges,
                        make_edge(
                            source_node["id"],
                            target_node["id"],
                            "calls",
                            f"`{source_node['label']}` calls `{name}`",
                            [make_evidence("typescript_call", rel_path, line_start, line_end, f"call to {name}")],
                        ),
                    )
            for jsx_match in JSX_COMPONENT_RE.finditer(source_body):
                name = jsx_match.group(1)
                target_ids = symbol_lookup.get(name, [])
                if len(target_ids) == 1 and target_ids[0] != source_node["id"]:
                    add_unique_edge(
                        edges,
                        make_edge(
                            source_node["id"],
                            target_ids[0],
                            "renders",
                            f"`{source_node['label']}` renders `{name}`",
                            [make_evidence("tsx_jsx", rel_path, line_start, line_end, f"JSX component {name}")],
                        ),
                    )


def add_style_edges(records: list[dict], nodes: dict[str, dict], class_lookup: dict[str, str], edges: dict[str, dict]) -> None:
    for record in records:
        if record["language"] not in {"tsx", "jsx"}:
            continue
        text = record["text"]
        rel_path = record["rel_path"]
        owner_nodes = [node for node in nodes.values() if node["file"] == rel_path and node["kind"] in {"component", "hook", "function", "page", "layout", "form", "provider"}]
        for match in CLASSNAME_RE.finditer(text):
            class_text = match.group(1) or match.group(2) or ""
            classes = [item.strip() for item in class_text.split() if item.strip()]
            line = line_number_at(text, match.start())
            owner = None
            for node in owner_nodes:
                if node["line_start"] and node["line_end"] and node["line_start"] <= line <= node["line_end"]:
                    owner = node
                    break
            if not owner:
                continue
            for class_name in classes:
                style_id = class_lookup.get(class_name)
                if not style_id:
                    continue
                add_unique_edge(
                    edges,
                    make_edge(
                        owner["id"],
                        style_id,
                        "uses_style",
                        f"`{owner['label']}` uses CSS class `.{class_name}`",
                        [make_evidence("tsx_className", rel_path, line, line, f"className {class_name}")],
                    ),
                )


def add_type_reference_edges(nodes: dict[str, dict], symbol_lookup: dict[str, list[str]], edges: dict[str, dict]) -> None:
    type_nodes = {node["label"]: node for node in nodes.values() if node["kind"] in {"type", "schema", "interface", "type_alias", "enum"}}
    for node in nodes.values():
        if node["kind"] not in {"function", "component", "hook", "api_client", "context", "provider", "page", "layout", "form", "store", "reducer"}:
            continue
        contract_text = str(node.get("contracts", {}))
        for type_name, type_node in type_nodes.items():
            if type_name in contract_text and type_node["id"] != node["id"]:
                add_unique_edge(
                    edges,
                    make_edge(
                        node["id"],
                        type_node["id"],
                        "uses_schema",
                        f"`{node['label']}` references type `{type_name}`",
                        [make_evidence("typescript_annotation", node["file"], node["line_start"], node["line_start"], f"type reference {type_name}")],
                    ),
                )


def extract_typescript_graph(records: list[dict]) -> dict:
    warnings = []
    nodes = {}
    edges = {}
    css_nodes, class_lookup, css_warnings = extract_css_nodes(records)
    warnings.extend(css_warnings)
    for node in css_nodes.values():
        nodes[node["id"]] = node
    for node in extract_html_nodes(records).values():
        nodes[node["id"]] = node
    for record in records:
        if record["language"] not in WEB_LANGUAGES:
            continue
        for node in extract_type_nodes(record, warnings).values():
            nodes[node["id"]] = node
        for node in extract_function_nodes(record, warnings).values():
            nodes[node["id"]] = node
    symbol_lookup = {}
    for node in nodes.values():
        symbol = node["metadata"].get("symbol")
        if symbol:
            symbol_lookup.setdefault(symbol, []).append(node["id"])
    file_lookup = build_file_lookup(records)
    add_import_edges(records, file_lookup, edges)
    add_symbol_edges(records, nodes, symbol_lookup, edges)
    add_style_edges(records, nodes, class_lookup, edges)
    add_type_reference_edges(nodes, symbol_lookup, edges)
    return {
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "symbol_lookup": symbol_lookup,
        "class_lookup": class_lookup,
        "warnings": warnings,
    }

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from cartographer_common import attach_fingerprints, copy_graph_for_visualiser, deterministic_fingerprint, guess_language, read_text, should_skip_path, write_json


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
GRAPH_PATH = ".repo_executive_context/codebase_cartographer/graph.json"
SUMMARY_OUTPUT_PATH = ".repo_executive_context/codebase_cartographer/semantic_node_summaries.json"
CONTEXT_OUTPUT_PATH = ".repo_executive_context/codebase_cartographer/semantic_node_context.json"
MAX_EXCERPT_LINES = 18
MAX_EXCERPT_CHARS = 1800
MAX_EXCERPT_LINE_CHARS = 220
MIN_AGENTIC_POINTS = 10
MAX_AGENTIC_POINTS = 12
TARGET_NODE_KINDS: set[str] | None = None
SERVICE_SUMMARY_OVERRIDES: dict[str, dict[str, object]] = {}


DOMAIN_PATTERNS: list[tuple[tuple[str, ...], str]] = [
    (("entra", "jwt", "jwks", "token"), "Entra ID/JWT token validation"),
    (("auth", "authenticate", "authorization", "credential", "login", "session"), "authentication and user access control"),
    (("blob", "sas", "artifact"), "blob artifact access and SAS links"),
    (("sql", "postgres", "postgresql", "database", "db"), "SQL/database persistence"),
    (("transaction",), "transaction logging"),
    (("job", "job id", "job_id"), "job ID tracking"),
    (("expa",), "EXPA assessment workflow"),
    (("cad", "glb", "model"), "CAD/model extraction and conversion"),
    (("inventory", "part", "variant"), "inventory and part versioning"),
    (("order",), "order management"),
    (("supplier",), "supplier management"),
    (("quality", "inspection", "report"), "quality and inspection reporting"),
    (("manufacturing", "requirement"), "manufacturing requirements"),
    (("dashboard", "ranking"), "dashboard and ranking views"),
    (("ingestion", "upload", "extract"), "ingestion and extraction flows"),
    (("secure", "share"), "secure sharing"),
    (("orchestrator", "workflow", "dispatch"), "workflow orchestration"),
    (("react", "tsx", "component", "page", "layout", "sidebar"), "React UI experience"),
    (("api", "endpoint", "route", "request", "response"), "API routing and integration"),
]

GENERIC_NODE_WORDS = {
    "a0",
    "a1",
    "d0",
    "d1",
    "d2",
    "d3",
    "t0",
    "t1",
    "t2",
    "t3",
    "t4",
    "t5",
    "t6",
    "t7",
    "t8",
    "t9",
    "aca",
    "app",
    "file",
    "main",
    "module",
    "page",
    "pages",
    "py",
    "tsx",
    "ts",
    "jsx",
    "js",
    "css",
    "json",
    "md",
    "html",
}

ACTION_VERBS = {
    "activate": "activate",
    "build": "build",
    "convert": "convert",
    "create": "create",
    "delete": "delete",
    "download": "download",
    "edit": "edit",
    "ensure": "ensure",
    "extract": "extract",
    "format": "format",
    "generate": "generate",
    "get": "retrieve",
    "handle": "handle",
    "inspect": "inspect",
    "list": "list",
    "load": "load",
    "log": "log",
    "navigate": "navigate",
    "post": "submit",
    "put": "update",
    "read": "read",
    "refresh": "refresh",
    "resolve": "resolve",
    "save": "save",
    "select": "select",
    "send": "send",
    "start": "start",
    "tag": "tag",
    "update": "update",
    "upload": "upload",
    "validate": "validate",
    "verify": "verify",
}

DISPLAY_TERMS = {
    "api": "API",
    "cad": "CAD",
    "db": "database",
    "expa": "EXPA",
    "glb": "GLB",
    "id": "ID",
    "jwt": "JWT",
    "jwks": "JWKS",
    "sas": "SAS",
    "sql": "SQL",
    "ui": "UI",
}

GENERIC_CALLS = {
    "BaseModel",
    "Depends",
    "Dict",
    "Field",
    "HTTPException",
    "JSONResponse",
    "Literal",
    "Optional",
    "Request",
    "get",
    "post",
    "put",
    "delete",
    "patch",
}


# ============================================================
# SOURCE EXCERPTS
# ============================================================

def graph_source_root(repo_root: Path, graph: dict) -> Path:
    graph_root = graph.get("repo", {}).get("root")
    if graph_root:
        path = Path(graph_root)
        if path.is_absolute():
            return path.resolve()
        return (repo_root / path).resolve()
    return repo_root.resolve()


def safe_source_path(source_root: Path, file_path: str | None) -> Path | None:
    if not file_path:
        return None
    candidate = (source_root / file_path).resolve()
    try:
        candidate.relative_to(source_root.resolve())
    except ValueError:
        return None
    if not candidate.exists() or not candidate.is_file():
        return None
    if should_skip_path(candidate, source_root):
        return None
    return candidate


def compact_line(line: str) -> str:
    value = line.rstrip()
    if len(value) <= MAX_EXCERPT_LINE_CHARS:
        return value
    return value[: MAX_EXCERPT_LINE_CHARS - 21].rstrip() + " ... [line truncated]"


def tail_priority(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    return bool(
        re.search(
            r"\b(return|raise|yield|except|finally|with|commit|execute|fetch|send|post|get|put|delete)\b",
            stripped,
            re.IGNORECASE,
        )
        or stripped in {"}", "});", ");", "]", ")"}
    )


def truncate_excerpt_lines(lines: list[str]) -> tuple[list[str], int, str]:
    compacted = [compact_line(line) for line in lines]
    if len(compacted) <= MAX_EXCERPT_LINES and len("\n".join(compacted)) <= MAX_EXCERPT_CHARS:
        return compacted, 0, "none"

    head_count = min(12, max(6, MAX_EXCERPT_LINES - 6), len(compacted))
    remaining = compacted[head_count:]
    tail_count = min(4, max(0, MAX_EXCERPT_LINES - head_count - 1), len(remaining))
    tail = remaining[-tail_count:] if tail_count else []
    for index in range(len(remaining) - 1, -1, -1):
        if tail_priority(remaining[index]):
            start = max(0, index - tail_count + 1)
            tail = remaining[start : start + tail_count]
            break

    omitted = max(0, len(compacted) - head_count - len(tail))
    excerpt = compacted[:head_count] + [f"... {omitted} lines omitted ..."] + tail
    while len("\n".join(excerpt)) > MAX_EXCERPT_CHARS and head_count > 5:
        head_count -= 1
        omitted = max(0, len(compacted) - head_count - len(tail))
        excerpt = compacted[:head_count] + [f"... {omitted} lines omitted ..."] + tail
    return excerpt, omitted, "middle_omitted"


def build_code_excerpt(node: dict, source_root: Path) -> dict | None:
    line_start = node.get("line_start")
    line_end = node.get("line_end")
    path = safe_source_path(source_root, node.get("file"))
    if not path or not isinstance(line_start, int) or not isinstance(line_end, int):
        return None
    if line_start < 1 or line_end < line_start:
        return None
    text = read_text(path)
    lines = text.splitlines()
    if not lines:
        return None
    start = max(1, min(line_start, len(lines)))
    end = max(start, min(line_end, len(lines)))
    selected = lines[start - 1 : end]
    excerpt_lines, omitted, truncation = truncate_excerpt_lines(selected)
    return {
        "text": "\n".join(excerpt_lines),
        "language": node.get("language") or guess_language(path),
        "file": node.get("file"),
        "line_start": start,
        "line_end": end,
        "omitted_lines": omitted,
        "truncation": truncation,
        "source": "deterministic_source_slice",
    }


def attach_code_excerpts_to_nodes(nodes: list[dict], source_root: str | Path) -> None:
    root = Path(source_root).resolve()
    for node in nodes:
        excerpt = build_code_excerpt(node, root)
        if not excerpt:
            continue
        details = dict(node.get("details") or {})
        details["code_excerpt"] = excerpt
        node["details"] = details


# ============================================================
# SEMANTIC SUMMARIES
# ============================================================

def human_label(value: str) -> str:
    cleaned = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
    cleaned = cleaned.replace("_", " ").replace("-", " ").replace("/", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or value


def node_in_target(node: dict) -> bool:
    if TARGET_NODE_KINDS is None:
        return True
    return node.get("kind") in TARGET_NODE_KINDS


def normalise_profile_key(value: object) -> str:
    return str(value or "").strip().lower()


def service_profile(node: dict) -> dict:
    for key in [node.get("id"), node.get("label"), node.get("file")]:
        profile = SERVICE_SUMMARY_OVERRIDES.get(normalise_profile_key(key))
        if isinstance(profile, dict):
            return profile
    return {}


def normalise_points(points: object, limit: int = MAX_AGENTIC_POINTS) -> list[str]:
    if not isinstance(points, list):
        return []
    values = []
    for point in points:
        text = str(point).strip()
        if not text:
            continue
        values.append(text)
        if len(values) >= limit:
            break
    return values


def unique_text(items: list[object], limit: int = 4) -> list[str]:
    seen = set()
    values = []
    for item in items:
        if isinstance(item, dict):
            value = item.get("label") or item.get("target") or item.get("source") or item.get("name")
        else:
            value = item
        if value is None:
            continue
        text = str(value)
        if not text or text in seen:
            continue
        seen.add(text)
        values.append(text)
        if len(values) >= limit:
            break
    return values


def join_names(items: list[str]) -> str:
    if not items:
        return ""
    quoted = [f"`{item}`" for item in items]
    if len(quoted) == 1:
        return quoted[0]
    return ", ".join(quoted[:-1]) + f", and {quoted[-1]}"


def connection_items(node: dict, direction: str, edge_kind: str | None = None) -> list[dict]:
    connections = node.get("details", {}).get("connections", {})
    items = connections.get(direction, []) if isinstance(connections, dict) else []
    if edge_kind:
        items = [item for item in items if item.get("edge") == edge_kind]
    return items


def node_file_name(node: dict) -> str:
    file_path = node.get("file") or ""
    return Path(file_path).name or file_path or "unknown file"


def interface_text(node: dict) -> str:
    interface = node.get("details", {}).get("interface", {})
    if not isinstance(interface, dict):
        return ""
    params = unique_text(interface.get("parameters", []), 4)
    returns = interface.get("returns")
    parts = []
    if params:
        parts.append(f"accepts {join_names(params)}")
    if returns:
        parts.append(f"returns `{returns}`")
    return " and ".join(parts)


def details_dict(node: dict) -> dict:
    details = node.get("details", {})
    return details if isinstance(details, dict) else {}


def connections_dict(node: dict) -> dict:
    connections = details_dict(node).get("connections", {})
    return connections if isinstance(connections, dict) else {}


def child_items(node: dict, kinds: set[str] | None = None) -> list[dict]:
    children = connections_dict(node).get("children", [])
    if not isinstance(children, list):
        return []
    if kinds is None:
        return children
    return [item for item in children if item.get("kind") in kinds]


def child_labels(node: dict, kinds: set[str] | None = None, limit: int = 6) -> list[str]:
    return unique_text(child_items(node, kinds), limit)


def code_excerpt_text(node: dict) -> str:
    excerpt = details_dict(node).get("code_excerpt", {})
    if isinstance(excerpt, dict):
        return str(excerpt.get("text") or "")
    return ""


def signal_blob(values: list[object]) -> str:
    parts = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, dict):
            parts.extend(str(item) for item in value.values() if item is not None)
        elif isinstance(value, list):
            parts.extend(str(item) for item in value if item is not None)
        else:
            parts.append(str(value))
    text = " ".join(parts)
    text = human_label(text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def contains_signal(blob: str, term: str) -> bool:
    pattern = re.escape(term.lower()).replace(r"\ ", r"\s+")
    return bool(re.search(rf"\b{pattern}\b", blob))


def extract_capability_phrases(values: list[object], limit: int = 5) -> list[str]:
    blob = signal_blob(values)
    phrases = []
    for terms, phrase in DOMAIN_PATTERNS:
        if any(contains_signal(blob, term) for term in terms):
            phrases.append(phrase)
        if len(phrases) >= limit:
            break
    return phrases


def phrase_list(items: list[str]) -> str:
    values = [item for item in items if item]
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return ", ".join(values[:-1]) + f", and {values[-1]}"


def clean_name_tokens(value: object) -> list[str]:
    text = str(value or "")
    text = re.sub(r"\.(py|tsx|ts|jsx|js|css|json|md|html)$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(GET|POST|PUT|PATCH|DELETE)\s+", "", text, flags=re.IGNORECASE)
    text = human_label(text).lower()
    tokens = re.findall(r"[a-z0-9]+", text)
    return [token for token in tokens if token not in GENERIC_NODE_WORDS and not token.isdigit()]


def display_terms(tokens: list[str], limit: int = 6) -> str:
    terms = [DISPLAY_TERMS.get(token, token) for token in tokens[:limit]]
    return " ".join(terms)


def action_phrase_from_name(value: object) -> str:
    tokens = clean_name_tokens(value)
    if not tokens:
        return ""
    if tokens == ["health"]:
        return "report service health"
    for index, token in enumerate(tokens):
        verb = ACTION_VERBS.get(token)
        if not verb:
            continue
        target_tokens = tokens[:index] + tokens[index + 1 :]
        target = display_terms(target_tokens)
        return f"{verb} {target}".strip()
    return f"handle {display_terms(tokens)}".strip()


def useful_calls(details: dict, limit: int = 4) -> list[str]:
    calls = []
    for call in unique_text(details.get("calls", []), 12):
        if call in GENERIC_CALLS:
            continue
        calls.append(call)
        if len(calls) >= limit:
            break
    return calls


def file_role(node: dict, children: list[dict], blob: str) -> str:
    language = str(node.get("language") or "").lower()
    label = str(node.get("label") or "").lower()
    endpoint_count = sum(1 for child in children if child.get("kind") in {"api_endpoint", "websocket_endpoint", "route"})
    if endpoint_count or contains_signal(blob, "fastapi"):
        return "Defines backend API routes"
    if "dockerfile" in label:
        return "Defines container runtime setup"
    if "settings" in label or "config" in label:
        return "Defines runtime configuration"
    if contains_signal(blob, "jwt") or contains_signal(blob, "jwks") or contains_signal(blob, "token"):
        return "Implements token and identity support"
    if language in {"tsx", "jsx"} or label.endswith((".tsx", ".jsx")):
        return "Implements a React UI module"
    if language in {"typescript", "javascript", "ts", "js"} and ("service" in label or "api" in label):
        return "Implements frontend API/service integration"
    if language == "python" or label.endswith(".py"):
        return "Implements backend service logic"
    if language in {"typescript", "javascript", "ts", "js"}:
        return "Implements frontend application logic"
    if language == "markdown" or label.endswith(".md"):
        return "Documents operational or architectural context"
    return f"Explains the role of `{node.get('label', node_file_name(node))}`"


def summarize_api_node(node: dict) -> str:
    details = node.get("details", {})
    overview = details.get("overview", {}) if isinstance(details.get("overview"), dict) else {}
    method = overview.get("method")
    path = overview.get("path")
    handler = overview.get("handler")
    endpoint = f"{method} {path}".strip() if method or path else node.get("label", "this endpoint")
    calls = useful_calls(details, 4)
    auth = unique_text(details.get("auth_or_dependencies", []), 2)
    action = action_phrase_from_name(handler or path or node.get("label"))
    summary = f"Handles `{endpoint}`"
    if action:
        summary += f" to {action}"
    if handler:
        summary += f" through `{handler}`"
    summary += "."
    extras = []
    if auth:
        extras.append(f"uses {join_names(auth)} for request identity or context")
    if calls:
        extras.append(f"delegates downstream work to {join_names(calls)}")
    if extras:
        summary += " It " + " and ".join(extras) + "."
    return summary


def summarize_callable_node(node: dict) -> str:
    details = node.get("details", {})
    label = node.get("label", "this callable")
    action = human_label(label)
    calls = unique_text(details.get("calls", []), 4)
    callers = unique_text(connection_items(node, "incoming", "calls"), 3)
    iface = interface_text(node)
    summary = f"Implements `{label}` to handle {action} in `{node_file_name(node)}`."
    if iface:
        summary += f" It {iface}."
    if calls:
        summary += f" It calls {join_names(calls)}."
    elif callers:
        summary += f" It is called by {join_names(callers)}."
    return summary


def summarize_class_node(node: dict) -> str:
    details = node.get("details", {})
    fields = details.get("fields", {}) if isinstance(details.get("fields"), dict) else {}
    methods = unique_text(details.get("methods", []), 4)
    label = node.get("label", "this class")
    summary = f"Defines `{label}` as a {human_label(node.get('kind', 'class'))} in `{node_file_name(node)}`."
    if fields:
        summary += f" It carries fields such as {join_names(unique_text(list(fields.keys()), 4))}."
    if methods:
        summary += f" Its behavior is organized through {join_names(methods)}."
    users = unique_text(connection_items(node, "incoming", "uses_schema"), 3)
    if users:
        summary += f" It is used by {join_names(users)}."
    return summary


def summarize_file_node(node: dict) -> str:
    details = details_dict(node)
    children = child_items(node)
    labels = child_labels(node, limit=10)
    calls = useful_calls(details, 4)
    excerpt = code_excerpt_text(node)
    blob = signal_blob([node.get("label"), node.get("file"), labels, calls, excerpt])
    capabilities = extract_capability_phrases([node.get("label"), node.get("file"), labels, calls, excerpt], 5)
    actions = [action_phrase_from_name(label) for label in labels]
    actions = [action for action in actions if action][:4]
    apis = child_labels(node, {"api_endpoint", "websocket_endpoint", "route"}, 4)
    schemas = child_labels(node, {"pydantic_model", "schema", "model", "dataclass", "typed_dict", "interface", "type_alias"}, 3)
    role = file_role(node, children, blob)
    summary = role
    if capabilities:
        summary += f" for {phrase_list(capabilities)}"
    elif actions:
        summary += f" around {phrase_list(actions[:3])}"
    summary += "."
    if apis:
        summary += f" It exposes routes such as {join_names(apis[:3])}."
    elif calls:
        summary += f" It coordinates with {join_names(calls)}."
    elif actions:
        summary += f" Its main behavior includes {phrase_list(actions)}."
    if schemas:
        summary += f" Data contracts include {join_names(schemas)}."
    return summary


def summarize_service_node(node: dict) -> str:
    profile = service_profile(node)
    summary = profile.get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    details = details_dict(node)
    service = details.get("service", {}) if isinstance(details.get("service"), dict) else {}
    children = child_items(node)
    labels = child_labels(node, limit=80)
    majority = service.get("majority_file_type") or node.get("metadata", {}).get("majority_file_type")
    role = service.get("service_role") or node.get("metadata", {}).get("service_role")
    capabilities = extract_capability_phrases([node.get("label"), node.get("file"), labels, majority, role], 5)
    if majority == "react":
        summary = "Owns the React frontend surface"
    elif majority == "python":
        summary = "Owns a Python backend service"
    else:
        summary = "Owns a deployable workspace service"
    if capabilities:
        summary += f" for {phrase_list(capabilities)}"
    else:
        summary += f" for {human_label(str(node.get('label') or node.get('file') or 'this service')).lower()}"
    summary += "."
    names = join_names(unique_text(children, 4))
    if names:
        summary += f" Evidence comes from key files such as {names}."
    return summary


def service_points(node: dict) -> list[str]:
    profile = service_profile(node)
    points = normalise_points(profile.get("points"))
    if points:
        return points
    details = details_dict(node)
    service = details.get("service", {}) if isinstance(details.get("service"), dict) else {}
    children = child_items(node)
    child_counts = Counter(item.get("kind", "node") for item in children)
    labels = child_labels(node, limit=80)
    majority = service.get("majority_file_type") or node.get("metadata", {}).get("majority_file_type")
    capabilities = extract_capability_phrases([node.get("label"), node.get("file"), labels, majority], 5)
    values = []
    if capabilities:
        runtime = "React frontend" if majority == "react" else "Python backend" if majority == "python" else "workspace service"
        values.append(f"Role: {runtime} for {phrase_list(capabilities)}.")
    if children:
        count_text = ", ".join(f"{count} {kind}" for kind, count in sorted(child_counts.items())[:3])
        if not values:
            values.append(f"Scope: mapped service area containing {count_text}.")
        names = join_names(unique_text(children, 4))
        if names:
            values.append(f"Evidence: key files include {names}.")
    return values


def file_points(node: dict) -> list[str]:
    details = details_dict(node)
    labels = child_labels(node, limit=10)
    calls = useful_calls(details, 4)
    excerpt = code_excerpt_text(node)
    capabilities = extract_capability_phrases([node.get("label"), node.get("file"), labels, calls, excerpt], 5)
    actions = [action_phrase_from_name(label) for label in labels]
    actions = [action for action in actions if action][:4]
    apis = child_labels(node, {"api_endpoint", "websocket_endpoint", "route"}, 4)
    schemas = child_labels(node, {"pydantic_model", "schema", "model", "dataclass", "typed_dict", "interface", "type_alias"}, 3)
    values = []
    if capabilities:
        values.append(f"Role: {phrase_list(capabilities)}.")
    if actions:
        values.append(f"Behavior: {phrase_list(actions)}.")
    if apis:
        values.append(f"Routes: {join_names(apis)}.")
    if schemas:
        values.append(f"Contracts: {join_names(schemas)}.")
    return values[:4]


def api_points(node: dict) -> list[str]:
    details = details_dict(node)
    overview = details.get("overview", {}) if isinstance(details.get("overview"), dict) else {}
    endpoint = f"{overview.get('method')} {overview.get('path')}".strip()
    handler = overview.get("handler")
    action = action_phrase_from_name(handler or endpoint or node.get("label"))
    auth = unique_text(details.get("auth_or_dependencies", []), 2)
    calls = useful_calls(details, 4)
    values = []
    if action:
        values.append(f"Action: {action}.")
    if handler:
        values.append(f"Handler: `{handler}`.")
    if auth:
        values.append(f"Context/security: {join_names(auth)}.")
    if calls:
        values.append(f"Downstream calls: {join_names(calls)}.")
    return values[:4]


def append_point(points: list[str], value: str) -> None:
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        return
    if not text.endswith("."):
        text += "."
    if text not in points:
        points.append(text)


def source_signal_lines(node: dict, limit: int = 4) -> list[str]:
    excerpt = code_excerpt_text(node)
    if not excerpt:
        return []
    values = []
    for line in excerpt.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("//"):
            continue
        if re.search(r"\b(def|class|return|raise|await|with|for|if|fetch|post|get|put|delete|execute|commit|send)\b", stripped, re.IGNORECASE):
            values.append(stripped)
        if len(values) >= limit:
            break
    return values


def contract_status_text(node: dict) -> str:
    contracts = node.get("contracts", {}) if isinstance(node.get("contracts"), dict) else {}
    statuses = []
    for name in ["request", "response"]:
        contract = contracts.get(name, {})
        if isinstance(contract, dict):
            statuses.append(f"{name}={contract.get('status', 'unknown')}")
    return ", ".join(statuses)


def connection_labels(node: dict, direction: str, limit: int = 4) -> list[str]:
    items = connections_dict(node).get(direction, [])
    if not isinstance(items, list):
        return []
    return unique_text(items, limit)


def minimum_semantic_points(node: dict, base_points: list[str]) -> list[str]:
    points = normalise_points(base_points)
    details = details_dict(node)
    label = str(node.get("label") or node.get("id") or "node")
    kind = str(node.get("kind") or "node")
    file_name = node_file_name(node)
    deterministic = str(node.get("summary", {}).get("deterministic") or "").strip()
    evidence = node.get("evidence", []) if isinstance(node.get("evidence"), list) else []
    children = child_labels(node, limit=6)
    incoming = connection_labels(node, "incoming", 4)
    outgoing = connection_labels(node, "outgoing", 4)
    calls = useful_calls(details, 4)
    source_lines = source_signal_lines(node, 4)
    contract_text = contract_status_text(node)
    overview = details.get("overview", {}) if isinstance(details.get("overview"), dict) else {}
    capabilities = extract_capability_phrases([label, node.get("file"), children, calls, code_excerpt_text(node)], 5)

    append_point(points, f"Identity: `{label}` is a `{human_label(kind)}` node mapped from `{file_name}`")
    if node.get("line_start") and node.get("line_end"):
        append_point(points, f"Source span: lines {node.get('line_start')}-{node.get('line_end')} anchor the mapped implementation")
    if deterministic:
        append_point(points, f"Deterministic role: {deterministic}")
    if capabilities:
        append_point(points, f"Domain signals: {phrase_list(capabilities)}")
    if overview:
        method = overview.get("method")
        path = overview.get("path")
        handler = overview.get("handler")
        if method or path:
            append_point(points, f"Runtime surface: `{method or ''} {path or ''}`".strip())
        if handler:
            append_point(points, f"Handler cue: `{handler}` is the callable entry point")
    if children:
        append_point(points, f"Contained behavior: key child nodes include {join_names(children[:4])}")
    if calls:
        append_point(points, f"Internal work: calls {join_names(calls)}")
    if outgoing:
        append_point(points, f"Outgoing graph links: reaches {join_names(outgoing)}")
    if incoming:
        append_point(points, f"Incoming graph links: reached by {join_names(incoming)}")
    if contract_text:
        append_point(points, f"Contract evidence: {contract_text}")
    for index, line in enumerate(source_lines, start=1):
        append_point(points, f"Source cue {index}: `{line}`")
    for item in evidence[:3]:
        if not isinstance(item, dict):
            continue
        detail = item.get("detail") or item.get("kind")
        source = item.get("file") or file_name
        append_point(points, f"Evidence: {detail} from `{source}`")
    while len(points) < MIN_AGENTIC_POINTS:
        append_point(points, f"Confidence note: no stronger source signal was available for point {len(points) + 1}; inspect `{file_name}` for deeper manual review")
    return points[:MAX_AGENTIC_POINTS]


def semantic_points_for_node(node: dict) -> list[str]:
    if node.get("kind") == "service":
        return minimum_semantic_points(node, service_points(node))
    if node.get("kind") in {"file", "module", "package"}:
        return minimum_semantic_points(node, file_points(node))
    if node.get("kind") in {"api_endpoint", "websocket_endpoint"}:
        return minimum_semantic_points(node, api_points(node))
    return minimum_semantic_points(node, [])


def summarize_config_node(node: dict) -> str:
    details = node.get("details", {})
    config = details.get("config", {}) if isinstance(details.get("config"), dict) else {}
    keys = unique_text(config.get("top_level_keys", []), 4)
    summary = f"Captures `{node.get('label')}` as project configuration or runbook context."
    if keys:
        summary += f" Key entries include {join_names(keys)}."
    return summary


def summarize_node(node: dict) -> str:
    kind = node.get("kind")
    if kind in {"api_endpoint", "websocket_endpoint"}:
        return summarize_api_node(node)
    if kind in {"function", "method", "constructor", "background_task", "cli_command"}:
        return summarize_callable_node(node)
    if kind in {"class", "exception", "schema", "model", "dataclass", "pydantic_model", "typed_dict", "interface", "type_alias", "enum"}:
        return summarize_class_node(node)
    if kind == "service":
        return summarize_service_node(node)
    if kind == "config_file":
        return summarize_config_node(node)
    if kind in {"file", "module", "package"}:
        return summarize_file_node(node)
    deterministic = node.get("summary", {}).get("deterministic")
    if deterministic:
        return deterministic
    return f"Represents `{node.get('label', node.get('id'))}` as a `{kind}` node in the codebase graph."


def context_item(node: dict) -> dict:
    details = node.get("details", {})
    return {
        "node_id": node["id"],
        "fingerprint": node.get("fingerprint") or deterministic_fingerprint(node),
        "kind": node.get("kind"),
        "label": node.get("label"),
        "file": node.get("file"),
        "line_start": node.get("line_start"),
        "line_end": node.get("line_end"),
        "deterministic_summary": node.get("summary", {}).get("deterministic"),
        "overview": details.get("overview"),
        "connections": details.get("connections"),
        "code_excerpt": details.get("code_excerpt"),
        "requested_agentic_field": "summary.agentic",
        "requested_agentic_points_field": "summary.agentic_points",
    }


def build_summary_payload(graph: dict) -> dict:
    items = []
    for node in graph.get("nodes", []):
        if not node_in_target(node):
            continue
        items.append(
            {
                "node_id": node["id"],
                "fingerprint": node.get("fingerprint") or deterministic_fingerprint(node),
                "summary": summarize_node(node),
                "points": semantic_points_for_node(node),
                "requested_agentic_field": "summary.agentic",
                "requested_agentic_points_field": "summary.agentic_points",
            }
        )
    return {
        "purpose": "Codex semantic node summaries. Apply only when node_id and fingerprint match.",
        "graph_path": GRAPH_PATH,
        "nodes": items,
        "counts": {
            "nodes": len(items),
            "target_node_kinds": sorted(TARGET_NODE_KINDS) if TARGET_NODE_KINDS is not None else "all",
        },
    }


def apply_summary_payload(graph: dict, payload: dict) -> dict:
    nodes_by_id = {node["id"]: node for node in graph.get("nodes", [])}
    applied = 0
    skipped = 0
    for item in payload.get("nodes", []):
        node = nodes_by_id.get(item.get("node_id"))
        if not node:
            skipped += 1
            continue
        if (node.get("fingerprint") or deterministic_fingerprint(node)) != item.get("fingerprint"):
            skipped += 1
            continue
        summary = dict(node.get("summary") or {})
        summary["agentic"] = item.get("summary")
        summary["agentic_status"] = "complete" if item.get("summary") else "not_enriched"
        if "points" in item:
            summary["agentic_points"] = normalise_points(item.get("points"))
        node["summary"] = summary
        applied += 1
    return {"applied": applied, "skipped": skipped}


# ============================================================
# ENRICHMENT
# ============================================================

def enrich_graph(graph: dict, repo_root: str | Path) -> tuple[dict, dict, dict, dict]:
    root = Path(repo_root).resolve()
    source_root = graph_source_root(root, graph)
    attach_code_excerpts_to_nodes(graph.get("nodes", []), source_root)
    attach_fingerprints(graph.get("nodes", []), graph.get("edges", []))
    context_payload = {
        "purpose": "Compact evidence pack for Codex semantic node summary generation.",
        "graph_path": GRAPH_PATH,
        "source_root": str(source_root),
        "nodes": [context_item(node) for node in graph.get("nodes", []) if node_in_target(node)],
        "counts": {
            "nodes": sum(1 for node in graph.get("nodes", []) if node_in_target(node)),
            "nodes_with_code_excerpt": sum(1 for node in graph.get("nodes", []) if node_in_target(node) and node.get("details", {}).get("code_excerpt")),
        },
    }
    summary_payload = build_summary_payload(graph)
    apply_result = apply_summary_payload(graph, summary_payload)
    attach_fingerprints(graph.get("nodes", []), graph.get("edges", []))
    return graph, context_payload, summary_payload, apply_result


def enrich_graph_file(
    repo_root: str | Path = REPO_ROOT,
    graph_path: str | Path = GRAPH_PATH,
    context_output_path: str | Path = CONTEXT_OUTPUT_PATH,
    summary_output_path: str | Path = SUMMARY_OUTPUT_PATH,
) -> dict:
    root = Path(repo_root).resolve()
    graph_file = root / graph_path
    graph = json.loads(graph_file.read_text(encoding="utf-8"))
    graph, context_payload, summary_payload, apply_result = enrich_graph(graph, root)
    write_json(root / context_output_path, context_payload)
    write_json(root / summary_output_path, summary_payload)
    write_json(graph_file, graph)
    copied_to = copy_graph_for_visualiser(graph_file, root)
    return {
        "graph": str(graph_file),
        "visualiser_graph": str(copied_to) if copied_to else None,
        "context": str(root / context_output_path),
        "summaries": str(root / summary_output_path),
        "nodes": len(graph.get("nodes", [])),
        "nodes_with_agentic_summary": sum(1 for node in graph.get("nodes", []) if node.get("summary", {}).get("agentic")),
        "nodes_with_code_excerpt": sum(1 for node in graph.get("nodes", []) if node.get("details", {}).get("code_excerpt")),
        "applied": apply_result["applied"],
        "skipped": apply_result["skipped"],
    }


def main() -> dict:
    result = enrich_graph_file(REPO_ROOT, GRAPH_PATH, CONTEXT_OUTPUT_PATH, SUMMARY_OUTPUT_PATH)
    print(f"semantic graph: {result['graph']}")
    if result.get("visualiser_graph"):
        print(f"visualiser graph: {result['visualiser_graph']}")
    print(f"semantic summaries: {result['nodes_with_agentic_summary']}/{result['nodes']}")
    print(f"code excerpts: {result['nodes_with_code_excerpt']}/{result['nodes']}")
    print(f"summary artifact: {result['summaries']}")
    print(f"context artifact: {result['context']}")
    if result["skipped"]:
        print(f"skipped stale summaries: {result['skipped']}")
    return result


if __name__ == "__main__":
    main()

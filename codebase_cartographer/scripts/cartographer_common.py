from __future__ import annotations

from collections import Counter
import hashlib
import json
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


# ============================================================
# CONFIG
# ============================================================

SCHEMA_VERSION = "0.2.0"

SUPPORTED_EXTENSIONS = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "jsx",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".css": "css",
    ".html": "html",
    ".htm": "html",
    ".sql": "sql",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".md": "markdown",
}

SKIP_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".mypy_cache",
    ".pytest_cache",
    ".repo_executive_context",
    ".repo_executive_context/codebase_index_n_search",
    ".repo_executive_context/codebase_cartographer",
    "codebase_cartographer/assets",
    "visualiser/public/codebase_cartographer",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".venv",
    "venv",
    "env",
}

SKIP_FILE_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}

STATUS_VALUES = {
    "complete",
    "partial",
    "unknown",
    "not_declared",
    "inferred_from_usage",
}

NODE_KIND_COLORS = {
    "workspace": "#ffdf6e",
    "service": "#ff9d2e",
    "package": "#ffbd59",
    "module": "#b5e7ff",
    "config_file": "#b9fbc0",
    "api_endpoint": "#ff174d",
    "api_client": "#ffb000",
    "route": "#ff719a",
    "websocket_endpoint": "#ff5bbd",
    "background_task": "#a78bfa",
    "cli_command": "#92f2ff",
    "component": "#35d3ff",
    "hook": "#7cff6b",
    "context": "#45f0b5",
    "provider": "#2dd4bf",
    "page": "#93c5fd",
    "layout": "#60a5fa",
    "form": "#f9a8d4",
    "store": "#facc15",
    "reducer": "#fde047",
    "function": "#00d5ff",
    "method": "#7cffb2",
    "constructor": "#9af0d8",
    "class": "#c77dff",
    "exception": "#f472b6",
    "decorator": "#f0abfc",
    "schema": "#ffd166",
    "model": "#ffdf8a",
    "dataclass": "#ffe08a",
    "pydantic_model": "#ffd166",
    "typed_dict": "#ffe9a8",
    "interface": "#68a8ff",
    "type_alias": "#8bbcff",
    "enum": "#a5b4fc",
    "type": "#68a8ff",
    "style": "#ffe45c",
    "style_rule": "#ffe45c",
    "media_query": "#fef08a",
    "container_query": "#fde68a",
    "supports_rule": "#fcd34d",
    "keyframes": "#fbbf24",
    "font_face": "#f59e0b",
    "css_layer": "#eab308",
    "css_at_rule": "#facc15",
    "html_document": "#fca5a5",
    "template": "#fdba74",
    "html_element": "#fb923c",
    "database_schema": "#34d399",
    "table": "#10b981",
    "view": "#6ee7b7",
    "materialized_view": "#5eead4",
    "migration": "#a7f3d0",
    "stored_procedure": "#2dd4bf",
    "sql_function": "#22d3ee",
    "trigger": "#67e8f9",
    "index": "#bef264",
    "constraint": "#d9f99d",
    "file": "#a8b3c5",
}

SPECIAL_FILE_LANGUAGES = {
    "dockerfile": "dockerfile",
    "containerfile": "dockerfile",
    ".env.example": "env",
    "package.json": "json",
    "tsconfig.json": "json",
    "vite.config.ts": "typescript",
    "vite.config.js": "javascript",
    "pyproject.toml": "toml",
}

FILE_TYPE_GROUPS = {
    "react": {"tsx", "jsx"},
    "python": {"python"},
    "typescript": {"typescript", "javascript"},
    "web": {"css", "html"},
    "sql": {"sql"},
    "config": {"json", "yaml", "toml", "dockerfile", "env"},
    "markdown": {"markdown"},
}

FILE_TYPE_PRIORITY = ["react", "python", "typescript", "web", "sql", "config", "markdown", "unknown"]


# ============================================================
# PATH AND TEXT HELPERS
# ============================================================

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalise_rel_path(path: str | Path) -> str:
    return str(path).replace("\\", "/")


def safe_rel_path(path: Path, repo_root: Path) -> str:
    return normalise_rel_path(path.resolve().relative_to(repo_root.resolve()))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return slug or "unknown"


def stable_id(kind: str, *parts: object) -> str:
    raw_parts = [kind]
    raw_parts.extend(str(part) for part in parts if part is not None and str(part) != "")
    return ":".join(slugify(part) for part in raw_parts)


def stable_edge_id(source: str, target: str, kind: str, evidence_key: str = "") -> str:
    raw = f"{source}|{target}|{kind}|{evidence_key}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"edge:{slugify(kind)}:{digest}"


def file_sha1(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def split_lines(text: str) -> list[str]:
    return text.splitlines()


def should_skip_path(path: Path, repo_root: Path) -> bool:
    rel_parts = safe_rel_path(path, repo_root).split("/")
    rel_joined = "/".join(rel_parts)
    if path.name in SKIP_FILE_NAMES:
        return True
    for skip_dir in SKIP_DIR_NAMES:
        if "/" in skip_dir:
            if rel_joined.startswith(skip_dir + "/") or rel_joined == skip_dir:
                return True
        elif skip_dir in rel_parts:
            return True
    return False


def guess_language(path: Path) -> str:
    name = path.name.lower()
    if name in SPECIAL_FILE_LANGUAGES:
        return SPECIAL_FILE_LANGUAGES[name]
    return SUPPORTED_EXTENSIONS.get(path.suffix.lower(), "unknown")


def file_type_for_language(language: str) -> str:
    for file_type, languages in FILE_TYPE_GROUPS.items():
        if language in languages:
            return file_type
    return "unknown"


def file_type_profile(language_counts: dict[str, int] | Counter[str]) -> dict:
    file_type_counts: Counter[str] = Counter()
    for language, count in language_counts.items():
        file_type_counts[file_type_for_language(language)] += count
    majority_file_type = "unknown"
    if file_type_counts:
        majority_file_type = sorted(
            file_type_counts,
            key=lambda item: (-file_type_counts[item], FILE_TYPE_PRIORITY.index(item) if item in FILE_TYPE_PRIORITY else len(FILE_TYPE_PRIORITY), item),
        )[0]
    return {
        "supported_file_count": sum(language_counts.values()),
        "language_counts": dict(sorted(language_counts.items())),
        "file_type_counts": dict(sorted(file_type_counts.items())),
        "majority_file_type": majority_file_type,
    }


# ============================================================
# GRAPH SHAPES
# ============================================================

def make_evidence(kind: str, file_path: str, line_start: int | None, line_end: int | None, detail: str) -> dict:
    return {
        "kind": kind,
        "file": file_path,
        "line_start": line_start,
        "line_end": line_end,
        "detail": detail,
    }


def make_contract(status: str, shape: object | None = None, source: str = "none", evidence: list[dict] | None = None) -> dict:
    if status not in STATUS_VALUES:
        status = "unknown"
    return {
        "status": status,
        "shape": shape if shape is not None else {},
        "source": source,
        "evidence": evidence or [],
    }


def empty_contracts() -> dict:
    return {
        "request": make_contract("not_declared"),
        "response": make_contract("not_declared"),
    }


def make_summary(deterministic: str, agentic: str | None = None) -> dict:
    return {
        "deterministic": deterministic,
        "agentic": agentic,
        "agentic_status": "complete" if agentic else "not_enriched",
    }


def make_node(
    node_id: str,
    kind: str,
    label: str,
    language: str,
    file_path: str,
    line_start: int | None,
    line_end: int | None,
    deterministic_status: str,
    summary: str,
    evidence: list[dict],
    contracts: dict | None = None,
    tags: list[str] | None = None,
    metadata: dict | None = None,
    details: dict | None = None,
) -> dict:
    return {
        "id": node_id,
        "kind": kind,
        "label": label,
        "language": language,
        "file": file_path,
        "line_start": line_start,
        "line_end": line_end,
        "deterministic_status": deterministic_status,
        "summary": make_summary(summary),
        "contracts": contracts or empty_contracts(),
        "evidence": evidence,
        "tags": tags or [],
        "metadata": metadata or {},
        "details": details or {},
        "color": NODE_KIND_COLORS.get(kind, "#d6dee9"),
    }


def make_edge(
    source: str,
    target: str,
    kind: str,
    deterministic_reason: str,
    evidence: list[dict],
    deterministic_status: str = "complete",
) -> dict:
    evidence_key = ""
    if evidence:
        first = evidence[0]
        evidence_key = f"{first.get('file')}:{first.get('line_start')}:{first.get('detail')}"
    return {
        "id": stable_edge_id(source, target, kind, evidence_key),
        "source": source,
        "target": target,
        "kind": kind,
        "reason": {
            "deterministic": deterministic_reason,
            "agentic": None,
            "agentic_status": "not_enriched",
        },
        "deterministic_status": deterministic_status,
        "evidence": evidence,
    }


def add_unique_node(nodes: dict[str, dict], node: dict, warnings: list[str]) -> None:
    existing = nodes.get(node["id"])
    if existing:
        warnings.append(f"duplicate node id skipped: {node['id']}")
        return
    nodes[node["id"]] = node


def add_unique_edge(edges: dict[str, dict], edge: dict) -> None:
    edges.setdefault(edge["id"], edge)


# ============================================================
# OUTPUT HELPERS
# ============================================================

def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def deterministic_payload(item: dict) -> dict:
    payload = json.loads(json.dumps(item, sort_keys=True))
    payload.pop("fingerprint", None)
    payload.pop("color", None)
    if "summary" in payload:
        payload["summary"].pop("agentic", None)
        payload["summary"].pop("agentic_status", None)
        payload["summary"].pop("agentic_points", None)
    if "reason" in payload:
        payload["reason"].pop("agentic", None)
        payload["reason"].pop("agentic_status", None)
    return payload


def deterministic_fingerprint(item: dict) -> str:
    payload = deterministic_payload(item)
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def attach_fingerprints(nodes: list[dict], edges: list[dict]) -> None:
    for node in nodes:
        node["fingerprint"] = deterministic_fingerprint(node)
    for edge in edges:
        edge["fingerprint"] = deterministic_fingerprint(edge)


def write_graph_sqlite(path: Path, graph: dict) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            path.unlink()
        except OSError as exc:
            unavailable_path = path.with_suffix(".sqlite_unavailable.txt")
            unavailable_path.write_text(f"SQLite graph index unavailable: {exc}\nCanonical graph.json was still generated.\n", encoding="utf-8")
            return False
    connection = None
    try:
        connection = sqlite3.connect(path)
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("PRAGMA synchronous=OFF")
        connection.execute("PRAGMA temp_store=MEMORY")
        connection.execute(
            "CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, label TEXT, file TEXT, line_start INTEGER, line_end INTEGER, payload TEXT)"
        )
        connection.execute(
            "CREATE TABLE edges (id TEXT PRIMARY KEY, source TEXT, target TEXT, kind TEXT, payload TEXT)"
        )
        for node in graph["nodes"]:
            connection.execute(
                "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    node["id"],
                    node["kind"],
                    node["label"],
                    node["file"],
                    node["line_start"],
                    node["line_end"],
                    json.dumps(node, sort_keys=True),
                ),
            )
        for edge in graph["edges"]:
            connection.execute(
                "INSERT INTO edges VALUES (?, ?, ?, ?, ?)",
                (
                    edge["id"],
                    edge["source"],
                    edge["target"],
                    edge["kind"],
                    json.dumps(edge, sort_keys=True),
                ),
            )
        connection.commit()
        return True
    except sqlite3.Error as exc:
        unavailable_path = path.with_suffix(".sqlite_unavailable.txt")
        unavailable_path.write_text(f"SQLite graph index unavailable: {exc}\nCanonical graph.json was still generated.\n", encoding="utf-8")
        return False
    finally:
        if connection:
            connection.close()


def copy_graph_for_visualiser(graph_path: Path, repo_root: Path) -> Path | None:
    visualiser_graph_dir = repo_root / ".repo_executive_context" / "codebase_cartographer" / "visualiser" / "public" / "codebase_cartographer"
    if not visualiser_graph_dir.exists():
        visualiser_graph_dir = repo_root / "visualiser" / "public" / "codebase_cartographer"
    if not visualiser_graph_dir.exists():
        visualiser_graph_dir = repo_root.parent / "visualiser" / "public" / "codebase_cartographer"
    if not visualiser_graph_dir.exists():
        return None
    target = visualiser_graph_dir / "graph.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(graph_path, target)
    except OSError as exc:
        unavailable_path = target.with_suffix(".copy_unavailable.txt")
        try:
            unavailable_path.write_text(f"Visualiser graph copy unavailable: {exc}\nCanonical graph.json was still generated.\n", encoding="utf-8")
        except OSError:
            pass
        return None
    return target


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)

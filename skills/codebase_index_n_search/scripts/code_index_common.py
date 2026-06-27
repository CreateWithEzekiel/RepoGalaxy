from __future__ import annotations

# ============================================================
# CODEBASE INDEX N SEARCH COMMON HELPERS
# ============================================================
# Purpose:
# - Shared deterministic helpers for repo indexing, querying, validation, and narrow reads.
# - Python stdlib only.
# - No argparse.
# ============================================================

import ast
import hashlib
import json
import os
import re
import sqlite3
import time
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2
INDEX_DIR_PARTS = (".repo_executive_context", "codebase_index_n_search")
INDEX_DB_NAME = "index.sqlite"
INDEX_STATE_NAME = "index_state.json"
GENERATOR_NAME = "codebase_index_n_search"
MAX_DEFAULT_FILE_BYTES = 512 * 1024
MAX_WORD_LINES = 200
MAX_NGRAM_LEN = 16
SPARSE_NGRAM_STEP = 8

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SUPPORTED_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".zig", ".rs", ".go",
    ".php", ".rb", ".hcl", ".tf", ".r", ".dart", ".sh", ".ps1", ".sql", ".json",
    ".yaml", ".yml", ".toml", ".xml", ".md", ".txt", ".ini", ".cfg", ".conf",
}

TEXT_FILE_NAMES = {
    "dockerfile", "makefile", "justfile", "rakefile", "gemfile", "procfile", "license",
    "readme", "changelog", "contributing", "agents.md", "claude.md",
}

SKIP_DIR_NAMES = {
    ".git", ".hg", ".svn", ".claude", ".code-index", ".code_index", ".repo_executive_context",
    "node_modules", ".zig-cache", "zig-out", ".next", ".nuxt", ".svelte-kit", "dist",
    "build", ".build", ".output", "out", "__pycache__", ".venv", "venv", ".env",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "target", ".gradle", ".idea",
    ".vs", "vendor", "pods", ".dart_tool", ".pub-cache", "coverage", ".nyc_output",
    ".turbo", ".parcel-cache", ".cache", ".tmp", ".temp", ".ds_store", "bundle",
    ".bundle", ".swc", ".terraform", ".terragrunt-cache", ".serverless", "elm-stuff",
    ".stack-work", ".cabal-sandbox", ".cargo", "bower_components",
}

SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".icns", ".webp", ".svg",
    ".ttf", ".otf", ".woff", ".woff2", ".eot", ".zip", ".tar", ".gz", ".bz2",
    ".xz", ".7z", ".rar", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".pptx",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".flv", ".ogg", ".webm", ".exe",
    ".dll", ".so", ".dylib", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo",
    ".class", ".db", ".sqlite", ".sqlite3", ".lock", ".sum", ".map",
}

SENSITIVE_EXACT_NAMES = {
    ".dev.vars", ".npmrc", ".pypirc", ".netrc", "credentials.json", "service-account.json",
    "secrets.json", "secrets.yaml", "secrets.yml", "id_rsa", "id_ed25519",
}

SENSITIVE_EXTENSIONS = {".pem", ".key", ".p12", ".pfx", ".jks"}
SENSITIVE_DIR_PARTS = {".ssh", ".gnupg", ".aws"}

WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
RUN_RE = re.compile(r"[A-Za-z0-9_./:-]{3,}")
CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")

KEYWORDS = {
    "and", "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
    "def", "defer", "delete", "do", "else", "enum", "except", "export", "false", "fn", "for",
    "from", "func", "function", "if", "import", "in", "interface", "let", "match", "module",
    "namespace", "nil", "none", "null", "or", "package", "pass", "pub", "public", "return",
    "self", "static", "struct", "switch", "this", "throw", "throws", "true", "try", "type",
    "var", "void", "while", "with", "yield",
}

COMMENT_PREFIXES = {
    ".py": ("#",),
    ".sh": ("#",),
    ".ps1": ("#",),
    ".rb": ("#",),
    ".r": ("#",),
    ".zig": ("//",),
    ".rs": ("//",),
    ".go": ("//",),
    ".ts": ("//",),
    ".tsx": ("//",),
    ".js": ("//",),
    ".jsx": ("//",),
    ".php": ("//", "#"),
    ".dart": ("//",),
    ".css": ("/*", "*"),
    ".html": ("<!--",),
}

SYMBOL_PATTERNS = {
    ".zig": [
        ("function", re.compile(r"^\s*(?:pub\s+)?(?:inline\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)")),
        ("struct", re.compile(r"^\s*(?:pub\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*struct\b")),
        ("enum", re.compile(r"^\s*(?:pub\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*enum\b")),
        ("constant", re.compile(r"^\s*(?:pub\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=")),
    ],
    ".ts": [], ".tsx": [], ".js": [], ".jsx": [],
    ".rs": [
        ("function", re.compile(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)")),
        ("struct", re.compile(r"^\s*(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
        ("enum", re.compile(r"^\s*(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
        ("trait", re.compile(r"^\s*(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
        ("impl", re.compile(r"^\s*impl(?:\s+[^\s]+)?\s+for\s+([A-Za-z_][A-Za-z0-9_:]*)\b|^\s*impl\s+([A-Za-z_][A-Za-z0-9_:]*)\b")),
    ],
    ".go": [
        ("function", re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)")),
        ("type", re.compile(r"^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b")),
    ],
    ".php": [
        ("class", re.compile(r"^\s*(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
        ("function", re.compile(r"^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)")),
    ],
    ".rb": [
        ("class", re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_:]*)\b")),
        ("module", re.compile(r"^\s*module\s+([A-Za-z_][A-Za-z0-9_:]*)\b")),
        ("function", re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_!?=]*)\b(.*)")),
    ],
    ".dart": [
        ("class", re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
        ("function", re.compile(r"^\s*(?:[A-Za-z_<>,?]+\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*(?:async\s*)?\{")),
    ],
    ".hcl": [
        ("block", re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_-]*)\s+\"([^\"]+)\"")),
    ],
    ".tf": [
        ("block", re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_-]*)\s+\"([^\"]+)\"")),
    ],
    ".r": [
        ("function", re.compile(r"^\s*([A-Za-z_.][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\s*\((.*)")),
    ],
    ".html": [
        ("element", re.compile(r"^\s*<([a-zA-Z][A-Za-z0-9-]*)(?:\s|>|$)")),
    ],
    ".css": [
        ("selector", re.compile(r"^\s*([^{}@][^{]{0,100})\s*\{")),
    ],
}

JS_TS_PATTERNS = [
    ("class", re.compile(r"^\s*export\s+(?:default\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b|^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
    ("function", re.compile(r"^\s*export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)|^\s*(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)")),
    ("function", re.compile(r"^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(?([^=]*)\)?\s*=>|^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(?([^=]*)\)?\s*=>")),
    ("component", re.compile(r"^\s*export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\((.*)|^\s*function\s+([A-Z][A-Za-z0-9_]*)\s*\((.*)")),
    ("interface", re.compile(r"^\s*export\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)\b|^\s*interface\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
    ("type", re.compile(r"^\s*export\s+type\s+([A-Za-z_][A-Za-z0-9_]*)\b|^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\b")),
]
for ext in (".ts", ".tsx", ".js", ".jsx"):
    SYMBOL_PATTERNS[ext] = JS_TS_PATTERNS

IMPORT_PATTERNS = {
    "js_ts": [
        re.compile(r"\bimport\b.*?\bfrom\s+[\"']([^\"']+)[\"']"),
        re.compile(r"\bimport\s*[\"']([^\"']+)[\"']"),
        re.compile(r"\brequire\s*\(\s*[\"']([^\"']+)[\"']\s*\)"),
        re.compile(r"\bexport\b.*?\bfrom\s+[\"']([^\"']+)[\"']"),
    ],
    "zig": [re.compile(r"@import\s*\(\s*[\"']([^\"']+)[\"']\s*\)")],
    "rust": [re.compile(r"^\s*mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;"), re.compile(r"^\s*use\s+([^;]+);")],
    "go": [re.compile(r"^\s*[\"`]([^\"`]+)[\"`]")],
    "php": [re.compile(r"\b(?:require|include)(?:_once)?\s*\(?\s*[\"']([^\"']+)[\"']"), re.compile(r"^\s*use\s+([^;]+);")],
    "ruby": [re.compile(r"\brequire_relative\s+[\"']([^\"']+)[\"']"), re.compile(r"\brequire\s+[\"']([^\"']+)[\"']")],
    "dart": [re.compile(r"\bimport\s+[\"']([^\"']+)[\"']"), re.compile(r"\bexport\s+[\"']([^\"']+)[\"']")],
    "css": [re.compile(r"@import\s+(?:url\()?\s*[\"']?([^\"')]+)")],
    "r": [re.compile(r"\bsource\s*\(\s*[\"']([^\"']+)[\"']\s*\)")],
    "hcl": [re.compile(r"\bsource\s*=\s*[\"']([^\"']+)[\"']")],
}


def normalize_repo_root(raw_root: str | Path | None) -> Path:
    if raw_root:
        return Path(raw_root).expanduser().resolve()
    return Path.cwd().resolve()


def index_dir_for(repo_root: Path) -> Path:
    return repo_root.joinpath(*INDEX_DIR_PARTS)


def db_path_for(repo_root: Path) -> Path:
    return index_dir_for(repo_root) / INDEX_DB_NAME


def temp_db_path_for(repo_root: Path) -> Path:
    return index_dir_for(repo_root) / f"{INDEX_DB_NAME}.tmp.{os.getpid()}"


def state_path_for(repo_root: Path) -> Path:
    return index_dir_for(repo_root) / INDEX_STATE_NAME


def rel_path(path: Path, repo_root: Path) -> str:
    return path.resolve().relative_to(repo_root).as_posix()


def is_safe_relative_path(path: str) -> bool:
    if not path or "\x00" in path:
        return False
    p = path.replace("\\", "/")
    if p.startswith("/") or p.startswith("~"):
        return False
    parts = [part for part in p.split("/") if part]
    return all(part not in {".", ".."} for part in parts)


def resolve_safe_repo_path(repo_root: Path, path: str) -> Path:
    if not is_safe_relative_path(path):
        raise ValueError(f"unsafe repo-relative path: {path}")
    resolved = (repo_root / path).resolve()
    try:
        resolved.relative_to(repo_root)
    except ValueError as exc:
        raise ValueError(f"path escapes repo root: {path}") from exc
    return resolved


def path_parts_lower(path: str) -> list[str]:
    return [part.lower() for part in path.replace("\\", "/").split("/") if part]


def is_sensitive_path(path: str) -> bool:
    p = path.replace("\\", "/")
    parts = path_parts_lower(p)
    if any(part in SENSITIVE_DIR_PARTS for part in parts):
        return True
    basename = parts[-1] if parts else ""
    if not basename:
        return False
    if basename.startswith(".env"):
        return True
    if basename in SENSITIVE_EXACT_NAMES:
        return True
    suffix = Path(basename).suffix.lower()
    if suffix in SENSITIVE_EXTENSIONS:
        return True
    if "credential" in basename or "secret" in basename:
        return True
    return False


def should_skip_dir(name: str) -> bool:
    return name.lower() in SKIP_DIR_NAMES


def is_supported_text_file(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix in SUPPORTED_EXTENSIONS:
        return True
    lower_name = path.name.lower()
    if lower_name in TEXT_FILE_NAMES:
        return True
    if any(lower_name == name or lower_name.startswith(name + ".") for name in TEXT_FILE_NAMES):
        return True
    return False


def should_skip_file(path: Path, repo_root: Path, max_file_bytes: int = MAX_DEFAULT_FILE_BYTES) -> bool:
    rel = rel_path(path, repo_root)
    if is_sensitive_path(rel):
        return True
    if path.suffix.lower() in SKIP_EXTENSIONS:
        return True
    if not is_supported_text_file(path):
        return True
    try:
        if path.stat().st_size > max_file_bytes:
            return True
    except OSError:
        return True
    return is_probably_binary(path)


def is_probably_binary(path: Path) -> bool:
    try:
        chunk = path.open("rb").read(1024)
    except OSError:
        return True
    return b"\x00" in chunk


def safe_read_text(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
        except OSError as exc:
            raise ValueError(f"Could not read {path}: {exc}") from exc
    raise ValueError(f"Could not decode text file: {path}")


def sha256_short(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:16]


def skip_rules_hash() -> str:
    payload = {
        "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
        "skip_dirs": sorted(SKIP_DIR_NAMES),
        "skip_extensions": sorted(SKIP_EXTENSIONS),
        "sensitive_exact": sorted(SENSITIVE_EXACT_NAMES),
        "sensitive_extensions": sorted(SENSITIVE_EXTENSIONS),
        "sensitive_dirs": sorted(SENSITIVE_DIR_PARTS),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def language_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    mapping = {
        ".py": "python", ".ts": "typescript", ".tsx": "tsx", ".js": "javascript",
        ".jsx": "jsx", ".html": "html", ".css": "css", ".zig": "zig", ".rs": "rust",
        ".go": "go", ".php": "php", ".rb": "ruby", ".hcl": "hcl", ".tf": "terraform",
        ".r": "r", ".dart": "dart", ".sh": "shell", ".ps1": "powershell", ".sql": "sql",
        ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".xml": "xml",
        ".md": "markdown", ".txt": "text", ".ini": "ini", ".cfg": "config", ".conf": "config",
    }
    if suffix in mapping:
        return mapping[suffix]
    return path.name.lower()


def walk_indexable_files(repo_root: Path, max_file_bytes: int = MAX_DEFAULT_FILE_BYTES) -> list[Path]:
    result: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(repo_root):
        current = Path(dirpath)
        try:
            rel_current = current.resolve().relative_to(repo_root).as_posix()
        except ValueError:
            continue
        dirnames[:] = sorted(d for d in dirnames if not should_skip_dir(d))
        if rel_current and is_sensitive_path(rel_current):
            dirnames[:] = []
            continue
        for filename in sorted(filenames):
            path = current / filename
            if should_skip_file(path, repo_root, max_file_bytes):
                continue
            result.append(path)
    return sorted(result, key=lambda p: rel_path(p, repo_root).lower())


def make_file_record(file_id: int, path: Path, repo_root: Path, text: str) -> dict[str, Any]:
    stat = path.stat()
    return {
        "id": file_id,
        "path": rel_path(path, repo_root),
        "extension": path.suffix.lower(),
        "language": language_for_path(path),
        "size": stat.st_size,
        "lines": text.count("\n") + (0 if text.endswith("\n") or text == "" else 1),
        "mtime": int(stat.st_mtime),
        "hash": sha256_short(text),
    }


def symbol_detail(line: str) -> str:
    return " ".join(line.strip().split())[:220]


def append_symbol(symbols: list[dict[str, Any]], path: str, name: str, kind: str, line_start: int, line_end: int | None, detail: str) -> None:
    name = (name or "").strip()
    if not name:
        return
    symbols.append({
        "path": path,
        "name": name,
        "kind": kind,
        "line_start": int(line_start),
        "line_end": int(line_end or line_start),
        "detail": detail[:220],
    })


def extract_python_symbols_and_imports(path_rel: str, text: str) -> tuple[list[dict[str, Any]], list[str]]:
    symbols: list[dict[str, Any]] = []
    imports: list[str] = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return symbols, imports

    lines = text.splitlines()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            kind = "async_function" if isinstance(node, ast.AsyncFunctionDef) else "function"
            detail = lines[node.lineno - 1].strip() if 0 < node.lineno <= len(lines) else node.name
            append_symbol(symbols, path_rel, node.name, kind, node.lineno, getattr(node, "end_lineno", node.lineno), detail)
        elif isinstance(node, ast.ClassDef):
            detail = lines[node.lineno - 1].strip() if 0 < node.lineno <= len(lines) else node.name
            append_symbol(symbols, path_rel, node.name, "class", node.lineno, getattr(node, "end_lineno", node.lineno), detail)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            prefix = "." * int(node.level or 0)
            module = node.module or ""
            imports.append(prefix + module)
    return symbols, sorted(set(i for i in imports if i))


def first_match_group(match: re.Match[str]) -> str:
    for group in match.groups():
        if group:
            return group
    return ""


def extract_regex_symbols(path: Path, path_rel: str, text: str) -> list[dict[str, Any]]:
    symbols: list[dict[str, Any]] = []
    patterns = SYMBOL_PATTERNS.get(path.suffix.lower(), [])
    for line_num, line in enumerate(text.splitlines(), start=1):
        if len(symbols) >= 500:
            break
        for kind, pattern in patterns:
            match = pattern.search(line)
            if not match:
                continue
            name = first_match_group(match)
            if kind == "block" and len(match.groups()) >= 2 and match.group(2):
                name = f"{match.group(1)} {match.group(2)}"
            if kind == "selector":
                name = name.strip()
                if not name or name.startswith(("/*", "*")):
                    continue
            append_symbol(symbols, path_rel, name, kind, line_num, line_num, symbol_detail(line))
            break
    return symbols


def extract_imports(path: Path, text: str) -> list[str]:
    suffix = path.suffix.lower()
    raw: list[str] = []
    if suffix in {".ts", ".tsx", ".js", ".jsx"}:
        patterns = IMPORT_PATTERNS["js_ts"]
    elif suffix == ".zig":
        patterns = IMPORT_PATTERNS["zig"]
    elif suffix == ".rs":
        patterns = IMPORT_PATTERNS["rust"]
    elif suffix == ".go":
        patterns = IMPORT_PATTERNS["go"]
    elif suffix == ".php":
        patterns = IMPORT_PATTERNS["php"]
    elif suffix == ".rb":
        patterns = IMPORT_PATTERNS["ruby"]
    elif suffix == ".dart":
        patterns = IMPORT_PATTERNS["dart"]
    elif suffix == ".css":
        patterns = IMPORT_PATTERNS["css"]
    elif suffix == ".r":
        patterns = IMPORT_PATTERNS["r"]
    elif suffix in {".hcl", ".tf"}:
        patterns = IMPORT_PATTERNS["hcl"]
    else:
        patterns = []
    for line in text.splitlines():
        for pattern in patterns:
            match = pattern.search(line)
            if match:
                value = first_match_group(match).strip()
                if value:
                    raw.append(value)
    return sorted(set(raw))


def extract_symbols_and_imports(path: Path, path_rel: str, text: str) -> tuple[list[dict[str, Any]], list[str]]:
    if path.suffix.lower() == ".py":
        return extract_python_symbols_and_imports(path_rel, text)
    return extract_regex_symbols(path, path_rel, text), extract_imports(path, text)


def normalize_word(word: str) -> str:
    return word.lower().strip("_")


def split_identifier(word: str) -> list[str]:
    pieces: list[str] = []
    for chunk in re.split(r"[_\-]+", word):
        pieces.extend(CAMEL_RE.sub(" ", chunk).split())
    return pieces


def tokenize_words(text: str) -> dict[str, list[int]]:
    hits: dict[str, set[int]] = defaultdict(set)
    for line_num, line in enumerate(text.splitlines(), start=1):
        for match in WORD_RE.finditer(line):
            raw = match.group(0)
            candidates = [raw]
            if len(raw) >= 4:
                candidates.extend(split_identifier(raw))
            for candidate in candidates:
                word = normalize_word(candidate)
                if len(word) < 2 or word in KEYWORDS:
                    continue
                hits[word].add(line_num)
    return {word: sorted(lines) for word, lines in hits.items()}


def query_words(text: str) -> list[str]:
    words: set[str] = set()
    for match in WORD_RE.finditer(text):
        raw = match.group(0)
        candidates = [raw]
        if len(raw) >= 4:
            candidates.extend(split_identifier(raw))
        for candidate in candidates:
            word = normalize_word(candidate)
            if len(word) >= 2 and word not in KEYWORDS:
                words.add(word)
    return sorted(words)


def normalize_search_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").lower()


def extract_trigrams(text: str) -> set[str]:
    normalized = normalize_search_text(text)
    if len(normalized) < 3:
        return set()
    result: set[str] = set()
    for idx in range(0, len(normalized) - 2):
        trigram = normalized[idx:idx + 3]
        if "\x00" not in trigram:
            result.add(trigram)
    return result


def extract_sparse_ngrams(text: str) -> set[str]:
    normalized = normalize_search_text(text)
    result: set[str] = set()
    for match in RUN_RE.finditer(normalized):
        run = match.group(0)
        if len(run) < 3:
            continue
        if len(run) <= MAX_NGRAM_LEN:
            result.add(run)
            continue
        result.add(run[:MAX_NGRAM_LEN])
        result.add(run[-MAX_NGRAM_LEN:])
        pos = 0
        while pos + MAX_NGRAM_LEN <= len(run):
            result.add(run[pos:pos + MAX_NGRAM_LEN])
            pos += SPARSE_NGRAM_STEP
    return result


def extract_query_sparse_ngrams(query: str) -> set[str]:
    grams = extract_sparse_ngrams(query)
    normalized = normalize_search_text(query)
    if 3 <= len(normalized) <= MAX_NGRAM_LEN:
        grams.add(normalized)
    return grams


def resolve_candidate_path(base: Path, raw: str, indexed_paths: set[str]) -> str | None:
    cleaned = raw.strip().strip("'\"")
    if not cleaned or "://" in cleaned:
        return None
    cleaned = cleaned.replace("\\", "/")
    candidates: list[Path] = []
    if cleaned.startswith("."):
        candidates.append(base / cleaned)
    elif cleaned.startswith("/"):
        candidates.append(Path(cleaned.lstrip("/")))
    else:
        module_path = cleaned.replace(".", "/")
        candidates.append(Path(module_path))
        candidates.append(base / cleaned)

    suffixes = ["", ".py", ".ts", ".tsx", ".js", ".jsx", ".zig", ".rs", ".go", ".php", ".rb", ".dart", ".css", ".json", ".yaml", ".yml", ".toml", "/index.ts", "/index.tsx", "/index.js", "/__init__.py"]
    for candidate in candidates:
        normalized = candidate.as_posix().lstrip("/")
        for suffix in suffixes:
            trial = normalized if suffix == "" else normalized + suffix
            trial = str(Path(trial).as_posix())
            parts: list[str] = []
            for part in trial.split("/"):
                if part in {"", "."}:
                    continue
                if part == "..":
                    if parts:
                        parts.pop()
                    continue
                parts.append(part)
            safe_trial = "/".join(parts)
            if safe_trial in indexed_paths:
                return safe_trial
    return None


def build_dependency_records(imports_by_path: dict[str, list[str]], indexed_paths: set[str]) -> list[dict[str, Any]]:
    depends_by_path: dict[str, list[str]] = {}
    imported_by: dict[str, set[str]] = defaultdict(set)
    for path, imports in imports_by_path.items():
        base = Path(path).parent
        resolved: set[str] = set()
        for raw in imports:
            dep = resolve_candidate_path(base, raw, indexed_paths)
            if dep and dep != path:
                resolved.add(dep)
                imported_by[dep].add(path)
        depends_by_path[path] = sorted(resolved)

    all_paths = sorted(set(imports_by_path) | set(imported_by))
    records: list[dict[str, Any]] = []
    for path in all_paths:
        imports = sorted(imports_by_path.get(path, []))
        depends_on = depends_by_path.get(path, [])
        reverse = sorted(imported_by.get(path, set()))
        if imports or depends_on or reverse:
            records.append({
                "path": path,
                "imports": imports,
                "depends_on": depends_on,
                "imported_by": reverse,
            })
    return records


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")

def write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def state_details_from_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "file_count", "symbol_count", "word_count", "distinct_word_count",
        "word_hit_count", "trigram_count", "sparse_ngram_count",
        "dependency_count", "content_line_count", "index_db_size",
    ]
    return {key: manifest.get(key) for key in keys}


def write_index_state(
    repo_root: Path,
    mode: str,
    status: str,
    write_mode: str = "",
    started_at_utc: str | None = None,
    completed_at_utc: str | None = None,
    error: str = "",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now_utc_iso()
    started = started_at_utc or now
    completed = completed_at_utc or (now if status in {"completed", "failed"} else "")
    index_dir = index_dir_for(repo_root)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "generator": GENERATOR_NAME,
        "mode": mode,
        "status": status,
        "write_mode": write_mode,
        "started_at_utc": started,
        "completed_at_utc": completed,
        "updated_at_utc": now,
        "index_dir": index_dir.as_posix(),
        "index_db": db_path_for(repo_root).as_posix(),
        "manifest": (index_dir / "manifest.json").as_posix(),
        "hashes": (index_dir / "hashes.json").as_posix(),
        "error": str(error)[:1000],
        "details": details or {},
    }
    write_json(state_path_for(repo_root), payload)
    return payload


def read_index_state(repo_root: Path) -> dict[str, Any]:
    return read_json(state_path_for(repo_root))


def remove_index_state(repo_root: Path) -> None:
    path = state_path_for(repo_root)
    if path.exists():
        try:
            path.unlink()
        except OSError:
            pass


def select_index_write_mode(repo_root: Path, requested_policy: str) -> str:
    policy = (requested_policy or "auto").strip().lower()
    if policy in {"atomic", "direct"}:
        return policy
    if policy != "auto":
        raise ValueError(f"unknown INDEX_WRITE_POLICY: {requested_policy}")
    state_path = state_path_for(repo_root)
    if not state_path.exists():
        return "atomic"
    try:
        state = read_index_state(repo_root)
    except Exception:
        return "direct"
    return "direct" if state.get("write_mode") == "direct" else "atomic"


def require_completed_index_state(repo_root: Path) -> dict[str, Any]:
    path = state_path_for(repo_root)
    if not path.exists():
        raise RuntimeError(f"index state missing: {path}. Run build_index.py before querying.")
    state = read_index_state(repo_root)
    if state.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError(f"index state schema mismatch: {state.get('schema_version')}. Rebuild index.")
    if state.get("status") != "completed":
        mode = state.get("mode", "unknown")
        updated = state.get("updated_at_utc", "unknown")
        raise RuntimeError(f"index transaction not complete: status={state.get('status')} mode={mode} updated={updated}. Rebuild or refresh index.")
    return state


def connect_sqlite(db_path: Path, write_mode: str = "read") -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    if write_mode == "atomic":
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA synchronous=FULL")
    elif write_mode == "direct":
        conn.execute("PRAGMA journal_mode=MEMORY")
        conn.execute("PRAGMA synchronous=OFF")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            extension TEXT NOT NULL,
            language TEXT NOT NULL,
            size INTEGER NOT NULL,
            lines INTEGER NOT NULL,
            mtime INTEGER NOT NULL,
            hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            name_lc TEXT NOT NULL,
            kind TEXT NOT NULL,
            line_start INTEGER NOT NULL,
            line_end INTEGER NOT NULL,
            detail TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS words (
            word TEXT NOT NULL,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            hit_count INTEGER NOT NULL,
            PRIMARY KEY (word, file_id)
        );
        CREATE TABLE IF NOT EXISTS word_hits (
            word TEXT NOT NULL,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            line_num INTEGER NOT NULL,
            PRIMARY KEY (word, file_id, line_num)
        );
        CREATE TABLE IF NOT EXISTS trigrams (
            trigram TEXT NOT NULL,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            PRIMARY KEY (trigram, file_id)
        );
        CREATE TABLE IF NOT EXISTS sparse_ngrams (
            ngram TEXT NOT NULL,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            PRIMARY KEY (ngram, file_id)
        );
        CREATE TABLE IF NOT EXISTS raw_imports (
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            import TEXT NOT NULL,
            PRIMARY KEY (file_id, import)
        );
        CREATE TABLE IF NOT EXISTS deps (
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            import TEXT NOT NULL,
            resolved_path TEXT,
            PRIMARY KEY (file_id, import)
        );
        CREATE TABLE IF NOT EXISTS content_lines (
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            line_num INTEGER NOT NULL,
            text TEXT NOT NULL,
            PRIMARY KEY (file_id, line_num)
        );
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
        CREATE INDEX IF NOT EXISTS idx_symbols_name_lc ON symbols(name_lc);
        CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path);
        CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
        CREATE INDEX IF NOT EXISTS idx_word_hits_word ON word_hits(word);
        CREATE INDEX IF NOT EXISTS idx_word_hits_path ON word_hits(path);
        CREATE INDEX IF NOT EXISTS idx_trigrams_trigram ON trigrams(trigram);
        CREATE INDEX IF NOT EXISTS idx_sparse_ngrams_ngram ON sparse_ngrams(ngram);
        CREATE INDEX IF NOT EXISTS idx_deps_path ON deps(path);
        CREATE INDEX IF NOT EXISTS idx_deps_resolved_path ON deps(resolved_path);
        CREATE INDEX IF NOT EXISTS idx_content_lines_path ON content_lines(path);
        """
    )


def reset_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS content_lines;
        DROP TABLE IF EXISTS deps;
        DROP TABLE IF EXISTS raw_imports;
        DROP TABLE IF EXISTS sparse_ngrams;
        DROP TABLE IF EXISTS trigrams;
        DROP TABLE IF EXISTS word_hits;
        DROP TABLE IF EXISTS words;
        DROP TABLE IF EXISTS symbols;
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS meta;
        """
    )
    init_schema(conn)


def set_meta(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        (key, json.dumps(value, sort_keys=True, separators=(",", ":"))),
    )


def get_meta(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    if row is None:
        return default
    return json.loads(row["value"])


def make_feature_flags(store_content_lines: bool, enable_trigram: bool, enable_sparse_ngram: bool) -> dict[str, bool]:
    return {
        "store_content_lines": bool(store_content_lines),
        "enable_trigram_index": bool(enable_trigram),
        "enable_sparse_ngram_index": bool(enable_sparse_ngram),
        "sqlite_fts": False,
    }


def build_file_payload(
    repo_root: Path,
    path: Path,
    file_id: int,
    store_content_lines: bool = True,
    enable_trigram: bool = True,
    enable_sparse_ngram: bool = True,
) -> dict[str, Any]:
    text = safe_read_text(path)
    rel = rel_path(path, repo_root)
    record = make_file_record(file_id, path, repo_root, text)
    symbols, imports = extract_symbols_and_imports(path, rel, text)
    word_map = tokenize_words(text)
    lines = text.splitlines()
    return {
        "file": record,
        "symbols": symbols,
        "imports": imports,
        "words": word_map,
        "trigrams": extract_trigrams(text) if enable_trigram else set(),
        "sparse_ngrams": extract_sparse_ngrams(text) if enable_sparse_ngram else set(),
        "content_lines": list(enumerate(lines, start=1)) if store_content_lines and not is_sensitive_path(rel) else [],
    }


def insert_file_payload(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    file = payload["file"]
    file_id = int(file["id"])
    path = file["path"]
    conn.execute(
        """
        INSERT INTO files(id, path, extension, language, size, lines, mtime, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (file_id, path, file["extension"], file["language"], file["size"], file["lines"], file["mtime"], file["hash"]),
    )
    conn.executemany(
        """
        INSERT INTO symbols(file_id, path, name, name_lc, kind, line_start, line_end, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (file_id, path, row["name"], row["name"].lower(), row["kind"], row["line_start"], row["line_end"], row["detail"])
            for row in payload["symbols"]
        ],
    )
    conn.executemany(
        "INSERT INTO words(word, file_id, path, hit_count) VALUES (?, ?, ?, ?)",
        [(word, file_id, path, len(lines)) for word, lines in sorted(payload["words"].items())],
    )
    word_hit_rows = []
    for word, lines in sorted(payload["words"].items()):
        for line_num in lines:
            word_hit_rows.append((word, file_id, path, line_num))
    conn.executemany(
        "INSERT INTO word_hits(word, file_id, path, line_num) VALUES (?, ?, ?, ?)",
        word_hit_rows,
    )
    conn.executemany(
        "INSERT INTO trigrams(trigram, file_id) VALUES (?, ?)",
        [(trigram, file_id) for trigram in sorted(payload["trigrams"])],
    )
    conn.executemany(
        "INSERT INTO sparse_ngrams(ngram, file_id) VALUES (?, ?)",
        [(ngram, file_id) for ngram in sorted(payload["sparse_ngrams"])],
    )
    conn.executemany(
        "INSERT INTO raw_imports(file_id, path, import) VALUES (?, ?, ?)",
        [(file_id, path, item) for item in sorted(set(payload["imports"]))],
    )
    conn.executemany(
        "INSERT INTO content_lines(file_id, path, line_num, text) VALUES (?, ?, ?, ?)",
        [(file_id, path, line_num, text) for line_num, text in payload["content_lines"]],
    )


def delete_file_by_path(conn: sqlite3.Connection, path: str) -> None:
    conn.execute("DELETE FROM files WHERE path=?", (path,))


def all_indexed_paths(conn: sqlite3.Connection) -> set[str]:
    return {row["path"] for row in conn.execute("SELECT path FROM files")}


def rebuild_resolved_deps(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM deps")
    indexed_paths = all_indexed_paths(conn)
    rows = conn.execute("SELECT file_id, path, import FROM raw_imports ORDER BY path, import").fetchall()
    out = []
    for row in rows:
        resolved = resolve_candidate_path(Path(row["path"]).parent, row["import"], indexed_paths)
        if resolved == row["path"]:
            resolved = None
        out.append((row["file_id"], row["path"], row["import"], resolved))
    conn.executemany("INSERT INTO deps(file_id, path, import, resolved_path) VALUES (?, ?, ?, ?)", out)


def db_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = ["files", "symbols", "words", "word_hits", "trigrams", "sparse_ngrams", "deps", "content_lines"]
    result: dict[str, int] = {}
    for table in tables:
        result[table] = int(conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"])
    result["distinct_words"] = int(conn.execute("SELECT COUNT(DISTINCT word) AS c FROM words").fetchone()["c"])
    return result


def hashes_from_db(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    rows = conn.execute("SELECT id, path, hash, mtime, size FROM files ORDER BY path").fetchall()
    return {
        row["path"]: {"id": row["id"], "hash": row["hash"], "mtime": row["mtime"], "size": row["size"]}
        for row in rows
    }


def manifest_from_db(repo_root: Path, conn: sqlite3.Connection, feature_flags: dict[str, bool] | None = None) -> dict[str, Any]:
    index_dir = index_dir_for(repo_root)
    db_path = db_path_for(repo_root)
    counts = db_counts(conn)
    features = feature_flags if feature_flags is not None else get_meta(conn, "feature_flags", {})
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": now_utc_iso(),
        "repo_root": repo_root.as_posix(),
        "index_dir": index_dir.as_posix(),
        "index_db": db_path.as_posix(),
        "index_db_size": db_path.stat().st_size if db_path.exists() else 0,
        "file_count": counts["files"],
        "symbol_count": counts["symbols"],
        "word_count": counts["words"],
        "distinct_word_count": counts["distinct_words"],
        "word_hit_count": counts["word_hits"],
        "trigram_count": counts["trigrams"],
        "sparse_ngram_count": counts["sparse_ngrams"],
        "dependency_count": counts["deps"],
        "content_line_count": counts["content_lines"],
        "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
        "skip_rules_hash": skip_rules_hash(),
        "feature_flags": features,
        "index_write_mode": get_meta(conn, "index_write_mode", "atomic"),
        "generator": GENERATOR_NAME,
    }


def remove_sqlite_sidecars(path: Path, include_main: bool = True, ignore_errors: bool = False) -> None:
    suffixes = ("", "-wal", "-shm", "-journal") if include_main else ("-wal", "-shm", "-journal")
    for suffix in suffixes:
        candidate = Path(str(path) + suffix)
        if candidate.exists():
            try:
                candidate.unlink()
            except OSError:
                if not ignore_errors:
                    raise


def replace_sqlite_db(tmp_path: Path, final_path: Path) -> None:
    final_path.parent.mkdir(parents=True, exist_ok=True)
    remove_sqlite_sidecars(final_path, include_main=False)
    remove_sqlite_sidecars(tmp_path, include_main=False)
    os.replace(str(tmp_path), str(final_path))
    remove_sqlite_sidecars(tmp_path, include_main=False)


def write_sidecars(repo_root: Path, conn: sqlite3.Connection, feature_flags: dict[str, bool] | None = None) -> dict[str, Any]:
    index_dir = index_dir_for(repo_root)
    index_dir.mkdir(parents=True, exist_ok=True)
    manifest = manifest_from_db(repo_root, conn, feature_flags)
    write_json(index_dir / "manifest.json", manifest)
    write_json(index_dir / "hashes.json", hashes_from_db(conn))
    return manifest


def current_hash_snapshot(repo_root: Path, max_file_bytes: int = MAX_DEFAULT_FILE_BYTES) -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {}
    for path in walk_indexable_files(repo_root, max_file_bytes):
        try:
            text = safe_read_text(path)
            record = make_file_record(0, path, repo_root, text)
        except Exception:
            continue
        snapshot[record["path"]] = {"hash": record["hash"], "mtime": record["mtime"], "size": record["size"]}
    return snapshot


def diff_hashes(old_hashes: dict[str, dict[str, Any]], current: dict[str, dict[str, Any]]) -> tuple[list[str], list[str], list[str]]:
    old_paths = set(old_hashes)
    current_paths = set(current)
    added = sorted(current_paths - old_paths)
    deleted = sorted(old_paths - current_paths)
    changed = sorted(
        path for path in (old_paths & current_paths)
        if old_hashes[path].get("hash") != current[path].get("hash")
        or old_hashes[path].get("size") != current[path].get("size")
    )
    return added, changed, deleted


def locate_file(conn: sqlite3.Connection, query: str) -> str | None:
    q = query.replace("\\", "/").lower()
    row = conn.execute("SELECT path FROM files WHERE lower(path)=?", (q,)).fetchone()
    if row:
        return row["path"]
    rows = conn.execute("SELECT path FROM files WHERE lower(path) LIKE ? ORDER BY length(path), path LIMIT 1", (f"%{q}%",)).fetchall()
    return rows[0]["path"] if rows else None


def is_comment_or_blank(path: Path, line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    prefixes = COMMENT_PREFIXES.get(path.suffix.lower(), ("#", "//"))
    return any(stripped.startswith(prefix) for prefix in prefixes)


def now_utc_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

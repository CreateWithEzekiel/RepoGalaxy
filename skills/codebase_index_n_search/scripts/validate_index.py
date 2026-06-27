from __future__ import annotations

# ============================================================
# VALIDATE CODE INDEX
# ============================================================
# Purpose:
# - Validate SQLite index, path safety, sensitive-file exclusion, and hash freshness.
# - Python stdlib only, no argparse.
# ============================================================

import sqlite3

import code_index_common as common

REPO_ROOT = r""
ALLOW_STALE = False
MAX_STALE_REPORT = 30

REQUIRED_FILES = ["manifest.json", "hashes.json", common.INDEX_DB_NAME]
REQUIRED_TABLES = {
    "meta", "files", "symbols", "words", "word_hits", "trigrams", "sparse_ngrams",
    "raw_imports", "deps", "content_lines",
}


def validate_path(path: str, label: str, errors: list[str]) -> None:
    if not common.is_safe_relative_path(path):
        errors.append(f"unsafe {label} path: {path}")
    if common.is_sensitive_path(path):
        errors.append(f"sensitive {label} path indexed: {path}")


def main() -> None:
    repo_root = common.normalize_repo_root(REPO_ROOT)
    index_dir = common.index_dir_for(repo_root)
    db_path = common.db_path_for(repo_root)
    errors: list[str] = []

    for name in REQUIRED_FILES:
        if not (index_dir / name).exists():
            errors.append(f"missing index file: {name}")

    if errors:
        for error in errors:
            print(error)
        raise SystemExit(1)

    try:
        manifest = common.read_json(index_dir / "manifest.json")
        hashes = common.read_json(index_dir / "hashes.json")
    except Exception as exc:
        print(f"failed to parse sidecar files: {exc}")
        raise SystemExit(1)

    state_path = common.state_path_for(repo_root)
    if state_path.exists():
        try:
            state = common.read_index_state(repo_root)
        except Exception as exc:
            errors.append(f"failed to parse index_state.json: {exc}")
            state = {}
        if state.get("schema_version") != common.SCHEMA_VERSION:
            errors.append(f"index_state schema mismatch: {state.get('schema_version')}")
        if state.get("status") != "completed":
            errors.append(f"index_state not completed: {state.get('status')}")
    elif manifest.get("index_write_mode") == "direct":
        errors.append("index_state missing for direct write mode")
    if manifest.get("schema_version") != common.SCHEMA_VERSION:
        errors.append(f"schema mismatch: {manifest.get('schema_version')}")
    if manifest.get("skip_rules_hash") != common.skip_rules_hash():
        errors.append("skip_rules_hash mismatch; rebuild index")

    conn = common.connect_sqlite(db_path)
    try:
        tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        missing = sorted(REQUIRED_TABLES - tables)
        for table in missing:
            errors.append(f"missing SQLite table: {table}")
        if missing:
            for error in errors:
                print(error)
            raise SystemExit(1)

        db_schema = common.get_meta(conn, "schema_version")
        if db_schema != common.SCHEMA_VERSION:
            errors.append(f"SQLite meta schema mismatch: {db_schema}")
        db_skip = common.get_meta(conn, "skip_rules_hash")
        if db_skip != common.skip_rules_hash():
            errors.append("SQLite meta skip_rules_hash mismatch; rebuild index")

        file_paths = set()
        for row in conn.execute("SELECT id, path FROM files ORDER BY path"):
            path = row["path"]
            validate_path(path, "file", errors)
            file_paths.add(path)
            if path not in hashes:
                errors.append(f"file missing from hashes.json: {path}")

        for table in ("symbols", "words", "word_hits", "raw_imports", "deps", "content_lines"):
            for row in conn.execute(f"SELECT DISTINCT path FROM {table}"):
                path = row["path"]
                validate_path(path, table, errors)
                if path not in file_paths:
                    errors.append(f"{table} references unknown file: {path}")

        for row in conn.execute("SELECT DISTINCT resolved_path FROM deps WHERE resolved_path IS NOT NULL"):
            validate_path(row["resolved_path"], "resolved dependency", errors)
            if row["resolved_path"] not in file_paths:
                errors.append(f"dependency resolves to unknown file: {row['resolved_path']}")
    except sqlite3.DatabaseError as exc:
        errors.append(f"SQLite validation failed: {exc}")
    finally:
        conn.close()

    stale: list[str] = []
    for path, old in hashes.items():
        try:
            full = common.resolve_safe_repo_path(repo_root, path)
        except ValueError:
            errors.append(f"unsafe hash path: {path}")
            continue
        if not full.exists():
            stale.append(f"deleted: {path}")
            continue
        try:
            text = common.safe_read_text(full)
        except Exception:
            stale.append(f"unreadable: {path}")
            continue
        current_hash = common.sha256_short(text)
        if current_hash != old.get("hash"):
            stale.append(f"changed: {path}")

    if stale and not ALLOW_STALE:
        errors.append(f"stale index entries: {len(stale)}")
        for item in stale[:MAX_STALE_REPORT]:
            errors.append(f"  {item}")
        if len(stale) > MAX_STALE_REPORT:
            errors.append(f"  ... {len(stale) - MAX_STALE_REPORT} more")

    if errors:
        for error in errors:
            print(error)
        raise SystemExit(1)

    conn = common.connect_sqlite(db_path)
    try:
        counts = common.db_counts(conn)
    finally:
        conn.close()
    print(
        "index valid: "
        f"files={counts['files']} symbols={counts['symbols']} words={counts['words']} "
        f"trigrams={counts['trigrams']} sparse_ngrams={counts['sparse_ngrams']} "
        f"deps={counts['deps']} lines={counts['content_lines']} dir={index_dir}"
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

# ============================================================
# REFRESH CODE INDEX
# ============================================================
# Purpose:
# - Compare current repo files with prior hashes.
# - Incrementally update SQLite rows for added/changed/deleted files.
# - Python stdlib only, no argparse.
# ============================================================

from pathlib import Path
from typing import Any

import build_index
import code_index_common as common

REPO_ROOT = r""
MAX_FILE_BYTES = common.MAX_DEFAULT_FILE_BYTES
STORE_CONTENT_LINES = True
ENABLE_TRIGRAM_INDEX = True
ENABLE_SPARSE_NGRAM_INDEX = True
INDEX_WRITE_POLICY = "auto"  # auto, atomic, direct
PRINT_PROGRESS = True
MAX_CHANGE_REPORT = 30


def print_progress(message: str) -> None:
    if PRINT_PROGRESS:
        print(message)


def full_rebuild(repo_root: Path, reason: str) -> None:
    print(f"refresh: full rebuild required: {reason}")
    build_index.REPO_ROOT = str(repo_root)
    build_index.MAX_FILE_BYTES = MAX_FILE_BYTES
    build_index.STORE_CONTENT_LINES = STORE_CONTENT_LINES
    build_index.ENABLE_TRIGRAM_INDEX = ENABLE_TRIGRAM_INDEX
    build_index.ENABLE_SPARSE_NGRAM_INDEX = ENABLE_SPARSE_NGRAM_INDEX
    build_index.INDEX_WRITE_POLICY = INDEX_WRITE_POLICY
    build_index.PRINT_PROGRESS = PRINT_PROGRESS
    build_index.main()


def refresh_index(repo_root: Path, index_write_mode: str) -> dict[str, Any]:
    index_dir = common.index_dir_for(repo_root)
    db_path = common.db_path_for(repo_root)
    manifest_path = index_dir / "manifest.json"
    hashes_path = index_dir / "hashes.json"

    if not db_path.exists() or not manifest_path.exists() or not hashes_path.exists():
        reason = "missing SQLite index or sidecars"
        full_rebuild(repo_root, reason)
        return {"full_rebuild": True, "reason": reason}

    manifest = common.read_json(manifest_path)
    desired_flags = common.make_feature_flags(
        STORE_CONTENT_LINES,
        ENABLE_TRIGRAM_INDEX,
        ENABLE_SPARSE_NGRAM_INDEX,
    )
    if manifest.get("schema_version") != common.SCHEMA_VERSION:
        reason = "schema version changed"
        full_rebuild(repo_root, reason)
        return {"full_rebuild": True, "reason": reason}
    if manifest.get("skip_rules_hash") != common.skip_rules_hash():
        reason = "skip rules changed"
        full_rebuild(repo_root, reason)
        return {"full_rebuild": True, "reason": reason}
    if manifest.get("feature_flags") != desired_flags:
        reason = "index feature flags changed"
        full_rebuild(repo_root, reason)
        return {"full_rebuild": True, "reason": reason}

    old_hashes = common.read_json(hashes_path)
    current = common.current_hash_snapshot(repo_root, MAX_FILE_BYTES)
    added, changed, deleted = common.diff_hashes(old_hashes, current)

    print(f"refresh: added={len(added)} changed={len(changed)} deleted={len(deleted)}")
    for label, paths in (("added", added), ("changed", changed), ("deleted", deleted)):
        for path in paths[:MAX_CHANGE_REPORT]:
            print(f"  {label}: {path}")
        if len(paths) > MAX_CHANGE_REPORT:
            print(f"  {label}: ... {len(paths) - MAX_CHANGE_REPORT} more")

    if not added and not changed and not deleted:
        return {"added": 0, "changed": 0, "deleted": 0, "full_rebuild": False}

    payloads: list[dict[str, Any]] = []
    next_id = max((int(row.get("id", 0)) for row in old_hashes.values()), default=0) + 1
    for rel in changed:
        file_id = int(old_hashes.get(rel, {}).get("id", next_id))
        if "id" not in old_hashes.get(rel, {}):
            next_id += 1
        try:
            payloads.append(common.build_file_payload(
                repo_root,
                common.resolve_safe_repo_path(repo_root, rel),
                file_id,
                store_content_lines=STORE_CONTENT_LINES,
                enable_trigram=ENABLE_TRIGRAM_INDEX,
                enable_sparse_ngram=ENABLE_SPARSE_NGRAM_INDEX,
            ))
        except Exception as exc:
            print_progress(f"skip changed unreadable: {rel} ({exc})")
    for rel in added:
        file_id = next_id
        next_id += 1
        try:
            payloads.append(common.build_file_payload(
                repo_root,
                common.resolve_safe_repo_path(repo_root, rel),
                file_id,
                store_content_lines=STORE_CONTENT_LINES,
                enable_trigram=ENABLE_TRIGRAM_INDEX,
                enable_sparse_ngram=ENABLE_SPARSE_NGRAM_INDEX,
            ))
        except Exception as exc:
            print_progress(f"skip added unreadable: {rel} ({exc})")

    conn = common.connect_sqlite(db_path, index_write_mode)
    try:
        conn.execute("BEGIN")
        for rel in deleted + changed:
            common.delete_file_by_path(conn, rel)
        for payload in payloads:
            common.insert_file_payload(conn, payload)
        common.rebuild_resolved_deps(conn)
        common.set_meta(conn, "generated_at_utc", common.now_utc_iso())
        common.set_meta(conn, "index_write_mode", index_write_mode)
        conn.commit()
        manifest = common.write_sidecars(repo_root, conn, desired_flags)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(
        "refreshed: "
        f"files={manifest['file_count']} "
        f"symbols={manifest['symbol_count']} "
        f"words={manifest['word_count']} "
        f"deps={manifest['dependency_count']}"
    )
    details = common.state_details_from_manifest(manifest)
    details.update({"added": len(added), "changed": len(changed), "deleted": len(deleted), "full_rebuild": False})
    return details


def refresh_index_direct(repo_root: Path) -> dict[str, Any]:
    started_at = common.write_index_state(repo_root, "refresh", "processing", write_mode="direct")["started_at_utc"]
    try:
        details = refresh_index(repo_root, "direct")
    except Exception as exc:
        common.write_index_state(
            repo_root,
            "refresh",
            "failed",
            write_mode="direct",
            started_at_utc=started_at,
            error=str(exc),
        )
        raise
    common.write_index_state(
        repo_root,
        "refresh",
        "completed",
        write_mode="direct",
        started_at_utc=started_at,
        details=details,
    )
    return details


def main() -> None:
    repo_root = common.normalize_repo_root(REPO_ROOT)
    write_mode = common.select_index_write_mode(repo_root, INDEX_WRITE_POLICY)
    if write_mode == "direct":
        refresh_index_direct(repo_root)
        return
    try:
        details = refresh_index(repo_root, "atomic")
        common.remove_index_state(repo_root)
        if common.state_path_for(repo_root).exists():
            common.write_index_state(repo_root, "refresh", "completed", write_mode="atomic", details=details)
    except (OSError, common.sqlite3.DatabaseError) as exc:
        if INDEX_WRITE_POLICY.strip().lower() != "auto":
            raise
        print_progress(f"atomic refresh unavailable; falling back to guarded direct mode ({exc})")
        refresh_index_direct(repo_root)


if __name__ == "__main__":
    main()

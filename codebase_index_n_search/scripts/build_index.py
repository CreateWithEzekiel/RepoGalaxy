from __future__ import annotations

# ============================================================
# BUILD CODE INDEX
# ============================================================
# Purpose:
# - Walk a repository once.
# - Write a deterministic SQLite multi-index for structure-first Codex retrieval.
# - Python stdlib only, no argparse.
# ============================================================

from pathlib import Path
from typing import Any

import code_index_common as common

REPO_ROOT = r""
MAX_FILE_BYTES = common.MAX_DEFAULT_FILE_BYTES
STORE_CONTENT_LINES = True
ENABLE_TRIGRAM_INDEX = True
ENABLE_SPARSE_NGRAM_INDEX = True
INDEX_WRITE_POLICY = "auto"  # auto, atomic, direct
PRINT_PROGRESS = True


def print_progress(message: str) -> None:
    if PRINT_PROGRESS:
        print(message)


def build_index(repo_root: Path) -> dict[str, Any]:
    write_mode = common.select_index_write_mode(repo_root, INDEX_WRITE_POLICY)
    if write_mode == "direct":
        return build_index_direct(repo_root)
    try:
        return build_index_atomic(repo_root)
    except (OSError, common.sqlite3.DatabaseError) as exc:
        if INDEX_WRITE_POLICY.strip().lower() != "auto":
            raise
        print_progress(f"atomic build unavailable; falling back to guarded direct mode ({exc})")
        return build_index_direct(repo_root)


def build_index_atomic(repo_root: Path) -> dict[str, Any]:
    index_dir = common.index_dir_for(repo_root)
    index_dir.mkdir(parents=True, exist_ok=True)
    tmp_db = common.temp_db_path_for(repo_root)
    final_db = common.db_path_for(repo_root)

    common.remove_sqlite_sidecars(tmp_db, ignore_errors=True)
    try:
        feature_flags = populate_index_db(repo_root, tmp_db, "atomic", "atomic")
        common.replace_sqlite_db(tmp_db, final_db)
        manifest = write_final_sidecars(repo_root, feature_flags)
        common.remove_index_state(repo_root)
        if common.state_path_for(repo_root).exists():
            common.write_index_state(
                repo_root,
                "build",
                "completed",
                write_mode="atomic",
                details=common.state_details_from_manifest(manifest),
            )
    finally:
        common.remove_sqlite_sidecars(tmp_db, ignore_errors=True)
    return manifest


def build_index_direct(repo_root: Path) -> dict[str, Any]:
    started_at = common.write_index_state(repo_root, "build", "processing", write_mode="direct")["started_at_utc"]
    try:
        feature_flags = populate_index_db(repo_root, common.db_path_for(repo_root), "direct", "direct")
        manifest = write_final_sidecars(repo_root, feature_flags)
    except Exception as exc:
        common.write_index_state(
            repo_root,
            "build",
            "failed",
            write_mode="direct",
            started_at_utc=started_at,
            error=str(exc),
        )
        raise
    common.write_index_state(
        repo_root,
        "build",
        "completed",
        write_mode="direct",
        started_at_utc=started_at,
        details=common.state_details_from_manifest(manifest),
    )
    return manifest


def populate_index_db(repo_root: Path, db_path: Path, sqlite_write_mode: str, index_write_mode: str) -> dict[str, bool]:
    index_dir = common.index_dir_for(repo_root)
    index_dir.mkdir(parents=True, exist_ok=True)

    files = common.walk_indexable_files(repo_root, MAX_FILE_BYTES)
    feature_flags = common.make_feature_flags(
        STORE_CONTENT_LINES,
        ENABLE_TRIGRAM_INDEX,
        ENABLE_SPARSE_NGRAM_INDEX,
    )

    print_progress(f"Indexing {len(files)} files under {repo_root}")

    conn = common.connect_sqlite(db_path, sqlite_write_mode)
    try:
        common.reset_schema(conn)
        common.set_meta(conn, "schema_version", common.SCHEMA_VERSION)
        common.set_meta(conn, "skip_rules_hash", common.skip_rules_hash())
        common.set_meta(conn, "feature_flags", feature_flags)
        common.set_meta(conn, "index_write_mode", index_write_mode)
        common.set_meta(conn, "generated_at_utc", common.now_utc_iso())
        common.set_meta(conn, "generator", common.GENERATOR_NAME)

        for file_id, path in enumerate(files, start=1):
            try:
                payload = common.build_file_payload(
                    repo_root,
                    path,
                    file_id,
                    store_content_lines=STORE_CONTENT_LINES,
                    enable_trigram=ENABLE_TRIGRAM_INDEX,
                    enable_sparse_ngram=ENABLE_SPARSE_NGRAM_INDEX,
                )
            except Exception as exc:
                print_progress(f"skip unreadable: {path} ({exc})")
                continue
            common.insert_file_payload(conn, payload)

        common.rebuild_resolved_deps(conn)
        conn.commit()
    finally:
        conn.close()

    return feature_flags


def write_final_sidecars(repo_root: Path, feature_flags: dict[str, bool]) -> dict[str, Any]:
    conn = common.connect_sqlite(common.db_path_for(repo_root))
    try:
        return common.write_sidecars(repo_root, conn, feature_flags)
    finally:
        conn.close()


def main() -> None:
    repo_root = common.normalize_repo_root(REPO_ROOT)
    manifest = build_index(repo_root)
    print(
        "indexed: "
        f"files={manifest['file_count']} "
        f"symbols={manifest['symbol_count']} "
        f"words={manifest['word_count']} "
        f"trigrams={manifest['trigram_count']} "
        f"sparse_ngrams={manifest['sparse_ngram_count']} "
        f"deps={manifest['dependency_count']} "
        f"db={manifest['index_db']}"
    )


if __name__ == "__main__":
    main()

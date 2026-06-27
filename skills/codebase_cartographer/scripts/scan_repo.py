from __future__ import annotations

from pathlib import Path

from cartographer_common import (
    file_sha1,
    guess_language,
    read_text,
    safe_rel_path,
    should_skip_path,
    split_lines,
)


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
MAX_FILE_BYTES = 750_000


# ============================================================
# SCAN
# ============================================================

def scan_repo(repo_root: str | Path = REPO_ROOT) -> list[dict]:
    root = Path(repo_root).resolve()
    records = []
    for path in sorted(root.rglob("*"), key=lambda item: str(item).lower()):
        if not path.is_file():
            continue
        if should_skip_path(path, root):
            continue
        language = guess_language(path)
        if language == "unknown":
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            continue
        text = read_text(path)
        rel_path = safe_rel_path(path, root)
        records.append(
            {
                "path": path,
                "rel_path": rel_path,
                "language": language,
                "extension": path.suffix.lower(),
                "sha1": file_sha1(path),
                "line_count": len(split_lines(text)),
                "text": text,
            }
        )
    return records


def build_source_manifest(records: list[dict]) -> dict:
    return {
        "files": [
            {
                "path": record["rel_path"],
                "language": record["language"],
                "sha1": record["sha1"],
                "line_count": record["line_count"],
            }
            for record in records
        ]
    }


def main() -> list[dict]:
    records = scan_repo(REPO_ROOT)
    print(f"scanned files: {len(records)}")
    for record in records[:40]:
        print(f"- {record['rel_path']} ({record['language']}, {record['line_count']} lines)")
    if len(records) > 40:
        print(f"... {len(records) - 40} more")
    return records


if __name__ == "__main__":
    main()

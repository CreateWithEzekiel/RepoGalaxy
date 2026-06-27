from __future__ import annotations

# ============================================================
# READ A NARROW SOURCE SLICE
# ============================================================
# Purpose:
# - Read exact source lines after indexed retrieval narrows the target.
# - Block unsafe paths and sensitive files.
# - Python stdlib only, no argparse.
# ============================================================

import code_index_common as common

REPO_ROOT = r""
FILE_PATH = r""
LINE_START = 1
LINE_END = 200
COMPACT = False
IF_HASH = r""


def main() -> None:
    repo_root = common.normalize_repo_root(REPO_ROOT)
    if not FILE_PATH:
        print("error: FILE_PATH is required")
        return
    rel = FILE_PATH.replace("\\", "/")
    if common.is_sensitive_path(rel):
        print("error: access to sensitive file blocked")
        return
    try:
        path = common.resolve_safe_repo_path(repo_root, rel)
    except ValueError as exc:
        print(f"error: {exc}")
        return
    if not path.exists() or not path.is_file():
        print(f"error: file not found: {rel}")
        return
    if common.should_skip_file(path, repo_root, max_file_bytes=10 * 1024 * 1024):
        print("error: file is skipped or unsupported for safe text reading")
        return

    try:
        text = common.safe_read_text(path)
    except Exception as exc:
        print(f"error: failed to read file: {exc}")
        return

    content_hash = common.sha256_short(text)
    if IF_HASH and IF_HASH == content_hash:
        print(f"unchanged:{content_hash}")
        return
    print(f"hash:{content_hash}")

    lines = text.splitlines()
    start = max(1, int(LINE_START or 1))
    end = int(LINE_END or (start + 120))
    end = max(start, min(end, len(lines)))

    for line_num in range(start, end + 1):
        line = lines[line_num - 1]
        if COMPACT and common.is_comment_or_blank(path, line):
            continue
        print(f"{line_num:>5}| {line}")


if __name__ == "__main__":
    main()

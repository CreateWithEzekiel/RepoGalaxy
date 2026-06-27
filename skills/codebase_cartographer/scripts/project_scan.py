from __future__ import annotations

from collections import Counter
import json
from pathlib import Path

from cartographer_common import (
    file_type_profile,
    guess_language,
    normalise_rel_path,
    now_iso,
    should_skip_path,
)


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = Path.cwd()

FILE_MARKERS = {
    ".git",
    "Dockerfile",
    "docker-compose.yml",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "vite.config.ts",
    "vite.config.js",
}

DIR_MARKERS = {
    "app",
    "src",
    "pages",
    "components",
    "routes",
}


# ============================================================
# FOLDER PROFILE
# ============================================================

def rel_path(path: Path, repo_root: Path) -> str:
    return normalise_rel_path(path.resolve().relative_to(repo_root.resolve()))


def marker_evidence(path: Path) -> list[str]:
    evidence = []
    for marker in sorted(FILE_MARKERS):
        if (path / marker).exists():
            evidence.append(f"file:{marker}")
    for marker in sorted(DIR_MARKERS):
        if (path / marker).is_dir():
            evidence.append(f"dir:{marker}")
    return evidence


def supported_file_profile(path: Path, repo_root: Path) -> dict:
    language_counts: Counter[str] = Counter()
    for child in path.rglob("*"):
        if not child.is_file():
            continue
        if should_skip_path(child, repo_root):
            continue
        language = guess_language(child)
        if language != "unknown":
            language_counts[language] += 1
    return file_type_profile(language_counts)


def scan_project_folders(repo_root: str | Path = REPO_ROOT) -> dict:
    root = Path(repo_root).resolve()
    folders = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir() or should_skip_path(child, root):
            continue
        profile = supported_file_profile(child, root)
        evidence = marker_evidence(child)
        folders.append(
            {
                "path": rel_path(child, root),
                "label": child.name,
                "evidence": evidence,
                "supported_file_count": profile["supported_file_count"],
                "language_counts": profile["language_counts"],
                "file_type_counts": profile["file_type_counts"],
                "majority_file_type": profile["majority_file_type"],
            }
        )
    return {
        "schema_version": "0.1.0",
        "generated_at": now_iso(),
        "repo": {
            "name": root.name,
            "root": str(root),
        },
        "folder_count": len(folders),
        "folders": folders,
    }


# ============================================================
# MAIN
# ============================================================

def main() -> dict:
    result = scan_project_folders(REPO_ROOT)
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


if __name__ == "__main__":
    main()

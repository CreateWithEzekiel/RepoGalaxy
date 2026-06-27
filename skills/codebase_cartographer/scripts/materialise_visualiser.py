from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
TARGET_RELATIVE_PATH = ".repo_executive_context/codebase_cartographer/visualiser"
OVERWRITE_EXISTING_FILES = True
REMOVE_STALE_NON_GENERATED_FILES = False
VERIFY_AFTER_COPY = True


# ============================================================
# PATHS
# ============================================================

def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def asset_root() -> Path:
    return skill_root() / "assets" / "visualiser"


def manifest_path() -> Path:
    return skill_root() / "assets" / "visualiser_manifest.json"


def target_root(repo_root: str | Path = REPO_ROOT) -> Path:
    return Path(repo_root).resolve() / TARGET_RELATIVE_PATH


# ============================================================
# MANIFEST
# ============================================================

def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest() -> dict:
    return json.loads(manifest_path().read_text(encoding="utf-8"))


def bundled_files() -> list[Path]:
    root = asset_root()
    return sorted(path for path in root.rglob("*") if path.is_file())


def relative_key(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


# ============================================================
# COPY
# ============================================================

def is_generated_visualiser_path(relative_path: str) -> bool:
    return relative_path == "public/codebase_cartographer" or relative_path.startswith("public/codebase_cartographer/")


def copy_visualiser_files(source_root: Path, destination_root: Path, manifest: dict) -> list[str]:
    copied: list[str] = []
    for item in manifest["files"]:
        relative_path = item["path"]
        source = source_root / relative_path
        destination = destination_root / relative_path
        if destination.exists() and not OVERWRITE_EXISTING_FILES:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(relative_path)
    (destination_root / "public" / "codebase_cartographer").mkdir(parents=True, exist_ok=True)
    (destination_root / "public" / "codebase_cartographer" / "traces").mkdir(parents=True, exist_ok=True)
    return copied


def remove_stale_files(destination_root: Path, manifest: dict) -> list[str]:
    expected = {item["path"] for item in manifest["files"]}
    removed: list[str] = []
    for path in sorted(destination_root.rglob("*"), reverse=True):
        if not path.is_file():
            continue
        relative_path = relative_key(path, destination_root)
        if relative_path in expected or is_generated_visualiser_path(relative_path):
            continue
        path.unlink()
        removed.append(relative_path)
    return removed


# ============================================================
# VERIFY
# ============================================================

def verify_visualiser(destination_root: Path, manifest: dict) -> dict:
    missing: list[str] = []
    mismatched: list[str] = []
    checked = 0
    for item in manifest["files"]:
        relative_path = item["path"]
        destination = destination_root / relative_path
        if not destination.exists():
            missing.append(relative_path)
            continue
        checked += 1
        if destination.stat().st_size != item["size"] or file_sha256(destination) != item["sha256"]:
            mismatched.append(relative_path)
    return {
        "ok": not missing and not mismatched,
        "checked": checked,
        "missing": missing,
        "mismatched": mismatched,
    }


# ============================================================
# MAIN
# ============================================================

def materialise_visualiser(repo_root: str | Path = REPO_ROOT) -> dict:
    source_root = asset_root()
    destination_root = target_root(repo_root)
    manifest = load_manifest()
    if not source_root.exists():
        raise FileNotFoundError(f"Bundled visualiser asset folder not found: {source_root}")
    copied = copy_visualiser_files(source_root, destination_root, manifest)
    removed = remove_stale_files(destination_root, manifest) if REMOVE_STALE_NON_GENERATED_FILES else []
    verification = verify_visualiser(destination_root, manifest) if VERIFY_AFTER_COPY else {"ok": None}
    result = {
        "visualiser": str(destination_root),
        "copied": len(copied),
        "removed_stale": len(removed),
        "verification": verification,
    }
    if verification.get("ok") is False:
        raise RuntimeError(json.dumps(result, indent=2, sort_keys=True))
    return result


def main() -> dict:
    result = materialise_visualiser(REPO_ROOT)
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


if __name__ == "__main__":
    main()

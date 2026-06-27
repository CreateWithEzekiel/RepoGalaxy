from __future__ import annotations

from collections import Counter
from pathlib import Path

from cartographer_common import (
    file_type_profile,
    guess_language,
    normalise_rel_path,
    now_iso,
    should_skip_path,
    write_json,
)


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
OUTPUT_ROOT = ".repo_executive_context/codebase_cartographer"
WORKSPACE_PROFILE_PATH = f"{OUTPUT_ROOT}/workspace_profile.json"
CARTOGRAPHER_CONFIG_PATH = f"{OUTPUT_ROOT}/cartographer_config.json"

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
# PATH HELPERS
# ============================================================

def service_index(name: str) -> int | None:
    return None


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


def supported_file_count(path: Path, repo_root: Path) -> int:
    return supported_file_profile(path, repo_root)["supported_file_count"]


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


def root_supported_file_count(repo_root: Path) -> int:
    return root_supported_file_profile(repo_root)["supported_file_count"]


def root_supported_file_profile(repo_root: Path) -> dict:
    language_counts: Counter[str] = Counter()
    for child in repo_root.iterdir():
        if not child.is_file():
            continue
        if should_skip_path(child, repo_root):
            continue
        language = guess_language(child)
        if language != "unknown":
            language_counts[language] += 1
    return file_type_profile(language_counts)


# ============================================================
# PROFILE
# ============================================================

def detect_workspace_profile(repo_root: str | Path = REPO_ROOT) -> dict:
    root = Path(repo_root).resolve()
    candidates = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir() or should_skip_path(child, root):
            continue
        evidence = marker_evidence(child)
        profile = supported_file_profile(child, root)
        source_count = profile["supported_file_count"]
        if not evidence and source_count == 0:
            continue
        score = len(evidence) + min(source_count, 8)
        candidates.append(
            {
                "path": rel_path(child, root),
                "label": child.name,
                "service_index": None,
                "supported_file_count": source_count,
                "language_counts": profile["language_counts"],
                "file_type_counts": profile["file_type_counts"],
                "majority_file_type": profile["majority_file_type"],
                "evidence": evidence,
                "score": score,
            }
        )
    root_markers = marker_evidence(root)
    root_profile = root_supported_file_profile(root)
    root_file_count = root_profile["supported_file_count"]
    strong_candidates = [item for item in candidates if item["score"] >= 2 and item["supported_file_count"] > 0]
    workspace_mode = "workspace" if len(strong_candidates) >= 2 else "single_repo"
    return {
        "schema_version": "0.1.0",
        "generated_at": now_iso(),
        "repo": {
            "name": root.name,
            "root": str(root),
        },
        "suggested_workspace_mode": workspace_mode,
        "root": {
            "path": ".",
            "label": root.name,
            "supported_file_count": root_file_count,
            "language_counts": root_profile["language_counts"],
            "file_type_counts": root_profile["file_type_counts"],
            "majority_file_type": root_profile["majority_file_type"],
            "evidence": root_markers,
        },
        "candidates": strong_candidates,
    }


def write_workspace_profile(repo_root: str | Path = REPO_ROOT) -> dict:
    root = Path(repo_root).resolve()
    profile = detect_workspace_profile(root)
    write_json(root / WORKSPACE_PROFILE_PATH, profile)
    return profile


# ============================================================
# CARTOGRAPHER CONFIG
# ============================================================

def service_role(candidate: dict, workspace_mode: str) -> str:
    if workspace_mode == "single_repo":
        return "main_repo"
    return "backend_service"


def service_root_from_profile_item(item: dict, workspace_mode: str) -> dict:
    return {
        "path": item["path"],
        "label": item["label"],
        "role": service_role(item, workspace_mode),
        "service_index": item.get("service_index"),
        "status": "complete",
        "source": "workspace_profile",
        "evidence": item["evidence"],
        "supported_file_count": item.get("supported_file_count", 0),
        "language_counts": item.get("language_counts", {}),
        "file_type_counts": item.get("file_type_counts", {}),
        "majority_file_type": item.get("majority_file_type", "unknown"),
    }


def refresh_service_root_profile(service_root: dict, profile_item: dict | None) -> dict:
    if not profile_item:
        return service_root
    updated = dict(service_root)
    for key in ["supported_file_count", "language_counts", "file_type_counts", "majority_file_type"]:
        updated[key] = profile_item.get(key, updated.get(key))
    if not updated.get("evidence") and profile_item.get("evidence"):
        updated["evidence"] = profile_item["evidence"]
    return updated


def config_service_roots(profile: dict) -> list[dict]:
    workspace_mode = profile["suggested_workspace_mode"]
    if workspace_mode == "single_repo":
        root = profile["root"]
        service_root = service_root_from_profile_item(root, workspace_mode)
        service_root["role"] = "main_repo"
        service_root["evidence"] = service_root["evidence"] or ["root_scan"]
        return [service_root]
    service_roots = []
    for candidate in profile["candidates"]:
        service_roots.append(service_root_from_profile_item(candidate, workspace_mode))
    return service_roots


def config_service_links(service_roots: list[dict]) -> list[dict]:
    return []


def merge_existing_config(profile: dict, existing: dict) -> dict:
    workspace_mode = existing.get("workspace_mode") or profile["suggested_workspace_mode"]
    service_roots_locked = existing.get("service_roots_locked") is True
    profile_items = {".": profile["root"]}
    profile_items.update({item["path"]: item for item in profile["candidates"]})
    service_roots = []
    known_paths = set()
    for service_root in existing.get("service_roots") or []:
        path = service_root.get("path") or "."
        known_paths.add(path)
        service_roots.append(refresh_service_root_profile(service_root, profile_items.get(path)))
    if not service_roots_locked:
        for candidate in profile["candidates"]:
            if candidate["path"] in known_paths:
                continue
            service_roots.append(service_root_from_profile_item(candidate, workspace_mode))
    merged = dict(existing)
    merged["workspace_mode"] = workspace_mode
    if service_roots_locked:
        merged["service_roots"] = service_roots
    else:
        merged["service_roots"] = service_roots or config_service_roots(profile)
    merged.setdefault("service_links", config_service_links(merged["service_roots"]))
    return merged


def default_cartographer_config(profile: dict) -> dict:
    service_roots = config_service_roots(profile)
    return {
        "schema_version": "0.1.0",
        "generated_at": now_iso(),
        "workspace_mode": profile["suggested_workspace_mode"],
        "service_roots_locked": False,
        "source": "workspace_profile",
        "notes": "Codex may edit this file before running the graph builder. The deterministic scripts consume this config as declared workspace structure evidence.",
        "service_roots": service_roots,
        "service_links": config_service_links(service_roots),
    }


def read_cartographer_config(repo_root: str | Path = REPO_ROOT) -> dict | None:
    root = Path(repo_root).resolve()
    path = root / CARTOGRAPHER_CONFIG_PATH
    if not path.exists():
        return None
    import json
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_cartographer_config(repo_root: str | Path = REPO_ROOT) -> tuple[dict, dict]:
    root = Path(repo_root).resolve()
    profile = write_workspace_profile(root)
    config_path = root / CARTOGRAPHER_CONFIG_PATH
    existing = read_cartographer_config(root)
    if existing:
        config = merge_existing_config(profile, existing)
        if config != existing:
            write_json(config_path, config)
        return profile, config
    config = default_cartographer_config(profile)
    write_json(config_path, config)
    return profile, config


def main() -> dict:
    profile, config = ensure_cartographer_config(REPO_ROOT)
    print(f"workspace mode: {config.get('workspace_mode')}")
    print(f"candidate roots: {len(profile.get('candidates', []))}")
    print(f"service roots: {len(config.get('service_roots', []))}")
    print(f"service links: {len(config.get('service_links', []))}")
    print(f"profile: {Path(REPO_ROOT).resolve() / WORKSPACE_PROFILE_PATH}")
    print(f"config: {Path(REPO_ROOT).resolve() / CARTOGRAPHER_CONFIG_PATH}")
    return {
        "profile": profile,
        "config": config,
    }


if __name__ == "__main__":
    main()

from __future__ import annotations

import json
from pathlib import Path


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = Path.cwd()
OUTPUT_ROOT = ".repo_executive_context/codebase_cartographer"
SETUP_CHECK_PATH = f"{OUTPUT_ROOT}/setup_check.json"
CARTOGRAPHER_CONFIG_PATH = f"{OUTPUT_ROOT}/cartographer_config.json"
GRAPH_PATH = f"{OUTPUT_ROOT}/graph.json"
SOURCE_MANIFEST_PATH = f"{OUTPUT_ROOT}/source_manifest.json"
SETUP_SCHEMA_VERSION = 1
ARCHITECTURE_CHOICES = {"A", "B", "C", "D", "E"}


# ============================================================
# STATE
# ============================================================

def read_optional_json(path: Path) -> tuple[dict | None, str | None]:
    if not path.exists():
        return None, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, str(exc)
    if not isinstance(payload, dict):
        return None, "JSON root is not an object."
    return payload, None


def validate_setup_check(payload: dict | None) -> list[str]:
    if payload is None:
        return ["setup_check.json is missing."]

    errors = []
    if payload.get("schema_version") != SETUP_SCHEMA_VERSION:
        errors.append("schema_version is missing or unsupported.")
    if payload.get("architecture_choice") not in ARCHITECTURE_CHOICES:
        errors.append("architecture_choice must be one of A, B, C, D, or E.")
    if not isinstance(payload.get("confirmed_service_nodes"), list):
        errors.append("confirmed_service_nodes must be a list.")
    if not isinstance(payload.get("confirmed_service_links"), list):
        errors.append("confirmed_service_links must be a list.")
    return errors


def check_skill_run_state(repo_root: str | Path = REPO_ROOT) -> dict:
    root = Path(repo_root).resolve()
    setup_path = root / SETUP_CHECK_PATH
    config_path = root / CARTOGRAPHER_CONFIG_PATH
    graph_path = root / GRAPH_PATH
    manifest_path = root / SOURCE_MANIFEST_PATH
    setup_check, load_error = read_optional_json(setup_path)
    artifacts = {
        "setup_check": setup_path.exists(),
        "cartographer_config": config_path.exists(),
        "source_manifest": manifest_path.exists(),
        "graph": graph_path.exists(),
    }

    if load_error:
        status = "invalid_setup_check"
        setup_required = True
        indexing_allowed = False
        reason = f"setup_check.json could not be parsed: {load_error}"
    else:
        errors = validate_setup_check(setup_check)
        if setup_path.exists() and errors:
            status = "invalid_setup_check"
            setup_required = True
            indexing_allowed = False
            reason = "; ".join(errors)
        elif not setup_path.exists() and any(artifacts[name] for name in ("cartographer_config", "source_manifest", "graph")):
            status = "legacy_run_without_setup_check"
            setup_required = True
            indexing_allowed = False
            reason = "Cartographer artifacts exist, but setup_check.json is missing."
        elif not setup_path.exists():
            status = "setup_required"
            setup_required = True
            indexing_allowed = False
            reason = "setup_check.json is missing."
        else:
            status = "ready"
            setup_required = False
            indexing_allowed = True
            reason = "First-run setup has been confirmed."

    return {
        "repo_root": str(root),
        "setup_check_path": SETUP_CHECK_PATH,
        "status": status,
        "setup_required": setup_required,
        "indexing_allowed": indexing_allowed,
        "reason": reason,
        "artifacts": artifacts,
    }


# ============================================================
# MAIN
# ============================================================

def main() -> dict:
    result = check_skill_run_state(REPO_ROOT)
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


if __name__ == "__main__":
    main()

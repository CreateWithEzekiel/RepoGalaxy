from __future__ import annotations

import json
from pathlib import Path

from materialise_visualiser import REPO_ROOT, load_manifest, target_root, verify_visualiser


# ============================================================
# CONFIG
# ============================================================

TARGET_RELATIVE_PATH = ".repo_executive_context/codebase_cartographer/visualiser"


# ============================================================
# MAIN
# ============================================================

def main() -> dict:
    destination_root = Path(REPO_ROOT).resolve() / TARGET_RELATIVE_PATH
    result = verify_visualiser(destination_root, load_manifest())
    result["visualiser"] = str(destination_root)
    print(json.dumps(result, indent=2, sort_keys=True))
    if not result["ok"]:
        raise RuntimeError("Visualiser snapshot verification failed.")
    return result


if __name__ == "__main__":
    main()

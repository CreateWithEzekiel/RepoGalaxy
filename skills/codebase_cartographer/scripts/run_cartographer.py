from __future__ import annotations

import json
from pathlib import Path

from build_graph import OUTPUT_ROOT, REPO_ROOT, build_graph, write_graph_outputs
from cartographer_common import copy_graph_for_visualiser, file_sha1, read_json, write_graph_sqlite, write_json
from generate_json_canvas import write_canvas_files
from generate_obsidian_notes import write_node_notes
from scan_repo import build_source_manifest, scan_repo
from semantic_delta import merge_unchanged_agentic_fields, write_semantic_queues
from validate_graph import validate_and_write
from workspace_config import CARTOGRAPHER_CONFIG_PATH, WORKSPACE_PROFILE_PATH, ensure_cartographer_config


# ============================================================
# CONFIG
# ============================================================

GRAPH_PATH = ".repo_executive_context/codebase_cartographer/graph.json"
SQLITE_PATH = ".repo_executive_context/codebase_cartographer/graph.sqlite"
SOURCE_MANIFEST_PATH = ".repo_executive_context/codebase_cartographer/source_manifest.json"
FORCE_REBUILD = False


# ============================================================
# EXISTING STATE
# ============================================================

def read_optional_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return read_json(path)
    except Exception:
        return None


# ============================================================
# RUNNER
# ============================================================

def run_cartographer(repo_root: str | Path = REPO_ROOT) -> dict:
    root = Path(repo_root).resolve()
    graph_path = root / GRAPH_PATH
    manifest_path = root / SOURCE_MANIFEST_PATH
    records = scan_repo(root)
    workspace_profile, cartographer_config = ensure_cartographer_config(root)
    source_manifest = build_source_manifest(records)
    config_path = root / CARTOGRAPHER_CONFIG_PATH
    source_manifest["cartographer_config"] = {
        "path": CARTOGRAPHER_CONFIG_PATH,
        "sha1": file_sha1(config_path) if config_path.exists() else None,
    }
    source_manifest["workspace_profile"] = {
        "suggested_workspace_mode": workspace_profile.get("suggested_workspace_mode"),
        "candidate_paths": sorted(item.get("path") for item in workspace_profile.get("candidates", [])),
    }
    old_manifest = read_optional_json(manifest_path)
    old_graph = read_optional_json(graph_path)
    if not FORCE_REBUILD and old_graph and old_manifest == source_manifest:
        queue_outputs = write_semantic_queues(root, old_graph, old_graph)
        copied_to = copy_graph_for_visualiser(graph_path, root)
        result = {
            "status": "skipped_no_source_changes",
            "graph": str(graph_path),
            "validation_status": old_graph.get("validation", {}).get("status", "unknown"),
            "nodes": len(old_graph.get("nodes", [])),
            "edges": len(old_graph.get("edges", [])),
            "semantic_delta": queue_outputs["delta_counts"],
            "visualiser_graph": str(copied_to) if copied_to else None,
        }
        return result
    graph = build_graph(root, records, cartographer_config)
    graph = merge_unchanged_agentic_fields(old_graph, graph)
    outputs = write_graph_outputs(graph, root, OUTPUT_ROOT)
    validation = validate_and_write(root, GRAPH_PATH)
    graph = read_json(root / GRAPH_PATH)
    write_graph_sqlite(root / SQLITE_PATH, graph)
    write_node_notes(graph, root)
    write_canvas_files(graph, root)
    queue_outputs = write_semantic_queues(root, old_graph, graph)
    write_json(manifest_path, source_manifest)
    copied_to = copy_graph_for_visualiser(root / GRAPH_PATH, root)
    result = {
        "status": "rebuilt",
        "graph": str(root / GRAPH_PATH),
        "sqlite": str(root / SQLITE_PATH),
        "validation_status": validation["status"],
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
        "semantic_delta": queue_outputs["delta_counts"],
        "visualiser_graph": str(copied_to) if copied_to else None,
        "initial_outputs": {key: str(value) if value else None for key, value in outputs.items()},
    }
    return result


def main() -> dict:
    result = run_cartographer(REPO_ROOT)
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


if __name__ == "__main__":
    main()

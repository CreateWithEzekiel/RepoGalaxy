from __future__ import annotations

import json
from pathlib import Path

from generate_obsidian_notes import safe_note_name


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
GRAPH_PATH = ".repo_executive_context/codebase_cartographer/graph.json"
CANVAS_ROOT = ".repo_executive_context/codebase_cartographer/obsidian_vault"

PERSPECTIVE_FILES = {
    "overview": "Codebase Overview.canvas",
    "frontend": "FE Perspective.canvas",
    "services": "Service Perspective.canvas",
    "api": "API Perspective.canvas",
    "data": "Data Perspective.canvas",
    "workflow": "Workflow Perspective.canvas",
}

KIND_ORDER = {
    "service": 0,
    "api_endpoint": 1,
    "component": 2,
    "hook": 3,
    "api_client": 4,
    "function": 5,
    "method": 6,
    "schema": 7,
    "type": 8,
    "class": 9,
    "style": 10,
    "file": 11,
}


# ============================================================
# CANVAS
# ============================================================

def sorted_perspective_nodes(graph: dict, node_ids: list[str]) -> list[dict]:
    nodes_by_id = {node["id"]: node for node in graph["nodes"]}
    nodes = [nodes_by_id[node_id] for node_id in node_ids if node_id in nodes_by_id]
    return sorted(nodes, key=lambda node: (KIND_ORDER.get(node["kind"], 99), node["file"], node["line_start"] or 0, node["id"]))


def canvas_node(node: dict, index: int) -> dict:
    column = index % 5
    row = index // 5
    return {
        "id": node["id"],
        "type": "file",
        "file": "nodes/" + safe_note_name(node["id"]),
        "x": column * 430,
        "y": row * 290,
        "width": 360,
        "height": 220,
    }


def canvas_edge(edge: dict, visible_node_ids: set[str]) -> dict | None:
    if edge["source"] not in visible_node_ids or edge["target"] not in visible_node_ids:
        return None
    return {
        "id": edge["id"],
        "fromNode": edge["source"],
        "toNode": edge["target"],
        "label": edge["kind"],
    }


def build_canvas(graph: dict, perspective_key: str) -> dict:
    perspective = graph["perspectives"][perspective_key]
    nodes = sorted_perspective_nodes(graph, perspective["node_ids"])
    visible_node_ids = {node["id"] for node in nodes}
    canvas_nodes = [canvas_node(node, index) for index, node in enumerate(nodes)]
    canvas_edges = []
    for edge in graph["edges"]:
        item = canvas_edge(edge, visible_node_ids)
        if item:
            canvas_edges.append(item)
    return {
        "nodes": canvas_nodes,
        "edges": canvas_edges,
    }


def write_canvas_files(graph: dict, repo_root: str | Path = REPO_ROOT, canvas_root: str | Path = CANVAS_ROOT) -> list[Path]:
    root = Path(repo_root).resolve()
    output = root / canvas_root
    output.mkdir(parents=True, exist_ok=True)
    paths = []
    for perspective_key, file_name in PERSPECTIVE_FILES.items():
        canvas = build_canvas(graph, perspective_key)
        path = output / file_name
        path.write_text(json.dumps(canvas, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


def main() -> list[Path]:
    root = Path(REPO_ROOT).resolve()
    graph = json.loads((root / GRAPH_PATH).read_text(encoding="utf-8"))
    paths = write_canvas_files(graph, root, CANVAS_ROOT)
    print(f"canvas files: {len(paths)}")
    for path in paths:
        print(f"- {path}")
    return paths


if __name__ == "__main__":
    main()

from __future__ import annotations

from pathlib import Path

from cartographer_common import deterministic_fingerprint, write_json


# ============================================================
# CONFIG
# ============================================================

AGENTIC_QUEUE_PATH = ".repo_executive_context/codebase_cartographer/agentic_summary_queue.json"
SEMANTIC_DELTA_PATH = ".repo_executive_context/codebase_cartographer/agentic_delta_queue.json"


# ============================================================
# DELTA
# ============================================================

def item_fingerprint(item: dict) -> str:
    return deterministic_fingerprint(item)


def merge_unchanged_agentic_fields(old_graph: dict | None, new_graph: dict) -> dict:
    if not old_graph:
        return new_graph
    old_nodes = {node["id"]: node for node in old_graph.get("nodes", [])}
    old_edges = {edge["id"]: edge for edge in old_graph.get("edges", [])}
    for node in new_graph.get("nodes", []):
        old_node = old_nodes.get(node["id"])
        if not old_node or item_fingerprint(old_node) != item_fingerprint(node):
            continue
        old_summary = old_node.get("summary", {})
        if old_summary.get("agentic"):
            node["summary"]["agentic"] = old_summary["agentic"]
            node["summary"]["agentic_status"] = old_summary.get("agentic_status", "complete")
    for edge in new_graph.get("edges", []):
        old_edge = old_edges.get(edge["id"])
        if not old_edge or item_fingerprint(old_edge) != item_fingerprint(edge):
            continue
        old_reason = old_edge.get("reason", {})
        if old_reason.get("agentic"):
            edge["reason"]["agentic"] = old_reason["agentic"]
            edge["reason"]["agentic_status"] = old_reason.get("agentic_status", "complete")
    return new_graph


def change_type(item: dict, old_items: dict[str, dict]) -> str | None:
    old_item = old_items.get(item["id"])
    if not old_item:
        return "new"
    if item_fingerprint(old_item) != item_fingerprint(item):
        return "changed"
    return None


def edge_change_type(item: dict, old_items: dict[str, dict]) -> str | None:
    old_item = old_items.get(item["id"])
    if not old_item:
        return "new"
    if item_fingerprint(old_item) != item_fingerprint(item):
        return "changed"
    return None


def build_agentic_summary_queue(graph: dict) -> dict:
    return build_agentic_delta_queue(None, graph)


def build_agentic_delta_queue(old_graph: dict | None, new_graph: dict) -> dict:
    old_nodes = {node["id"]: node for node in old_graph.get("nodes", [])} if old_graph else {}
    old_edges = {edge["id"]: edge for edge in old_graph.get("edges", [])} if old_graph else {}
    node_items = []
    for node in new_graph.get("nodes", []):
        item_change_type = change_type(node, old_nodes) if old_graph else "new"
        if not item_change_type:
            continue
        node_items.append(
            {
                "change_type": item_change_type,
                "node_id": node["id"],
                "fingerprint": item_fingerprint(node),
                "kind": node["kind"],
                "label": node["label"],
                "file": node["file"],
                "line_start": node["line_start"],
                "line_end": node["line_end"],
                "deterministic_summary": node["summary"]["deterministic"],
                "requested_agentic_field": "summary.agentic",
            }
        )
    edge_items = []
    for edge in new_graph.get("edges", []):
        item_change_type = edge_change_type(edge, old_edges) if old_graph else "new"
        if not item_change_type:
            continue
        edge_items.append(
            {
                "change_type": item_change_type,
                "edge_id": edge["id"],
                "fingerprint": item_fingerprint(edge),
                "source": edge["source"],
                "target": edge["target"],
                "kind": edge["kind"],
                "deterministic_reason": edge["reason"]["deterministic"],
                "requested_agentic_field": "reason.agentic",
            }
        )
    removed_nodes = sorted(set(old_nodes) - {node["id"] for node in new_graph.get("nodes", [])})
    removed_edges = sorted(set(old_edges) - {edge["id"] for edge in new_graph.get("edges", [])})
    return {
        "purpose": "Delta-only optional Codex enrichment queue. Use only for semantic summaries/reasons, never graph topology or contracts.",
        "nodes": node_items,
        "edges": edge_items,
        "removed_nodes": removed_nodes,
        "removed_edges": removed_edges,
        "counts": {
            "nodes_to_enrich": len(node_items),
            "edges_to_enrich": len(edge_items),
            "removed_nodes": len(removed_nodes),
            "removed_edges": len(removed_edges),
        },
    }


def write_semantic_queues(repo_root: str | Path, old_graph: dict | None, new_graph: dict) -> dict:
    root = Path(repo_root).resolve()
    full_queue = build_agentic_summary_queue(new_graph)
    delta_queue = build_agentic_delta_queue(old_graph, new_graph)
    write_json(root / AGENTIC_QUEUE_PATH, full_queue)
    write_json(root / SEMANTIC_DELTA_PATH, delta_queue)
    return {
        "full_queue": str(root / AGENTIC_QUEUE_PATH),
        "delta_queue": str(root / SEMANTIC_DELTA_PATH),
        "delta_counts": delta_queue["counts"],
    }

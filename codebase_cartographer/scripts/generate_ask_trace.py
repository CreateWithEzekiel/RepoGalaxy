from __future__ import annotations

import json
import shutil
import sqlite3
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from cartographer_common import read_json, slugify, write_json


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
GRAPH_PATH = ".repo_executive_context/codebase_cartographer/graph.json"
TRACE_ROOT = ".repo_executive_context/codebase_cartographer/traces"
INDEX_DB_PATH = ".repo_executive_context/codebase_index_n_search/index.sqlite"
QUESTION = "How does the selected flow work?"
START_NODE_ID = ""
TRACE_ID = ""
MAX_TRACE_STEPS = 14

FLOW_EDGE_PRIORITY = {
    "calls_api": 0,
    "handled_by": 1,
    "calls": 2,
    "uses_schema": 3,
    "uses_table": 4,
    "renders": 5,
    "uses_style": 6,
    "imports": 7,
    "contains": 8,
}


# ============================================================
# INDEX SUPPORT
# ============================================================

def index_snapshot(root: Path, question: str) -> dict:
    db_path = root / INDEX_DB_PATH
    if not db_path.exists():
        return {"status": "missing", "db": str(db_path), "symbol_hits": []}
    tokens = [slugify(item) for item in question.split() if len(slugify(item)) >= 3][:8]
    try:
        connection = sqlite3.connect(db_path)
        meta = dict(connection.execute("SELECT key, value FROM meta").fetchall())
        symbol_hits = []
        for token in tokens:
            rows = connection.execute(
                "SELECT path, name, kind, line_start, line_end FROM symbols WHERE name_lc LIKE ? ORDER BY path, line_start LIMIT 12",
                (f"%{token.lower()}%",),
            ).fetchall()
            for path, name, kind, line_start, line_end in rows:
                symbol_hits.append(
                    {
                        "token": token,
                        "path": path,
                        "name": name,
                        "kind": kind,
                        "line_start": line_start,
                        "line_end": line_end,
                    }
                )
        connection.close()
        return {"status": "available", "db": str(db_path), "meta": meta, "symbol_hits": symbol_hits[:40]}
    except sqlite3.Error as exc:
        return {"status": "unavailable", "db": str(db_path), "error": str(exc), "symbol_hits": []}


# ============================================================
# TRACE PLANNING
# ============================================================

def node_search_text(node: dict) -> str:
    return " ".join(
        [
            node.get("id", ""),
            node.get("label", ""),
            node.get("kind", ""),
            node.get("file", ""),
            node.get("summary", {}).get("deterministic", ""),
            json.dumps(node.get("metadata", {}), sort_keys=True),
        ]
    ).lower()


def score_node(node: dict, question_tokens: list[str]) -> int:
    text = node_search_text(node)
    score = 0
    for token in question_tokens:
        if token and token in text:
            score += 4 if token in node.get("label", "").lower() else 1
    if node.get("kind") in {"component", "form", "api_client", "api_endpoint", "websocket_endpoint"}:
        score += 3
    if node.get("kind") in {"function", "method", "table", "pydantic_model", "schema"}:
        score += 1
    return score


def choose_start_node(graph: dict, start_node_id: str, question: str) -> dict:
    nodes = graph.get("nodes", [])
    by_id = {node["id"]: node for node in nodes}
    if start_node_id and start_node_id in by_id:
        return by_id[start_node_id]
    tokens = [slugify(item) for item in question.split() if len(slugify(item)) >= 3]
    ranked = sorted(nodes, key=lambda node: score_node(node, tokens), reverse=True)
    if ranked and score_node(ranked[0], tokens) > 0:
        return ranked[0]
    for kind in ["component", "form", "api_client", "api_endpoint", "function", "service"]:
        match = next((node for node in nodes if node.get("kind") == kind), None)
        if match:
            return match
    return nodes[0]


def adjacency(edges: list[dict]) -> dict[str, list[dict]]:
    graph = {}
    for edge in edges:
        graph.setdefault(edge["source"], []).append(edge)
        reverse = dict(edge)
        reverse["source"], reverse["target"] = edge["target"], edge["source"]
        reverse["direction"] = "reverse"
        graph.setdefault(edge["target"], []).append(reverse)
    for items in graph.values():
        items.sort(key=lambda edge: (FLOW_EDGE_PRIORITY.get(edge["kind"], 99), edge["target"]))
    return graph


def should_follow(edge: dict, target: dict) -> bool:
    if edge["kind"] in {"contains_file"}:
        return False
    if target.get("kind") in {"config_file", "style_rule", "media_query", "html_element"} and edge["kind"] not in {"uses_style", "renders"}:
        return False
    return True


def build_trace_edges(graph: dict, start_node: dict) -> list[dict]:
    nodes_by_id = {node["id"]: node for node in graph.get("nodes", [])}
    by_node = adjacency(graph.get("edges", []))
    visited = {start_node["id"]}
    queue = deque([(start_node["id"], [])])
    best_path = []
    while queue:
        node_id, path = queue.popleft()
        if len(path) > len(best_path):
            best_path = path
        if len(path) >= MAX_TRACE_STEPS:
            break
        for edge in by_node.get(node_id, []):
            target = nodes_by_id.get(edge["target"])
            if not target or target["id"] in visited or not should_follow(edge, target):
                continue
            visited.add(target["id"])
            next_path = path + [edge]
            queue.append((target["id"], next_path))
            if target.get("kind") in {"table", "view", "pydantic_model", "schema"} and len(next_path) >= 4:
                return next_path
    return best_path[:MAX_TRACE_STEPS]


def confidence_for_edge(edge: dict) -> str:
    status = edge.get("deterministic_status")
    if status == "complete":
        return "deterministic"
    if status == "partial":
        return "source_backed"
    if status == "inferred_from_usage":
        return "inferred_from_usage"
    return "needs_confirmation"


def make_steps(graph: dict, start_node: dict, trace_edges: list[dict]) -> list[dict]:
    nodes_by_id = {node["id"]: node for node in graph.get("nodes", [])}
    steps = [
        {
            "order": 1,
            "node_id": start_node["id"],
            "edge_id": None,
            "phase": "start",
            "direction": "forward",
            "title": f"Start at {start_node['label']}",
            "explanation": start_node.get("summary", {}).get("deterministic", ""),
            "packet_label": "start",
            "delay_ms": 700,
            "confidence": "deterministic",
            "evidence": start_node.get("evidence", []),
        }
    ]
    for index, edge in enumerate(trace_edges, start=2):
        target = nodes_by_id.get(edge["target"], {})
        phase = "response" if edge.get("direction") == "reverse" else "request"
        if edge["kind"] in {"uses_table"}:
            phase = "database"
        elif edge["kind"] in {"calls", "handled_by"}:
            phase = "processing"
        steps.append(
            {
                "order": index,
                "node_id": edge["target"],
                "edge_id": edge["id"],
                "phase": phase,
                "direction": edge.get("direction", "forward"),
                "title": f"{edge['kind']} -> {target.get('label', edge['target'])}",
                "explanation": edge.get("reason", {}).get("deterministic", ""),
                "packet_label": phase,
                "delay_ms": 850 if phase == "processing" else 650,
                "confidence": confidence_for_edge(edge),
                "evidence": edge.get("evidence", []) + target.get("evidence", [])[:2],
            }
        )
    if len(steps) > 1:
        return_order = len(steps) + 1
        steps.append(
            {
                "order": return_order,
                "node_id": start_node["id"],
                "edge_id": trace_edges[0]["id"] if trace_edges else None,
                "phase": "response",
                "direction": "reverse",
                "title": "Return to start",
                "explanation": "Trace loops back to the starting node for visual learning playback.",
                "packet_label": "response",
                "delay_ms": 900,
                "confidence": "source_backed",
                "evidence": [],
            }
        )
    return steps


def build_trace_plan(graph: dict, question: str, start_node_id: str, trace_id: str, root: Path) -> dict:
    start_node = choose_start_node(graph, start_node_id, question)
    trace_edges = build_trace_edges(graph, start_node)
    index_info = index_snapshot(root, question)
    confidence_rank = {"deterministic": 0, "source_backed": 1, "inferred_from_usage": 2, "needs_confirmation": 3}
    steps = make_steps(graph, start_node, trace_edges)
    confidence = max((step["confidence"] for step in steps), key=lambda value: confidence_rank.get(value, 99))
    resolved_trace_id = trace_id or slugify(question)[:64] or f"trace_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    return {
        "schema_version": "0.1.0",
        "trace_id": resolved_trace_id,
        "question": question,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "start_node_id": start_node["id"],
        "confidence": confidence,
        "mode": "ask_trace",
        "loop": True,
        "playback": {
            "loop_delay_ms": 1200,
            "default_step_delay_ms": 700,
        },
        "evidence_order": ["codebase_cartographer_graph", "codebase_index_n_search", "source_slice_if_needed", "codex_interpretation"],
        "index": index_info,
        "steps": steps,
        "alternatives": [],
    }


# ============================================================
# OUTPUT
# ============================================================

def update_trace_index(trace_root: Path, trace_plan: dict) -> None:
    index_path = trace_root / "trace_index.json"
    existing = {"traces": []}
    if index_path.exists():
        try:
            existing = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {"traces": []}
    traces = [item for item in existing.get("traces", []) if item.get("trace_id") != trace_plan["trace_id"]]
    traces.append(
        {
            "trace_id": trace_plan["trace_id"],
            "question": trace_plan["question"],
            "start_node_id": trace_plan["start_node_id"],
            "confidence": trace_plan["confidence"],
            "path": f"{trace_plan['trace_id']}.json",
            "generated_at": trace_plan["generated_at"],
        }
    )
    traces.sort(key=lambda item: item["generated_at"], reverse=True)
    write_json(index_path, {"traces": traces})


def copy_traces_for_visualiser(root: Path, trace_root: Path) -> None:
    visualiser_root = root / ".repo_executive_context" / "codebase_cartographer" / "visualiser" / "public" / "codebase_cartographer" / "traces"
    if not visualiser_root.parent.exists():
        visualiser_root = root / "visualiser" / "public" / "codebase_cartographer" / "traces"
    if not visualiser_root.parent.exists():
        return
    visualiser_root.mkdir(parents=True, exist_ok=True)
    for path in trace_root.glob("*.json"):
        shutil.copy2(path, visualiser_root / path.name)


def generate_trace(repo_root: str | Path = REPO_ROOT, question: str = QUESTION, start_node_id: str = START_NODE_ID, trace_id: str = TRACE_ID) -> dict:
    root = Path(repo_root).resolve()
    graph = read_json(root / GRAPH_PATH)
    trace_plan = build_trace_plan(graph, question, start_node_id, trace_id, root)
    trace_root = root / TRACE_ROOT
    trace_root.mkdir(parents=True, exist_ok=True)
    trace_path = trace_root / f"{trace_plan['trace_id']}.json"
    write_json(trace_path, trace_plan)
    update_trace_index(trace_root, trace_plan)
    copy_traces_for_visualiser(root, trace_root)
    return {"trace_path": str(trace_path), "trace_id": trace_plan["trace_id"], "steps": len(trace_plan["steps"])}


def main() -> dict:
    result = generate_trace(REPO_ROOT, QUESTION, START_NODE_ID, TRACE_ID)
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


if __name__ == "__main__":
    main()

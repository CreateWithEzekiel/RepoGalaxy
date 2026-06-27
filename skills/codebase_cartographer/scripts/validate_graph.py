from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from cartographer_common import STATUS_VALUES, write_json


# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
GRAPH_PATH = ".repo_executive_context/codebase_cartographer/graph.json"
REPORT_PATH = ".repo_executive_context/codebase_cartographer/graph_validation_report.md"


# ============================================================
# VALIDATION
# ============================================================

def validate_graph(graph: dict) -> dict:
    findings = []
    warnings = list(graph.get("validation", {}).get("warnings", []))
    node_ids = [node["id"] for node in graph.get("nodes", [])]
    edge_ids = [edge["id"] for edge in graph.get("edges", [])]
    duplicate_nodes = sorted(item for item, count in Counter(node_ids).items() if count > 1)
    duplicate_edges = sorted(item for item, count in Counter(edge_ids).items() if count > 1)
    if duplicate_nodes:
        findings.append({"severity": "error", "message": f"duplicate node ids: {duplicate_nodes}"})
    if duplicate_edges:
        findings.append({"severity": "error", "message": f"duplicate edge ids: {duplicate_edges}"})
    node_id_set = set(node_ids)
    for edge in graph.get("edges", []):
        if edge["source"] not in node_id_set:
            findings.append({"severity": "error", "message": f"edge has missing source: {edge['id']} -> {edge['source']}"})
        if edge["target"] not in node_id_set:
            findings.append({"severity": "error", "message": f"edge has missing target: {edge['id']} -> {edge['target']}"})
    for node in graph.get("nodes", []):
        if node.get("deterministic_status") not in STATUS_VALUES:
            findings.append({"severity": "error", "message": f"node has invalid status: {node['id']}"})
        if not node.get("evidence"):
            warnings.append(f"node has no evidence: {node['id']}")
        for contract_name in ["request", "response"]:
            contract = node.get("contracts", {}).get(contract_name, {})
            if contract.get("status") not in STATUS_VALUES:
                findings.append({"severity": "error", "message": f"node has invalid {contract_name} contract status: {node['id']}"})
    for edge in graph.get("edges", []):
        if edge.get("deterministic_status") not in STATUS_VALUES:
            findings.append({"severity": "error", "message": f"edge has invalid status: {edge['id']}"})
        if not edge.get("evidence"):
            warnings.append(f"edge has no evidence: {edge['id']}")
    contains_targets = {edge["target"] for edge in graph.get("edges", []) if edge.get("kind") == "contains"}
    declared_api_targets = {edge["target"] for edge in graph.get("edges", []) if edge.get("kind") == "declares_api"}
    handled_api_sources = {edge["source"] for edge in graph.get("edges", []) if edge.get("kind") == "handled_by"}
    for node in graph.get("nodes", []):
        if node.get("kind") in {"api_endpoint", "websocket_endpoint"} and node["id"] not in contains_targets:
            warnings.append(f"api endpoint has no deterministic parent contains edge: {node['id']}")
        if node.get("kind") in {"api_endpoint", "websocket_endpoint"} and node["id"] not in declared_api_targets:
            warnings.append(f"api endpoint has no deterministic file declaration edge: {node['id']}")
        if node.get("kind") in {"api_endpoint", "websocket_endpoint"} and node["id"] not in handled_api_sources:
            warnings.append(f"api endpoint has no deterministic handler edge: {node['id']}")
        if not isinstance(node.get("details", {}), dict):
            findings.append({"severity": "error", "message": f"node has invalid details payload: {node['id']}"})
        summary_points = node.get("summary", {}).get("agentic_points") if isinstance(node.get("summary", {}), dict) else None
        if summary_points is not None:
            if not isinstance(summary_points, list) or any(not isinstance(point, str) for point in summary_points):
                findings.append({"severity": "error", "message": f"node has invalid agentic points: {node['id']}"})
            elif len(summary_points) > 10:
                warnings.append(f"node has many agentic points: {node['id']}")
        code_excerpt = node.get("details", {}).get("code_excerpt") if isinstance(node.get("details", {}), dict) else None
        if code_excerpt is not None:
            if not isinstance(code_excerpt, dict) or not isinstance(code_excerpt.get("text"), str):
                findings.append({"severity": "error", "message": f"node has invalid code excerpt: {node['id']}"})
            elif len(code_excerpt.get("text", "")) > 2200:
                warnings.append(f"node code excerpt is unusually long: {node['id']}")
    status = "failed" if any(item["severity"] == "error" for item in findings) else "complete"
    contract_counts = Counter()
    for node in graph.get("nodes", []):
        contracts = node.get("contracts", {})
        for contract_name in ["request", "response"]:
            status_key = contracts.get(contract_name, {}).get("status", "unknown")
            contract_counts[f"{contract_name}:{status_key}"] += 1
    return {
        "status": status,
        "findings": findings,
        "warnings": sorted(set(warnings)),
        "counts": {
            "nodes": len(graph.get("nodes", [])),
            "edges": len(graph.get("edges", [])),
            "node_kinds": dict(sorted(Counter(node["kind"] for node in graph.get("nodes", [])).items())),
            "edge_kinds": dict(sorted(Counter(edge["kind"] for edge in graph.get("edges", [])).items())),
            "contract_statuses": dict(sorted(contract_counts.items())),
        },
    }


def report_markdown(graph: dict, validation: dict) -> str:
    lines = [
        "# Graph Validation Report",
        "",
        f"- Status: `{validation['status']}`",
        f"- Nodes: `{validation['counts']['nodes']}`",
        f"- Edges: `{validation['counts']['edges']}`",
        "",
        "## Deterministic Summary",
        graph.get("summary", {}).get("deterministic", "No deterministic summary."),
        "",
        "## Node Kinds",
    ]
    for kind, count in validation["counts"]["node_kinds"].items():
        lines.append(f"- `{kind}`: {count}")
    lines.extend(["", "## Edge Kinds"])
    for kind, count in validation["counts"]["edge_kinds"].items():
        lines.append(f"- `{kind}`: {count}")
    lines.extend(["", "## Contract Statuses"])
    for status, count in validation["counts"]["contract_statuses"].items():
        lines.append(f"- `{status}`: {count}")
    lines.extend(["", "## Findings"])
    if validation["findings"]:
        for finding in validation["findings"]:
            lines.append(f"- `{finding['severity']}`: {finding['message']}")
    else:
        lines.append("- No validation errors found.")
    lines.extend(["", "## Warnings"])
    if validation["warnings"]:
        for warning in validation["warnings"][:200]:
            lines.append(f"- {warning}")
        if len(validation["warnings"]) > 200:
            lines.append(f"- ... {len(validation['warnings']) - 200} more warnings omitted")
    else:
        lines.append("- No warnings.")
    lines.extend(
        [
            "",
            "## Determinism Notes",
            "- Node IDs, edge IDs, line references, imports, calls, API paths, schemas, CSS selectors, and canvas layout are generated by scripts.",
            "- Agentic summaries are not used as graph truth.",
            "- Missing contracts remain `unknown`, `partial`, `not_declared`, or `inferred_from_usage`.",
            "",
        ]
    )
    return "\n".join(lines)


def validate_and_write(repo_root: str | Path = REPO_ROOT, graph_path: str | Path = GRAPH_PATH, report_path: str | Path = REPORT_PATH) -> dict:
    root = Path(repo_root).resolve()
    graph_file = root / graph_path
    graph = json.loads(graph_file.read_text(encoding="utf-8"))
    validation = validate_graph(graph)
    graph["validation"] = validation
    write_json(graph_file, graph)
    report_file = root / report_path
    report_file.parent.mkdir(parents=True, exist_ok=True)
    report_file.write_text(report_markdown(graph, validation), encoding="utf-8")
    return validation


def main() -> dict:
    validation = validate_and_write(REPO_ROOT, GRAPH_PATH, REPORT_PATH)
    print(f"validation status: {validation['status']}")
    print(f"nodes: {validation['counts']['nodes']}")
    print(f"edges: {validation['counts']['edges']}")
    return validation


if __name__ == "__main__":
    main()

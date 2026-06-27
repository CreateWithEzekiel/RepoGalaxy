from __future__ import annotations

import hashlib
import re
from pathlib import Path

# ============================================================
# CONFIG
# ============================================================

REPO_ROOT = str(Path.cwd())
GRAPH_PATH = ".repo_executive_context/codebase_cartographer/graph.json"
NOTES_ROOT = ".repo_executive_context/codebase_cartographer/obsidian_vault/nodes"


# ============================================================
# MARKDOWN
# ============================================================

def safe_note_name(node_id: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "__", node_id).strip("_") or "node"
    if len(stem) > 96:
        digest = hashlib.sha1(node_id.encode("utf-8")).hexdigest()[:12]
        stem = stem[:80].rstrip("_") + "__" + digest
    return stem + ".md"


def yaml_value(value: object) -> str:
    text = "" if value is None else str(value)
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def contract_markdown(contract: dict) -> str:
    lines = [
        f"- Status: `{contract.get('status', 'unknown')}`",
        f"- Source: `{contract.get('source', 'none')}`",
    ]
    shape = contract.get("shape") or {}
    if shape:
        lines.append("- Shape:")
        lines.append("```json")
        import json

        lines.append(json.dumps(shape, indent=2, sort_keys=True))
        lines.append("```")
    return "\n".join(lines)


def evidence_markdown(evidence: list[dict]) -> str:
    if not evidence:
        return "- No evidence recorded."
    lines = []
    for item in evidence:
        location = item.get("file", "unknown")
        if item.get("line_start"):
            location += f":{item.get('line_start')}"
        lines.append(f"- `{item.get('kind', 'evidence')}` at `{location}`: {item.get('detail', '')}")
    return "\n".join(lines)


def node_markdown(node: dict) -> str:
    contracts = node.get("contracts", {})
    request_contract = contracts.get("request", {})
    response_contract = contracts.get("response", {})
    lines = [
        "---",
        f"node_id: {yaml_value(node['id'])}",
        f"kind: {yaml_value(node['kind'])}",
        f"source: {yaml_value(node['file'])}",
        f"line_start: {node.get('line_start') or ''}",
        f"line_end: {node.get('line_end') or ''}",
        f"deterministic_status: {yaml_value(node.get('deterministic_status'))}",
        "---",
        "",
        f"# {node['label']}",
        "",
        "## Deterministic Facts",
        f"- Kind: `{node['kind']}`",
        f"- Language: `{node['language']}`",
        f"- Source: `{node['file']}`",
        f"- Lines: `{node.get('line_start')}` to `{node.get('line_end')}`",
        f"- Status: `{node.get('deterministic_status')}`",
        "",
        "## Contracts",
        "### Request",
        contract_markdown(request_contract),
        "",
        "### Response",
        contract_markdown(response_contract),
        "",
        "## Codex Summary",
        node.get("summary", {}).get("agentic") or "Not enriched. Deterministic graph generation does not invent summaries.",
        "",
        "## Deterministic Summary",
        node.get("summary", {}).get("deterministic") or "No deterministic summary available.",
        "",
        "## Evidence",
        evidence_markdown(node.get("evidence", [])),
        "",
    ]
    return "\n".join(lines)


def write_node_notes(graph: dict, repo_root: str | Path = REPO_ROOT, notes_root: str | Path = NOTES_ROOT) -> dict[str, str]:
    root = Path(repo_root).resolve()
    output = root / notes_root
    output.mkdir(parents=True, exist_ok=True)
    note_paths = {}
    for node in graph["nodes"]:
        note_path = output / safe_note_name(node["id"])
        note_path.write_text(node_markdown(node), encoding="utf-8")
        note_paths[node["id"]] = note_path.name
    return note_paths


def main() -> dict[str, str]:
    import json

    root = Path(REPO_ROOT).resolve()
    graph = json.loads((root / GRAPH_PATH).read_text(encoding="utf-8"))
    note_paths = write_node_notes(graph, root, NOTES_ROOT)
    print(f"node notes: {len(note_paths)}")
    return note_paths


if __name__ == "__main__":
    main()

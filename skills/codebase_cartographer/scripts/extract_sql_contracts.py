from __future__ import annotations

import json
import re
from pathlib import Path

from cartographer_common import (
    add_unique_edge,
    add_unique_node,
    empty_contracts,
    make_edge,
    make_evidence,
    make_node,
    stable_id,
)


# ============================================================
# REGEXES
# ============================================================

CREATE_TABLE_RE = re.compile(r"\bCREATE\s+(?:TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$.]*)\s*\((.*?)\)\s*;", re.IGNORECASE | re.DOTALL)
CREATE_VIEW_RE = re.compile(r"\bCREATE\s+(MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$.]*)", re.IGNORECASE)
CREATE_INDEX_RE = re.compile(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$.]*)\s+ON\s+([A-Za-z_][\w$.]*)", re.IGNORECASE)
CREATE_TRIGGER_RE = re.compile(r"\bCREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$.]*)", re.IGNORECASE)
CREATE_FUNCTION_RE = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][\w$.]*)", re.IGNORECASE)
CREATE_PROCEDURE_RE = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+([A-Za-z_][\w$.]*)", re.IGNORECASE)
CONSTRAINT_RE = re.compile(r"\bCONSTRAINT\s+([A-Za-z_][\w$]*)|\b(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b", re.IGNORECASE)
TABLE_USAGE_RE = re.compile(r"\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([A-Za-z_][\w$.]*)", re.IGNORECASE)
SQLALCHEMY_TABLE_RE = re.compile(r"class\s+([A-Za-z_][\w]*)[^\n]*:\s*(?:(?!\nclass\s).)*?__tablename__\s*=\s*['\"]([^'\"]+)['\"]", re.DOTALL)


# ============================================================
# HELPERS
# ============================================================

def line_number_at(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def split_sql_name(name: str) -> tuple[str | None, str]:
    parts = name.strip('"`[]').split(".")
    if len(parts) >= 2:
        return parts[-2].strip('"`[]'), parts[-1].strip('"`[]')
    return None, parts[-1].strip('"`[]')


def parse_columns(body: str) -> dict:
    columns = {}
    constraints = []
    for raw_line in body.splitlines():
        line = raw_line.strip().rstrip(",")
        if not line or line.startswith("--"):
            continue
        if CONSTRAINT_RE.search(line) and line.upper().startswith(("CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK")):
            constraints.append(line)
            continue
        parts = line.split()
        if len(parts) >= 2:
            name = parts[0].strip('"`[]')
            if name.upper() not in {"PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"}:
                columns[name] = {
                    "type": parts[1],
                    "nullable": "NOT NULL" not in line.upper(),
                    "raw": line,
                }
    return {"columns": columns, "constraints": constraints}


def read_config_summary(text: str, language: str) -> dict:
    if language == "json":
        try:
            payload = json.loads(text)
        except Exception:
            return {"parse_status": "failed"}
        if isinstance(payload, dict):
            return {"parse_status": "complete", "top_level_keys": sorted(payload.keys())[:40]}
        return {"parse_status": "complete", "shape": type(payload).__name__}
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
    keys = []
    for line in lines[:80]:
        if ":" in line:
            keys.append(line.split(":", 1)[0].strip())
        elif "=" in line:
            keys.append(line.split("=", 1)[0].strip())
    return {"parse_status": "partial", "top_level_keys": sorted(set(keys))[:40], "line_count": len(text.splitlines())}


def table_node_id(schema: str | None, table: str) -> str:
    return stable_id("table", schema or "default", table)


# ============================================================
# NODE EXTRACTION
# ============================================================

def extract_sql_file_nodes(record: dict, nodes: dict[str, dict], warnings: list[str]) -> None:
    rel_path = record["rel_path"]
    text = record["text"]
    file_id = stable_id("file", rel_path)
    if record["language"] == "sql":
        migration_id = stable_id("migration", rel_path)
        add_unique_node(
            nodes,
            make_node(
                migration_id,
                "migration",
                Path(rel_path).name,
                "sql",
                rel_path,
                1,
                record["line_count"] or None,
                "complete",
                f"SQL migration or script `{rel_path}`.",
                [make_evidence("sql_file", rel_path, 1, record["line_count"] or None, "sql file")],
                empty_contracts(),
                ["sql", "migration"],
                {"parent_id": file_id},
                {"sql": {"statement_count": text.count(";")}},
            ),
            warnings,
        )
    for match in CREATE_TABLE_RE.finditer(text):
        schema, table = split_sql_name(match.group(1))
        parsed = parse_columns(match.group(2))
        line_start = line_number_at(text, match.start())
        line_end = line_number_at(text, match.end())
        node_id = table_node_id(schema, table)
        add_unique_node(
            nodes,
            make_node(
                node_id,
                "table",
                table,
                "sql",
                rel_path,
                line_start,
                line_end,
                "complete",
                f"SQL table `{table}` declared in `{rel_path}`.",
                [make_evidence("sql_create_table", rel_path, line_start, line_end, f"table {table}")],
                empty_contracts(),
                ["sql", "table"],
                {"schema": schema, "table": table, "parent_id": stable_id("migration", rel_path) if record["language"] == "sql" else file_id},
                {"sql": {"schema": schema, "table": table, **parsed}},
            ),
            warnings,
        )
        for constraint in parsed["constraints"]:
            constraint_id = stable_id("constraint", schema or "default", table, constraint[:48])
            add_unique_node(
                nodes,
                make_node(
                    constraint_id,
                    "constraint",
                    constraint[:72],
                    "sql",
                    rel_path,
                    line_start,
                    line_end,
                    "partial",
                    f"SQL constraint on `{table}`.",
                    [make_evidence("sql_constraint", rel_path, line_start, line_end, constraint[:96])],
                    empty_contracts(),
                    ["sql", "constraint"],
                    {"schema": schema, "table": table, "parent_id": node_id},
                    {"sql": {"table": table, "constraint": constraint}},
                ),
                warnings,
            )
    for match in CREATE_VIEW_RE.finditer(text):
        schema, name = split_sql_name(match.group(2))
        kind = "materialized_view" if match.group(1) else "view"
        line = line_number_at(text, match.start())
        add_unique_node(
            nodes,
            make_node(
                stable_id(kind, schema or "default", name),
                kind,
                name,
                "sql",
                rel_path,
                line,
                line,
                "complete",
                f"SQL {kind.replace('_', ' ')} `{name}` declared in `{rel_path}`.",
                [make_evidence("sql_create_view", rel_path, line, line, f"view {name}")],
                empty_contracts(),
                ["sql", kind],
                {"schema": schema, "view": name, "parent_id": stable_id("migration", rel_path) if record["language"] == "sql" else file_id},
                {"sql": {"schema": schema, "view": name}},
            ),
            warnings,
        )
    for regex, kind, detail in [
        (CREATE_INDEX_RE, "index", "index"),
        (CREATE_TRIGGER_RE, "trigger", "trigger"),
        (CREATE_FUNCTION_RE, "sql_function", "function"),
        (CREATE_PROCEDURE_RE, "stored_procedure", "procedure"),
    ]:
        for match in regex.finditer(text):
            name = match.group(1)
            line = line_number_at(text, match.start())
            add_unique_node(
                nodes,
                make_node(
                    stable_id(kind, rel_path, name),
                    kind,
                    name,
                    "sql",
                    rel_path,
                    line,
                    line,
                    "complete",
                    f"SQL {detail} `{name}` declared in `{rel_path}`.",
                    [make_evidence(f"sql_create_{detail}", rel_path, line, line, f"{detail} {name}")],
                    empty_contracts(),
                    ["sql", kind],
                    {"parent_id": stable_id("migration", rel_path) if record["language"] == "sql" else file_id},
                    {"sql": {"name": name, "kind": kind}},
                ),
                warnings,
            )


def extract_sqlalchemy_table_nodes(record: dict, nodes: dict[str, dict], warnings: list[str]) -> None:
    if record["language"] != "python":
        return
    rel_path = record["rel_path"]
    for match in SQLALCHEMY_TABLE_RE.finditer(record["text"]):
        class_name = match.group(1)
        table = match.group(2)
        line = line_number_at(record["text"], match.start())
        node_id = table_node_id(None, table)
        add_unique_node(
            nodes,
            make_node(
                node_id,
                "table",
                table,
                "python",
                rel_path,
                line,
                line,
                "partial",
                f"SQLAlchemy table `{table}` mapped by `{class_name}`.",
                [make_evidence("sqlalchemy_tablename", rel_path, line, line, f"__tablename__ {table}")],
                empty_contracts(),
                ["sql", "table", "orm"],
                {"table": table, "model": class_name, "parent_id": stable_id("file", rel_path)},
                {"sql": {"table": table, "model": class_name, "source": "sqlalchemy"}},
            ),
            warnings,
        )


def extract_config_nodes(record: dict, nodes: dict[str, dict], warnings: list[str]) -> None:
    if record["language"] not in {"json", "yaml", "toml", "dockerfile", "env", "markdown"}:
        return
    rel_path = record["rel_path"]
    name = Path(rel_path).name
    is_config = record["language"] != "markdown" or name.lower() in {"readme.md"} or "how_it_runs" in name.lower()
    if not is_config:
        return
    summary = read_config_summary(record["text"], record["language"])
    node_id = stable_id("config_file", rel_path)
    add_unique_node(
        nodes,
        make_node(
            node_id,
            "config_file",
            name,
            record["language"],
            rel_path,
            1,
            record["line_count"] or None,
            summary.get("parse_status", "partial"),
            f"{record['language']} project artifact `{rel_path}`.",
            [make_evidence("config_file", rel_path, 1, record["line_count"] or None, "supporting project artifact")],
            empty_contracts(),
            ["config", record["language"]],
            {"parent_id": stable_id("file", rel_path), "config_summary": summary},
            {"config": summary},
        ),
        warnings,
    )


# ============================================================
# EDGE EXTRACTION
# ============================================================

def add_table_usage_edges(records: list[dict], nodes: dict[str, dict], edges: dict[str, dict]) -> None:
    table_by_name = {}
    for node in nodes.values():
        if node["kind"] == "table":
            table_by_name[node["label"].lower()] = node
    if not table_by_name:
        return
    owner_nodes = [
        node
        for node in nodes.values()
        if node["kind"] in {"function", "method", "constructor", "api_endpoint", "api_client", "background_task", "cli_command"}
    ]
    for record in records:
        text = record["text"]
        rel_path = record["rel_path"]
        file_owners = [node for node in owner_nodes if node["file"] == rel_path]
        for match in TABLE_USAGE_RE.finditer(text):
            _, table = split_sql_name(match.group(1))
            table_node = table_by_name.get(table.lower())
            if not table_node:
                continue
            line = line_number_at(text, match.start())
            owner = None
            for node in file_owners:
                if node["line_start"] and node["line_end"] and node["line_start"] <= line <= node["line_end"]:
                    owner = node
                    break
            if not owner:
                owner = next((node for node in file_owners if node["kind"] == "api_endpoint"), None)
            if not owner:
                continue
            add_unique_edge(
                edges,
                make_edge(
                    owner["id"],
                    table_node["id"],
                    "uses_table",
                    f"`{owner['label']}` references database table `{table_node['label']}`",
                    [make_evidence("sql_table_usage", rel_path, line, line, f"table usage {table}")],
                    "partial",
                ),
            )


def extract_sql_graph(records: list[dict]) -> dict:
    nodes = {}
    edges = {}
    warnings = []
    for record in records:
        extract_sql_file_nodes(record, nodes, warnings)
        extract_sqlalchemy_table_nodes(record, nodes, warnings)
        extract_config_nodes(record, nodes, warnings)
    return {
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "warnings": warnings,
    }


def add_sql_usage_edges(records: list[dict], nodes: dict[str, dict], edges: dict[str, dict]) -> None:
    add_table_usage_edges(records, nodes, edges)

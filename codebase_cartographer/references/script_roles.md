# Script Roles

Load this reference when choosing which bundled script to run or patch.

- `scan_repo.py`: find supported source files and skip generated/sensitive folders.
- `skill_run_check.py`: read the repo-local `setup_check.json` sentinel and report whether first-run setup is required before indexing.
- `project_scan.py`: read top-level project folders and simple folder evidence for the first-run question flow.
- `workspace_config.py`: detect repo/workspace shape and create the editable cartographer config.
- `extract_python_api_contracts.py`: parse Python AST, FastAPI routes, Pydantic/dataclass/TypedDict schemas, functions, classes, imports, and calls.
- `extract_typescript_contracts.py`: parse TypeScript/TSX/CSS structure, React components, hooks, types/interfaces, CSS selectors, imports, simple API clients, and visible calls.
- `extract_sql_contracts.py`: parse SQL files for tables, views, indexes, and database relationships where supported.
- `build_graph.py`: merge extractor output into canonical `graph.json` and `graph.sqlite`.
- `generate_ask_trace.py`: generate Ask & Trace trace JSON from the canonical graph for Human repo-understanding questions.
- `generate_obsidian_notes.py`: write file-backed markdown notes for graph nodes.
- `generate_json_canvas.py`: write stable JSON Canvas perspective files.
- `materialise_visualiser.py`: copy the bundled visualiser snapshot literally into `.repo_executive_context/codebase_cartographer/visualiser/` and verify bundled file hashes.
- `verify_visualiser_snapshot.py`: verify the materialised visualiser still matches the bundled manifest.
- `semantic_node_summaries.py`: add deterministic code excerpts and fingerprint-checked semantic summaries for graph nodes.
- `validate_graph.py`: validate IDs, edges, counts, evidence, and contract statuses.
- `run_cartographer.py`: orchestrate the full deterministic run.

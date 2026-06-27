---
name: Codebase Cartographer
description: Generate deterministic codebase graph artifacts and materialise a bundled local browser visualiser for Python, FastAPI, React, TypeScript, TSX, and CSS repositories. Use when Codex needs to map functions, components, API routes, schemas, styles, imports, calls, request/response contracts, evidence-backed service links, Obsidian notes, JSON Canvas files, Ask & Trace flows, or a localhost node graph without inventing source relationships.
---

# Codebase Cartographer

## Core Rule

Treat bundled scripts as the source of truth for graph topology, node identity, source references, API contracts, and validation status. Codex may add summaries only in clearly separated `agentic_*` fields or separate enrichment files.

Do not invent:
- nodes
- edges
- payload shapes
- response shapes
- route methods or paths
- schema references
- source line evidence

When source truth is missing, write `unknown`, `partial`, `not_declared`, or `inferred_from_usage`.

## Bare Invocation Or Unclear Prompt

If Human invokes only `$Codebase Cartographer`, mentions this skill without a clear task, or gives an unclear prompt that does not explicitly ask to run, index, open, refresh, explain, or trace something, do not run scripts and do not start first-run setup. Reply with:

```text
Codebase Cartographer turns your repository into a spatial code map.

It scans your repo, builds a graph, and opens a local visualiser where you can inspect services, files, APIs, components, functions, schemas, config, styles, and database objects. Use it to reveal hidden dependencies, service boundaries, and architecture risks that are hard to see in a file tree.

| Use it to | What happens |
|---|---|
| Map a repo | Builds a graph and local visualiser |
| Understand structure | Shows services, files, and code relationships |
| Review architecture | Highlights service links and API flow |
| Explore visually | Opens a browser-based spatial map |

You can ask me to:

| Prompt | Result |
|---|---|
| Run it on this repo | Start setup and indexing |
| Open the visualiser | Launch the map |
| Refresh the graph | Re-index after code changes |
| Explain a node | Inspect one part of the codebase |
| Ask & Trace a workflow | Generate a trace path through the map |

I can guide you through the process, just let me know!
```

## First-Run Setup Gate

Before indexing, materialising the visualiser, or running graph generation for a target repository, run the setup check from the target repository root:

```powershell
python <skill-root>\scripts\skill_run_check.py
```

If the result has `setup_required: false`, continue directly to the run workflow. Do not ask the architecture question and do not run `project_scan.py`.

If the result has `setup_required: true`, load `references/workflows/first_run_setup.md` and complete that gate before any indexing or graph generation.

## Run And Refresh Workflow

For run, refresh, open visualiser, or rebuild requests, load `references/workflows/run_workflow.md`. Use its open-visualiser fast path when Human only asks to open the visualiser.

Always materialise the bundled visualiser with `scripts/materialise_visualiser.py`; do not recreate, rewrite, scaffold, simplify, or infer visualiser code. Then run `scripts/workspace_config.py` as needed and `scripts/run_cartographer.py` for deterministic graph generation.

After the first canonical graph exists, create or refresh semantic summaries with `scripts/semantic_node_summaries.py`.

Initial setup is not complete until semantic summaries have been created for the canonical graph, or the failure is reported clearly to Human.

## Ask & Trace Trigger

When Human asks a repo-understanding question after this skill is already active for the target repo, or while the local visualiser/localhost browser for that repo is open, treat the question as both a chat answer request and an Ask & Trace request.

Answer Human in chat, generate a trace JSON with `scripts/generate_ask_trace.py` from the canonical graph using the best matching start node, let the script copy the trace into the visualiser, and tell Human to click `Ask & Trace` near the top-left mode controls. The visualiser polls for new traces; if the in-app browser does not update after a few seconds, ask Human whether to let Codex refresh/open the viewer with Browser Use. Load `references/visualiser/runtime_expectations.md` for details.

## Semantic Enrichment

Semantic summaries are required local explanations after initial graph generation. They must never become graph truth.

Load `references/workflows/semantic_enrichment.md` when creating node summaries, refreshing summaries from `agentic_delta_queue.json`, or adding evidence-backed service-to-service links.

## Workspace Shape Controls

Load `references/config/workspace_shape_controls.md` before editing `.repo_executive_context/codebase_cartographer/cartographer_config.json`, confirming service roots, locking first-run service roots, or declaring service links.

When choosing which bundled script to run or patch, load `references/script_roles.md`.

## Validation Boundary

Do not use Browser Use or the in-app browser as the default validation method for this skill or a copied visualiser. When the visualiser is copied literally from bundled assets, validate with `scripts/materialise_visualiser.py`, `scripts/verify_visualiser_snapshot.py`, manifest/hash checks, and generated file existence.

Use browser validation only when Human explicitly asks for UI inspection, when Codex directly edits visualiser source, or when debugging a reported visualiser runtime issue. Agentic features that Codex directly edits must have explicit workflow instructions and targeted validation; copied visualiser files do not need browser-use checks by default.

## References

Load only the reference needed for the task:

- `references/workflows/first_run_setup.md`: first-run architecture questions and confirmed config writing.
- `references/workflows/run_workflow.md`: run, refresh, materialise, output tree, Codebase Index N Search collaboration, and dev-server workflow.
- `references/workflows/semantic_enrichment.md`: semantic node summaries and evidence-backed service link enrichment.
- `references/config/workspace_shape_controls.md`: `cartographer_config.json`, `service_roots_locked`, service roots, and service links.
- `references/visualiser/runtime_expectations.md`: visualiser materialisation, Ask & Trace trace generation, and runtime expectations.
- `references/script_roles.md`: bundled script purpose map.
- `references/graph_schema.md`: canonical graph fields.
- `references/deterministic_contract_rules.md`: status vocabulary and allowed evidence.
- `references/obsidian_canvas_rules.md`: JSON Canvas output rules.

## Safety

Keep generated artifacts local. Graph data can expose private architecture through file paths, symbol names, routes, and contracts. Do not transmit or publish generated outputs without Human review.

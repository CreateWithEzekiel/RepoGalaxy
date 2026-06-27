# Visualiser Runtime Expectations

Load this reference when materialising, verifying, launching, or using the local browser visualiser, including Ask & Trace mode.

## Ask & Trace Trigger

When Human asks a repo-understanding question after this skill is already active for the target repo, or while the local visualiser/localhost browser for that repo is open, treat the question as both a chat answer request and an Ask & Trace request.

Answer Human in chat, generate a trace JSON with `scripts/generate_ask_trace.py` from the canonical graph using the best matching start node, let the script copy the trace into the visualiser, and tell Human to click `Ask & Trace` near the top-left mode controls. The visualiser polls `trace_index.json` and should pick up the newest trace automatically; if the in-app browser still shows an old trace after a few seconds, ask Human whether to let Codex refresh/open the viewer with Browser Use.

If the canonical graph does not exist yet, say the graph must be generated first and follow the normal setup/indexing workflow. If no confident start node can be selected, ask one focused question or use the nearest service/file node and state the assumption.

`generate_ask_trace.py` uses in-code defaults. Do not run the file directly unless those defaults are intended. For a Human question, import the module and call `generate_trace(...)` with the actual question:

```powershell
python -c "import json, sys; sys.path.insert(0, r'<skill-root>\scripts'); import generate_ask_trace as t; print(json.dumps(t.generate_trace(repo_root=r'<repo-root>', question=r'<Human question>', start_node_id=r'<best node id or blank>'), indent=2))"
```

Use `start_node_id` when a confident graph node is known. Leave it blank only when the script should choose the nearest matching node.

## Trace-Only Custom Links

Some real workspace flows cross service boundaries that are not directly visible in source code, such as a frontend calling an orchestrator health endpoint that fans out to multiple backend health endpoints through cloud/runtime wiring. Do not force these into the permanent graph unless Human confirms the topology.

For a question-specific Ask & Trace answer:
- first generate the best graph-backed trace
- inspect the relevant source/config slices and explain the missing runtime handoff in chat
- add trace-only `custom_edges` to the generated trace JSON when the visual explanation needs a visible cross-service line
- add matching `steps` whose `edge_id` references those custom edge IDs
- set custom edge `kind` to a precise value such as `trace_inferred_handoff`, `runtime_fanout`, or `calls_service`
- set confidence to `inferred_from_usage` or `needs_confirmation` unless the runtime/config evidence is direct
- keep evidence records concise and honest

Example trace-only edge:

```json
{
  "id": "trace_custom:frontend:orchestrator_health",
  "source": "service:frontend",
  "target": "api:orchestrator:GET /health",
  "kind": "trace_inferred_handoff",
  "reason": "Question-specific trace: frontend health checks are interpreted as reaching the orchestrator health endpoint before downstream fanout.",
  "confidence": "inferred_from_usage",
  "evidence": []
}
```

If Human wants this relationship to persist across future maps, confirm it explicitly and write it as a `service_links` entry in `.repo_executive_context/codebase_cartographer/cartographer_config.json`, then re-run `scripts/run_cartographer.py`.

## Visualiser Source

The visualiser source of truth is the bundled `assets/visualiser/` tree plus `assets/visualiser_manifest.json`.

Rules:
- Copy the visualiser with `scripts/materialise_visualiser.py`; do not manually recreate it.
- Keep bundled visualiser source files byte-identical during materialisation.
- Do not bundle or copy `node_modules`, `dist`, generated `graph.json`, generated trace JSON, logs, or caches as visualiser source.
- Let graph and trace generators populate `public/codebase_cartographer/` inside the materialised visualiser.
- Run the browser app from `.repo_executive_context/codebase_cartographer/visualiser/`.

## Validation Boundary

Do not use Browser Use or the in-app browser as the default validation method for copied visualiser files. If the visualiser was materialised literally from the bundled assets, validate by running `scripts/materialise_visualiser.py` or `scripts/verify_visualiser_snapshot.py`, checking manifest/hash results, and confirming generated graph/trace files exist in the expected public folder.

Use browser validation only when Human explicitly asks to inspect the UI, when Codex directly edits visualiser source, or when debugging a reported visualiser runtime issue. For agentic features Codex edits directly, validate the edited workflow or generated artifact explicitly; do not treat a browser smoke check as the main proof that the skill works.

The local browser visualiser should:
- use a black background and bright color-coded node kinds
- support start-node selection and type filters
- bring the selected node into the foreground
- render connected layers smaller and dimmer toward the background
- support one-step back and return-to-start navigation
- show node details, source evidence, deterministic contracts, and connection reasons in a modal
- show agentic summaries only when separate enrichment data exists

# Run Workflow

Load this reference when Human asks to run, refresh, open, or rebuild Codebase Cartographer for a target repository.

## Contents

- Open visualiser fast path
- Quick start and deterministic run
- Default output tree
- Optional Codebase Index N Search collaboration
- Workflow checklist
- Validation boundary

## Open Visualiser Fast Path

When Human only asks to open the visualiser, first check whether the copied visualiser and graph already exist:

```text
.repo_executive_context/codebase_cartographer/visualiser/package.json
.repo_executive_context/codebase_cartographer/visualiser/public/codebase_cartographer/graph.json
```

If both exist, do not rebuild the graph, do not re-run first-run setup, and do not re-index. From `.repo_executive_context/codebase_cartographer/visualiser/`, run `npm install` only if dependencies are missing, then run `npm run dev` and give Human the local URL. If Browser Use is available and Human asked to open the visualiser, navigate the in-app browser to the local URL. If Human did not ask, offer to open it instead of silently taking over the browser.

If either file is missing, continue with Quick Start.

## Quick Start

On initial skill activation for a target repository, satisfy the First-Run Setup Gate first. If `scripts/skill_run_check.py` reports `setup_required: false`, continue here without asking first-run questions.

After setup is confirmed or skipped, check whether the supporting `Codebase Index N Search` skill is available in the current session.

If it is available:
- If `.repo_executive_context/codebase_index_n_search/` is missing in the target repository, run that skill's `scripts/build_index.py` against the target repo before broad exploration.
- If `.repo_executive_context/codebase_index_n_search/` exists, run `status` or `stale`; refresh or rebuild the index before relying on it when it is stale, invalid, or reports changed skip rules.

If `Codebase Index N Search` is not available, continue with the deterministic cartographer scanner and note that compact indexed source lookup is unavailable.

From the target repository root, resolve this skill's folder as `<skill-root>`, then materialise the bundled visualiser into the repo-local cartographer output folder:

```powershell
python <skill-root>\scripts\materialise_visualiser.py
```

The visualiser must be copied literally from the bundled `assets/visualiser/` snapshot. Do not recreate, rewrite, scaffold, simplify, or infer the visualiser code. Use the materialisation script to copy the asset tree and verify it against `assets/visualiser_manifest.json`.

Then let the skill detect workspace structure and create the editable config:

```powershell
python <skill-root>\scripts\workspace_config.py
```

Codex should inspect `.repo_executive_context/codebase_cartographer/workspace_profile.json`, then edit `.repo_executive_context/codebase_cartographer/cartographer_config.json` when the repo shape needs explicit control. Use this config to declare whether the target is a single repo, a workspace containing multiple sub-repos/services, which roots should become service suns, and any known service-to-service links.

Then run the full deterministic pipeline:

```powershell
python <skill-root>\scripts\run_cartographer.py
```

The runner writes or reuses the workspace config, then hashes supported source files and the cartographer config. If nothing changed since the last run, it skips graph rebuild and writes an empty delta queue. If source or config changed, it rebuilds deterministic graph truth, preserves existing agentic summaries for unchanged nodes/edges, and writes only changed items to `agentic_delta_queue.json`.

After the first deterministic graph exists for a target repository, always create semantic node summary enrichment for the canonical graph with `scripts/semantic_node_summaries.py`. Initial setup is not complete until this step succeeds, or the failure is reported clearly to Human.

## Default Output

```text
.repo_executive_context/codebase_cartographer/
  graph.json
  graph.sqlite
  graph_validation_report.md
  workspace_profile.json
  cartographer_config.json
  agentic_summary_queue.json
  agentic_delta_queue.json
  semantic_node_context.json
  semantic_node_summaries.json
  source_manifest.json
  visualiser/
    index.html
    package.json
    package-lock.json
    src/
    public/
      assets/
      codebase_cartographer/
        graph.json
        traces/
  obsidian_vault/
    Codebase Overview.canvas
    FE Perspective.canvas
    API Perspective.canvas
    Data Perspective.canvas
    Workflow Perspective.canvas
    nodes/
```

The runner copies `graph.json` to `.repo_executive_context/codebase_cartographer/visualiser/public/codebase_cartographer/` when the materialised visualiser exists. It still supports the legacy repo-level `visualiser/public/codebase_cartographer/` path for this development repository.

## Optional Collaboration

Use `Codebase Index N Search` as the preferred supporting source index when the skill is available. Keep Codebase Cartographer's canonical outputs in `.repo_executive_context/codebase_cartographer/`.

If the supporting skill is available but `.repo_executive_context/codebase_index_n_search/` is absent, run the supporting skill's index build first. If the folder exists, run `status` or `stale` before relying on it, and refresh changed files when needed.

Do not make `Codebase Index N Search` responsible for graph topology, visualiser contracts, Obsidian output, or agentic summaries.

## Workflow Checklist

1. Run `scripts/skill_run_check.py`; if `setup_required` is `false`, continue to the normal workflow. If setup is required, run the First-Run Setup Gate and do not initiate indexing until Human confirms.
2. Check whether `Codebase Index N Search` is available and whether `.repo_executive_context/codebase_index_n_search/` exists; build, refresh, or validate that supporting index first when possible.
3. Run `scripts/materialise_visualiser.py` to copy the bundled visualiser literally into `.repo_executive_context/codebase_cartographer/visualiser/`.
4. Run `scripts/workspace_config.py` or let `scripts/run_cartographer.py` create the first config.
5. Inspect `workspace_profile.json` and adjust `cartographer_config.json` when the folder contains multiple sub-repos/services or known topology.
6. Run `scripts/run_cartographer.py`.
7. Inspect `graph_validation_report.md` for deterministic, partial, unknown, and inferred facts.
8. Run `scripts/semantic_node_summaries.py` to create or refresh semantic node summary enrichment for the canonical graph before saying initial setup is complete.
9. Run `scripts/verify_visualiser_snapshot.py` if visualiser drift is suspected.
10. From `.repo_executive_context/codebase_cartographer/visualiser/`, run `npm install` if dependencies are missing, then `npm run dev` to open the local browser visualiser. Use Browser Use to open the in-app browser only when Human asked or approves; otherwise provide the URL and offer to open it.
11. After source or config changes, re-run the deterministic pipeline, inspect `agentic_delta_queue.json`, and refresh semantic summaries for new or changed nodes while preserving unchanged fingerprint-matched summaries.
12. For later repo-understanding questions while the skill or visualiser is active, answer in chat and generate an Ask & Trace trace JSON automatically.

## Validation Boundary

Do not use Browser Use or the in-app browser as the default validation method for this workflow. For copied visualiser files, manifest/hash verification is the primary validation. Use browser validation only when Human asks for UI inspection, when Codex directly edits visualiser source, or when debugging a reported visualiser runtime issue.

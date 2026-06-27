# Semantic Enrichment Workflows

Load this reference when creating semantic summaries, refreshing summaries after graph/source changes, or adding service-to-service semantic links.

## Semantic Node Summary Enrichment

Semantic summaries are required local explanations after initial graph generation. They must never become graph truth.

Use this workflow on initial skill activation after the canonical graph exists, and again after source or config changes:

1. Run or verify `Codebase Index N Search` first with `status` or `stale`.
2. Use graph node details, edges, contracts, evidence, and validation as the first evidence source.
3. Use Codebase Index N Search compact queries such as `outline`, `symbol`, `deps`, `search`, or `snapshot` before reading source.
4. Read narrow source slices only when the graph and compact index evidence are insufficient.
5. Write concise semantic wording to `summary.agentic`, at least 10 useful expandable explanation points to `summary.agentic_points` where source evidence permits, and set `summary.agentic_status`.
6. Apply generated summaries only when both `node_id` and `fingerprint` match.
7. When code changes, use `agentic_delta_queue.json` to identify new and changed nodes, update only those semantic summaries, and preserve unchanged summaries whose fingerprints still match.

Semantic wording must explain what the node does in the product or system, not merely what it is in the graph. Start from route handlers, function names, class/schema names, imports, calls, code excerpts, file paths, service child files, contracts, and validation evidence. Use that evidence to state the node's responsibility, capability, workflow role, and important downstream work.

Avoid inventory-style primary summaries such as "represents a service boundary", "collects an artifact", "contains N functions", or "groups mapped files" unless there is no stronger evidence. Counts and child names may appear only as supporting evidence after the role is explained. For services, describe the runtime surface and capability it owns, such as authentication, API orchestration, React UI, inventory flows, blob access, or reporting. For files, describe the module's responsibility and how its routes/functions/schemas contribute. For API nodes, describe the user or system action handled, request identity/context evidence, downstream calls, and returned effect when visible from source.

Use `scripts/semantic_node_summaries.py` to:
- add deterministic, truncated `details.code_excerpt` snippets from source line ranges
- generate compact local context and summary artifacts
- apply semantic summaries into the selected graph artifact by fingerprint

After running the script, Codex must inspect `semantic_node_context.json` and the source excerpts for the important service, file, API, component, and workflow nodes before saying semantic enrichment is complete. If a summary only describes the first visible lines, counts, or folder grouping, read the relevant source slices and improve the semantic points so they explain the node's real responsibility, runtime role, downstream work, and evidence.

The default semantic summary artifacts are:

```text
.repo_executive_context/codebase_cartographer/
  semantic_node_context.json
  semantic_node_summaries.json
```

Rules:
- keep excerpts short and deterministic
- do not store long raw source by default
- keep `summary.agentic` short enough for hover overlays and place richer responsibility lists in `summary.agentic_points`
- make `summary.agentic_points` role/capability/evidence bullets, not graph-count bullets; shallow fallback points should be treated as a signal to inspect more source
- do not change nodes, edges, contracts, source references, or validation status from Codex interpretation
- use `unknown`, `partial`, `not_declared`, or `inferred_from_usage` when source truth is missing

## Semantic Service Link Enrichment

Use this workflow when a workspace has multiple deployable services that are wired together through runtime, infrastructure, API, queue, storage, or orchestration configuration rather than simple source imports.

1. Run or verify `Codebase Index N Search` first with `status` or `stale`.
2. Start from deterministic service roots, API routes, API clients, settings/config files, environment variable names, Docker/deployment files, queue names, blob/container names, and workflow handoff points.
3. Use compact `outline`, `symbol`, `deps`, `search`, and `regex` queries before reading source.
4. Read narrow source or config slices only when compact graph/index evidence is insufficient.
5. Add service-to-service links only when there is evidence that one service calls, orchestrates, dispatches to, configures, reads outputs from, publishes to, subscribes to, or otherwise depends on another service.
6. Write accepted links into `.repo_executive_context/codebase_cartographer/cartographer_config.json` under `service_links`, then re-run `scripts/run_cartographer.py`.

Preferred `service_links` shape:

```json
{
  "source_path": "service-a",
  "target_path": "service-b",
  "kind": "connects_service",
  "relationship_type": "orchestrates",
  "status": "partial",
  "confidence": 0.86,
  "reason": "`service-a` orchestrates `service-b` through runtime configuration and matching API workflow evidence.",
  "evidence": [
    {
      "kind": "config",
      "file": "service-a/settings.py",
      "line_start": 12,
      "line_end": 18,
      "detail": "settings declare the downstream service endpoint"
    }
  ]
}
```

Rules:
- Do not create service links from folder order, label shape, naming style, or prior chat memory alone.
- Prefer `kind: "connects_service"` for service-to-service topology so the visualiser can render the relationship prominently; put the more precise relationship in `relationship_type`.
- Use `status: "complete"` only for direct source/config proof. Use `status: "partial"` when Codex is connecting multiple evidence points semantically.
- Keep every link auditable with a concise `reason`, numeric `confidence`, and evidence records. If evidence is weak, do not add the link.
- Keep parser-proven API calls/imports as deterministic source relationships; use `service_links` only for workspace-level relationships between deployable services.

# Workspace Shape Controls

Load this reference when inspecting or editing `.repo_executive_context/codebase_cartographer/cartographer_config.json`, confirming service roots, or declaring service links.

Use `.repo_executive_context/codebase_cartographer/cartographer_config.json` as the explicit control surface between Codex's repo-shape judgment and deterministic graph generation.

Important fields:
- `workspace_mode`: `single_repo` or `workspace`.
- `service_roots_locked`: `true` when Human confirmed service roots during first-run setup; prevents auto-detected candidates from being appended later.
- `service_roots`: roots that should become large service/repo suns in the visualiser.
- `service_links`: known service-to-service connections. These are config-declared relationships unless source extraction later proves them.

Rules:
- Do not hardcode one naming convention as universal truth.
- Let deterministic detection propose likely roots from markers such as `.git`, `package.json`, `pyproject.toml`, `requirements.txt`, `Dockerfile`, `src`, or `app`.
- Let Codex edit the config when the user intent or repo shape is clearer than marker detection.
- When `service_roots_locked` is `true`, preserve the confirmed `service_roots` exactly except for refreshed file-count/profile metadata.
- The graph builder must record config-derived service roots and links with `workspace_config` evidence.
- Keep API contracts, function ownership, calls, imports, and source line relationships parser-derived; do not move those into config.

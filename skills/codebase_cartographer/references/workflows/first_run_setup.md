# First-Run Setup Gate

Load this reference when `scripts/skill_run_check.py` reports `setup_required: true`, or when Human asks about first-run setup behavior.

## Contents

- Setup check behavior
- Architecture question flow
- Confirmed setup file shapes
- Service root and service link config shapes

Before running `Codebase Index N Search`, `workspace_config.py`, `materialise_visualiser.py`, or `run_cartographer.py` for a target repository, run the setup check from the target repository root:

```powershell
python <skill-root>\scripts\skill_run_check.py
```

If the result has `setup_required: false`, continue directly to the run workflow. Do not ask the architecture question and do not run `project_scan.py`.

If the result has `setup_required: true`, run:

```powershell
python <skill-root>\scripts\project_scan.py
```

Use the detected folder names to make a likely architecture guess when there is clear evidence, but still require Human confirmation because service roots are locked from this answer.

Then ask Human:

```text
What architecture best describes this project?

A. Single Frontend only
B. Single Backend only
C. Multiple Backend
D. Frontend + Backend Monolith
E. Frontend + Backend Multiple Microservices

From the folder names, my likely guess is <choice and label>, but I need your confirmation because Cartographer locks service roots from this answer.
```

Always replace placeholder folder names in the prompts below with the actual `folders[].path` values returned by `project_scan.py`. Do not reuse sample names from this reference unless those exact folders appear in the scan output.

For `A` or `B`, show the detected project folders for context and ask:

```text
I will treat this whole repo as one service node.

Detected project folders:
- <folder path from project_scan.py>
- <folder path from project_scan.py>
- <folder path from project_scan.py>

Confirm this is correct before we initiate the indexing?
```

For `C`, `D`, or `E`, show the detected project folders and ask:

```text
Detected project folders:
- <folder path from project_scan.py>
- <folder path from project_scan.py>
- <folder path from project_scan.py>

Which folder names are services, and how do they connect?
Example format: <source folder> -> <target folder>. <source folder> -> <target folder>.
```

Before writing config for `C`, `D`, or `E`, confirm the interpreted service setup. Never write `cartographer_config.json` from the semantic service description until Human confirms this interpreted setup:

```text
I interpreted the service setup as:

Service nodes:
- <confirmed service folder>
- <confirmed service folder>
- <confirmed service folder>

Service links:
- <source service folder> -> <target service folder>
- <source service folder> -> <target service folder>

Confirm this is correct before we initiate the indexing?
```

Only after Human confirms, write `.repo_executive_context/codebase_cartographer/setup_check.json` and `.repo_executive_context/codebase_cartographer/cartographer_config.json`.

Use this `setup_check.json` shape:

```json
{
  "schema_version": 1,
  "architecture_choice": "E",
  "architecture_label": "Frontend + Backend Multiple Microservices",
  "confirmed_at": "<UTC ISO timestamp>",
  "raw_human_answer": "<Human architecture and connection answer>",
  "confirmed_service_nodes": ["frontend", "backend-api"],
  "confirmed_service_links": ["frontend -> backend-api"]
}
```

For `A` or `B`, set `confirmed_service_nodes` to `["."]` and `confirmed_service_links` to `[]`.

For `A` or `B`, set `workspace_mode: "single_repo"`, `service_roots_locked: true`, one service root with `path: "."`, and no service links.

Use this `cartographer_config.json` shape for `A` or `B`:

```json
{
  "schema_version": "0.1.0",
  "workspace_mode": "single_repo",
  "service_roots_locked": true,
  "source": "human_confirmed_first_run",
  "service_roots": [
    {
      "path": ".",
      "label": "<repo folder name>",
      "role": "main_repo",
      "status": "complete",
      "source": "human_confirmed_first_run",
      "evidence": ["setup_check"]
    }
  ],
  "service_links": []
}
```

For `C`, `D`, or `E`, set `workspace_mode: "workspace"`, `service_roots_locked: true`, confirmed folder names as `service_roots`, and confirmed connections as `service_links`.

Human-declared service links must use `kind: "connects_service"`, `relationship_type: "human_declared_connection"`, `status: "partial"`, and evidence kind `human_declared_first_run` unless direct source/config evidence later proves the link.

Use this `cartographer_config.json` shape for `C`, `D`, or `E`:

```json
{
  "schema_version": "0.1.0",
  "workspace_mode": "workspace",
  "service_roots_locked": true,
  "source": "human_confirmed_first_run",
  "service_roots": [
    {
      "path": "frontend",
      "label": "frontend",
      "role": "service",
      "status": "complete",
      "source": "human_confirmed_first_run",
      "evidence": ["setup_check"]
    },
    {
      "path": "backend-api",
      "label": "backend-api",
      "role": "service",
      "status": "complete",
      "source": "human_confirmed_first_run",
      "evidence": ["setup_check"]
    }
  ],
  "service_links": [
    {
      "source_path": "frontend",
      "target_path": "backend-api",
      "kind": "connects_service",
      "relationship_type": "human_declared_connection",
      "status": "partial",
      "confidence": 0.9,
      "reason": "Human confirmed this service connection during Codebase Cartographer first-run setup.",
      "evidence": [
        {
          "kind": "human_declared_first_run",
          "detail": "frontend -> backend-api"
        }
      ]
    }
  ]
}
```

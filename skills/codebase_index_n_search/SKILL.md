---
name: Codebase Index N Search
description: Use this skill for repo exploration, token-saving code search, structure-first source reading, symbol lookup, dependency lookup, substring search, prefix search, regex search, stale or incomplete index checks, and avoiding broad source-file loading. It provides Python-only deterministic scripts that index a repository once into .repo_executive_context/codebase_index_n_search, query a SQLite-backed file/symbol/word/trigram/sparse-ngram/dependency/line index, refresh changed files on demand, prefer ACID-safe SQLite writes, fall back to guarded direct writes when needed, and read only narrow source slices.
---

# Codebase Index N Search

This skill gives Codex a deterministic, Python-only code retrieval workflow: index once, query compact structure/search indexes, then read only the source lines needed for the task.

## Core intent

Use this skill to:
- avoid broad source-file loading at the start of repo work
- build a repo-local SQLite code index before exploration
- query file, symbol, word, prefix, search, regex, dependency, hot-file, snapshot, and outline data from indexes
- read exact line ranges after structure has narrowed the target
- keep all generated index files inside `.repo_executive_context/codebase_index_n_search`

Do not use this skill to run MCP, use WSL2, Docker, a server, embeddings, or external Python packages. This skill is independent from `ast_summary_builder` and does not write AST summary markdown.

## Storage location

All generated repo indexes must be stored under:

`.repo_executive_context/codebase_index_n_search/`

Expected V2 files:
- `index.sqlite`
- `manifest.json`
- `hashes.json`

`index_state.json` is created only for guarded direct-write fallback mode. Atomic mode does not require it.

## Required workflow

1. Build or refresh the index before broad repo exploration.
2. Run `status` or `stale` before relying on old index data; query scripts enforce `index_state.json` only when that fallback guard file exists.
3. Query compact indexed structure before reading source.
4. Prefer symbol, word, prefix, file, dependency, outline, trigram-backed search, and regex queries over raw file loads.
5. Use `read_slice.py` only after selecting a specific file and line range.
6. Read a full source file only when narrow slices are insufficient for exact implementation or verification.
7. Re-run `refresh_index.py` after meaningful file edits before relying on prior query results.

## Script selection

| Need | Script | Notes |
|---|---|---|
| Build or rebuild the full SQLite index | `scripts/build_index.py` | Deterministically scans the repo and writes `index.sqlite`, `manifest.json`, and `hashes.json`; uses `index_state.json` only in direct fallback mode. |
| Refresh stale index after changes | `scripts/refresh_index.py` | Reports added/changed/deleted files and updates only affected file rows unless schema/skip rules changed. |
| Query indexed data | `scripts/query_index.py` | Modes: `status`, `stale`, `tree`, `find_file`, `outline`, `symbol`, `word`, `prefix`, `search`, `regex`, `deps`, `rdeps`, `deps_transitive`, `hot`, `snapshot`. |
| Read exact source lines | `scripts/read_slice.py` | Enforces safe repo-relative paths, sensitive-file blocking, hash checks, and compact reads. |
| Validate index health | `scripts/validate_index.py` | Checks SQLite schema, sidecars, safe paths, sensitive-file exclusion, and hash freshness. |

Shared helper code lives in `scripts/code_index_common.py`; do not invoke it directly. `index_state.json` is written by the scripts, not by Codex prose.

## Write-mode selection

Build and refresh scripts expose `INDEX_WRITE_POLICY = "auto"` with allowed values:
- `auto`: inspect `.repo_executive_context/codebase_index_n_search/index_state.json`; use `direct` only when it records `write_mode: direct`, otherwise use `atomic`
- `atomic`: require ACID-safe SQLite writes and atomic DB replacement; fail if the filesystem blocks it
- `direct`: write directly to `index.sqlite` and guard the transaction with `index_state.json`

Prefer `auto` unless the user explicitly asks to force a mode. In normal folders, `auto` creates no state file and uses SQLite durability plus atomic replacement. In OneDrive or locked folders where atomic writes fail, `auto` falls back to direct mode and creates `index_state.json` so future queries can reject half-built indexes.

## Script execution pattern

The scripts use module-level configuration variables instead of argparse. Prefer dynamic import so Codex can set variables before calling `main()`.

```python
from pathlib import Path
import importlib.util
import os
import sys

codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
script = codex_home / "skills" / "codebase_index_n_search" / "scripts" / "query_index.py"
sys.path.insert(0, str(script.parent))
spec = importlib.util.spec_from_file_location("query_index", script)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

mod.REPO_ROOT = str(Path("path/to/repo").resolve())
mod.QUERY_MODE = "search"
mod.QUERY = "search term"
mod.MAX_RESULTS = 40
mod.main()
```

Direct execution also works for smoke tests because each script has safe defaults:

```powershell
python <codex-home>/skills/codebase_index_n_search/scripts/build_index.py
```

When executing directly, edit or dynamically set the module-level variables first if the default repo is not the current working directory.

## Query guidance

Use these defaults when deciding what to query:
- `status`: verify index existence, counts, generated timestamp, feature flags, and DB size
- `stale`: cheaply detect added/changed/deleted files before serious work or after edits
- `tree`: understand repo shape without reading files
- `find_file`: locate likely files by fuzzy path/name match
- `outline`: inspect symbols for one file before reading it
- `symbol`: find definitions or declarations by exact/partial name
- `word`: find exact identifier-like occurrences
- `prefix`: find partial identifiers such as `searchC` before broad search
- `search`: phrase/string/error lookup using word, prefix, trigram, sparse n-gram, then bounded line-scan verification
- `regex`: syntax-pattern lookup using literal trigram prefilter where possible
- `deps`: inspect imports and direct reverse imports for a file
- `rdeps`: inspect only reverse imports for a file
- `deps_transitive`: inspect dependency and dependent blast radius
- `hot`: inspect recently changed indexed files
- `snapshot`: compact indexed repo summary

For named code structures, prefer `symbol -> outline -> read_slice`.
For partial identifiers, prefer `prefix -> search`.
For phrase, error, string, or endpoint lookup, use `search`.
For syntax patterns such as route decorators, imports, or signatures, use `regex`.
For implementation work, follow `outline -> read_slice` for the smallest useful context.

V2 intentionally returns multiple candidate groups where useful. Do not over-trust the first narrow hit when the prompt is vague; compare nearby symbol/path/search/dependency candidates, then confirm with `read_slice.py`.

If a query reports a `processing` or `failed` `index_state.json`, run `refresh_index.py` or `build_index.py` before searching. A missing `index_state.json` is normal in atomic mode.

## Validation expectation

After creating or changing an index, run:
- `scripts/validate_index.py` for repo index health

Report:
- index output folder
- SQLite DB path and size
- file/symbol/word/trigram/sparse-ngram/dependency/content-line counts
- validation result
- any stale or skipped files that matter to the task

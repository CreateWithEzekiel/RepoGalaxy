# Codebase Index N Search Index Contract

This skill writes deterministic repo-local indexes under:

`.repo_executive_context/codebase_index_n_search/`

## Files

### `index.sqlite`

Canonical V2 index. All paths stored in SQLite are repo-relative.

Core tables:
- `meta`: schema version, feature flags, skip rules hash, write mode, generator metadata.
- `files`: file id, path, extension, language, size, line count, mtime, content hash.
- `symbols`: file symbols/outlines with name, kind, line range, and compact detail.
- `words`: one row per normalized word per file.
- `word_hits`: exact word hit line numbers.
- `trigrams`: trigram to file postings for substring candidate filtering.
- `sparse_ngrams`: sparse n-gram to file postings for wider candidate discovery.
- `raw_imports`: parsed import strings per file.
- `deps`: parsed imports with best-effort repo-relative resolution.
- `content_lines`: cached non-sensitive source lines for verified snippets.

V2 deliberately does not use SQLite FTS/FTS5.

### `manifest.json`

Repository-level index metadata.

Required keys:
- `schema_version`
- `generated_at_utc`
- `repo_root`
- `index_dir`
- `index_db`
- `index_db_size`
- `file_count`
- `symbol_count`
- `word_count`
- `distinct_word_count`
- `word_hit_count`
- `trigram_count`
- `sparse_ngram_count`
- `dependency_count`
- `content_line_count`
- `supported_extensions`
- `skip_rules_hash`
- `feature_flags`
- `index_write_mode`
- `generator`

### `hashes.json`

Object keyed by repo-relative path.

Values:
- `id`
- `hash`
- `mtime`
- `size`

### `index_state.json`

Optional deterministic transaction marker for guarded direct-write fallback mode. Query scripts must enforce it only when the file exists.

Required keys:
- `schema_version`
- `generator`
- `mode`
- `status`
- `write_mode`
- `started_at_utc`
- `completed_at_utc`
- `updated_at_utc`
- `index_dir`
- `index_db`
- `manifest`
- `hashes`
- `error`
- `details`

## Query Modes

`query_index.py` supports:
- `status`
- `stale`
- `tree`
- `find_file`
- `outline`
- `symbol`
- `word`
- `prefix`
- `search`
- `regex`
- `deps`
- `rdeps`
- `deps_transitive`
- `hot`
- `snapshot`

`search` runs deterministic local tiers: exact word hits, prefix hits, trigram candidates, sparse n-gram candidates, then bounded cached-line fallback.

## Safety Contract

Scripts must:
- use repo-relative paths in outputs
- reject absolute paths in query/read inputs except `REPO_ROOT`
- reject `..` path traversal
- skip `.repo_executive_context` during indexing
- block `.env*`, keys, credentials, secrets, SSH, AWS, and GnuPG paths
- avoid third-party Python dependencies
- avoid argparse and expose module-level config variables
- use `INDEX_WRITE_POLICY = "auto"` by default
- prefer ACID-safe SQLite writes and atomic DB replacement when no direct fallback state is present
- mark build/refresh state as `processing`, `completed`, or `failed` in `index_state.json` only for guarded direct writes
- reject queries when present `index_state.json` is stale-schema, `processing`, or `failed`
- treat source slices as final truth for editing decisions

from __future__ import annotations

# ============================================================
# QUERY CODE INDEX
# ============================================================
# Purpose:
# - Query compact SQLite repo-local indexes before reading source files.
# - Python stdlib only, no argparse.
# ============================================================

import json
import re
from collections import Counter, defaultdict, deque
from pathlib import Path

import code_index_common as common

REPO_ROOT = r""
QUERY_MODE = "status"  # status, stale, tree, find_file, outline, symbol, word, prefix, search, regex, deps, rdeps, deps_transitive, hot, snapshot
QUERY = r""
PATH_FILTER = r""
MAX_RESULTS = 40
INCLUDE_CONTEXT = False
LINE_CONTEXT = 1
MAX_CANDIDATE_FILES = 200
REGEX_FLAGS = "i"
DEPTH = 3


def connect(repo_root: Path):
    if common.state_path_for(repo_root).exists():
        common.require_completed_index_state(repo_root)
    db_path = common.db_path_for(repo_root)
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite index not found: {db_path}. Run build_index.py first.")
    return common.connect_sqlite(db_path)


def path_like() -> str:
    needle = PATH_FILTER.lower().replace("\\", "/")
    return f"%{needle}%"


def path_matches(path: str) -> bool:
    if not PATH_FILTER:
        return True
    needle = PATH_FILTER.lower().replace("\\", "/")
    return needle in path.lower()


def path_clause(alias: str = "f") -> tuple[str, list[str]]:
    if not PATH_FILTER:
        return "", []
    return f" AND lower({alias}.path) LIKE ?", [path_like()]


def mode_status(conn, repo_root: Path) -> None:
    manifest_path = common.index_dir_for(repo_root) / "manifest.json"
    manifest = common.read_json(manifest_path) if manifest_path.exists() else common.manifest_from_db(repo_root, conn)
    state_path = common.state_path_for(repo_root)
    state = common.read_index_state(repo_root) if state_path.exists() else {}
    print("codebase_index_n_search status")
    print(f"  write_mode: {manifest.get('index_write_mode', 'atomic')}")
    print(f"  state: {state.get('status', 'not required')} ({state.get('mode', 'atomic')})")
    print(f"  state_updated: {state.get('updated_at_utc', '')}")
    print(f"  schema: {manifest.get('schema_version')}")
    print(f"  generated: {manifest.get('generated_at_utc')}")
    print(f"  files: {manifest.get('file_count')}")
    print(f"  symbols: {manifest.get('symbol_count')}")
    print(f"  words: {manifest.get('word_count')} ({manifest.get('distinct_word_count')} distinct)")
    print(f"  trigrams: {manifest.get('trigram_count')}")
    print(f"  sparse_ngrams: {manifest.get('sparse_ngram_count')}")
    print(f"  deps: {manifest.get('dependency_count')}")
    print(f"  content_lines: {manifest.get('content_line_count')}")
    print(f"  db_size: {manifest.get('index_db_size')} bytes")
    print(f"  db: {manifest.get('index_db')}")
    print(f"  features: {json.dumps(manifest.get('feature_flags', {}), sort_keys=True)}")


def mode_stale(repo_root: Path) -> None:
    hashes_path = common.index_dir_for(repo_root) / "hashes.json"
    if not hashes_path.exists():
        print("stale: index missing hashes.json")
        return
    old_hashes = common.read_json(hashes_path)
    current = common.current_hash_snapshot(repo_root)
    added, changed, deleted = common.diff_hashes(old_hashes, current)
    print(f"stale: added={len(added)} changed={len(changed)} deleted={len(deleted)}")
    for label, paths in (("added", added), ("changed", changed), ("deleted", deleted)):
        for path in paths[:MAX_RESULTS]:
            print(f"  {label}: {path}")
        if len(paths) > MAX_RESULTS:
            print(f"  {label}: ... {len(paths) - MAX_RESULTS} more")


def mode_tree(conn) -> None:
    clause, params = path_clause("f")
    files = conn.execute(
        """
        SELECT f.path, f.language, f.lines, COALESCE(s.c, 0) AS symbols
        FROM files f
        LEFT JOIN (SELECT file_id, COUNT(*) AS c FROM symbols GROUP BY file_id) s ON s.file_id=f.id
        WHERE 1=1
        """ + clause + " ORDER BY f.path LIMIT ?",
        params + [MAX_RESULTS],
    ).fetchall()
    all_paths = conn.execute("SELECT path FROM files f WHERE 1=1" + clause, params).fetchall()
    dirs: Counter[str] = Counter()
    for row in all_paths:
        parts = row["path"].split("/")
        dirs[parts[0] if len(parts) > 1 else "."] += 1
    print("top folders:")
    for folder, count in dirs.most_common(MAX_RESULTS):
        print(f"  {folder}/ ({count} files)")
    print("files:")
    for row in files:
        print(f"  {row['path']} ({row['language']}, {row['lines']}L, {row['symbols']} symbols)")
    total = len(all_paths)
    if total > len(files):
        print(f"  ... {total - len(files)} more files")


def score_file(path: str, query: str) -> int:
    p = path.lower()
    q = query.lower().replace("\\", "/")
    name = Path(p).name
    score = 0
    if p == q:
        score += 1000
    if name == q:
        score += 800
    if q in p:
        score += 400
    tokens = [t for t in re.split(r"[./_\-\s]+", q) if t]
    score += sum(80 for token in tokens if token in p)
    pos = 0
    subseq = True
    for char in q:
        found = p.find(char, pos)
        if found == -1:
            subseq = False
            break
        pos = found + 1
    if subseq:
        score += 100
    score -= min(len(path), 200) // 20
    return score


def mode_find_file(conn) -> None:
    if not QUERY:
        print("error: QUERY is required for find_file")
        return
    clause, params = path_clause("f")
    rows = conn.execute("SELECT path, language, lines FROM files f WHERE 1=1" + clause, params).fetchall()
    ranked = sorted(((score_file(row["path"], QUERY), row) for row in rows), key=lambda x: (-x[0], x[1]["path"]))
    ranked = [item for item in ranked if item[0] > 0]
    for score, row in ranked[:MAX_RESULTS]:
        print(f"{row['path']} score={score} {row['language']} {row['lines']}L")
    if not ranked:
        print("no matching files")


def mode_outline(conn) -> None:
    if not QUERY:
        print("error: QUERY must be a repo-relative file path for outline")
        return
    path = common.locate_file(conn, QUERY)
    if not path:
        print("file not indexed")
        return
    meta = conn.execute("SELECT language, lines FROM files WHERE path=?", (path,)).fetchone()
    print(f"{path} ({meta['language']}, {meta['lines']}L)")
    rows = conn.execute(
        "SELECT kind, name, line_start, line_end, detail FROM symbols WHERE path=? ORDER BY line_start, name LIMIT ?",
        (path, MAX_RESULTS),
    ).fetchall()
    if not rows:
        print("  (no symbols detected)")
        return
    for row in rows:
        print(f"  L{row['line_start']}-{row['line_end']} {row['kind']} {row['name']} :: {row['detail']}")
    total = conn.execute("SELECT COUNT(*) AS c FROM symbols WHERE path=?", (path,)).fetchone()["c"]
    if total > len(rows):
        print(f"  ... {total - len(rows)} more symbols")


def mode_symbol(conn) -> None:
    if not QUERY:
        print("error: QUERY is required for symbol")
        return
    q = QUERY.lower()
    clause, params = path_clause("s")
    rows = conn.execute(
        """
        SELECT path, line_start, line_end, kind, name, detail
        FROM symbols s
        WHERE name_lc=?
        """ + clause + " ORDER BY path, line_start LIMIT ?",
        [q] + params + [MAX_RESULTS],
    ).fetchall()
    if not rows:
        rows = conn.execute(
            """
            SELECT path, line_start, line_end, kind, name, detail
            FROM symbols s
            WHERE name_lc LIKE ?
            """ + clause + " ORDER BY length(name), path, line_start LIMIT ?",
            [f"%{q}%"] + params + [MAX_RESULTS],
        ).fetchall()
    for row in rows:
        print(f"{row['path']}:{row['line_start']} {row['kind']} {row['name']} :: {row['detail']}")
    if not rows:
        print("no matching symbols")


def print_word_rows(conn, rows) -> None:
    for row in rows[:MAX_RESULTS]:
        line_rows = conn.execute(
            "SELECT line_num FROM word_hits WHERE word=? AND file_id=? ORDER BY line_num LIMIT 30",
            (row["word"], row["file_id"]),
        ).fetchall()
        lines = ",".join(str(item["line_num"]) for item in line_rows)
        suffix = "" if row["hit_count"] <= len(line_rows) else f" (+{row['hit_count'] - len(line_rows)} more hits)"
        label = f" word={row['word']}" if row["word"] != common.normalize_word(QUERY) else ""
        print(f"{row['path']}: lines {lines}{suffix}{label}")


def mode_word(conn) -> None:
    if not QUERY:
        print("error: QUERY is required for word")
        return
    q = common.normalize_word(QUERY)
    clause, params = path_clause("w")
    rows = conn.execute(
        "SELECT word, file_id, path, hit_count FROM words w WHERE word=?" + clause + " ORDER BY path LIMIT ?",
        [q] + params + [MAX_RESULTS],
    ).fetchall()
    print_word_rows(conn, rows)
    if not rows:
        print("no matching word hits")


def mode_prefix(conn) -> None:
    if not QUERY:
        print("error: QUERY is required for prefix")
        return
    clause, params = path_clause("w")
    raw = common.normalize_word(QUERY)
    rows = []
    if len(raw) >= 2:
        rows = conn.execute(
            "SELECT word, file_id, path, hit_count FROM words w WHERE word LIKE ?" + clause + " ORDER BY length(word), word, path LIMIT ?",
            [raw + "%"] + params + [MAX_RESULTS],
        ).fetchall()
    if not rows:
        terms = [term for term in common.query_words(QUERY) if term != raw]
        for term in terms:
            if len(term) < 2:
                continue
            rows.extend(conn.execute(
                "SELECT word, file_id, path, hit_count FROM words w WHERE word LIKE ?" + clause + " ORDER BY length(word), word, path LIMIT ?",
                [term + "%"] + params + [MAX_RESULTS],
            ).fetchall())
    dedup = []
    seen = set()
    for row in rows:
        key = (row["word"], row["file_id"])
        if key not in seen:
            seen.add(key)
            dedup.append(row)
    print_word_rows(conn, dedup)
    if not dedup:
        print("no prefix hits")


def ids_for_word_terms(conn, terms: list[str], prefix: bool = False) -> dict[int, int]:
    scores: dict[int, int] = defaultdict(int)
    for term in terms:
        if len(term) < 2:
            continue
        if prefix and len(term) >= 3:
            rows = conn.execute("SELECT file_id, hit_count FROM words WHERE word LIKE ? LIMIT 2000", (term + "%",)).fetchall()
            for row in rows:
                scores[int(row["file_id"])] += 30 + min(int(row["hit_count"]), 10)
        elif not prefix:
            rows = conn.execute("SELECT file_id, hit_count FROM words WHERE word=?", (term,)).fetchall()
            for row in rows:
                scores[int(row["file_id"])] += 80 + min(int(row["hit_count"]), 20)
    return scores


def ids_for_trigrams(conn, query: str) -> set[int]:
    trigrams = sorted(common.extract_trigrams(query))
    if not trigrams:
        return set()
    postings: list[set[int]] = []
    for trigram in trigrams:
        rows = conn.execute("SELECT file_id FROM trigrams WHERE trigram=?", (trigram,)).fetchall()
        ids = {int(row["file_id"]) for row in rows}
        if not ids:
            return set()
        postings.append(ids)
    postings.sort(key=len)
    result = set(postings[0])
    for ids in postings[1:]:
        result &= ids
        if not result:
            return set()
    return result


def ids_for_sparse_ngrams(conn, query: str) -> dict[int, int]:
    grams = sorted(common.extract_query_sparse_ngrams(query))
    scores: dict[int, int] = defaultdict(int)
    for gram in grams:
        rows = conn.execute("SELECT file_id FROM sparse_ngrams WHERE ngram=? LIMIT 2000", (gram,)).fetchall()
        for row in rows:
            scores[int(row["file_id"])] += 10 + min(len(gram), 16)
    return scores


def line_match_strength(query: str, text: str, terms: list[str]) -> int:
    q = query.lower()
    lower = text.lower()
    if q and q in lower:
        return 4
    if terms:
        hits = sum(1 for term in terms if term in lower)
        if hits == len(set(terms)):
            return 3
        if hits:
            return 1
    return 0


def fetch_verified_hits(conn, candidate_scores: dict[int, int] | None, query: str, method: str, base_score: int, limit: int) -> list[dict[str, object]]:
    terms = common.query_words(query)
    rows = []
    if candidate_scores is None:
        first = query.lower() if len(query) >= 2 else (terms[0] if terms else "")
        if not first:
            return []
        clause, params = path_clause("c")
        rows = conn.execute(
            "SELECT c.file_id, c.path, c.line_num, c.text FROM content_lines c WHERE lower(c.text) LIKE ?" + clause + " ORDER BY c.path, c.line_num LIMIT ?",
            [f"%{first}%"] + params + [max(limit * 20, limit)],
        ).fetchall()
    else:
        ranked_ids = [file_id for file_id, _score in sorted(candidate_scores.items(), key=lambda item: (-item[1], item[0]))[:MAX_CANDIDATE_FILES]]
        for file_id in ranked_ids:
            path_row = conn.execute("SELECT path FROM files WHERE id=?", (file_id,)).fetchone()
            if not path_row or not path_matches(path_row["path"]):
                continue
            probe = query.lower() if len(query) >= 2 else (terms[0] if terms else "")
            if probe:
                rows.extend(conn.execute(
                    "SELECT file_id, path, line_num, text FROM content_lines WHERE file_id=? AND lower(text) LIKE ? ORDER BY line_num LIMIT 80",
                    (file_id, f"%{probe}%"),
                ).fetchall())
            if len(rows) < limit:
                for term in terms[:3]:
                    rows.extend(conn.execute(
                        "SELECT file_id, path, line_num, text FROM content_lines WHERE file_id=? AND lower(text) LIKE ? ORDER BY line_num LIMIT 40",
                        (file_id, f"%{term}%"),
                    ).fetchall())
    results: list[dict[str, object]] = []
    seen = set()
    for row in rows:
        key = (row["path"], row["line_num"])
        if key in seen:
            continue
        seen.add(key)
        strength = line_match_strength(query, row["text"], terms)
        if strength <= 0:
            continue
        candidate_boost = 0 if candidate_scores is None else candidate_scores.get(int(row["file_id"]), 0)
        score = base_score + candidate_boost + strength * 25 - min(len(row["path"]), 200) // 10
        results.append({
            "path": row["path"],
            "line": int(row["line_num"]),
            "text": " ".join(row["text"].strip().split())[:280],
            "method": method,
            "score": score,
        })
    return sorted(results, key=lambda item: (-int(item["score"]), str(item["path"]), int(item["line"])))[:limit]


def print_search_results(results: list[dict[str, object]]) -> None:
    if not results:
        print("no search hits")
        return
    for item in results[:MAX_RESULTS]:
        print(f"{item['path']}:{item['line']} [{item['method']}] score={item['score']}: {item['text']}")
    if len(results) > MAX_RESULTS:
        print(f"truncated at {MAX_RESULTS} results")


def mode_search(conn) -> None:
    if not QUERY:
        print("error: QUERY is required for search")
        return
    terms = common.query_words(QUERY)
    all_results: list[dict[str, object]] = []
    seen = set()

    stages: list[tuple[str, dict[int, int] | None, int]] = []
    exact_ids = ids_for_word_terms(conn, terms, prefix=False)
    if exact_ids:
        stages.append(("word", exact_ids, 500))
    prefix_ids = ids_for_word_terms(conn, terms, prefix=True)
    if prefix_ids:
        stages.append(("prefix", prefix_ids, 350))
    trigram_ids = ids_for_trigrams(conn, QUERY)
    if trigram_ids:
        stages.append(("trigram", {file_id: 80 for file_id in trigram_ids}, 260))
    sparse_ids = ids_for_sparse_ngrams(conn, QUERY)
    if sparse_ids:
        stages.append(("sparse_ngram", sparse_ids, 180))

    for method, ids, base_score in stages:
        for item in fetch_verified_hits(conn, ids, QUERY, method, base_score, MAX_RESULTS):
            key = (item["path"], item["line"])
            if key not in seen:
                seen.add(key)
                all_results.append(item)
        if len(all_results) >= MAX_RESULTS:
            break

    if len(all_results) < MAX_RESULTS:
        for item in fetch_verified_hits(conn, None, QUERY, "fallback_line_scan", 80, MAX_RESULTS - len(all_results)):
            key = (item["path"], item["line"])
            if key not in seen:
                seen.add(key)
                all_results.append(item)

    print_search_results(sorted(all_results, key=lambda item: (-int(item["score"]), str(item["path"]), int(item["line"]))))


def literal_runs_for_regex(pattern: str) -> list[str]:
    return sorted(set(re.findall(r"[A-Za-z0-9_./:-]{3,}", pattern)), key=lambda item: (-len(item), item))


def mode_regex(conn) -> None:
    if not QUERY:
        print("error: QUERY is required for regex")
        return
    flags = re.IGNORECASE if "i" in REGEX_FLAGS.lower() else 0
    try:
        compiled = re.compile(QUERY, flags)
    except re.error as exc:
        print(f"error: invalid regex: {exc}")
        return
    literals = literal_runs_for_regex(QUERY)
    candidate_ids: set[int] | None = None
    if literals:
        candidate_ids = ids_for_trigrams(conn, literals[0])
    rows = []
    if candidate_ids:
        for file_id in sorted(candidate_ids)[:MAX_CANDIDATE_FILES]:
            rows.extend(conn.execute("SELECT path, line_num, text FROM content_lines WHERE file_id=? ORDER BY line_num", (file_id,)).fetchall())
    else:
        clause, params = path_clause("c")
        rows = conn.execute("SELECT path, line_num, text FROM content_lines c WHERE 1=1" + clause + " ORDER BY path, line_num", params).fetchall()
    count = 0
    for row in rows:
        if not path_matches(row["path"]):
            continue
        if compiled.search(row["text"]):
            print(f"{row['path']}:{row['line_num']} [regex]: {' '.join(row['text'].strip().split())[:280]}")
            count += 1
            if count >= MAX_RESULTS:
                print(f"truncated at {MAX_RESULTS} results")
                return
    if count == 0:
        print("no regex hits")


def dep_target(conn) -> str | None:
    if not QUERY:
        return None
    return common.locate_file(conn, QUERY)


def print_deps_for_path(conn, path: str) -> None:
    print(path)
    imports = conn.execute("SELECT import, resolved_path FROM deps WHERE path=? ORDER BY import", (path,)).fetchall()
    reverse = conn.execute("SELECT DISTINCT path FROM deps WHERE resolved_path=? ORDER BY path", (path,)).fetchall()
    print("  imports:")
    for row in imports[:MAX_RESULTS]:
        suffix = f" -> {row['resolved_path']}" if row["resolved_path"] else ""
        print(f"    {row['import']}{suffix}")
    print("  imported_by:")
    for row in reverse[:MAX_RESULTS]:
        print(f"    {row['path']}")


def mode_deps(conn) -> None:
    path = dep_target(conn)
    if not path:
        print("no dependency record found")
        return
    print_deps_for_path(conn, path)


def mode_rdeps(conn) -> None:
    path = dep_target(conn)
    if not path:
        print("no dependency record found")
        return
    rows = conn.execute("SELECT DISTINCT path FROM deps WHERE resolved_path=? ORDER BY path LIMIT ?", (path, MAX_RESULTS)).fetchall()
    print(f"imported_by {path}:")
    for row in rows:
        print(f"  {row['path']}")
    if not rows:
        print("  (none)")


def walk_deps(conn, start: str, reverse: bool, depth: int) -> list[tuple[int, str]]:
    seen = {start}
    queue = deque([(start, 0)])
    out: list[tuple[int, str]] = []
    while queue:
        path, level = queue.popleft()
        if level >= depth:
            continue
        if reverse:
            rows = conn.execute("SELECT DISTINCT path AS next FROM deps WHERE resolved_path=? ORDER BY path", (path,)).fetchall()
        else:
            rows = conn.execute("SELECT DISTINCT resolved_path AS next FROM deps WHERE path=? AND resolved_path IS NOT NULL ORDER BY resolved_path", (path,)).fetchall()
        for row in rows:
            nxt = row["next"]
            if not nxt or nxt in seen:
                continue
            seen.add(nxt)
            out.append((level + 1, nxt))
            queue.append((nxt, level + 1))
    return out


def mode_deps_transitive(conn) -> None:
    path = dep_target(conn)
    if not path:
        print("no dependency record found")
        return
    depth = max(1, int(DEPTH or 1))
    print(f"transitive deps for {path} depth={depth}")
    print("  dependencies:")
    deps = walk_deps(conn, path, reverse=False, depth=depth)
    for level, item in deps[:MAX_RESULTS]:
        print(f"    d{level}: {item}")
    if not deps:
        print("    (none)")
    print("  dependents:")
    rdeps = walk_deps(conn, path, reverse=True, depth=depth)
    for level, item in rdeps[:MAX_RESULTS]:
        print(f"    d{level}: {item}")
    if not rdeps:
        print("    (none)")


def mode_hot(conn) -> None:
    clause, params = path_clause("f")
    rows = conn.execute(
        "SELECT path, mtime, language, lines FROM files f WHERE 1=1" + clause + " ORDER BY mtime DESC, path LIMIT ?",
        params + [MAX_RESULTS],
    ).fetchall()
    for row in rows:
        print(f"{row['path']} mtime={row['mtime']} {row['language']} {row['lines']}L")


def mode_snapshot(conn) -> None:
    counts = common.db_counts(conn)
    print("snapshot")
    print(json.dumps(counts, sort_keys=True))
    print("files:")
    rows = conn.execute("SELECT path, language, lines FROM files ORDER BY path LIMIT ?", (MAX_RESULTS,)).fetchall()
    for row in rows:
        print(f"  {row['path']} ({row['language']}, {row['lines']}L)")
    print("symbols:")
    symbols = conn.execute("SELECT path, line_start, kind, name FROM symbols ORDER BY path, line_start LIMIT ?", (MAX_RESULTS,)).fetchall()
    for row in symbols:
        print(f"  {row['path']}:{row['line_start']} {row['kind']} {row['name']}")


def main() -> None:
    repo_root = common.normalize_repo_root(REPO_ROOT)
    mode = QUERY_MODE.strip().lower()
    if mode == "stale":
        if common.state_path_for(repo_root).exists():
            common.require_completed_index_state(repo_root)
        mode_stale(repo_root)
        return
    conn = connect(repo_root)
    try:
        if mode == "status":
            mode_status(conn, repo_root)
        elif mode == "tree":
            mode_tree(conn)
        elif mode == "find_file":
            mode_find_file(conn)
        elif mode == "outline":
            mode_outline(conn)
        elif mode == "symbol":
            mode_symbol(conn)
        elif mode == "word":
            mode_word(conn)
        elif mode == "prefix":
            mode_prefix(conn)
        elif mode == "search":
            mode_search(conn)
        elif mode == "regex":
            mode_regex(conn)
        elif mode == "deps":
            mode_deps(conn)
        elif mode == "rdeps":
            mode_rdeps(conn)
        elif mode == "deps_transitive":
            mode_deps_transitive(conn)
        elif mode == "hot":
            mode_hot(conn)
        elif mode == "snapshot":
            mode_snapshot(conn)
        else:
            print(f"error: unknown QUERY_MODE '{QUERY_MODE}'")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

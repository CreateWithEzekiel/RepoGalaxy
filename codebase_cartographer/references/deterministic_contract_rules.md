# Deterministic Contract Rules

## Status Vocabulary

- `complete`: directly declared in source and resolved to a schema, annotation, decorator, or explicit type.
- `partial`: some source truth exists, but the full shape cannot be proven.
- `unknown`: the extractor cannot determine the contract from supported source truth.
- `not_declared`: no contract is declared in the supported source syntax.
- `inferred_from_usage`: a relationship or shape is inferred from visible usage, such as a string literal `fetch("/api/users")`.

## Allowed Contract Evidence

Use only:

- FastAPI route decorators and route function signatures.
- FastAPI decorator keyword arguments such as `response_model`.
- Pydantic `BaseModel` fields.
- Python dataclasses.
- Python `TypedDict`.
- Python function annotations.
- TypeScript `interface` declarations.
- TypeScript `type` declarations.
- Zod-like `z.object(...)` declarations when directly visible.
- API client request/response type annotations.
- SQL DDL and migrations for tables, views, indexes, constraints, triggers, functions, and procedures.
- SQLAlchemy-style `__tablename__` declarations when directly visible.
- HTML and CSS parser-visible selectors, at-rules, forms, meaningful elements, and references.
- String-literal API paths for usage edges, marked `inferred_from_usage`.

## Forbidden

Do not use natural-language guesses for payloads, responses, or graph edges.

Do not turn Codex summaries into deterministic graph facts.

Do not mark a contract as `complete` unless the shape is directly supported by parseable source evidence.

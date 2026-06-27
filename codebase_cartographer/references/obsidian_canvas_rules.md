# Obsidian Canvas Rules

Use JSON Canvas `1.0` compatible files.

## Preferred Node Type

Prefer file-backed canvas nodes:

```json
{
  "id": "node-id",
  "type": "file",
  "file": "nodes/function__example.md",
  "x": 0,
  "y": 0,
  "width": 360,
  "height": 220
}
```

Use text cards only for perspective legends or summaries.

## Layout

Keep layout deterministic:

- sort nodes by kind, file, line, and ID
- place perspective nodes in stable grids
- avoid random or force-directed layout
- keep canvas edge IDs stable

## Edge

Use JSON Canvas edges:

```json
{
  "id": "edge-id",
  "fromNode": "source-canvas-node-id",
  "toNode": "target-canvas-node-id",
  "label": "calls"
}
```

Canvas labels must come from deterministic edge kinds or deterministic reasons.

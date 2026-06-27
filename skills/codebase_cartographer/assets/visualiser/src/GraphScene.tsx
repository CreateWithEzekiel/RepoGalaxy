import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { CodeEdge, CodeGraph, CodeNode, NodeKind, TracePlan } from "./types";

type PerformanceTierName = "full" | "balanced" | "recovery" | "emergency";
type NodeLodKey = "full" | "near" | "mid" | "far" | "tiny";

interface PerformanceTier {
  effectStrength: number;
  backgroundFrameInterval: number;
  neighborFrameInterval: number;
  lodCheckMs: number;
  overlayUpdateMs: number;
}

interface NodeLodTier {
  key: NodeLodKey;
  minProjectedRadiusPx: number;
  widthSegments: number;
  heightSegments: number;
  effectScale: number;
}

const MAX_DEPTH = 4;
const MAX_PACKET_COUNT = 90;
const PACKET_SPEED_UNITS_PER_MS = 0.16;
const PACKET_MIN_TRAVEL_MS = 420;
const PACKET_REST_MS = 20000;
const PACKET_STAGGER_MS = 2000;
const PACKET_INITIAL_BURST = 10;
const PACKET_PAIR_BURST = 2;
const TRACE_PACKET_REST_MS = 650;
const TRACE_PACKET_STAGGER_MS = 420;
const TRACE_PACKET_INITIAL_BURST = 16;
const TRACE_PACKET_PAIR_BURST = 8;
const TRACE_DIM_FACTOR = 0.4;
const TRACE_LINE_COLOR = "#ffffff";
const LARGE_GRAPH_NODE_COUNT = 1000;
const HUGE_GRAPH_NODE_COUNT = 2000;
const OVERLAY_UPDATE_MS = 16;
const FPS_FULL_EFFECT = 40;
const FPS_BALANCED_EFFECT = 30;
const FPS_RECOVERY_EFFECT = 20;
const FPS_SMOOTHING = 0.08;
const HIGHLIGHT_EASE = 0.14;
const HIGHLIGHT_IDLE_CUTOFF = 0.01;
const SCREEN_CULL_MARGIN = 0.18;
const HOVER_PICK_RADIUS_PX = 34;
const HOVER_GLOW_RADIUS_PX = 96;
const HOVER_GLOW_MAX_NODES = 24;
const IDLE_STRUCTURAL_TWINKLE_SLOT_COUNT = 5;
const IDLE_STRUCTURAL_TWINKLE_MIN_FADE_MS = 1000;
const IDLE_STRUCTURAL_TWINKLE_MAX_FADE_MS = 4000;
const HOVER_SPREAD_RADIUS = 190;
const HOVER_SPREAD_STRENGTH = 96;
const HOVER_SPREAD_EASE = 0.18;
const SELECTED_SPREAD_RADIUS = 230;
const SELECTED_SPREAD_STRENGTH = 74;
const IMPORT_DIRECTION_MARKER_LENGTH = 8;
const IMPORT_DIRECTION_MARKER_RADIUS = 3.2;
const IMPORT_DIRECTION_MARKER_MIN_COUNT = 2;
const IMPORT_DIRECTION_MARKER_MAX_COUNT = 8;
const IMPORT_DIRECTION_MARKER_TAIL_LENGTH = 34;
const IMPORT_DIRECTION_MARKER_LENGTH_PER_ARROW = 260;
const MIN_STATIC_STAR_COUNT = 100;
const MAX_STATIC_STAR_COUNT = 10000;
const SHOOTING_STAR_COUNT = 18;
const SHOOTING_STAR_MIN_DELAY_MS = 650;
const SHOOTING_STAR_MAX_DELAY_MS = 3600;
const FUN_GRAPH_LAYER = 0;
const FUN_VEHICLE_LAYER = 1;
const FUN_ROADSTER_GLB_URL = "/assets/fun/Roadster_Vehicle.glb";
const FUN_SKY_TEXTURE_URL = "/assets/fun/space-panorama.svg";
const FUN_MAX_FORWARD_SPEED = 0.48;
const FUN_MAX_REVERSE_SPEED = -0.32;
const FUN_SCROLL_SPEED_STEP = 0.00022;
const FUN_STEER_DEAD_ZONE = 0.14;
const FUN_BASE_TURN_RATE = 0.00024;
const FUN_EXTRA_TURN_RATE = 0.00125;
const FUN_STEER_EASE_MS = 135;
const FUN_SPEED_EASE_MS = 260;
const FUN_STOP_EASE_MS = 520;
const FUN_VISUAL_YAW_EASE_MS = 260;
const FUN_VISUAL_PITCH_EASE_MS = 260;
const FUN_VISUAL_ROLL_EASE_MS = 220;
const FUN_MAX_VISUAL_YAW = 0.4;
const FUN_MAX_VISUAL_PITCH = 0.4;
const FUN_VEHICLE_GLOW_FORWARD_CORE_OPACITY_BOOST = 0.0;
const FUN_VEHICLE_GLOW_FORWARD_OPACITY_BOOST = 0.0;
const FUN_VEHICLE_GLOW_FORWARD_LIGHT_BOOST = 20.0;
const FUN_TAIL_STREAK_MAX_OPACITY = 0.8;
const FUN_TAIL_STREAK_HALO_MAX_OPACITY = 0.6;
const FUN_TAIL_STREAK_CORE_LINEWIDTH = 2.0;
const FUN_TAIL_STREAK_HALO_LINEWIDTH = 20.0;
const FUN_TAIL_STREAK_POINT_COUNT = 20;
const FUN_TAIL_STREAK_SAMPLE_MIN_DISTANCE = 4;
const FUN_TAIL_STREAK_STRAIGHTEN_POINTS = 20;
const FUN_TAIL_STREAK_STRAIGHTEN_STRENGTH = 0.8;
const FUN_CAMERA_EASE_MS = 165;
const FUN_MAX_PITCH = THREE.MathUtils.degToRad(89);
const FUN_CAMERA_DISTANCE = 172;
const FUN_CAMERA_HEIGHT = 66;
const FUN_LOOK_AHEAD = 210;
const FUN_PROXIMITY_RADIUS = 155;
const FUN_HOVER_PROXIMITY_RADIUS = FUN_PROXIMITY_RADIUS * 5;
const FUN_BOUNDARY_BUFFER = 560;
const FUN_BOUNDARY_SLOW_RADIUS = 620;
const FUN_STARDUST_COUNT = 46;
const FUN_STARDUST_LENGTH = 260;
const PERFORMANCE_TIERS: Record<PerformanceTierName, PerformanceTier> = {
  full: { effectStrength: 1, backgroundFrameInterval: 1, neighborFrameInterval: 1, lodCheckMs: 300, overlayUpdateMs: OVERLAY_UPDATE_MS },
  balanced: { effectStrength: 0.75, backgroundFrameInterval: 1, neighborFrameInterval: 1, lodCheckMs: 400, overlayUpdateMs: 32 },
  recovery: { effectStrength: 0.45, backgroundFrameInterval: 2, neighborFrameInterval: 2, lodCheckMs: 600, overlayUpdateMs: 64 },
  emergency: { effectStrength: 0.2, backgroundFrameInterval: 4, neighborFrameInterval: 2, lodCheckMs: 800, overlayUpdateMs: 96 },
};
const NODE_LOD_TIERS: NodeLodTier[] = [
  { key: "full", minProjectedRadiusPx: 50, widthSegments: 30, heightSegments: 20, effectScale: 1 },
  { key: "near", minProjectedRadiusPx: 30, widthSegments: 24, heightSegments: 16, effectScale: 0.9 },
  { key: "mid", minProjectedRadiusPx: 16, widthSegments: 20, heightSegments: 14, effectScale: 0.65 },
  { key: "far", minProjectedRadiusPx: 7, widthSegments: 14, heightSegments: 9, effectScale: 0.35 },
  { key: "tiny", minProjectedRadiusPx: 0, widthSegments: 10, heightSegments: 7, effectScale: 0.1 },
];
const KIND_LABELS: Partial<Record<NodeKind, string>> = {
  service: "Service",
  api_endpoint: "API",
  websocket_endpoint: "WebSocket",
  api_client: "Client",
  component: "Component",
  hook: "Hook",
  page: "Page",
  layout: "Layout",
  form: "Form",
  function: "Function",
  method: "Method",
  constructor: "Constructor",
  class: "Class",
  schema: "Schema",
  pydantic_model: "Pydantic",
  dataclass: "Dataclass",
  typed_dict: "TypedDict",
  interface: "Interface",
  type_alias: "Type Alias",
  enum: "Enum",
  style_rule: "Style",
  table: "Table",
  migration: "Migration",
  file: "File",
};

const KIND_RANK: Partial<Record<NodeKind, number>> = {
  workspace: 0,
  service: 0,
  package: 1,
  module: 2,
  file: 3,
  config_file: 4,
  api_endpoint: 5,
  websocket_endpoint: 6,
  api_client: 7,
  component: 8,
  page: 9,
  layout: 10,
  form: 11,
  hook: 12,
  function: 13,
  method: 14,
  constructor: 15,
  schema: 16,
  pydantic_model: 17,
  dataclass: 18,
  typed_dict: 19,
  interface: 20,
  type_alias: 21,
  enum: 22,
  class: 23,
  table: 24,
  view: 25,
  migration: 26,
  style_rule: 27,
  style: 28,
};

const VISUAL_KIND_COLORS: Partial<Record<NodeKind, string>> = {
  service: "#ffd35a",
  file: "#fbfdff",
  config_file: "#b9fbc0",
  api_endpoint: "#ff4f78",
  websocket_endpoint: "#ff5bbd",
  api_client: "#ffb000",
  function: "#2f9dff",
  method: "#7cffb2",
  constructor: "#9af0d8",
  schema: "#ffd166",
  model: "#ffdf8a",
  dataclass: "#ffe08a",
  pydantic_model: "#ffd166",
  typed_dict: "#ffe9a8",
  class: "#c77dff",
  exception: "#f472b6",
  interface: "#68a8ff",
  type_alias: "#8bbcff",
  enum: "#a5b4fc",
  type: "#68a8ff",
  component: "#35d3ff",
  hook: "#7cff6b",
  context: "#45f0b5",
  provider: "#2dd4bf",
  page: "#93c5fd",
  layout: "#60a5fa",
  form: "#f9a8d4",
  store: "#facc15",
  reducer: "#fde047",
  style: "#ffe45c",
  style_rule: "#ffe45c",
  media_query: "#fef08a",
  keyframes: "#fbbf24",
  html_document: "#fca5a5",
  html_element: "#fb923c",
  table: "#10b981",
  view: "#6ee7b7",
  migration: "#a7f3d0",
};
const REACT_SERVICE_COLOR = "#35d3ff";
const LAYOUT_ZONE_DIRECTIONS: Record<string, [number, number, number]> = {
  core: [0, 0, 0.1],
  source: [0.2, 0.08, 0.12],
  config: [-0.5, 0.38, 0.62],
  api: [1, 0.04, 0.12],
  client: [0.88, 0.32, 0.22],
  logic: [0.08, -0.04, 0.06],
  contract: [0.58, -0.36, 0.02],
  data: [-0.1, -0.86, -0.38],
  ui: [-0.86, 0.42, 0.2],
  state: [-0.38, 0.3, 0.32],
  style: [-1, 0.32, -0.08],
  runtime: [0.24, -0.46, 0.18],
};
const LAYOUT_EDGE_FALLBACKS: Record<string, { weight: number; distance: number }> = {
  contains_file: { weight: 1, distance: 330 },
  contains: { weight: 0.9, distance: 96 },
  declares_api: { weight: 1, distance: 118 },
  handled_by: { weight: 1, distance: 82 },
  calls: { weight: 0.62, distance: 130 },
  imports: { weight: 0.46, distance: 190 },
  renders: { weight: 0.58, distance: 128 },
  uses_schema: { weight: 0.72, distance: 112 },
  uses_table: { weight: 0.72, distance: 142 },
  uses_style: { weight: 0.5, distance: 116 },
  calls_api: { weight: 0.9, distance: 460 },
  connects_service: { weight: 0.86, distance: 1180 },
};

interface GraphSceneProps {
  graph: CodeGraph;
  selectedId: string;
  activeKinds: Set<NodeKind>;
  perspectiveIds: Set<string>;
  activeTrace: TracePlan | null;
  funMode: boolean;
  showSelectedOverlays: boolean;
  showHoverOverlays: boolean;
  twinkleEnabled: boolean;
  glowIntensity: number;
  stardustCount: number;
  screenCullKinds: Set<NodeKind>;
  tinyNodeCullBelowPx: number;
  tinyNodeRestoreAbovePx: number;
  resetViewSignal: number;
  onZoomChange: (zoomLevel: number) => void;
  onFunSpeedChange: (speedLevel: number) => void;
  onFpsChange: (fps: number) => void;
  onSelect: (nodeId: string) => void;
  onDeselect: () => void;
}

interface SpaceNode {
  node: CodeNode;
  depth: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  opacity: number;
}

interface NodeLayoutHint {
  schema?: string;
  layer?: string;
  zone?: string;
  order?: number;
  weight?: number;
  parent_id?: string;
  service_key?: string;
  affinity_ids?: string[];
  edge_weights?: Record<string, number>;
}

interface EdgeLayoutHint {
  schema?: string;
  weight?: number;
  distance?: number;
  directional?: boolean;
  role?: string;
}

interface HoverState {
  node: CodeNode;
  x: number;
  y: number;
}

interface NeighborOverlay {
  id: string;
  node: CodeNode;
  x: number;
  y: number;
}

interface IdleStructuralTwinkleProfile {
  slot: number;
  fadeInMs: number;
  fadeOutMs: number;
  slotMs: number;
}

type GraphEdgeObject = THREE.Line | Line2;
interface ImportDirectionMarker {
  cone: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Sprite<THREE.SpriteMaterial>;
  tail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}
interface TailGlowStreak {
  core: Line2;
  halo: Line2;
  history: THREE.Vector3[];
  localEmitter: THREE.Vector3;
}

function nodeColor(node: CodeNode) {
  if (node.kind === "service" && node.metadata.majority_file_type === "react") {
    return REACT_SERVICE_COLOR;
  }
  return VISUAL_KIND_COLORS[node.kind] ?? node.color;
}

function isHeavyNode(node: CodeNode) {
  return ["workspace", "service", "package", "module", "file", "config_file", "api_endpoint", "websocket_endpoint", "api_client", "table", "view", "migration"].includes(node.kind);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nodeLayoutHint(node: CodeNode): NodeLayoutHint {
  return (objectRecord(node.metadata.layout) ?? {}) as NodeLayoutHint;
}

function edgeLayoutHint(edge: CodeEdge): EdgeLayoutHint {
  return (objectRecord(edge.metadata?.layout) ?? {}) as EdgeLayoutHint;
}

function layoutString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function layoutNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function serviceIndexForNode(node: CodeNode) {
  const metadataIndex = node.metadata.service_index;
  if (typeof metadataIndex === "number") {
    return metadataIndex;
  }
  return null;
}

function isPrimaryService(node: CodeNode) {
  return node.metadata.service_role === "main_repo";
}

function serviceKeyForNode(node: CodeNode) {
  const layoutServiceKey = layoutString(nodeLayoutHint(node).service_key);
  if (layoutServiceKey) {
    return layoutServiceKey;
  }
  if (node.kind === "service") {
    return node.file || node.label;
  }
  const firstPathPart = node.file.split("/")[0] ?? "";
  return firstPathPart || "__repo__";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnit(value: string) {
  return stableHash(value) / 4294967295;
}

function idleStructuralTwinkleProfile(nodeId: string, slot: number): IdleStructuralTwinkleProfile {
  const fadeRangeMs = IDLE_STRUCTURAL_TWINKLE_MAX_FADE_MS - IDLE_STRUCTURAL_TWINKLE_MIN_FADE_MS;
  const fadeInMs = Math.round(IDLE_STRUCTURAL_TWINKLE_MIN_FADE_MS + stableUnit(`idle-twinkle-fade-in:${nodeId}`) * fadeRangeMs);
  const fadeOutMs = Math.round(IDLE_STRUCTURAL_TWINKLE_MIN_FADE_MS + stableUnit(`idle-twinkle-fade-out:${nodeId}`) * fadeRangeMs);
  return {
    slot,
    fadeInMs,
    fadeOutMs,
    slotMs: fadeInMs + fadeOutMs,
  };
}

function idleStructuralTwinkleStrength(profile: IdleStructuralTwinkleProfile | undefined, now: number) {
  if (!profile) {
    return 0;
  }
  const cyclePosition = (now / profile.slotMs) % IDLE_STRUCTURAL_TWINKLE_SLOT_COUNT;
  const activeSlot = Math.floor(cyclePosition);
  if (profile.slot !== activeSlot) {
    return 0;
  }
  const slotElapsed = (cyclePosition - activeSlot) * profile.slotMs;
  if (slotElapsed <= profile.fadeInMs) {
    return clamp(slotElapsed / profile.fadeInMs, 0, 1);
  }
  return clamp(1 - (slotElapsed - profile.fadeInMs) / profile.fadeOutMs, 0, 1);
}

function buildDepths(selectedId: string, nodes: CodeNode[], edges: CodeEdge[], activeKinds: Set<NodeKind>, perspectiveIds: Set<string>) {
  const allowedIds = new Set(nodes.filter((node) => activeKinds.has(node.kind) && perspectiveIds.has(node.id)).map((node) => node.id));
  allowedIds.add(selectedId);
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!allowedIds.has(edge.source) || !allowedIds.has(edge.target)) {
      continue;
    }
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: selectedId, depth: 0 }];
  depths.set(selectedId, 0);
  while (queue.length) {
    const item = queue.shift();
    if (!item || item.depth >= MAX_DEPTH) {
      continue;
    }
    for (const nextId of adjacency.get(item.id) ?? []) {
      if (depths.has(nextId)) {
        continue;
      }
      depths.set(nextId, item.depth + 1);
      queue.push({ id: nextId, depth: item.depth + 1 });
    }
  }
  return depths;
}

function layoutDepth(node: CodeNode) {
  if (node.kind === "service") {
    return 0;
  }
  if (node.kind === "file" || node.kind === "config_file") {
    return 1;
  }
  if (node.kind === "api_endpoint" || node.kind === "websocket_endpoint" || node.kind === "api_client" || node.kind === "table") {
    return 1.35;
  }
  if (["schema", "model", "pydantic_model", "dataclass", "typed_dict", "interface", "type_alias", "enum", "type", "class", "view"].includes(node.kind)) {
    return 1.75;
  }
  return 2.2;
}

function nodeRadius(node: CodeNode, depth: number) {
  if (node.kind === "service") {
    return isPrimaryService(node) ? 30 : 23;
  }
  if (node.kind === "api_endpoint" || node.kind === "websocket_endpoint") {
    return 8.2;
  }
  if (node.kind === "file" || node.kind === "config_file") {
    return 12.3;
  }
  if (["schema", "model", "pydantic_model", "dataclass", "typed_dict", "class", "table", "view"].includes(node.kind)) {
    return 5.2;
  }
  return Math.max(3.6, 5.1 - depth * 0.38);
}

function baseOpacity(node: CodeNode, depth: number) {
  if (node.kind === "service") {
    return 1;
  }
  return Math.max(0.62, 0.88 - depth * 0.08);
}

function fallbackLayoutZone(node: CodeNode) {
  if (node.kind === "api_endpoint" || node.kind === "websocket_endpoint") return "api";
  if (node.kind === "api_client") return "client";
  if (["schema", "model", "pydantic_model", "dataclass", "typed_dict", "interface", "type_alias", "enum", "type"].includes(node.kind)) return "contract";
  if (["table", "view", "materialized_view", "migration", "stored_procedure", "sql_function", "trigger", "index", "constraint"].includes(node.kind)) return "data";
  if (["component", "page", "layout", "form", "html_document", "template", "html_element"].includes(node.kind)) return "ui";
  if (["hook", "context", "provider", "store", "reducer"].includes(node.kind)) return "state";
  if (["style", "style_rule", "media_query", "container_query", "supports_rule", "keyframes", "font_face", "css_layer", "css_at_rule"].includes(node.kind)) return "style";
  if (node.kind === "config_file") return "config";
  if (node.kind === "file") return "source";
  if (node.kind === "service") return "core";
  return "logic";
}

function layoutZone(node: CodeNode) {
  return layoutString(nodeLayoutHint(node).zone) ?? fallbackLayoutZone(node);
}

function layoutOrder(node: CodeNode, fallback: number) {
  return layoutNumber(nodeLayoutHint(node).order) ?? node.line_start ?? fallback;
}

function compareLayoutNodes(a: CodeNode, b: CodeNode) {
  const aOrder = layoutOrder(a, 0);
  const bOrder = layoutOrder(b, 0);
  return (KIND_RANK[a.kind] ?? 99) - (KIND_RANK[b.kind] ?? 99)
    || a.file.localeCompare(b.file)
    || aOrder - bOrder
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id);
}

function sphericalOffset(seed: string, radius: number, stretchX: number, stretchY: number, stretchZ: number) {
  const theta = stableUnit(`${seed}:theta`) * Math.PI * 2;
  const zUnit = stableUnit(`${seed}:z`) * 2 - 1;
  const planar = Math.sqrt(Math.max(0, 1 - zUnit * zUnit));
  return new THREE.Vector3(
    Math.cos(theta) * planar * radius * stretchX,
    Math.sin(theta) * planar * radius * stretchY,
    zUnit * radius * stretchZ,
  );
}

function layoutDirection(node: CodeNode) {
  const directionTuple = LAYOUT_ZONE_DIRECTIONS[layoutZone(node)] ?? LAYOUT_ZONE_DIRECTIONS.logic;
  const direction = new THREE.Vector3(directionTuple[0], directionTuple[1], directionTuple[2]);
  if (direction.lengthSq() < 0.001) {
    direction.set(1, 0, 0);
  }
  return direction.normalize();
}

function orthogonalBasis(direction: THREE.Vector3) {
  const reference = Math.abs(direction.z) < 0.82 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(direction, reference);
  if (tangent.lengthSq() < 0.001) {
    tangent.set(1, 0, 0);
  }
  tangent.normalize();
  const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
  return { tangent, bitangent };
}

function layoutOffset(seed: string, node: CodeNode, parent: CodeNode | null | undefined, radius: number, index: number) {
  const zoneDirection = layoutDirection(node);
  const scatter = sphericalOffset(`${seed}:scatter`, radius, 1.08, 0.98, 1.04);
  const direction = scatter.clone().normalize();
  const { tangent, bitangent } = orthogonalBasis(direction);
  const order = layoutOrder(node, index);
  const shell = Math.floor(index / (parent?.kind === "service" ? 18 : 12));
  const angle = (order * 1.618 + stableUnit(`${seed}:angle`) * Math.PI * 2) % (Math.PI * 2);
  const spread = Math.min(radius * 0.34, 24 + shell * 14 + stableUnit(`${seed}:spread`) * 16);
  const lift = (stableUnit(`${seed}:lift`) - 0.5) * Math.min(38, radius * 0.18);
  const zoneBias = zoneDirection.multiplyScalar(Math.min(radius * 0.16, parent?.kind === "file" ? 24 : 58));
  return scatter
    .add(zoneBias)
    .add(tangent.multiplyScalar(Math.cos(angle) * spread))
    .add(bitangent.multiplyScalar(Math.sin(angle) * spread + lift));
}

function buildParentMap(nodes: CodeNode[], edges: CodeEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentCandidates = new Map<string, { parentId: string; rank: number }>();
  for (const node of nodes) {
    const layoutParentId = layoutString(nodeLayoutHint(node).parent_id);
    if (layoutParentId && nodesById.has(layoutParentId) && layoutParentId !== node.id) {
      parentCandidates.set(node.id, { parentId: layoutParentId, rank: 0 });
      continue;
    }
    const parentId = typeof node.metadata.parent_id === "string" ? node.metadata.parent_id : null;
    if (parentId && nodesById.has(parentId) && parentId !== node.id) {
      parentCandidates.set(node.id, { parentId, rank: node.kind === "api_endpoint" ? 3 : 2 });
    }
  }
  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    let childId: string | null = null;
    let parentId: string | null = null;
    let rank: number | null = null;
    if (edge.kind === "contains_file" && source.kind === "service" && target.kind === "file") {
      childId = target.id;
      parentId = source.id;
      rank = 0;
    } else if (edge.kind === "declares_api" && source.kind === "file" && target.kind === "api_endpoint") {
      childId = target.id;
      parentId = source.id;
      rank = 0;
    } else if (edge.kind === "contains") {
      childId = target.id;
      parentId = source.id;
      rank = target.kind === "api_endpoint" ? 3 : 2;
    } else if (edge.kind === "handled_by" && source.kind === "api_endpoint") {
      childId = target.id;
      parentId = source.id;
      rank = 1;
    }
    if (rank === null || !childId || !parentId || childId === parentId) {
      continue;
    }
    const existing = parentCandidates.get(childId);
    if (!existing || rank < existing.rank) {
      parentCandidates.set(childId, { parentId, rank });
    }
  }
  return new Map([...parentCandidates.entries()].map(([childId, item]) => [childId, item.parentId]));
}

function childClusterRadius(node: CodeNode, index: number) {
  const zone = layoutZone(node);
  const weight = layoutNumber(nodeLayoutHint(node).weight) ?? 1;
  const weightedBump = Math.min(48, Math.max(0, weight - 2) * 8);
  if (node.kind === "file") {
    return 300 + weightedBump + Math.floor(index / 18) * 96 + stableUnit(`file-radius:${node.id}`) * 70;
  }
  if (zone === "api" || zone === "client") {
    return 112 + weightedBump + Math.floor(index / 12) * 34 + stableUnit(`api-radius:${node.id}`) * 26;
  }
  if (zone === "contract") {
    return 86 + weightedBump + Math.floor(index / 14) * 30 + stableUnit(`schema-radius:${node.id}`) * 22;
  }
  if (zone === "data") {
    return 112 + weightedBump + Math.floor(index / 12) * 34 + stableUnit(`data-radius:${node.id}`) * 24;
  }
  if (zone === "ui" || zone === "state" || zone === "style") {
    return 92 + weightedBump + Math.floor(index / 14) * 30 + stableUnit(`ui-radius:${node.id}`) * 22;
  }
  return 66 + weightedBump + Math.floor(index / 16) * 28 + stableUnit(`symbol-radius:${node.id}`) * 20;
}

function layoutEdgeWeight(edge: CodeEdge) {
  return layoutNumber(edgeLayoutHint(edge).weight) ?? LAYOUT_EDGE_FALLBACKS[edge.kind]?.weight ?? 0.32;
}

function layoutEdgeDistance(edge: CodeEdge) {
  return layoutNumber(edgeLayoutHint(edge).distance) ?? LAYOUT_EDGE_FALLBACKS[edge.kind]?.distance ?? 180;
}

function layoutMobility(node: CodeNode) {
  if (node.kind === "service") return 0;
  if (node.kind === "file" || node.kind === "config_file") return 0.28;
  if (node.kind === "api_endpoint" || node.kind === "websocket_endpoint" || node.kind === "api_client") return 0.68;
  return 1;
}

function layoutPairKey(leftId: string, rightId: string) {
  return leftId < rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`;
}

function layoutCollisionRadius(node: CodeNode) {
  const visualRadius = nodeRadius(node, layoutDepth(node));
  if (node.kind === "service") return 96;
  if (node.kind === "file" || node.kind === "config_file") return 44;
  if (node.kind === "api_endpoint" || node.kind === "websocket_endpoint" || node.kind === "api_client") return 28;
  if (layoutZone(node) === "data" || layoutZone(node) === "contract") return 22;
  return Math.max(18, visualRadius * 3.4);
}

function dynamicParentLeash(node: CodeNode, parent: CodeNode, siblingCount: number, initialDistance: number) {
  const weight = layoutNumber(nodeLayoutHint(node).weight) ?? 1;
  const weightExpansion = Math.max(0, weight - 2) * 18;
  if (parent.kind === "service") {
    return Math.max(initialDistance + 160 + weightExpansion, 420 + Math.cbrt(Math.max(siblingCount, 1)) * 142 + Math.sqrt(Math.max(siblingCount - 18, 0)) * 22);
  }
  if (parent.kind === "file" || parent.kind === "config_file") {
    return Math.max(initialDistance + 86 + weightExpansion, 150 + Math.cbrt(Math.max(siblingCount, 1)) * 62 + Math.sqrt(Math.max(siblingCount - 12, 0)) * 13);
  }
  return Math.max(initialDistance + 64 + weightExpansion, 92 + Math.cbrt(Math.max(siblingCount, 1)) * 38 + Math.sqrt(Math.max(siblingCount - 8, 0)) * 10);
}

function layoutBucketKey(x: number, y: number, z: number) {
  return `${x}:${y}:${z}`;
}

function layoutFallbackDirection(seed: string) {
  const direction = sphericalOffset(seed, 1, 1, 1, 1);
  if (direction.lengthSq() < 0.001) {
    direction.set(1, 0, 0);
  }
  return direction.normalize();
}

function relaxLayoutPositions(nodes: CodeNode[], edges: CodeEdge[], positionsById: Map<string, THREE.Vector3>, parentMap: Map<string, string>, childrenByParent: Map<string, CodeNode[]>) {
  const hasLayoutHints = nodes.some((node) => nodeLayoutHint(node).schema === "cartographer_layout_v1");
  if (!hasLayoutHints) {
    return;
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const originalPositions = new Map([...positionsById.entries()].map(([id, position]) => [id, position.clone()]));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const directEdgeKeys = new Set<string>();
  const layoutEdges = edges.filter((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) {
      return false;
    }
    directEdgeKeys.add(layoutPairKey(edge.source, edge.target));
    return layoutEdgeWeight(edge) > 0.28;
  });
  const collisionRadii = new Map(nodes.map((node) => [node.id, layoutCollisionRadius(node)]));
  const bucketSize = 220;
  for (let pass = 0; pass < 24; pass += 1) {
    for (const node of nodes) {
      const position = positionsById.get(node.id);
      const original = originalPositions.get(node.id);
      const mobility = layoutMobility(node);
      if (position && original && mobility > 0) {
        position.lerp(original, 0.018 * mobility);
      }
    }
    for (const edge of layoutEdges) {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      const sourcePosition = positionsById.get(edge.source);
      const targetPosition = positionsById.get(edge.target);
      if (!sourceNode || !targetNode || !sourcePosition || !targetPosition) {
        continue;
      }
      const delta = targetPosition.clone().sub(sourcePosition);
      const length = delta.length();
      if (length < 0.001) {
        continue;
      }
      const desired = layoutEdgeDistance(edge);
      const weight = layoutEdgeWeight(edge);
      const strength = Math.min(0.038, 0.006 + weight * 0.018);
      const shift = clamp((length - desired) * strength, -28, 28);
      const sourceMobility = layoutMobility(sourceNode);
      const targetMobility = layoutMobility(targetNode);
      const totalMobility = sourceMobility + targetMobility;
      if (totalMobility <= 0) {
        continue;
      }
      const direction = delta.normalize();
      if (sourceMobility > 0) {
        sourcePosition.add(direction.clone().multiplyScalar(shift * sourceMobility / totalMobility));
      }
      if (targetMobility > 0) {
        targetPosition.add(direction.clone().multiplyScalar(-shift * targetMobility / totalMobility));
      }
    }
    const buckets = new Map<string, CodeNode[]>();
    for (const node of nodes) {
      const position = positionsById.get(node.id);
      if (!position) {
        continue;
      }
      const bucketX = Math.floor(position.x / bucketSize);
      const bucketY = Math.floor(position.y / bucketSize);
      const bucketZ = Math.floor(position.z / bucketSize);
      const key = layoutBucketKey(bucketX, bucketY, bucketZ);
      buckets.set(key, [...(buckets.get(key) ?? []), node]);
    }
    const processedPairs = new Set<string>();
    for (const node of nodes) {
      const position = positionsById.get(node.id);
      if (!position) {
        continue;
      }
      const bucketX = Math.floor(position.x / bucketSize);
      const bucketY = Math.floor(position.y / bucketSize);
      const bucketZ = Math.floor(position.z / bucketSize);
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
            for (const otherNode of buckets.get(layoutBucketKey(bucketX + xOffset, bucketY + yOffset, bucketZ + zOffset)) ?? []) {
              if (node.id === otherNode.id) {
                continue;
              }
              const pairKey = layoutPairKey(node.id, otherNode.id);
              if (processedPairs.has(pairKey)) {
                continue;
              }
              processedPairs.add(pairKey);
              const otherPosition = positionsById.get(otherNode.id);
              if (!otherPosition) {
                continue;
              }
              const sourceMobility = layoutMobility(node);
              const targetMobility = layoutMobility(otherNode);
              const totalMobility = sourceMobility + targetMobility;
              if (totalMobility <= 0) {
                continue;
              }
              const sameParent = parentMap.get(node.id) !== undefined && parentMap.get(node.id) === parentMap.get(otherNode.id);
              const directlyRelated = directEdgeKeys.has(pairKey);
              const delta = otherPosition.clone().sub(position);
              let length = delta.length();
              const direction = length > 0.001 ? delta.multiplyScalar(1 / length) : layoutFallbackDirection(`collision:${pairKey}`);
              if (length <= 0.001) {
                length = 0.001;
              }
              let minDistance = (collisionRadii.get(node.id) ?? 18) + (collisionRadii.get(otherNode.id) ?? 18);
              let softDistance = minDistance;
              let strength = 0.42;
              if (sameParent && !directlyRelated) {
                minDistance *= 1.38;
                softDistance = minDistance * 1.72;
                strength = 0.56;
              }
              if (length >= softDistance) {
                continue;
              }
              const force = Math.min(32, (softDistance - length) * (length < minDistance ? strength : 0.11));
              if (sourceMobility > 0) {
                position.add(direction.clone().multiplyScalar(-force * sourceMobility / totalMobility));
              }
              if (targetMobility > 0) {
                otherPosition.add(direction.clone().multiplyScalar(force * targetMobility / totalMobility));
              }
            }
          }
        }
      }
    }
    for (const node of nodes) {
      const parentId = parentMap.get(node.id);
      const parentNode = parentId ? nodesById.get(parentId) : null;
      const position = positionsById.get(node.id);
      const parentPosition = parentId ? positionsById.get(parentId) : null;
      if (!parentId || !parentNode || !position || !parentPosition || layoutMobility(node) <= 0) {
        continue;
      }
      const original = originalPositions.get(node.id);
      const originalParent = originalPositions.get(parentId) ?? parentPosition;
      const initialDistance = original ? original.distanceTo(originalParent) : position.distanceTo(parentPosition);
      const siblingCount = childrenByParent.get(parentId)?.length ?? 1;
      const leash = dynamicParentLeash(node, parentNode, siblingCount, initialDistance);
      const offset = position.clone().sub(parentPosition);
      const distance = offset.length();
      const direction = distance > 0.001 ? offset.multiplyScalar(1 / distance) : layoutFallbackDirection(`leash:${parentId}:${node.id}`);
      const innerDistance = Math.max(layoutCollisionRadius(parentNode) + layoutCollisionRadius(node) * 0.72, parentNode.kind === "service" ? 136 : 54);
      if (distance > leash) {
        position.copy(parentPosition).add(direction.multiplyScalar(leash));
      } else if (distance < innerDistance) {
        position.copy(parentPosition).add(direction.multiplyScalar(innerDistance));
      }
    }
  }
}

function serviceLayoutScale(totalNodeCount: number, serviceNodeCount: number) {
  if (totalNodeCount >= 3500 || serviceNodeCount >= 18) return 3;
  if (totalNodeCount >= 2000 || serviceNodeCount >= 12) return 2;
  if (totalNodeCount >= 1000 || serviceNodeCount >= 8) return 1.5;
  return 1;
}

function buildServiceAnchors(nodes: CodeNode[]) {
  const anchors = new Map<string, THREE.Vector3>();
  const serviceNodes = nodes
    .filter((node) => node.kind === "service")
    .sort((a, b) => (serviceIndexForNode(a) ?? 999) - (serviceIndexForNode(b) ?? 999) || a.label.localeCompare(b.label));
  const nonRootServices = serviceNodes.filter((node) => !isPrimaryService(node));
  const layoutScale = serviceLayoutScale(nodes.length, serviceNodes.length);
  for (const node of serviceNodes) {
    if (isPrimaryService(node)) {
      anchors.set(serviceKeyForNode(node), new THREE.Vector3(0, 0, 80));
      continue;
    }
    const ringIndex = nonRootServices.findIndex((item) => item.id === node.id);
    const angle = (Math.PI * 2 * Math.max(ringIndex, 0)) / Math.max(nonRootServices.length, 1) - Math.PI * 0.16;
    const arm = ringIndex % 4;
    const radius = (900 + arm * 170) * layoutScale;
    const z = Math.sin(angle * 1.65) * 430 + (arm - 1.5) * 145 - 160;
    anchors.set(serviceKeyForNode(node), new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, z));
  }
  if (!anchors.size) {
    anchors.set("__repo__", new THREE.Vector3(0, 0, 80));
  }
  return anchors;
}

function makeSpaceNodes(graph: CodeGraph, activeKinds: Set<NodeKind>, perspectiveIds: Set<string>): SpaceNode[] {
  const nodes = graph.nodes
    .filter((node) => activeKinds.has(node.kind) && perspectiveIds.has(node.id))
    .sort(compareLayoutNodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const serviceAnchors = buildServiceAnchors(nodes);
  const parentMap = buildParentMap(nodes, graph.edges);
  const childrenByParent = new Map<string, CodeNode[]>();
  for (const node of nodes) {
    const key = serviceKeyForNode(node);
    if (!serviceAnchors.has(key)) {
      const fallbackAngle = stableUnit(key) * Math.PI * 2;
      serviceAnchors.set(key, new THREE.Vector3(Math.cos(fallbackAngle) * 760, Math.sin(fallbackAngle) * 520, Math.sin(fallbackAngle * 1.4) * 360 - 220));
    }
    const parentId = parentMap.get(node.id);
    if (parentId && nodesById.has(parentId)) {
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node]);
    }
  }
  const siblingIndex = new Map<string, number>();
  for (const children of childrenByParent.values()) {
    children.sort(compareLayoutNodes).forEach((node, index) => siblingIndex.set(node.id, index));
  }
  const positionsById = new Map<string, THREE.Vector3>();
  const spaceById = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const depth = layoutDepth(node);
    if (node.kind === "service") {
      const anchor = serviceAnchors.get(serviceKeyForNode(node)) ?? new THREE.Vector3(0, 0, 0);
      positionsById.set(node.id, anchor.clone());
      spaceById.set(node.id, {
        node,
        depth,
        x: anchor.x,
        y: anchor.y,
        z: anchor.z,
        radius: nodeRadius(node, depth),
        opacity: 1,
      });
    }
  }
  const remaining = nodes.filter((node) => node.kind !== "service");
  for (let pass = 0; pass < 5; pass += 1) {
    for (const node of remaining) {
      if (spaceById.has(node.id)) {
        continue;
      }
      const parentId = parentMap.get(node.id);
      const parentPosition = parentId ? positionsById.get(parentId) : null;
      if (parentId && !parentPosition && pass < 4) {
        continue;
      }
      const serviceAnchor = serviceAnchors.get(serviceKeyForNode(node)) ?? serviceAnchors.get("__repo__") ?? new THREE.Vector3(0, 0, 0);
      const basePosition = parentPosition ?? serviceAnchor;
      const parent = parentId ? nodesById.get(parentId) : null;
      const index = siblingIndex.get(node.id) ?? Math.floor(stableUnit(`fallback-index:${node.id}`) * 36);
      const radius = childClusterRadius(node, index);
      const stretchX = parent?.kind === "service" ? 1.28 : parent?.kind === "file" ? 1.05 : 0.94;
      const stretchY = parent?.kind === "service" ? 1.04 : parent?.kind === "file" ? 0.98 : 0.9;
      const stretchZ = parent?.kind === "service" ? 1.2 : parent?.kind === "file" ? 1.02 : 0.88;
      const seed = `cluster:${parentId ?? serviceKeyForNode(node)}:${node.id}`;
      const offset = nodeLayoutHint(node).schema === "cartographer_layout_v1"
        ? layoutOffset(seed, node, parent, radius, index)
        : sphericalOffset(seed, radius, stretchX, stretchY, stretchZ);
      const depth = layoutDepth(node);
      const position = basePosition.clone().add(offset);
      positionsById.set(node.id, position);
      spaceById.set(node.id, {
        node,
        depth,
        x: position.x,
        y: position.y,
        z: position.z,
        radius: nodeRadius(node, depth),
        opacity: baseOpacity(node, depth),
      });
    }
  }
  for (const node of nodes) {
    if (spaceById.has(node.id)) {
      continue;
    }
    const anchor = serviceAnchors.get(serviceKeyForNode(node)) ?? new THREE.Vector3(0, 0, 0);
    const depth = layoutDepth(node);
    const index = Math.floor(stableUnit(`orphan-index:${node.id}`) * 36);
    const radius = childClusterRadius(node, index);
    const seed = `orphan:${serviceKeyForNode(node)}:${node.id}`;
    const offset = nodeLayoutHint(node).schema === "cartographer_layout_v1"
      ? layoutOffset(seed, node, null, radius, index)
      : sphericalOffset(seed, radius, 1.2, 0.9, 1.2);
    const position = anchor.clone().add(offset);
    positionsById.set(node.id, position);
    spaceById.set(node.id, {
      node,
      depth,
      x: position.x,
      y: position.y,
      z: position.z,
      radius: nodeRadius(node, depth),
      opacity: baseOpacity(node, depth),
    });
  }
  relaxLayoutPositions(nodes, graph.edges, positionsById, parentMap, childrenByParent);
  return nodes.map((node) => {
    const existing = spaceById.get(node.id);
    const position = positionsById.get(node.id);
    if (existing && position) {
      return { ...existing, x: position.x, y: position.y, z: position.z };
    }
    const depth = layoutDepth(node);
    return { node, depth, x: 0, y: 0, z: 0, radius: nodeRadius(node, depth), opacity: baseOpacity(node, depth) };
  });
}

function makeStarfieldGeometry(starCount: number) {
  const safeStarCount = Math.round(clamp(starCount, MIN_STATIC_STAR_COUNT, MAX_STATIC_STAR_COUNT));
  const positions = new Float32Array(safeStarCount * 3);
  for (let index = 0; index < safeStarCount; index += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const radius = 900 + Math.random() * 7200;
    positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius * 0.74;
    positions[index * 3 + 2] = Math.cos(phi) * radius - 980;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function makeStarfield(starCount: number) {
  const geometry = makeStarfieldGeometry(starCount);
  const material = new THREE.PointsMaterial({
    color: "#ffffff",
    opacity: 0.92,
    size: 4.8,
    sizeAttenuation: true,
    transparent: true,
  });
  return new THREE.Points(geometry, material);
}

function resetShootingStar(line: THREE.Line, now: number, index: number) {
  line.userData.active = false;
  line.userData.nextLaunchAt = now + SHOOTING_STAR_MIN_DELAY_MS + Math.random() * SHOOTING_STAR_MAX_DELAY_MS + index * 110;
  (line.material as THREE.LineBasicMaterial).opacity = 0;
}

function launchShootingStar(line: THREE.Line, now: number) {
  const side = Math.floor(Math.random() * 4);
  const spanX = 2400 + Math.random() * 4200;
  const spanY = 1500 + Math.random() * 2600;
  const start = new THREE.Vector3(
    side === 0 ? -spanX : side === 1 ? spanX : (Math.random() - 0.5) * spanX * 2,
    side === 2 ? spanY : side === 3 ? -spanY : (Math.random() - 0.5) * spanY * 2,
    Math.random() * 6200 - 2800,
  );
  const direction = new THREE.Vector3(
    side === 0 ? 1 : side === 1 ? -1 : (Math.random() - 0.5) * 0.82,
    side === 2 ? -1 : side === 3 ? 1 : (Math.random() - 0.5) * 0.62,
    (Math.random() - 0.5) * 0.28,
  ).normalize();
  line.userData.active = true;
  line.userData.startedAt = now;
  line.userData.duration = 850 + Math.random() * 1150;
  line.userData.speed = 1.5 + Math.random() * 2.1;
  line.userData.length = 320 + Math.random() * 560;
  line.userData.maxOpacity = 0.24 + Math.random() * 0.34;
  line.userData.start = start;
  line.userData.direction = direction;
  (line.material as THREE.LineBasicMaterial).color.set(Math.random() > 0.32 ? "#ffffff" : "#bfe7ff");
}

function makeShootingStars() {
  const group = new THREE.Group();
  const stars: THREE.Line[] = [];
  const now = performance.now();
  for (let index = 0; index < SHOOTING_STAR_COUNT; index += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ffffff",
      depthWrite: false,
      opacity: 0,
      transparent: true,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    resetShootingStar(line, now, index);
    stars.push(line);
    group.add(line);
  }
  return { group, stars };
}

function updateShootingStars(stars: THREE.Line[], now: number) {
  for (let index = 0; index < stars.length; index += 1) {
    const line = stars[index];
    const material = line.material as THREE.LineBasicMaterial;
    if (!line.userData.active) {
      if (now >= (line.userData.nextLaunchAt as number)) {
        launchShootingStar(line, now);
      } else {
        material.opacity += (0 - material.opacity) * 0.18;
        continue;
      }
    }
    const elapsed = now - (line.userData.startedAt as number);
    const duration = line.userData.duration as number;
    if (elapsed >= duration) {
      resetShootingStar(line, now, index);
      continue;
    }
    const direction = line.userData.direction as THREE.Vector3;
    const head = (line.userData.start as THREE.Vector3).clone().add(direction.clone().multiplyScalar((line.userData.speed as number) * elapsed));
    const tail = head.clone().sub(direction.clone().multiplyScalar(line.userData.length as number));
    const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    positions.setXYZ(0, tail.x, tail.y, tail.z);
    positions.setXYZ(1, head.x, head.y, head.z);
    positions.needsUpdate = true;
    material.opacity = Math.sin((elapsed / duration) * Math.PI) * (line.userData.maxOpacity as number);
  }
}

function makeFunSkySphere() {
  const texture = new THREE.TextureLoader().load(FUN_SKY_TEXTURE_URL);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(9600, 64, 32),
    new THREE.MeshBasicMaterial({
      depthWrite: false,
      map: texture,
      opacity: 0.62,
      side: THREE.BackSide,
      transparent: true,
    }),
  );
  sphere.renderOrder = -10;
  return sphere;
}

function addBox(group: THREE.Group, material: THREE.Material, size: [number, number, number], position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  group.add(mesh);
  return mesh;
}

function addEllipsoid(group: THREE.Group, material: THREE.Material, scale: [number, number, number], position: [number, number, number], widthSegments = 18, heightSegments = 8) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, widthSegments, heightSegments), material);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.position.set(position[0], position[1], position[2]);
  group.add(mesh);
  return mesh;
}

function addCylinderBetween(group: THREE.Group, material: THREE.Material, start: THREE.Vector3, end: THREE.Vector3, radius: number, radialSegments = 8) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  group.add(mesh);
  return mesh;
}

function makeRoadsterHull(material: THREE.Material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -27, -7, -45, 27, -7, -45, 27, -7, 47, -27, -7, 47,
    -20, 7, -39, 20, 7, -39, 22, 6, 43, -22, 6, 43,
  ]), 3));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ]);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makeRearBadge() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "900 24px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 4;
    context.strokeStyle = "rgba(0, 0, 0, 0.88)";
    context.strokeText("T  E  S  L  A", canvas.width / 2, canvas.height / 2);
    context.fillStyle = "rgba(255, 255, 255, 0.98)";
    context.fillText("T  E  S  L  A", canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 8),
    new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  badge.position.set(0, 11.2, 58.2);
  badge.renderOrder = 8;
  return badge;
}

function makeRearPlate() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    const radius = 18;
    context.roundRect(0, 0, canvas.width, canvas.height, radius);
    context.fillStyle = "rgba(1, 2, 5, 0.98)";
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.3)";
    context.lineWidth = 5;
    context.stroke();
    context.font = "900 34px Arial, sans-serif";
    context.fillStyle = "rgba(255, 255, 255, 0.96)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("ROADSTER", canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(11.75, 4),
    new THREE.MeshBasicMaterial({
      depthTest: true,
      depthWrite: false,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
}

function makeRoadsterTrail() {
  const group = new THREE.Group();
  const offsets = [-7, 0, 7];
  for (const x of offsets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      x, -4, 58,
      x * 0.2, -6, 122,
    ]), 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: "#d8fbff",
        depthWrite: false,
        opacity: x === 0 ? 0.46 : 0.28,
        transparent: true,
      }),
    );
    group.add(line);
  }
  return group;
}

function makeTailLightTrails() {
  const group = new THREE.Group();
  for (const x of [-15, 15]) {
    for (const offset of [-2.2, 2.2]) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        x + offset, 8.8, 58,
        x * 0.62, 7.2, 132,
      ]), 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: "#ff8aa0",
          depthWrite: false,
          opacity: 0,
          transparent: true,
        }),
      );
      group.add(line);
    }
  }
  return group;
}

function makeTailGlowStreaks() {
  const group = new THREE.Group();
  const streaks: TailGlowStreak[] = [];
  const emptyPositions = Array.from({ length: FUN_TAIL_STREAK_POINT_COUNT * 3 }, () => 0);
  for (const x of [-21, -17, -13, 13, 17, 21]) {
    const haloGeometry = new LineGeometry();
    const coreGeometry = new LineGeometry();
    haloGeometry.setPositions(emptyPositions);
    coreGeometry.setPositions(emptyPositions);
    const halo = new Line2(haloGeometry, new LineMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ff4058",
      depthWrite: false,
      linewidth: FUN_TAIL_STREAK_HALO_LINEWIDTH,
      opacity: 0,
      resolution: new THREE.Vector2(1, 1),
      transparent: true,
    }));
    const core = new Line2(coreGeometry, new LineMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ff8ba0",
      depthWrite: false,
      linewidth: FUN_TAIL_STREAK_CORE_LINEWIDTH,
      opacity: 0,
      resolution: new THREE.Vector2(1, 1),
      transparent: true,
    }));
    halo.userData.isTailGlowStreak = true;
    core.userData.isTailGlowStreak = true;
    group.add(halo);
    group.add(core);
    streaks.push({
      core,
      halo,
      history: [],
      localEmitter: new THREE.Vector3(x, -1.4 + (stableUnit(`tail-glow-streak-y:${x}`) - 0.5) * 3.8, 59.5),
    });
  }
  group.userData.streaks = streaks;
  return group;
}

function makeRoadsterStardust() {
  const group = new THREE.Group();
  const texture = makeGlowTexture();
  for (let index = 0; index < FUN_STARDUST_COUNT; index += 1) {
    const material = new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: stableUnit(`fun-stardust-color:${index}`) > 0.62 ? "#ffd35a" : "#d8fbff",
      depthWrite: false,
      map: texture,
      opacity: 0,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(
      (stableUnit(`fun-stardust-x:${index}`) - 0.5) * 74,
      -10 + stableUnit(`fun-stardust-y:${index}`) * 30,
      68 + stableUnit(`fun-stardust-z:${index}`) * FUN_STARDUST_LENGTH,
    );
    sprite.userData.baseScale = 7 + stableUnit(`fun-stardust-scale:${index}`) * 18;
    sprite.userData.phase = stableUnit(`fun-stardust-phase:${index}`) * Math.PI * 2;
    group.add(sprite);
  }
  return group;
}

function makeSpacesuitDriver() {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.18, metalness: 0.12, roughness: 0.36 });
  const helmet = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.22, metalness: 0.12, roughness: 0.18 });
  const visor = new THREE.MeshStandardMaterial({ color: "#151d28", emissive: "#23455e", emissiveIntensity: 0.42, metalness: 0.18, roughness: 0.08 });
  addEllipsoid(group, suit, [3.8, 5.8, 3], [0, 8, 3], 12, 6);
  addEllipsoid(group, helmet, [4.1, 4.1, 3.7], [0, 15, 1], 16, 8);
  const helmetVisor = addBox(group, visor, [6.2, 2.1, 0.8], [0, 15.2, -2.4]);
  helmetVisor.rotation.x = -0.14;
  for (const x of [-4.7, 4.7]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 8.4, 10), suit);
    arm.rotation.z = Math.PI / 2.7 * Math.sign(x);
    arm.rotation.x = 0.52;
    arm.position.set(x, 8.8, -1.5);
    group.add(arm);
  }
  for (const x of [-2.2, 2.2]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 8.2, 10), suit);
    leg.rotation.x = Math.PI / 2.25;
    leg.position.set(x, 3.4, 7);
    group.add(leg);
  }
  group.position.set(-5, 1, 5);
  return group;
}

function addRoadsterWheel(group: THREE.Group, tire: THREE.Material, rim: THREE.Material, position: [number, number, number], side: number) {
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 8.8, 6.4, 28), tire);
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(position[0], position[1], position[2]);
  group.add(wheel);

  const rimFaceX = position[0] + side * 3.45;
  const outerRim = new THREE.Mesh(new THREE.TorusGeometry(5.8, 0.55, 8, 32), rim);
  outerRim.rotation.y = Math.PI / 2;
  outerRim.position.set(rimFaceX, position[1], position[2]);
  group.add(outerRim);

  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.32, 8, 28), rim);
  innerRim.rotation.y = Math.PI / 2;
  innerRim.position.set(rimFaceX + side * 0.05, position[1], position[2]);
  group.add(innerRim);

  for (let index = 0; index < 7; index += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1, 7.8), rim);
    spoke.position.set(rimFaceX + side * 0.1, position[1], position[2]);
    spoke.rotation.x = index * Math.PI / 7;
    group.add(spoke);
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.9, 18), rim);
  hub.rotation.z = Math.PI / 2;
  hub.position.set(rimFaceX + side * 0.2, position[1], position[2]);
  group.add(hub);
}

function makeRoadsterVehicleFallback() {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: "#f13a36", emissive: "#b70c1c", emissiveIntensity: 0.68, metalness: 0.76, roughness: 0.16 });
  const redDark = new THREE.MeshStandardMaterial({ color: "#8e241f", emissive: "#5f1112", emissiveIntensity: 0.48, metalness: 0.72, roughness: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: "#11131d", emissive: "#0e243d", emissiveIntensity: 0.46, metalness: 0.5, roughness: 0.24 });
  const glass = new THREE.MeshStandardMaterial({ color: "#9ff4ff", emissive: "#24c6ef", emissiveIntensity: 0.56, metalness: 0.18, opacity: 0.5, roughness: 0.08, transparent: true });
  const tire = new THREE.MeshStandardMaterial({ color: "#020204", metalness: 0.34, roughness: 0.4 });
  const rim = new THREE.MeshStandardMaterial({ color: "#cfd2c5", emissive: "#ffffff", emissiveIntensity: 0.18, metalness: 0.86, roughness: 0.16 });
  const silver = new THREE.MeshStandardMaterial({ color: "#c7c8bc", emissive: "#ffffff", emissiveIntensity: 0.12, metalness: 0.72, roughness: 0.22 });
  const light = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const tailLight = new THREE.MeshBasicMaterial({ color: "#ff344d" });
  const tailClear = new THREE.MeshBasicMaterial({ color: "#dfe8ef" });
  const tailHousing = new THREE.MeshBasicMaterial({ color: "#050508" });
  const frame = new THREE.MeshStandardMaterial({ color: "#05070b", emissive: "#101827", emissiveIntensity: 0.22, metalness: 0.55, roughness: 0.2 });
  const interior = new THREE.MeshStandardMaterial({ color: "#606774", emissive: "#28303a", emissiveIntensity: 0.18, metalness: 0.16, roughness: 0.34 });
  const dashboard = new THREE.MeshStandardMaterial({ color: "#2d343d", emissive: "#111923", emissiveIntensity: 0.2, metalness: 0.18, roughness: 0.32 });
  const instrument = new THREE.MeshBasicMaterial({ color: "#9ff4ff" });
  const controlFace = new THREE.MeshBasicMaterial({ color: "#111722" });
  const seat = new THREE.MeshStandardMaterial({ color: "#7d858f", emissive: "#2b3038", emissiveIntensity: 0.2, metalness: 0.18, roughness: 0.38 });
  const seatTrim = new THREE.MeshBasicMaterial({ color: "#c4cbd3" });

  addBox(group, dark, [54, 5, 92], [0, -7, 0]);
  group.add(makeRoadsterHull(red));
  addEllipsoid(group, red, [28, 7, 49], [0, -1, 3], 22, 8);
  const hood = addEllipsoid(group, red, [21, 3.2, 22], [0, 4, -34], 18, 7);
  hood.rotation.x = -0.06;
  const hoodCenter = addBox(group, redDark, [15, 1.1, 36], [0, 7.1, -28]);
  hoodCenter.rotation.x = -0.04;
  for (const x of [-15.5, 15.5]) {
    const hoodShoulder = addBox(group, red, [2.1, 1.1, 34], [x, 7.3, -27]);
    hoodShoulder.rotation.x = -0.05;
    hoodShoulder.rotation.z = x > 0 ? -0.08 : 0.08;
  }
  const rearDeck = addEllipsoid(group, red, [25, 1.8, 22], [0, 2.7, 38], 18, 7);
  rearDeck.rotation.x = -0.01;
  const rearDeckInset = addBox(group, frame, [25, 1.1, 22], [0, 8.1, 35]);
  rearDeckInset.rotation.x = 0.08;
  for (const z of [25.5, 30.5, 35.5]) {
    const deckSlat = addBox(group, redDark, [40, 0.8, 1.2], [0, 11.2, z]);
    deckSlat.rotation.x = 0.1;
  }
  for (const x of [-21, 21]) {
    addEllipsoid(group, red, [9.5, 5.4, 23], [x, -0.5, -30], 16, 7);
    addEllipsoid(group, red, [7.5, 4.8, 41], [x, -1, 4], 14, 6);
    addEllipsoid(group, red, [11, 6.4, 20], [x, 2.5, 35], 16, 7);
    const sideSill = addBox(group, redDark, [3.4, 3.2, 58], [x > 0 ? 27.5 : -27.5, -6.7, 1]);
    sideSill.rotation.z = x > 0 ? -0.04 : 0.04;
    const lowerSill = addBox(group, red, [4.2, 2, 44], [x > 0 ? 29 : -29, -4.7, 8]);
    lowerSill.rotation.z = x > 0 ? -0.06 : 0.06;
    const sideVent = addBox(group, silver, [1.3, 9.4, 3.2], [x > 0 ? 30.8 : -30.8, -0.7, -34]);
    sideVent.rotation.z = x > 0 ? -0.07 : 0.07;
    const rearIntake = addBox(group, dark, [2.1, 4.2, 6.2], [x > 0 ? 29.6 : -29.6, 2.4, 29]);
    rearIntake.rotation.z = x > 0 ? -0.12 : 0.12;
  }
  const cockpitTub = addBox(group, interior, [34, 3.2, 26], [0, 7.6, 6]);
  cockpitTub.rotation.x = -0.04;
  const cockpitTrim = new THREE.Mesh(new THREE.TorusGeometry(17.5, 1.05, 8, 42), frame);
  cockpitTrim.scale.z = 0.7;
  cockpitTrim.rotation.x = Math.PI / 2;
  cockpitTrim.position.set(0, 9.6, 4);
  group.add(cockpitTrim);
  const windshield = addBox(group, glass, [34, 1.1, 12], [0, 15, -18]);
  windshield.rotation.x = -0.72;
  addCylinderBetween(group, frame, new THREE.Vector3(-19, 8, -24), new THREE.Vector3(-16, 20, -12), 1.1, 8);
  addCylinderBetween(group, frame, new THREE.Vector3(19, 8, -24), new THREE.Vector3(16, 20, -12), 1.1, 8);
  addCylinderBetween(group, frame, new THREE.Vector3(-16, 20, -12), new THREE.Vector3(16, 20, -12), 0.9, 8);
  addCylinderBetween(group, frame, new THREE.Vector3(-19, 8, -24), new THREE.Vector3(19, 8, -24), 0.8, 8);
  addCylinderBetween(group, red, new THREE.Vector3(-20, 8.7, -22), new THREE.Vector3(-18, 20.8, -10), 1.5, 10);
  addCylinderBetween(group, red, new THREE.Vector3(20, 8.7, -22), new THREE.Vector3(18, 20.8, -10), 1.5, 10);
  addCylinderBetween(group, red, new THREE.Vector3(-18, 20.8, -10), new THREE.Vector3(18, 20.8, -10), 1.35, 10);
  for (const x of [-19, 19]) {
    addCylinderBetween(group, red, new THREE.Vector3(x, 9.4, 8), new THREE.Vector3(x * 0.84, 21, 25), 1.9, 10);
    addCylinderBetween(group, frame, new THREE.Vector3(x * 0.9, 11.2, 13), new THREE.Vector3(x * 0.76, 19.6, 24), 0.8, 8);
  }
  addCylinderBetween(group, red, new THREE.Vector3(-16, 21, 25), new THREE.Vector3(16, 21, 25), 1.8, 12);
  const rearHoopCap = addBox(group, red, [39, 4.4, 4.8], [0, 20.6, 27]);
  rearHoopCap.rotation.x = -0.16;
  const rearHoopGlass = addBox(group, glass, [31, 1, 8.5], [0, 16.1, 27.8]);
  rearHoopGlass.rotation.x = -0.32;
  const dash = addBox(group, dashboard, [34, 4.8, 8.5], [0, 10.4, -8.7]);
  dash.rotation.x = -0.14;
  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.32, 8, 22), frame);
  steeringWheel.position.set(-6.4, 13.1, -4.4);
  steeringWheel.rotation.z = 0.08;
  group.add(steeringWheel);
  addCylinderBetween(group, frame, new THREE.Vector3(-6.4, 9.8, -7.1), new THREE.Vector3(-6.4, 12.6, -4.6), 0.42, 8);
  for (const x of [-11.2, -8.6, -6]) {
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(1.15, 18), instrument);
    gauge.position.set(x, 12.3, -4.15);
    group.add(gauge);
  }
  const radio = addBox(group, controlFace, [7.2, 2.8, 0.7], [3.2, 11.4, -4.05]);
  radio.rotation.x = -0.04;
  for (const x of [0.6, 5.8]) {
    addEllipsoid(group, instrument, [0.52, 0.52, 0.18], [x, 11.4, -3.58], 10, 5);
  }
  const gloveBox = addBox(group, controlFace, [8.6, 2.4, 0.65], [12.3, 10.8, -4.02]);
  gloveBox.rotation.x = -0.04;
  for (const x of [-24, 24]) {
    const mirror = addBox(group, frame, [5.8, 2.2, 3.1], [x, 11.5, -12]);
    mirror.rotation.z = x > 0 ? -0.07 : 0.07;
    addCylinderBetween(group, frame, new THREE.Vector3(x > 0 ? 19.8 : -19.8, 9.6, -13.2), new THREE.Vector3(x, 11.5, -12), 0.42, 8);
    const mirrorBack = addEllipsoid(group, red, [2.6, 1.5, 2.5], [x > 0 ? 22.5 : -22.5, 11.8, -12], 12, 6);
    mirrorBack.rotation.z = x > 0 ? -0.08 : 0.08;
    const fuelCap = new THREE.Mesh(new THREE.CircleGeometry(2.7, 20), silver);
    fuelCap.position.set(x > 0 ? 28.4 : -28.4, 5.3, 24);
    fuelCap.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(fuelCap);
  }
  for (const x of [-8, 8]) {
    const cushion = addBox(group, seat, [9, 2.4, 12], [x, 4, 13]);
    cushion.rotation.x = -0.08;
    const back = addBox(group, seat, [9, 10, 2.6], [x, 9.3, 19]);
    back.rotation.x = -0.34;
    const headrest = addBox(group, seat, [7, 4, 2.4], [x, 16, 21]);
    headrest.rotation.x = -0.22;
    addBox(group, seatTrim, [7, 0.8, 1], [x, 5.4, 7.4]);
    addBox(group, seatTrim, [1, 5.8, 0.8], [x - 3.8, 10, 17.8]);
    addBox(group, seatTrim, [1, 5.8, 0.8], [x + 3.8, 10, 17.8]);
  }
  group.add(makeSpacesuitDriver());

  for (const x of [-27, 27]) {
    const side = x > 0 ? 1 : -1;
    for (const z of [-34, 37]) {
      addRoadsterWheel(group, tire, rim, [x, -8.2, z], side);
      const arch = addBox(group, silver, [1.2, 13.2, 3], [x + side * 0.9, -2.1, z - 0.8]);
      arch.rotation.z = side * -0.04;
    }
  }

  for (const x of [-18, 18]) {
    const housing = addBox(group, tailHousing, [18, 5, 2.4], [x, 3.5, -50.5]);
    housing.rotation.z = x > 0 ? 0.08 : -0.08;
    for (const offset of [-5.2, 0, 5.2]) {
      const lamp = addEllipsoid(group, light, [2.6, 2.4, 0.75], [x + offset, 3.5, -52], 16, 8);
      lamp.rotation.z = x > 0 ? 0.08 : -0.08;
    }
  }
  const grille = addBox(group, frame, [43, 9, 2.2], [0, -2.2, -53.5]);
  grille.rotation.x = -0.02;
  for (const y of [-5, -2.4, 0.2, 2.8]) {
    addBox(group, silver, [39, 0.55, 1], [0, y, -54.8]);
  }
  for (const x of [-15, 0, 15]) {
    addBox(group, silver, [0.8, 8, 1], [x, -1.3, -54.7]);
  }
  const frontSplitter = addBox(group, silver, [55, 1.1, 3.5], [0, -8.3, -54.2]);
  frontSplitter.rotation.x = -0.04;
  const rearShoulder = addBox(group, red, [64, 2.6, 6.5], [0, 6.6, 50.2]);
  rearShoulder.rotation.x = -0.05;
  const carbonLip = addBox(group, frame, [58, 1.8, 5.2], [0, 10.7, 52.2]);
  carbonLip.rotation.x = -0.08;
  const rearUpperBlade = addBox(group, red, [62, 2.2, 4.2], [0, 12.5, 49.4]);
  rearUpperBlade.rotation.x = -0.14;
  const rearBadgePanel = addBox(group, redDark, [47, 8.6, 2.3], [0, 5.6, 57.7]);
  rearBadgePanel.rotation.x = -0.01;
  for (const x of [-22, 22]) {
    const housing = addBox(group, tailHousing, [23, 6.3, 2.4], [x, 8.6, 57]);
    housing.rotation.z = x > 0 ? -0.08 : 0.08;
    const lampOffsets = x < 0 ? [-6.2, -1, 4.5] : [-4.5, 1, 6.2];
    for (const offset of lampOffsets) {
      const innerLamp = (x < 0 && offset > 0) || (x > 0 && offset < 0);
      const lamp = addEllipsoid(group, innerLamp ? tailLight : tailClear, [innerLamp ? 2.7 : 2.5, innerLamp ? 2.7 : 2.5, 0.75], [x + offset, 8.8, 58.3], 16, 8);
      lamp.rotation.z = x > 0 ? -0.08 : 0.08;
      const lampRing = addEllipsoid(group, silver, [innerLamp ? 3.4 : 3.1, innerLamp ? 3.4 : 3.1, 0.35], [x + offset, 8.8, 58.1], 16, 8);
      lampRing.rotation.z = x > 0 ? -0.08 : 0.08;
    }
    const keyhole = addEllipsoid(group, frame, [1, 1, 0.5], [x + (x < 0 ? 8 : -8), 6.4, 58.4], 10, 5);
    keyhole.rotation.z = x > 0 ? -0.08 : 0.08;
  }
  addEllipsoid(group, red, [30, 6.6, 12], [0, 2.1, 50], 20, 7);
  const lowerBumper = addBox(group, red, [60, 8.2, 3.4], [0, -0.1, 58.9]);
  lowerBumper.rotation.x = 0.02;
  const plateRecess = addBox(group, redDark, [30, 8.4, 2], [0, -0.1, 62.5]);
  plateRecess.rotation.x = 0.02;
  const bumperLip = addBox(group, red, [58, 1.6, 3.3], [0, -3.8, 61.4]);
  bumperLip.rotation.x = 0.05;
  addBox(group, frame, [50, 1, 2.6], [0, -5, 62.8]);
  const centerDiffuser = addBox(group, dark, [34, 3.2, 4.6], [0, -6.4, 61.8]);
  centerDiffuser.rotation.x = 0.06;
  for (const x of [-22, 22]) {
    const exhaustPocket = addBox(group, dark, [14, 3.8, 2.2], [x, -5.1, 63.3]);
    exhaustPocket.rotation.z = x > 0 ? -0.04 : 0.04;
    for (const y of [-6.1, -5.1, -4.1]) {
      addBox(group, silver, [11, 0.34, 0.7], [x, y, 64]);
    }
  }
  for (const x of [-28, 28]) {
    const wheelCutout = addBox(group, dark, [7.5, 9.5, 4.2], [x, -4.5, 59.7]);
    wheelCutout.rotation.z = x > 0 ? -0.06 : 0.06;
    addEllipsoid(group, tire, [3.6, 8.5, 6.8], [x, -8.6, 55.4], 14, 6);
  }
  for (const x of [-8, 8]) {
    const diffuserFin = addBox(group, dark, [1.3, 3, 4.2], [x, -7.5, 62.6]);
    diffuserFin.rotation.x = 0.08;
  }
  const plate = makeRearPlate();
  plate.position.set(0, 3.1, 62.4);
  group.add(plate);
  group.add(makeRearBadge());
  const rearDeckLip = addBox(group, frame, [44, 1.1, 4.6], [0, 11.8, 47.4]);
  rearDeckLip.rotation.x = -0.08;
  const rearGlow = new THREE.PointLight(0xff3348, 0.85, 95);
  rearGlow.position.set(0, 5, 55);
  group.add(rearGlow);

  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    blending: THREE.AdditiveBlending,
    color: "#ff6b72",
    depthWrite: false,
    map: makeGlowTexture(),
    opacity: 0.22,
    transparent: true,
  }));
  aura.position.set(0, -1, 10);
  aura.scale.set(110, 70, 1);
  group.add(aura);
  group.userData.aura = aura;
  const trail = makeRoadsterTrail();
  trail.visible = false;
  group.add(trail);
  group.userData.trail = trail;
  const tailLightTrails = makeTailLightTrails();
  tailLightTrails.visible = false;
  group.add(tailLightTrails);
  group.userData.tailLightTrails = tailLightTrails;
  const stardust = makeRoadsterStardust();
  stardust.visible = false;
  group.add(stardust);
  group.userData.stardust = stardust;
  group.scale.setScalar(0.95);
  return group;
}

function disposeRenderableResources(object: THREE.Object3D) {
  if (object instanceof Line2) {
    object.geometry.dispose();
    object.material.dispose();
    return;
  }
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      material.forEach((item) => {
        (item as THREE.Material & { map?: THREE.Texture }).map?.dispose();
        item.dispose();
      });
    } else {
      (material as THREE.Material & { map?: THREE.Texture }).map?.dispose();
      material.dispose();
    }
  } else if (object instanceof THREE.Sprite) {
    object.material.map?.dispose();
    object.material.dispose();
  }
}

function setObjectLayer(object: THREE.Object3D, layer: number) {
  object.traverse((item) => {
    item.layers.set(layer);
  });
}

function brightenRoadsterGltfScene(scene: THREE.Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        const isBodyRed = material.color.r > material.color.g * 1.35 && material.color.r > material.color.b * 1.35;
        if (isBodyRed) {
          material.color.set("#ff1f22");
          material.emissive.set("#b70c1c");
          material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.38);
          material.metalness = Math.max(material.metalness, 0.66);
          material.roughness = Math.min(material.roughness, 0.32);
        } else {
          material.color.lerp(new THREE.Color("#ffffff"), 0.12);
          material.emissive.copy(material.color).multiplyScalar(0.06);
          material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.16);
          material.metalness = Math.max(material.metalness, 0.42);
          material.roughness = Math.min(material.roughness, 0.58);
        }
        material.needsUpdate = true;
      }
    });
  });
}

function roadsterAxisValue(vector: THREE.Vector3, axis: number) {
  return axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z;
}

function roadsterFakeAoBand(value: number, center: number, radius: number) {
  const delta = clamp(Math.abs(value - center) / Math.max(radius, 0.0001), 0, 1);
  return 1 - delta * delta * (3 - 2 * delta);
}

function applyRoadsterFakeAo(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  if (bounds.isEmpty()) {
    return;
  }
  const axes = [0, 1, 2];
  const spans = axes.map((axis) => roadsterAxisValue(bounds.max, axis) - roadsterAxisValue(bounds.min, axis));
  const heightAxis = spans.indexOf(Math.min(...spans));
  const lengthAxis = spans.indexOf(Math.max(...spans));
  const widthAxis = axes.find((axis) => axis !== heightAxis && axis !== lengthAxis) ?? 0;
  const heightSpan = Math.max(spans[heightAxis], 0.0001);
  const widthSpan = Math.max(spans[widthAxis], 0.0001);
  const lengthSpan = Math.max(spans[lengthAxis], 0.0001);
  const geometryUseCount = new Map<THREE.BufferGeometry, number>();

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometryUseCount.set(object.geometry, (geometryUseCount.get(object.geometry) ?? 0) + 1);
    }
  });

  const point = new THREE.Vector3();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const sourceGeometry = object.geometry;
    const geometry = (geometryUseCount.get(sourceGeometry) ?? 0) > 1 ? sourceGeometry.clone() : sourceGeometry;
    if (geometry !== sourceGeometry) {
      object.geometry = geometry;
    }
    const positionAttribute = geometry.getAttribute("position");
    if (!positionAttribute) {
      return;
    }
    const sourceColorAttribute = geometry.getAttribute("color");
    const hasSourceColors = sourceColorAttribute?.count === positionAttribute.count;
    const colors = new Float32Array(positionAttribute.count * 3);
    for (let index = 0; index < positionAttribute.count; index += 1) {
      point.fromBufferAttribute(positionAttribute, index).applyMatrix4(object.matrixWorld);
      const height = clamp((roadsterAxisValue(point, heightAxis) - roadsterAxisValue(bounds.min, heightAxis)) / heightSpan, 0, 1);
      const width = clamp((roadsterAxisValue(point, widthAxis) - roadsterAxisValue(bounds.min, widthAxis)) / widthSpan, 0, 1);
      const length = clamp((roadsterAxisValue(point, lengthAxis) - roadsterAxisValue(bounds.min, lengthAxis)) / lengthSpan, 0, 1);
      const side = Math.abs(width - 0.5) * 2;
      const lowerBody = (1 - THREE.MathUtils.smoothstep(height, 0.08, 0.46)) * 0.16;
      const underbody = (1 - THREE.MathUtils.smoothstep(height, 0, 0.2)) * 0.22;
      const sideSill = THREE.MathUtils.smoothstep(side, 0.62, 0.98) * (1 - THREE.MathUtils.smoothstep(height, 0.16, 0.5)) * 0.12;
      const wheelWell = Math.max(roadsterFakeAoBand(length, 0.24, 0.1), roadsterFakeAoBand(length, 0.76, 0.1))
        * THREE.MathUtils.smoothstep(side, 0.54, 0.96)
        * (1 - THREE.MathUtils.smoothstep(height, 0.18, 0.55))
        * 0.24;
      const cabinPocket = roadsterFakeAoBand(length, 0.53, 0.2)
        * (1 - THREE.MathUtils.smoothstep(side, 0.38, 0.9))
        * THREE.MathUtils.smoothstep(height, 0.48, 0.92)
        * 0.1;
      const bumperCrease = Math.max(roadsterFakeAoBand(length, 0.08, 0.08), roadsterFakeAoBand(length, 0.92, 0.08))
        * (1 - THREE.MathUtils.smoothstep(height, 0.28, 0.74))
        * 0.1;
      const shade = 1 - Math.min(0.78, (lowerBody + underbody + sideSill + wheelWell + cabinPocket + bumperCrease) * 5);
      colors[index * 3] = (hasSourceColors ? sourceColorAttribute.getX(index) : 1) * shade;
      colors[index * 3 + 1] = (hasSourceColors ? sourceColorAttribute.getY(index) : 1) * shade;
      colors[index * 3 + 2] = (hasSourceColors ? sourceColorAttribute.getZ(index) : 1) * shade;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if ("vertexColors" in material) {
        (material as THREE.Material & { vertexColors: boolean }).vertexColors = true;
        material.needsUpdate = true;
      }
    });
  });
}

function makeRoadsterVehicle() {
  const group = new THREE.Group();
  const modelRoot = new THREE.Group();
  modelRoot.rotation.x = -Math.PI / 2;
  modelRoot.position.set(0, -30, 0);
  modelRoot.scale.setScalar(0.06);
  group.add(modelRoot);

  new GLTFLoader().load(
    FUN_ROADSTER_GLB_URL,
    (gltf) => {
      if (group.userData.disposed) {
        gltf.scene.traverse(disposeRenderableResources);
        return;
      }
      brightenRoadsterGltfScene(gltf.scene);
      applyRoadsterFakeAo(gltf.scene);
      setObjectLayer(gltf.scene, FUN_VEHICLE_LAYER);
      modelRoot.add(gltf.scene);
    },
    undefined,
    () => {
      if (!group.userData.disposed) {
        const fallback = makeRoadsterVehicleFallback();
        setObjectLayer(fallback, FUN_VEHICLE_LAYER);
        group.add(fallback);
      }
    },
  );

  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    blending: THREE.AdditiveBlending,
    color: "#ff6b72",
    depthWrite: false,
    map: makeGlowTexture(),
    opacity: 0.22,
    transparent: true,
  }));
  aura.position.set(0, -1, 10);
  aura.scale.set(110, 70, 1);
  group.add(aura);
  group.userData.aura = aura;
  const trail = makeRoadsterTrail();
  trail.visible = false;
  group.add(trail);
  group.userData.trail = trail;
  const tailLightTrails = makeTailLightTrails();
  tailLightTrails.visible = false;
  group.add(tailLightTrails);
  group.userData.tailLightTrails = tailLightTrails;
  const stardust = makeRoadsterStardust();
  stardust.visible = false;
  group.add(stardust);
  group.userData.stardust = stardust;
  const tailLamp = new THREE.MeshBasicMaterial({ color: "#ff1f32", depthWrite: false, opacity: 0.8, transparent: true });
  const tailGlowTexture = makeGlowTexture();
  for (const x of [-17.0, 17.0]) {
    for (const offset of [-3.0, 0, 3.0]) {
      const lamp = addEllipsoid(group, tailLamp, [1.15, 1.15, 0.2], [x + offset, -1, 56.0], 16, 8);
      lamp.rotation.z = x > 0 ? -10.08 : 10.08;
      lamp.rotation.y = x > 0 ? -0.18 : 0.18;
    }
    const tailGlowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ff1834",
      depthWrite: false,
      map: tailGlowTexture,
      opacity: 0.9,
      transparent: true,
    }));
    tailGlowSprite.position.set(x, -1, 60);
    tailGlowSprite.scale.set(30, 20, 10);
    group.add(tailGlowSprite);
    const tailGlow = new THREE.PointLight(0xff1834, 2.1, 122);
    tailGlow.position.set(x, -1.5, 57.4);
    group.add(tailGlow);
  }
  const vehicleGlowTexture = makeGlowTexture();
  const vehicleGlowNodes: Array<{ core: THREE.Sprite; glow: THREE.Sprite; light: THREE.PointLight; coreOpacity: number; glowOpacity: number; lightIntensity: number }> = [];
  for (const glowNode of [
    { position: new THREE.Vector3(0, 0, -20), glowScale: new THREE.Vector3(100, 100, 1), lightIntensity: 0.9 },
    { position: new THREE.Vector3(0, -10, 100), glowScale: new THREE.Vector3(200, 200, 1), lightIntensity: 1.2 },
  ]) {
    const glowCore = new THREE.Sprite(new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ff3046",
      depthWrite: false,
      map: vehicleGlowTexture,
      opacity: 0.01,
      transparent: true,
    }));
    glowCore.position.copy(glowNode.position);
    glowCore.scale.set(10, 10, 1);
    group.add(glowCore);
    const vehicleGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ff3046",
      depthWrite: false,
      map: vehicleGlowTexture,
      opacity: 0.6,
      transparent: true,
    }));
    vehicleGlow.position.copy(glowNode.position);
    vehicleGlow.scale.copy(glowNode.glowScale);
    group.add(vehicleGlow);
    const vehicleGlowLight = new THREE.PointLight(0xff3046, glowNode.lightIntensity, 165);
    vehicleGlowLight.position.copy(glowNode.position);
    group.add(vehicleGlowLight);
    vehicleGlowNodes.push({ core: glowCore, glow: vehicleGlow, light: vehicleGlowLight, coreOpacity: 0.01, glowOpacity: 0.6, lightIntensity: glowNode.lightIntensity });
  }
  group.userData.vehicleGlowNodes = vehicleGlowNodes;
  const vehicleFillLight = new THREE.PointLight(0xffffff, 1.45, 240);
  vehicleFillLight.position.set(0, 34, 74);
  group.add(vehicleFillLight);
  const vehicleRearLight = new THREE.PointLight(0xffd7bd, 2.1, 260);
  vehicleRearLight.position.set(0, 28, 132);
  group.add(vehicleRearLight);
  const vehicleHoodLight = new THREE.PointLight(0xfff0dc, 0.9, 210);
  vehicleHoodLight.position.set(0, 42, -56);
  group.add(vehicleHoodLight);
  const vehicleShapeLight = new THREE.DirectionalLight(0xffffff, 2.6);
  vehicleShapeLight.position.set(-68, 88, 104);
  vehicleShapeLight.castShadow = true;
  vehicleShapeLight.shadow.mapSize.set(512, 512);
  vehicleShapeLight.shadow.camera.left = -90;
  vehicleShapeLight.shadow.camera.right = 90;
  vehicleShapeLight.shadow.camera.top = 90;
  vehicleShapeLight.shadow.camera.bottom = -90;
  vehicleShapeLight.shadow.camera.near = 1;
  vehicleShapeLight.shadow.camera.far = 260;
  vehicleShapeLight.shadow.camera.layers.set(FUN_VEHICLE_LAYER);
  const vehicleShapeTarget = new THREE.Object3D();
  vehicleShapeTarget.position.set(10, -8, 22);
  group.add(vehicleShapeTarget);
  vehicleShapeLight.target = vehicleShapeTarget;
  group.add(vehicleShapeLight);
  group.userData.shapeLight = vehicleShapeLight;
  group.userData.shapeLightTarget = vehicleShapeTarget;
  const vehicleShapeSpot = new THREE.SpotLight(0xffffff, 1.65, 250, Math.PI / 5.2, 0.42, 1.25);
  vehicleShapeSpot.position.set(-58, 74, 112);
  vehicleShapeSpot.target = vehicleShapeTarget;
  group.add(vehicleShapeSpot);
  group.userData.shapeSpot = vehicleShapeSpot;
  const vehicleShapeRightLight = new THREE.DirectionalLight(0xffffff, 2.6);
  vehicleShapeRightLight.position.set(68, 88, 104);
  vehicleShapeRightLight.castShadow = true;
  vehicleShapeRightLight.shadow.mapSize.set(512, 512);
  vehicleShapeRightLight.shadow.camera.left = -90;
  vehicleShapeRightLight.shadow.camera.right = 90;
  vehicleShapeRightLight.shadow.camera.top = 90;
  vehicleShapeRightLight.shadow.camera.bottom = -90;
  vehicleShapeRightLight.shadow.camera.near = 1;
  vehicleShapeRightLight.shadow.camera.far = 260;
  vehicleShapeRightLight.shadow.camera.layers.set(FUN_VEHICLE_LAYER);
  const vehicleShapeRightTarget = new THREE.Object3D();
  vehicleShapeRightTarget.position.set(-10, -8, 22);
  group.add(vehicleShapeRightTarget);
  vehicleShapeRightLight.target = vehicleShapeRightTarget;
  group.add(vehicleShapeRightLight);
  group.userData.shapeRightLight = vehicleShapeRightLight;
  group.userData.shapeRightLightTarget = vehicleShapeRightTarget;
  const vehicleShapeRightSpot = new THREE.SpotLight(0xffffff, 1.65, 250, Math.PI / 5.2, 0.42, 1.25);
  vehicleShapeRightSpot.position.set(58, 74, 112);
  vehicleShapeRightSpot.target = vehicleShapeRightTarget;
  group.add(vehicleShapeRightSpot);
  group.userData.shapeRightSpot = vehicleShapeRightSpot;
  const vehicleShapeCenterLight = new THREE.DirectionalLight(0xffffff, 2.6);
  vehicleShapeCenterLight.position.set(0, 88, 104);
  vehicleShapeCenterLight.castShadow = true;
  vehicleShapeCenterLight.shadow.mapSize.set(512, 512);
  vehicleShapeCenterLight.shadow.camera.left = -90;
  vehicleShapeCenterLight.shadow.camera.right = 90;
  vehicleShapeCenterLight.shadow.camera.top = 90;
  vehicleShapeCenterLight.shadow.camera.bottom = -90;
  vehicleShapeCenterLight.shadow.camera.near = 1;
  vehicleShapeCenterLight.shadow.camera.far = 260;
  vehicleShapeCenterLight.shadow.camera.layers.set(FUN_VEHICLE_LAYER);
  const vehicleShapeCenterTarget = new THREE.Object3D();
  vehicleShapeCenterTarget.position.set(0, -8, 22);
  group.add(vehicleShapeCenterTarget);
  vehicleShapeCenterLight.target = vehicleShapeCenterTarget;
  group.add(vehicleShapeCenterLight);
  group.userData.shapeCenterLight = vehicleShapeCenterLight;
  group.userData.shapeCenterLightTarget = vehicleShapeCenterTarget;
  const vehicleShapeLowerSpot = new THREE.SpotLight(0xffffff, 1.65, 250, Math.PI / 5.2, 0.42, 1.25);
  vehicleShapeLowerSpot.position.set(0, -74, 112);
  vehicleShapeLowerSpot.target = vehicleShapeCenterTarget;
  group.add(vehicleShapeLowerSpot);
  group.userData.shapeLowerSpot = vehicleShapeLowerSpot;
  const rearTopSpotTarget = new THREE.Object3D();
  rearTopSpotTarget.position.set(0, 2, 48);
  group.add(rearTopSpotTarget);
  const rearTopSpot = new THREE.SpotLight(0xfff1df, 0.85, 130, Math.PI / 9, 0.5, 1.7);
  rearTopSpot.position.set(0, 54, 78);
  rearTopSpot.target = rearTopSpotTarget;
  group.add(rearTopSpot);
  const rearLowerAccentTarget = new THREE.Object3D();
  rearLowerAccentTarget.position.set(0, -4, 44);
  group.add(rearLowerAccentTarget);
  const rearLowerAccentSpot = new THREE.SpotLight(0xffdfc2, 0.58, 140, Math.PI / 7.5, 0.58, 1.7);
  rearLowerAccentSpot.position.set(10, -16, 64);
  rearLowerAccentSpot.target = rearLowerAccentTarget;
  group.add(rearLowerAccentSpot);
  const rearUpperRightTarget = new THREE.Object3D();
  rearUpperRightTarget.position.set(6, 6, 46);
  group.add(rearUpperRightTarget);
  const rearUpperRightSpot = new THREE.SpotLight(0xf3fbff, 0.9, 190, Math.PI / 8.5, 0.54, 1.55);
  rearUpperRightSpot.position.set(64, 116, 114);
  rearUpperRightSpot.target = rearUpperRightTarget;
  group.add(rearUpperRightSpot);
  setObjectLayer(group, FUN_VEHICLE_LAYER);
  group.scale.setScalar(0.95);
  return group;
}

function funDirection(yaw: number, pitch: number) {
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ).normalize();
}

function funSpeedLevel(speed: number) {
  return clamp((speed - FUN_MAX_REVERSE_SPEED) / (FUN_MAX_FORWARD_SPEED - FUN_MAX_REVERSE_SPEED), 0, 1);
}

function funBoundsForNodes(spaceNodes: SpaceNode[]) {
  const center = nodeCentroid(spaceNodes) ?? new THREE.Vector3(0, 0, 0);
  const nodeRadius = Math.max(
    900,
    ...spaceNodes.map((item) => center.distanceTo(new THREE.Vector3(item.x, item.y, item.z)) + item.radius),
  );
  return { center, radius: nodeRadius + FUN_BOUNDARY_BUFFER };
}

function updateGraphEdgeGeometry(line: GraphEdgeObject, sourcePoint: THREE.Vector3, targetPoint: THREE.Vector3) {
  if (line.userData.isWideLine) {
    (line.geometry as LineGeometry).setPositions([
      sourcePoint.x, sourcePoint.y, sourcePoint.z,
      targetPoint.x, targetPoint.y, targetPoint.z,
    ]);
    return;
  }
  const position = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  position.setXYZ(0, sourcePoint.x, sourcePoint.y, sourcePoint.z);
  position.setXYZ(1, targetPoint.x, targetPoint.y, targetPoint.z);
  position.needsUpdate = true;
}

function makeImportDirectionMarker(opacity: number): ImportDirectionMarker {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(IMPORT_DIRECTION_MARKER_RADIUS, IMPORT_DIRECTION_MARKER_LENGTH, 3),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ffd35a",
      depthTest: true,
      depthWrite: false,
      opacity,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    blending: THREE.AdditiveBlending,
    color: "#ffd35a",
    depthTest: true,
    depthWrite: false,
    map: makeGlowTexture(),
    opacity: 0,
    transparent: true,
  }));
  glow.scale.set(30, 30, 1);
  const tailGeometry = new THREE.BufferGeometry();
  tailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const tail = new THREE.Line(
    tailGeometry,
    new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ffd35a",
      depthTest: true,
      depthWrite: false,
      opacity: opacity * 0.42,
      transparent: true,
    }),
  );
  return { cone, glow, tail };
}

function importDirectionMarkerCount(edgeLength: number) {
  return Math.max(IMPORT_DIRECTION_MARKER_MIN_COUNT, Math.min(IMPORT_DIRECTION_MARKER_MAX_COUNT, Math.ceil(edgeLength / IMPORT_DIRECTION_MARKER_LENGTH_PER_ARROW)));
}

function updateImportDirectionMarker(marker: ImportDirectionMarker, fromPoint: THREE.Vector3, toPoint: THREE.Vector3, progress: number) {
  const direction = toPoint.clone().sub(fromPoint);
  const edgeLength = direction.length();
  if (edgeLength < 1) {
    marker.cone.visible = false;
    marker.glow.visible = false;
    marker.tail.visible = false;
    return;
  }
  direction.normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const headProgress = clamp(progress, 0, 1);
  const tailProgress = clamp(headProgress - IMPORT_DIRECTION_MARKER_TAIL_LENGTH / edgeLength, 0, 1);
  const tailPoint = fromPoint.clone().lerp(toPoint, tailProgress);
  const headPoint = fromPoint.clone().lerp(toPoint, headProgress);
  const tailPosition = marker.tail.geometry.getAttribute("position") as THREE.BufferAttribute;
  marker.cone.visible = true;
  marker.glow.visible = true;
  marker.tail.visible = true;
  marker.cone.position.copy(headPoint);
  marker.cone.quaternion.copy(quaternion);
  marker.glow.position.copy(headPoint);
  tailPosition.setXYZ(0, tailPoint.x, tailPoint.y, tailPoint.z);
  tailPosition.setXYZ(1, headPoint.x, headPoint.y, headPoint.z);
  tailPosition.needsUpdate = true;
}

function setImportDirectionMarkerOpacity(marker: ImportDirectionMarker, opacity: number) {
  marker.cone.material.opacity = opacity;
  marker.glow.material.opacity = opacity * 0.32;
  marker.tail.material.opacity = opacity * 0.42;
}

function hideImportDirectionMarker(marker: ImportDirectionMarker) {
  setImportDirectionMarkerOpacity(marker, 0);
  marker.cone.visible = false;
  marker.glow.visible = false;
  marker.tail.visible = false;
}

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.62)");
  gradient.addColorStop(0.46, "rgba(255, 255, 255, 0.18)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeRimMaterial(color: THREE.Color, opacity: number) {
  return new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uPulse: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uPulse;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 1.55);
        vec3 hot = mix(uColor, vec3(1.0), 0.38 + uPulse * 0.42);
        float alpha = rim * uOpacity * (0.58 + uPulse * 0.78);
        gl_FragColor = vec4(hot, alpha);
      }
    `,
  });
}

function makeVisibleEdges(edges: CodeEdge[], spaceNodes: SpaceNode[]) {
  const visibleIds = new Set(spaceNodes.map((item) => item.node.id));
  return edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
}

function nodePositionMap(spaceNodes: SpaceNode[]) {
  return new Map(spaceNodes.map((item) => [item.node.id, item]));
}

function universeRadius(spaceNodes: SpaceNode[]) {
  return Math.max(
    1200,
    ...spaceNodes.map((item) => Math.sqrt(item.x * item.x + item.y * item.y + item.z * item.z) + item.radius),
  );
}

function universeExtent(spaceNodes: SpaceNode[]) {
  if (!spaceNodes.length) {
    return 0;
  }
  let maxDistance = 0;
  for (let sourceIndex = 0; sourceIndex < spaceNodes.length; sourceIndex += 1) {
    const source = spaceNodes[sourceIndex];
    maxDistance = Math.max(maxDistance, source.radius * 2);
    for (let targetIndex = sourceIndex + 1; targetIndex < spaceNodes.length; targetIndex += 1) {
      const target = spaceNodes[targetIndex];
      const distance = Math.sqrt((target.x - source.x) ** 2 + (target.y - source.y) ** 2 + (target.z - source.z) ** 2);
      maxDistance = Math.max(maxDistance, distance + source.radius + target.radius);
    }
  }
  return maxDistance;
}

function nodeCentroid(spaceNodes: Iterable<SpaceNode>) {
  const center = new THREE.Vector3();
  let count = 0;
  for (const item of spaceNodes) {
    center.add(new THREE.Vector3(item.x, item.y, item.z));
    count += 1;
  }
  return count ? center.divideScalar(count) : null;
}

function focusViewportOffset(_hostWidth: number) {
  return 0;
}

function applyNodeSpread(target: THREE.Vector3, basePosition: THREE.Vector3, centerPosition: THREE.Vector3, radius: number, strength: number, seed: string) {
  const spreadVector = basePosition.clone().sub(centerPosition);
  const distance = spreadVector.length();
  if (distance >= radius) {
    return;
  }
  if (distance < 0.001) {
    const angle = stableUnit(seed) * Math.PI * 2;
    spreadVector.set(Math.cos(angle), Math.sin(angle), stableUnit(`${seed}:z`) - 0.5);
  }
  spreadVector.normalize();
  const falloff = 1 - distance / radius;
  target.add(spreadVector.multiplyScalar(strength * falloff * falloff));
}

function screenOffsetToWorld(offset: THREE.Vector3, camera: THREE.PerspectiveCamera, height: number) {
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const unitsPerPixel = visibleHeight / Math.max(height, 1);
  return new THREE.Vector3(offset.x * unitsPerPixel, offset.y * unitsPerPixel, 0);
}

function packetTravelMs(sourcePoint: THREE.Vector3, targetPoint: THREE.Vector3) {
  return Math.max(PACKET_MIN_TRAVEL_MS, sourcePoint.distanceTo(targetPoint) / PACKET_SPEED_UNITS_PER_MS);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function fitCameraDistance(extent: number, minDistance: number, maxDistance: number) {
  return clamp(extent * 1.5, minDistance, maxDistance);
}

function easedCruise(progress: number) {
  const t = clamp(progress, 0, 1);
  const ramp = 0.22;
  const velocity = 1 / (1 - ramp);
  if (t < ramp) {
    return 0.5 * (velocity / ramp) * t * t;
  }
  if (t > 1 - ramp) {
    const remaining = 1 - t;
    return 1 - 0.5 * (velocity / ramp) * remaining * remaining;
  }
  return 0.5 * velocity * ramp + velocity * (t - ramp);
}

function depthOpacity(depth: number | undefined) {
  if (depth === 0) {
    return 1;
  }
  if (depth === 1) {
    return 0.96;
  }
  if (depth === 2) {
    return 0.9;
  }
  if (depth === 3) {
    return 0.82;
  }
  if (depth === 4) {
    return 0.74;
  }
  return 0.68;
}

function depthScale(depth: number | undefined, isSelected: boolean) {
  if (isSelected) {
    return 1.48;
  }
  if (depth === 1) {
    return 1.12;
  }
  if (depth === 2) {
    return 1.03;
  }
  if (depth === 3) {
    return 0.93;
  }
  return 0.86;
}

function performanceTierForFps(fps: number): PerformanceTier {
  if (fps > FPS_FULL_EFFECT) {
    return PERFORMANCE_TIERS.full;
  }
  if (fps >= FPS_BALANCED_EFFECT) {
    return PERFORMANCE_TIERS.balanced;
  }
  if (fps >= FPS_RECOVERY_EFFECT) {
    return PERFORMANCE_TIERS.recovery;
  }
  return PERFORMANCE_TIERS.emergency;
}

function nodeLodForProjectedRadius(projectedRadiusPx: number) {
  return NODE_LOD_TIERS.find((tier) => projectedRadiusPx >= tier.minProjectedRadiusPx) ?? NODE_LOD_TIERS[NODE_LOD_TIERS.length - 1];
}

function strongerNodeLod(current: NodeLodTier, minimum: NodeLodTier) {
  return current.widthSegments >= minimum.widthSegments ? current : minimum;
}

function resolvedNodeLod(projectedRadiusPx: number, isSelected: boolean, isHover: boolean, isTraceNode: boolean, connectedToFocus: boolean, isHighlighted: boolean) {
  if (isSelected || isHover || isHighlighted) {
    return NODE_LOD_TIERS[0];
  }
  let tier = nodeLodForProjectedRadius(projectedRadiusPx);
  if (isTraceNode) {
    tier = strongerNodeLod(tier, NODE_LOD_TIERS[1]);
  }
  if (connectedToFocus) {
    tier = strongerNodeLod(tier, NODE_LOD_TIERS[2]);
  }
  return tier;
}

function updateSphereLod(sphere: THREE.Mesh, tier: NodeLodTier) {
  if (sphere.userData.lodKey === tier.key) {
    return;
  }
  const baseRadius = sphere.userData.baseRadius as number;
  sphere.geometry.dispose();
  sphere.geometry = new THREE.SphereGeometry(baseRadius, tier.widthSegments, tier.heightSegments);
  const rim = sphere.userData.rim as THREE.Mesh | undefined;
  if (rim) {
    rim.geometry.dispose();
    rim.geometry = new THREE.SphereGeometry(baseRadius * 1.16, tier.widthSegments, tier.heightSegments);
  }
  sphere.userData.lodKey = tier.key;
}

function updateSphereScreenMetrics(sphere: THREE.Mesh, camera: THREE.PerspectiveCamera, _width: number, height: number, worldPosition: THREE.Vector3, projectedPosition: THREE.Vector3) {
  sphere.getWorldPosition(worldPosition);
  projectedPosition.copy(worldPosition).project(camera);
  const cameraDistance = Math.max(1, camera.position.distanceTo(worldPosition));
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cameraDistance;
  const baseRadius = sphere.userData.baseRadius as number;
  const projectedRadiusPx = (baseRadius * Math.max(sphere.scale.x, 0.001) / Math.max(visibleHeight, 1)) * height;
  sphere.userData.projectedRadiusPx = projectedRadiusPx;
  sphere.userData.offscreen = projectedPosition.z < -1
    || projectedPosition.z > 1
    || projectedPosition.x < -1 - SCREEN_CULL_MARGIN
    || projectedPosition.x > 1 + SCREEN_CULL_MARGIN
    || projectedPosition.y < -1 - SCREEN_CULL_MARGIN
    || projectedPosition.y > 1 + SCREEN_CULL_MARGIN;
}

export default function GraphScene({ graph, selectedId, activeKinds, perspectiveIds, activeTrace, funMode, showSelectedOverlays, showHoverOverlays, twinkleEnabled, glowIntensity, stardustCount, screenCullKinds, tinyNodeCullBelowPx, tinyNodeRestoreAbovePx, resetViewSignal, onZoomChange, onFunSpeedChange, onFpsChange, onSelect, onDeselect }: GraphSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const starfieldRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null>(null);
  const selectedIdRef = useRef(selectedId);
  const funModeRef = useRef(funMode);
  const showSelectedOverlaysRef = useRef(showSelectedOverlays);
  const showHoverOverlaysRef = useRef(showHoverOverlays);
  const twinkleEnabledRef = useRef(twinkleEnabled);
  const glowIntensityRef = useRef(glowIntensity);
  const stardustCountRef = useRef(stardustCount);
  const screenCullKindsRef = useRef(screenCullKinds);
  const tinyNodeCullBelowPxRef = useRef(tinyNodeCullBelowPx);
  const tinyNodeRestoreAbovePxRef = useRef(tinyNodeRestoreAbovePx);
  const resetViewSignalRef = useRef(resetViewSignal);
  const resetViewActiveRef = useRef(false);
  const onZoomChangeRef = useRef(onZoomChange);
  const onFunSpeedChangeRef = useRef(onFunSpeedChange);
  const onFpsChangeRef = useRef(onFpsChange);
  const onSelectRef = useRef(onSelect);
  const onDeselectRef = useRef(onDeselect);
  const depthsRef = useRef<Map<string, number>>(new Map());
  const positionsRef = useRef<Map<string, SpaceNode>>(new Map());
  const panOffsetRef = useRef(new THREE.Vector3(0, 0, 0));
  const focusOffsetRef = useRef(new THREE.Vector3(0, 0, 0));
  const graphPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const graphRotationRef = useRef(new THREE.Euler(-0.16, 0, 0));
  const hoverNodeIdRef = useRef<string | null>(null);
  const hoverProximityNodeIdsRef = useRef<Set<string>>(new Set());
  const [hover, setHover] = useState<HoverState | null>(null);
  const [neighborOverlays, setNeighborOverlays] = useState<NeighborOverlay[]>([]);
  const spaceNodes = useMemo(
    () => makeSpaceNodes(graph, activeKinds, perspectiveIds),
    [activeKinds, graph, perspectiveIds],
  );
  const visibleEdges = useMemo(() => makeVisibleEdges(graph.edges, spaceNodes), [graph.edges, spaceNodes]);
  const parentByNodeId = useMemo(() => buildParentMap(graph.nodes, graph.edges), [graph.edges, graph.nodes]);
  const positions = useMemo(() => nodePositionMap(spaceNodes), [spaceNodes]);
  const maxUniverseRadius = useMemo(() => universeRadius(spaceNodes), [spaceNodes]);
  const maxUniverseExtent = useMemo(() => universeExtent(spaceNodes), [spaceNodes]);
  const depths = useMemo(
    () => buildDepths(selectedId, graph.nodes, graph.edges, activeKinds, perspectiveIds),
    [activeKinds, graph.edges, graph.nodes, perspectiveIds, selectedId],
  );
  const traceEdgeIds = useMemo(
    () => new Set((activeTrace?.steps ?? []).map((step) => step.edge_id).filter((edgeId): edgeId is string => Boolean(edgeId))),
    [activeTrace],
  );
  const traceNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeTrace?.start_node_id) {
      ids.add(activeTrace.start_node_id);
    }
    for (const step of activeTrace?.steps ?? []) {
      ids.add(step.node_id);
    }
    return ids;
  }, [activeTrace]);
  const traceSpaceNodes = useMemo(() => spaceNodes.filter((item) => traceNodeIds.has(item.node.id)), [spaceNodes, traceNodeIds]);
  const traceUniverseExtent = useMemo(() => universeExtent(traceSpaceNodes), [traceSpaceNodes]);
  const hasActiveTrace = traceNodeIds.size > 0 || traceEdgeIds.size > 0;

  selectedIdRef.current = selectedId;
  funModeRef.current = funMode;
  showSelectedOverlaysRef.current = showSelectedOverlays;
  showHoverOverlaysRef.current = showHoverOverlays;
  twinkleEnabledRef.current = twinkleEnabled;
  glowIntensityRef.current = glowIntensity;
  stardustCountRef.current = stardustCount;
  screenCullKindsRef.current = screenCullKinds;
  tinyNodeCullBelowPxRef.current = tinyNodeCullBelowPx;
  tinyNodeRestoreAbovePxRef.current = tinyNodeRestoreAbovePx;
  resetViewSignalRef.current = resetViewSignal;
  onZoomChangeRef.current = onZoomChange;
  onFunSpeedChangeRef.current = onFunSpeedChange;
  onFpsChangeRef.current = onFpsChange;
  onSelectRef.current = onSelect;
  onDeselectRef.current = onDeselect;
  positionsRef.current = positions;
  depthsRef.current = depths;

  useEffect(() => {
    resetViewActiveRef.current = false;
    if (selectedId) {
      panOffsetRef.current.set(0, 0, 0);
    }
  }, [selectedId]);

  useEffect(() => {
    resetViewActiveRef.current = false;
    if (activeTrace) {
      panOffsetRef.current.set(0, 0, 0);
    }
  }, [activeTrace?.trace_id]);

  useEffect(() => {
    if (resetViewSignal > 0) {
      resetViewActiveRef.current = true;
      panOffsetRef.current.set(0, 0, 0);
      hoverNodeIdRef.current = null;
      hoverProximityNodeIdsRef.current = new Set();
      setHover(null);
      setNeighborOverlays([]);
    }
  }, [resetViewSignal]);

  useEffect(() => {
    const starfield = starfieldRef.current;
    if (!starfield) {
      return;
    }
    const previousGeometry = starfield.geometry;
    starfield.geometry = makeStarfieldGeometry(stardustCount);
    previousGeometry.dispose();
  }, [stardustCount]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    host.replaceChildren();

    const scene = new THREE.Scene();
    const maxCameraDistance = Math.max(3200, maxUniverseExtent * 3);
    const minCameraDistance = clamp(maxUniverseRadius * 0.18, 360, 720);
    const initialCameraExtent = hasActiveTrace && traceUniverseExtent > 0 ? traceUniverseExtent : maxUniverseExtent;
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, maxCameraDistance * 2.4);
    camera.layers.set(FUN_GRAPH_LAYER);
    camera.position.set(0, 32, fitCameraDistance(initialCameraExtent, minCameraDistance, maxCameraDistance));
    const exploreCameraPosition = camera.position.clone();
    const exploreCameraQuaternion = camera.quaternion.clone();
    let lastReportedZoom = -1;
    let lastReportedFunSpeed = -1;
    const funBounds = funBoundsForNodes(spaceNodes);

    function reportZoomLevel() {
      const zoomRange = Math.max(maxCameraDistance - minCameraDistance, 1);
      const zoomLevel = clamp(1 - (camera.position.z - minCameraDistance) / zoomRange, 0, 1);
      const roundedZoom = Math.round(zoomLevel * 1000) / 1000;
      if (Math.abs(roundedZoom - lastReportedZoom) >= 0.004) {
        lastReportedZoom = roundedZoom;
        onZoomChangeRef.current(roundedZoom);
      }
    }

    function reportFunSpeedLevel(speed: number) {
      const roundedSpeed = Math.round(funSpeedLevel(speed) * 1000) / 1000;
      if (Math.abs(roundedSpeed - lastReportedFunSpeed) >= 0.004) {
        lastReportedFunSpeed = roundedSpeed;
        onFunSpeedChangeRef.current(roundedSpeed);
      }
    }

    const largeGraph = graph.nodes.length >= LARGE_GRAPH_NODE_COUNT;
    const hugeGraph = graph.nodes.length >= HUGE_GRAPH_NODE_COUNT;
    const pixelRatioCap = hugeGraph ? 1.15 : largeGraph ? 1.45 : 2;
    const sphereWidthSegments = largeGraph ? 14 : 30;
    const sphereHeightSegments = largeGraph ? 9 : 20;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const graphGroup = new THREE.Group();
    if (funModeRef.current) {
      graphGroup.position.set(0, 0, 0);
      graphGroup.rotation.set(0, 0, 0);
    } else {
      graphGroup.position.copy(graphPositionRef.current);
      graphGroup.rotation.copy(graphRotationRef.current);
    }
    scene.add(graphGroup);
    const skySphere = makeFunSkySphere();
    scene.add(skySphere);
    const starfield = makeStarfield(stardustCountRef.current);
    starfieldRef.current = starfield;
    scene.add(starfield);
    const { group: shootingStarGroup, stars: shootingStarObjects } = makeShootingStars();
    scene.add(shootingStarGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.62);
    ambientLight.layers.enable(FUN_VEHICLE_LAYER);
    scene.add(ambientLight);
    const keyLight = new THREE.PointLight(0xffffff, 2.8, 1200);
    keyLight.layers.enable(FUN_VEHICLE_LAYER);
    keyLight.position.set(0, 220, 390);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x31ffc5, 1.55, 900);
    rimLight.layers.enable(FUN_VEHICLE_LAYER);
    rimLight.position.set(-260, -120, 260);
    scene.add(rimLight);
    const vehicleGroup = makeRoadsterVehicle();
    vehicleGroup.visible = funModeRef.current;
    scene.add(vehicleGroup);
    const tailGlowStreaks = makeTailGlowStreaks();
    tailGlowStreaks.visible = false;
    setObjectLayer(tailGlowStreaks, FUN_VEHICLE_LAYER);
    scene.add(tailGlowStreaks);
    vehicleGroup.userData.tailGlowStreaks = tailGlowStreaks;
    const vehicleLight = new THREE.PointLight(0xffdde0, 2.4, 520);
    vehicleLight.layers.set(FUN_VEHICLE_LAYER);
    vehicleLight.visible = funModeRef.current;
    scene.add(vehicleLight);
    const funState = {
      cameraPosition: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      pitch: 0,
      position: new THREE.Vector3(),
      speed: 0,
      steerX: 0,
      steerY: 0,
      targetSteerX: 0,
      targetSteerY: 0,
      targetSpeed: 0,
      visualPitch: 0,
      visualRoll: 0,
      visualYaw: 0,
      yaw: 0,
    };
    const shapeLightBase = new THREE.Vector3(-68, 88, 104);
    const shapeSpotBase = new THREE.Vector3(-58, 74, 112);
    const shapeRightLightBase = new THREE.Vector3(68, 88, 104);
    const shapeRightSpotBase = new THREE.Vector3(58, 74, 112);
    const shapeCenterLightBase = new THREE.Vector3(0, 88, 104);
    const shapeLowerSpotBase = new THREE.Vector3(0, -74, 112);
    const shapeLightEuler = new THREE.Euler();
    const shapeLightPosition = new THREE.Vector3();
    const shapeSpotPosition = new THREE.Vector3();
    const shapeRightLightPosition = new THREE.Vector3();
    const shapeRightSpotPosition = new THREE.Vector3();
    const shapeCenterLightPosition = new THREE.Vector3();
    const shapeLowerSpotPosition = new THREE.Vector3();
    function resetFunState() {
      const center = funBounds.center;
      const startDistance = Math.min(fitCameraDistance(initialCameraExtent, minCameraDistance, maxCameraDistance) * 0.58, funBounds.radius * 0.55);
      funState.position.set(center.x, center.y + 72, center.z + startDistance);
      const direction = center.clone().sub(funState.position).normalize();
      funState.yaw = Math.atan2(direction.x, -direction.z);
      funState.pitch = Math.asin(clamp(direction.y, -Math.sin(FUN_MAX_PITCH), Math.sin(FUN_MAX_PITCH)));
      funState.direction.copy(funDirection(funState.yaw, funState.pitch));
      funState.cameraPosition.copy(funState.position).sub(funState.direction.clone().multiplyScalar(FUN_CAMERA_DISTANCE)).add(new THREE.Vector3(0, FUN_CAMERA_HEIGHT, 0));
      funState.speed = 0;
      funState.steerX = 0;
      funState.steerY = 0;
      funState.targetSteerX = 0;
      funState.targetSteerY = 0;
      funState.targetSpeed = 0;
      funState.visualPitch = 0;
      funState.visualRoll = 0;
      funState.visualYaw = 0;
      vehicleGroup.position.copy(funState.position);
      vehicleGroup.lookAt(funState.position.clone().add(funState.direction));
      vehicleGroup.rotateY(Math.PI);
      camera.position.copy(funState.cameraPosition);
      camera.lookAt(funState.position.clone().add(funState.direction.clone().multiplyScalar(FUN_LOOK_AHEAD)));
      reportFunSpeedLevel(funState.speed);
    }
    let funHoverTarget: { node: CodeNode; x: number; y: number } | null = null;

    function enterFunMode() {
      exploreCameraPosition.copy(camera.position);
      exploreCameraQuaternion.copy(camera.quaternion);
      graphGroup.position.set(0, 0, 0);
      graphGroup.rotation.set(0, 0, 0);
      vehicleGroup.visible = true;
      vehicleLight.visible = true;
      tailGlowStreaks.visible = false;
      (tailGlowStreaks.userData.streaks as TailGlowStreak[] | undefined)?.forEach((streak) => {
        streak.history.length = 0;
      });
      hoverNodeIdRef.current = null;
      hoverProximityNodeIdsRef.current = new Set();
      setHover(null);
      setNeighborOverlays([]);
      resetFunState();
    }

    function exitFunMode() {
      vehicleGroup.visible = false;
      vehicleLight.visible = false;
      tailGlowStreaks.visible = false;
      (tailGlowStreaks.userData.streaks as TailGlowStreak[] | undefined)?.forEach((streak) => {
        streak.history.length = 0;
        (streak.core.material as LineMaterial).opacity = 0;
        (streak.halo.material as LineMaterial).opacity = 0;
      });
      funState.speed = 0;
      funState.steerX = 0;
      funState.steerY = 0;
      funState.targetSteerX = 0;
      funState.targetSteerY = 0;
      funState.targetSpeed = 0;
      funState.visualPitch = 0;
      funState.visualRoll = 0;
      funState.visualYaw = 0;
      funHoverTarget = null;
      hoverNodeIdRef.current = null;
      hoverProximityNodeIdsRef.current = new Set();
      setHover(null);
      setNeighborOverlays([]);
      reportFunSpeedLevel(0);
      camera.position.copy(exploreCameraPosition);
      camera.quaternion.copy(exploreCameraQuaternion);
      camera.updateMatrixWorld();
      graphGroup.position.copy(graphPositionRef.current);
      graphGroup.rotation.copy(graphRotationRef.current);
    }

    let lastFunMode = funModeRef.current;
    if (lastFunMode) {
      enterFunMode();
    }

    const sphereObjects: THREE.Mesh[] = [];
    const lineObjects: GraphEdgeObject[] = [];
    const packetObjects: THREE.Mesh[] = [];
    const sphereByNodeId = new Map<string, THREE.Mesh>();
    const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const connectedNodeIdsByNodeId = new Map<string, Set<string>>();
    const traceStepByEdge = new Map((activeTrace?.steps ?? []).filter((step) => step.edge_id).map((step) => [step.edge_id as string, step]));
    const glowTexture = makeGlowTexture();
    const idleTwinkleProfileByNodeId = new Map<string, IdleStructuralTwinkleProfile>();
    spaceNodes
      .filter((item) => item.node.kind === "service" || item.node.kind === "file" || item.node.kind === "config_file")
      .sort((a, b) => stableHash(`idle-twinkle:${a.node.id}`) - stableHash(`idle-twinkle:${b.node.id}`))
      .forEach((item, index) => idleTwinkleProfileByNodeId.set(item.node.id, idleStructuralTwinkleProfile(item.node.id, index % IDLE_STRUCTURAL_TWINKLE_SLOT_COUNT)));
    for (const item of spaceNodes) {
      const geometry = new THREE.SphereGeometry(item.radius, sphereWidthSegments, sphereHeightSegments);
      const color = new THREE.Color(nodeColor(item.node));
      const isService = item.node.kind === "service";
      const isFile = item.node.kind === "file";
      const isApi = item.node.kind === "api_endpoint";
      const isTraceNode = traceNodeIds.has(item.node.id);
      const traceDimmed = hasActiveTrace && !isTraceNode;
      const hotColor = item.node.kind === "service"
        ? color.clone().lerp(new THREE.Color("#ffffff"), 0.68)
        : color.clone().lerp(new THREE.Color("#ffffff"), isFile ? 0.82 : isApi ? 0.74 : 0.58);
      const twinkleColor = color.clone().lerp(new THREE.Color("#ffffff"), 0.94);
      const baseEmissive = isService ? 1.56 : isFile ? 1.1 : isApi ? 1.08 : 0.54;
      const initialOpacity = traceDimmed ? item.opacity * TRACE_DIM_FACTOR : item.opacity;
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: traceDimmed ? baseEmissive * TRACE_DIM_FACTOR : baseEmissive,
        metalness: 0.18,
        opacity: initialOpacity,
        roughness: isService || isFile || isApi ? 0.18 : 0.28,
        transparent: true,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(item.x, item.y, item.z);
      sphere.userData.nodeId = item.node.id;
      sphere.userData.basePosition = sphere.position.clone();
      sphere.userData.baseRadius = item.radius;
      sphere.userData.lodKey = largeGraph ? "far" : "full";
      sphere.userData.baseOpacity = item.opacity;
      sphere.userData.baseColor = color.clone();
      sphere.userData.hotColor = hotColor;
      sphere.userData.twinkleColor = twinkleColor;
      sphere.userData.nodeKind = item.node.kind;
      sphere.userData.isTraceNode = isTraceNode;
      sphere.userData.screenCulled = false;
      sphere.userData.baseEmissive = baseEmissive;
      sphere.userData.phase = stableUnit(`pulse:${item.node.id}`) * Math.PI * 2;
      sphere.userData.pulseSpeed = 0.0012 + stableUnit(`pulse-speed:${item.node.id}`) * 0.0032;
      sphere.userData.pulseAmount = 0.045 + stableUnit(`pulse-amount:${item.node.id}`) * 0.095;
      sphere.userData.glowPhase = stableUnit(`glow-phase:${item.node.id}`) * Math.PI * 2;
      sphere.userData.glowSpeed = 0.0011 + stableUnit(`glow-speed:${item.node.id}`) * 0.002;
      sphere.userData.highlightIntensity = 0;
      sphereObjects.push(sphere);
      sphereByNodeId.set(item.node.id, sphere);
      graphGroup.add(sphere);

      const baseRimOpacity = isService ? 0.94 : isFile ? 0.62 : isApi ? 0.5 : 0.32;
      const rim = new THREE.Mesh(
        new THREE.SphereGeometry(item.radius * 1.16, sphereWidthSegments, sphereHeightSegments),
        makeRimMaterial(isService ? color.clone().lerp(new THREE.Color("#ffffff"), 0.42) : color, traceDimmed ? baseRimOpacity * TRACE_DIM_FACTOR : baseRimOpacity),
      );
      rim.position.copy(sphere.position);
      rim.userData.nodeId = item.node.id;
      sphere.userData.rim = rim;
      graphGroup.add(rim);

      const baseGlowOpacity = isService ? 0.84 : isFile ? 0.5 : isApi ? 0.48 : 0.24;
      const glowMaterial = new THREE.SpriteMaterial({
        blending: THREE.AdditiveBlending,
        color,
        depthWrite: false,
        map: glowTexture,
        opacity: traceDimmed ? baseGlowOpacity * TRACE_DIM_FACTOR : baseGlowOpacity,
        transparent: true,
      });
      const glow = new THREE.Sprite(glowMaterial);
      glow.position.copy(sphere.position);
      glow.scale.setScalar(item.radius * (isService ? 7.4 : isFile ? 5.3 : 4.4));
      glow.userData.nodeId = item.node.id;
      glow.userData.baseScale = item.radius * (isService ? 7.4 : isFile ? 5.3 : 4.4);
      sphere.userData.glow = glow;
      graphGroup.add(glow);
    }

    for (const edge of graph.edges) {
      if (!sphereByNodeId.has(edge.source) || !sphereByNodeId.has(edge.target)) {
        continue;
      }
      connectedNodeIdsByNodeId.set(edge.source, new Set([...(connectedNodeIdsByNodeId.get(edge.source) ?? []), edge.target]));
      connectedNodeIdsByNodeId.set(edge.target, new Set([...(connectedNodeIdsByNodeId.get(edge.target) ?? []), edge.source]));
    }

    const currentPositions = nodePositionMap(spaceNodes);
    for (const edge of visibleEdges) {
      const source = currentPositions.get(edge.source);
      const target = currentPositions.get(edge.target);
      if (!source || !target) {
        continue;
      }
      const points = [
        new THREE.Vector3(source.x, source.y, source.z),
        new THREE.Vector3(target.x, target.y, target.z),
      ];
      const isServiceEdge = edge.kind === "connects_service" || (source.node.kind === "service" && target.node.kind === "service");
      const isFileEdge = edge.kind === "contains_file";
      const isApiFileEdge = edge.kind === "declares_api";
      const isFunctionDependencyEdge = (edge.kind === "imports" || edge.kind === "calls") && source.node.kind === "function" && target.node.kind === "function";
      const traceStep = traceStepByEdge.get(edge.id);
      const isTraceEdge = Boolean(traceStep);
      const isParentEdge = edge.kind === "contains_file" || edge.kind === "declares_api" || edge.kind === "contains" || edge.kind === "handled_by";
      const hasLightweightNode = !isHeavyNode(source.node) || !isHeavyNode(target.node);
      const traceColor = TRACE_LINE_COLOR;
      const color = new THREE.Color(isTraceEdge ? traceColor : isServiceEdge ? "#fff0a8" : isFileEdge ? "#fbfdff" : isApiFileEdge ? "#ff4f78" : hasLightweightNode ? "#b4b4b4" : target.node.kind === "api_endpoint" ? nodeColor(target.node) : target.node.kind === "file" ? nodeColor(target.node) : isParentEdge ? "#eaf6ff" : nodeColor(source.node));
      const tubeRadius = isTraceEdge ? 2.4 : isServiceEdge ? 2 : isFileEdge || isApiFileEdge ? 1.5 : isParentEdge ? 0.72 : 0;
      const initialLineOpacity = isTraceEdge ? 1 : isServiceEdge ? 0.96 : tubeRadius > 0 ? 0.58 : isParentEdge ? 0.58 : 0.42;
      const visibleLineOpacity = hasActiveTrace && !isTraceEdge ? initialLineOpacity * TRACE_DIM_FACTOR : initialLineOpacity;
      const line = tubeRadius > 0
        ? (() => {
          const geometry = new LineGeometry();
          geometry.setPositions([
            points[0].x, points[0].y, points[0].z,
            points[1].x, points[1].y, points[1].z,
          ]);
          const material = new LineMaterial({
            blending: THREE.AdditiveBlending,
            color: color.getHex(),
            depthWrite: false,
            linewidth: tubeRadius * 1.7,
            opacity: visibleLineOpacity,
            resolution: new THREE.Vector2(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1)),
            transparent: true,
          });
          const wideLine = new Line2(geometry, material);
          wideLine.userData.isWideLine = true;
          return wideLine;
        })()
        : new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            blending: THREE.AdditiveBlending,
            color,
            opacity: visibleLineOpacity,
            transparent: true,
          }),
        );
      line.userData.source = edge.source;
      line.userData.target = edge.target;
      line.userData.edgeId = edge.id;
      line.userData.kind = edge.kind;
      line.userData.baseOpacity = isTraceEdge ? 1 : isServiceEdge ? 0.76 : isParentEdge ? 0.58 : 0.42;
      line.userData.traceOrder = traceStep?.order ?? null;
      line.userData.traceDirection = traceStep?.direction ?? "forward";
      line.userData.isTraceEdge = isTraceEdge;
      line.userData.isServiceEdge = isServiceEdge;
      line.userData.isFunctionDependencyEdge = isFunctionDependencyEdge;
      line.userData.baseLinewidth = tubeRadius * 1.7;
      line.userData.baseColor = color.getHex();
      line.userData.sourcePoint = points[0].clone();
      line.userData.targetPoint = points[1].clone();
      line.userData.sourceSphere = sphereByNodeId.get(edge.source) ?? null;
      line.userData.targetSphere = sphereByNodeId.get(edge.target) ?? null;
      line.userData.packetScale = tubeRadius > 0 ? tubeRadius / 2 : 0.36;
      lineObjects.push(line);
      graphGroup.add(line);
    }

    for (let index = 0; index < MAX_PACKET_COUNT; index += 1) {
      const packet = new THREE.Mesh(
        new THREE.SphereGeometry(5.6, 14, 10),
        new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          color: "#ffffff",
          opacity: 0,
          transparent: true,
        }),
      );
      packet.userData.phase = stableUnit(`packet:${index}`);
      packetObjects.push(packet);
      graphGroup.add(packet);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragState = {
      active: false,
      mode: "rotate" as "rotate" | "pan",
      moved: false,
      x: 0,
      y: 0,
    };
    const screenCulledNodeIds = new Set<string>();
    function resize() {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      for (const line of lineObjects) {
        if (line.userData.isWideLine) {
          (line.material as LineMaterial).resolution.set(width, height);
        }
      }
      const streaks = tailGlowStreaks.userData.streaks as TailGlowStreak[] | undefined;
      streaks?.forEach((streak) => {
        (streak.core.material as LineMaterial).resolution.set(width, height);
        (streak.halo.material as LineMaterial).resolution.set(width, height);
      });
      focusOffsetRef.current.set(focusViewportOffset(width), 0, 0);
    }

    function focusTarget() {
      function rotatedVisibleCentroid() {
        const center = nodeCentroid(positionsRef.current.values());
        return center ? center.applyEuler(graphGroup.rotation) : null;
      }

      function visibleCentroidTarget() {
        const rotatedCenter = rotatedVisibleCentroid();
        return rotatedCenter ? panOffsetRef.current.clone().sub(rotatedCenter) : null;
      }

      if (hasActiveTrace) {
        const tracePositions = [...traceNodeIds]
          .map((nodeId) => positionsRef.current.get(nodeId))
          .filter((item): item is SpaceNode => Boolean(item));
        if (tracePositions.length) {
          const traceCenter = tracePositions.reduce(
            (center, item) => center.add(new THREE.Vector3(item.x, item.y, item.z)),
            new THREE.Vector3(),
          ).divideScalar(tracePositions.length);
          const rotatedCenter = traceCenter.applyEuler(graphGroup.rotation);
          const focusOffset = screenOffsetToWorld(focusOffsetRef.current, camera, renderer.domElement.clientHeight);
          return panOffsetRef.current.clone().add(focusOffset).sub(rotatedCenter);
        }
      }
      if (resetViewActiveRef.current || !selectedIdRef.current) {
        return visibleCentroidTarget();
      }
      const selectedPosition = positionsRef.current.get(selectedIdRef.current);
      if (!selectedPosition) {
        return null;
      }
      const rotatedSelected = new THREE.Vector3(selectedPosition.x, selectedPosition.y, selectedPosition.z).applyEuler(graphGroup.rotation);
      const focusOffset = screenOffsetToWorld(focusOffsetRef.current, camera, renderer.domElement.clientHeight);
      return panOffsetRef.current.clone().add(focusOffset).sub(rotatedSelected);
    }

    function syncPanOffsetToVisibleCentroid() {
      const center = nodeCentroid(positionsRef.current.values());
      if (!center) {
        panOffsetRef.current.copy(graphGroup.position);
        return;
      }
      panOffsetRef.current.copy(graphGroup.position).add(center.applyEuler(graphGroup.rotation));
    }

    function syncPanOffsetToTraceCentroid() {
      const tracePositions = [...traceNodeIds]
        .map((nodeId) => positionsRef.current.get(nodeId))
        .filter((item): item is SpaceNode => Boolean(item));
      if (!tracePositions.length) {
        panOffsetRef.current.copy(graphGroup.position);
        return;
      }
      const traceCenter = tracePositions.reduce(
        (center, item) => center.add(new THREE.Vector3(item.x, item.y, item.z)),
        new THREE.Vector3(),
      ).divideScalar(tracePositions.length);
      const focusOffset = screenOffsetToWorld(focusOffsetRef.current, camera, renderer.domElement.clientHeight);
      panOffsetRef.current.copy(graphGroup.position).sub(focusOffset).add(traceCenter.applyEuler(graphGroup.rotation));
    }

    function projectNeighborOverlay(nodeId: string, rect: DOMRect): NeighborOverlay | null {
      const sphere = sphereByNodeId.get(nodeId);
      const node = graphNodeById.get(nodeId);
      if (!sphere || !node || sphere.userData.screenCulled) {
        return null;
      }
      const worldPosition = new THREE.Vector3();
      sphere.getWorldPosition(worldPosition);
      const projected = worldPosition.project(camera);
      if (projected.z < -1 || projected.z > 1) {
        return null;
      }
      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      return {
        id: nodeId,
        node,
        x: Math.min(Math.max(screenX + 10, 12), Math.max(rect.width - 184, 12)),
        y: Math.min(Math.max(screenY - 14, 12), Math.max(rect.height - 58, 12)),
      };
    }

    function updateNeighborOverlays(node: CodeNode | null, rect: DOMRect) {
      const overlayIds = new Set<string>();
      if (hasActiveTrace) {
        traceNodeIds.forEach((nodeId) => overlayIds.add(nodeId));
      }
      if (showSelectedOverlaysRef.current && selectedIdRef.current) {
        overlayIds.add(selectedIdRef.current);
        for (const nodeId of connectedNodeIdsByNodeId.get(selectedIdRef.current) ?? []) {
          overlayIds.add(nodeId);
        }
      }
      if (node && showHoverOverlaysRef.current && !hasActiveTrace) {
        for (const nodeId of connectedNodeIdsByNodeId.get(node.id) ?? []) {
          overlayIds.add(nodeId);
        }
      }
      if (!overlayIds.size) {
        setNeighborOverlays((current) => current.length ? [] : current);
        return;
      }
      const overlays = [...overlayIds]
        .map((nodeId) => projectNeighborOverlay(nodeId, rect))
        .filter((item): item is NeighborOverlay => Boolean(item));
      setNeighborOverlays((current) => {
        const same = current.length === overlays.length
          && current.every((item, index) => item.id === overlays[index]?.id && Math.abs(item.x - overlays[index].x) < 1 && Math.abs(item.y - overlays[index].y) < 1);
        return same ? current : overlays;
      });
    }

    function pickNode(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(sphereObjects, false).find((item) => !item.object.userData.screenCulled);
      if (hit) {
        const nodeId = hit.object.userData.nodeId as string;
        return graphNodeById.get(nodeId) ?? null;
      }
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      let nearestNodeId = "";
      let nearestDistance = HOVER_PICK_RADIUS_PX;
      const worldPosition = new THREE.Vector3();
      for (const sphere of sphereObjects) {
        if (sphere.userData.screenCulled) {
          continue;
        }
        sphere.getWorldPosition(worldPosition);
        const projected = worldPosition.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) {
          continue;
        }
        const screenX = (projected.x * 0.5 + 0.5) * rect.width;
        const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
        const nodeId = sphere.userData.nodeId as string;
        const node = graphNodeById.get(nodeId);
        const apiPriority = node && (node.kind === "api_endpoint" || node.kind === "websocket_endpoint" || node.kind === "api_client" || node.kind === "route") ? 9 : 0;
        const distance = Math.max(0, Math.hypot(pointerX - screenX, pointerY - screenY) - apiPriority);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestNodeId = nodeId;
        }
      }
      if (nearestNodeId) {
        return graphNodeById.get(nearestNodeId) ?? null;
      }
      return null;
    }

    function updateHoverProximity(event: PointerEvent, rect: DOMRect) {
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldPosition = new THREE.Vector3();
      const candidates: Array<{ id: string; distance: number }> = [];
      for (const sphere of sphereObjects) {
        if (sphere.userData.screenCulled) {
          continue;
        }
        sphere.getWorldPosition(worldPosition);
        const projected = worldPosition.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) {
          continue;
        }
        const screenX = (projected.x * 0.5 + 0.5) * rect.width;
        const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
        const distance = Math.hypot(pointerX - screenX, pointerY - screenY);
        if (distance <= HOVER_GLOW_RADIUS_PX) {
          candidates.push({ id: sphere.userData.nodeId as string, distance });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      hoverProximityNodeIdsRef.current = new Set(candidates.slice(0, HOVER_GLOW_MAX_NODES).map((item) => item.id));
    }

    function updateFunSteering(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      funState.targetSteerX = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -1, 1);
      funState.targetSteerY = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1, -1, 1);
      const node = pickNode(event);
      if (node) {
        const sphere = sphereByNodeId.get(node.id);
        const worldPosition = new THREE.Vector3();
        sphere?.getWorldPosition(worldPosition);
        const distance = sphere ? worldPosition.distanceTo(funState.position) - ((sphere.userData.baseRadius as number | undefined) ?? 0) : Number.POSITIVE_INFINITY;
        if (distance <= FUN_HOVER_PROXIMITY_RADIUS) {
          funHoverTarget = { node, x: event.clientX - rect.left, y: event.clientY - rect.top };
          renderer.domElement.style.cursor = "pointer";
          return;
        }
      }
      funHoverTarget = null;
      renderer.domElement.style.cursor = "crosshair";
    }

    function onPointerDown(event: PointerEvent) {
      if (funModeRef.current) {
        event.preventDefault();
        updateFunSteering(event);
        if (event.button === 2) {
          funState.targetSpeed = 0;
          return;
        }
        if (event.button === 0) {
          const node = pickNode(event);
          if (node) {
            onSelectRef.current(node.id);
          } else {
            onDeselectRef.current();
          }
        }
        return;
      }
      if (!selectedIdRef.current && !hasActiveTrace) {
        syncPanOffsetToVisibleCentroid();
      }
      resetViewActiveRef.current = false;
      hoverNodeIdRef.current = null;
      hoverProximityNodeIdsRef.current = new Set();
      setHover(null);
      updateNeighborOverlays(null, renderer.domElement.getBoundingClientRect());
      dragState.active = true;
      dragState.mode = event.shiftKey || event.button === 1 || event.button === 2 ? "pan" : "rotate";
      dragState.moved = false;
      dragState.x = event.clientX;
      dragState.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (funModeRef.current) {
        updateFunSteering(event);
        return;
      }
      if (dragState.active) {
        const dx = event.clientX - dragState.x;
        const dy = event.clientY - dragState.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          dragState.moved = true;
        }
        if (dragState.mode === "pan") {
          panOffsetRef.current.x += dx * 0.82;
          panOffsetRef.current.y -= dy * 0.82;
        } else {
          graphGroup.rotation.y += dx * 0.006;
          graphGroup.rotation.x = clamp(graphGroup.rotation.x + dy * 0.004, -0.95, 0.95);
          const targetPosition = focusTarget();
          if (targetPosition) {
            graphGroup.position.copy(targetPosition);
            focusTransition = null;
          }
        }
        overlayNextUpdateAt = 0;
        dragState.x = event.clientX;
        dragState.y = event.clientY;
        return;
      }
      if (hasActiveTrace) {
        hoverNodeIdRef.current = null;
        hoverProximityNodeIdsRef.current = new Set();
        renderer.domElement.style.cursor = "grab";
        setHover(null);
        updateNeighborOverlays(null, renderer.domElement.getBoundingClientRect());
        return;
      }
      const node = pickNode(event);
      hoverNodeIdRef.current = node?.id ?? null;
      const rect = renderer.domElement.getBoundingClientRect();
      updateHoverProximity(event, rect);
      renderer.domElement.style.cursor = node ? "pointer" : "grab";
      setHover(node ? { node, x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
      updateNeighborOverlays(node, rect);
    }

    function onPointerUp(event: PointerEvent) {
      if (funModeRef.current) {
        return;
      }
      const node = !dragState.moved ? pickNode(event) : null;
      dragState.active = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      if (node) {
        onSelectRef.current(node.id);
      } else if (!dragState.moved) {
        if (hasActiveTrace) {
          syncPanOffsetToTraceCentroid();
        } else {
          syncPanOffsetToVisibleCentroid();
        }
        onDeselectRef.current();
      }
    }

    function onPointerLeave() {
      dragState.active = false;
      if (funModeRef.current) {
        funState.targetSteerX = 0;
        funState.targetSteerY = 0;
        funHoverTarget = null;
        hoverNodeIdRef.current = null;
        hoverProximityNodeIdsRef.current = new Set();
        setHover(null);
        updateNeighborOverlays(null, renderer.domElement.getBoundingClientRect());
        return;
      }
      hoverNodeIdRef.current = null;
      hoverProximityNodeIdsRef.current = new Set();
      setHover(null);
      updateNeighborOverlays(null, renderer.domElement.getBoundingClientRect());
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      resetViewActiveRef.current = false;
      if (funModeRef.current) {
        funState.targetSpeed = clamp(funState.targetSpeed - event.deltaY * FUN_SCROLL_SPEED_STEP, FUN_MAX_REVERSE_SPEED, FUN_MAX_FORWARD_SPEED);
        return;
      }
      if (event.shiftKey) {
        panOffsetRef.current.x -= event.deltaY * 0.4;
        panOffsetRef.current.y += event.deltaX * 0.4;
        overlayNextUpdateAt = 0;
        return;
      }
      const nextCameraDistance = clamp(camera.position.z + event.deltaY * 0.62, minCameraDistance, maxCameraDistance);
      if (!selectedIdRef.current && !hasActiveTrace) {
        syncPanOffsetToVisibleCentroid();
        const rect = renderer.domElement.getBoundingClientRect();
        const pointerOffset = new THREE.Vector3(
          event.clientX - rect.left - rect.width / 2,
          rect.height / 2 - (event.clientY - rect.top),
          0,
        );
        const zoomOffset = screenOffsetToWorld(pointerOffset, camera, renderer.domElement.clientHeight);
        camera.position.z = nextCameraDistance;
        panOffsetRef.current.add(screenOffsetToWorld(pointerOffset, camera, renderer.domElement.clientHeight).sub(zoomOffset));
      } else {
        camera.position.z = nextCameraDistance;
      }
      const targetPosition = focusTarget();
      if (targetPosition) {
        graphGroup.position.copy(targetPosition);
      }
      overlayNextUpdateAt = 0;
    }

    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    let frame = 0;
    let frameIndex = 0;
    let focusedTargetKey = "";
    let focusTransition: { from: THREE.Vector3; startAt: number; duration: number } | null = null;
    let packetNodeId = selectedIdRef.current;
    let functionMarkerCycleStartedAt = performance.now();
    let packetInitialBurstPending = true;
    let packetNextLaunchAt = 0;
    let overlayNextUpdateAt = 0;
    let lodNextCheckAt = 0;
    let fpsNextReportAt = 0;
    let lastFrameAt = performance.now();
    let rollingFps = 60;
    let lastHoverNodeId: string | null = null;
    const worldPositionScratch = new THREE.Vector3();
    const projectedPositionScratch = new THREE.Vector3();
    const packetCooldownUntil = new Map<string, number>();
    function hidePackets() {
      for (const packet of packetObjects) {
        packet.userData.edge = null;
        packet.userData.edgeId = null;
        (packet.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    }

    function eligiblePacketEdges(activeDepths: Map<string, number>, now: number) {
      const busyEdgeIds = new Set(
        packetObjects
          .map((packet) => packet.userData.edgeId as string | null)
          .filter((edgeId): edgeId is string => Boolean(edgeId)),
      );
      const traceLines = lineObjects
        .filter((line) => line.userData.isTraceEdge)
        .filter((line) => line.visible)
        .filter((line) => {
          const edgeId = line.userData.edgeId as string;
          return (packetCooldownUntil.get(edgeId) ?? 0) <= now;
        })
        .sort((a, b) => (a.userData.traceOrder as number) - (b.userData.traceOrder as number));
      if (hasActiveTrace) {
        return traceLines;
      }
      if (traceLines.length) {
        return traceLines;
      }
      return lineObjects
        .filter((line) => line.visible)
        .filter((line) => {
          const edgeId = line.userData.edgeId as string;
          if (busyEdgeIds.has(edgeId) || (packetCooldownUntil.get(edgeId) ?? 0) > now) {
            return false;
          }
          const sourceDepth = activeDepths.get(line.userData.source as string);
          const targetDepth = activeDepths.get(line.userData.target as string);
          return sourceDepth !== undefined && targetDepth !== undefined && Math.max(sourceDepth, targetDepth) <= 3;
        })
        .map((line) => ({ line, order: Math.random() }))
        .sort((a, b) => a.order - b.order)
        .map((item) => item.line);
    }

    function launchPackets(count: number, activeDepths: Map<string, number>, now: number) {
      const freePackets = packetObjects.filter((packet) => !packet.userData.edge);
      const packetEdges = eligiblePacketEdges(activeDepths, now);
      const launches = Math.min(count, freePackets.length, packetEdges.length);
      for (let index = 0; index < launches; index += 1) {
        const packet = freePackets[index];
        const packetEdge = packetEdges[index];
        const material = packet.material as THREE.MeshBasicMaterial;
        const sourcePoint = packetEdge.userData.sourcePoint as THREE.Vector3;
        const targetPoint = packetEdge.userData.targetPoint as THREE.Vector3;
        const traceDirection = packetEdge.userData.traceDirection as string | undefined;
        const direction = traceDirection === "reverse" ? -1 : traceDirection === "forward" ? 1 : Math.random() < 0.5 ? 1 : -1;
        const edgeId = packetEdge.userData.edgeId as string;
        packet.userData.edge = packetEdge;
        packet.userData.edgeId = edgeId;
        packet.userData.startedAt = now;
        packet.userData.direction = direction;
        const travelMs = packetTravelMs(sourcePoint, targetPoint);
        packet.userData.travelMs = travelMs;
        packet.position.copy(direction > 0 ? sourcePoint : targetPoint);
        packet.scale.setScalar(packetEdge.userData.packetScale as number);
        material.opacity = 0;
        packetCooldownUntil.set(edgeId, now + (hasActiveTrace ? TRACE_PACKET_REST_MS : travelMs + PACKET_REST_MS));
      }
      return launches;
    }

    function updateFunMode(dt: number, now: number) {
      if (resetViewActiveRef.current) {
        resetFunState();
        resetViewActiveRef.current = false;
        hoverNodeIdRef.current = null;
        setHover(null);
        setNeighborOverlays([]);
      }
      const steerEase = 1 - Math.exp(-dt / FUN_STEER_EASE_MS);
      funState.steerX += (funState.targetSteerX - funState.steerX) * steerEase;
      funState.steerY += (funState.targetSteerY - funState.steerY) * steerEase;
      const speedEase = 1 - Math.exp(-dt / (Math.abs(funState.targetSpeed) < 0.001 ? FUN_STOP_EASE_MS : FUN_SPEED_EASE_MS));
      funState.speed += (funState.targetSpeed - funState.speed) * speedEase;
      if (Math.abs(funState.targetSpeed) < 0.001 && Math.abs(funState.speed) < 0.002) {
        funState.speed = 0;
      }
      const steerDistance = Math.hypot(funState.steerX, funState.steerY);
      if (steerDistance > FUN_STEER_DEAD_ZONE) {
        const steerAmount = clamp((steerDistance - FUN_STEER_DEAD_ZONE) / (1 - FUN_STEER_DEAD_ZONE), 0, 1);
        const steerX = (funState.steerX / steerDistance) * steerAmount;
        const steerY = (funState.steerY / steerDistance) * steerAmount;
        const speedResistance = 1 / (1 + Math.abs(funState.speed) * 4.6);
        const turnStep = (FUN_BASE_TURN_RATE + FUN_EXTRA_TURN_RATE * steerAmount) * dt * speedResistance;
        funState.yaw += steerX * turnStep;
        funState.pitch = clamp(funState.pitch - steerY * turnStep, -FUN_MAX_PITCH, FUN_MAX_PITCH);
      }
      funState.direction.copy(funDirection(funState.yaw, funState.pitch));
      const currentDistance = funState.position.distanceTo(funBounds.center);
      let candidatePosition = funState.position.clone().addScaledVector(funState.direction, funState.speed * dt);
      let candidateDistance = candidatePosition.distanceTo(funBounds.center);
      if (candidateDistance > currentDistance && currentDistance > funBounds.radius - FUN_BOUNDARY_SLOW_RADIUS) {
        const room = clamp((funBounds.radius - currentDistance) / FUN_BOUNDARY_SLOW_RADIUS, 0, 1);
        const maxSpeed = (funState.speed >= 0 ? FUN_MAX_FORWARD_SPEED : Math.abs(FUN_MAX_REVERSE_SPEED)) * (0.12 + room * 0.88);
        if (Math.abs(funState.speed) > maxSpeed) {
          funState.speed = Math.sign(funState.speed) * maxSpeed;
          funState.targetSpeed = Math.sign(funState.targetSpeed || funState.speed) * Math.min(Math.abs(funState.targetSpeed), maxSpeed);
          candidatePosition = funState.position.clone().addScaledVector(funState.direction, funState.speed * dt);
          candidateDistance = candidatePosition.distanceTo(funBounds.center);
        }
      }
      if (candidateDistance > funBounds.radius) {
        const radial = candidatePosition.sub(funBounds.center).normalize();
        candidatePosition = funBounds.center.clone().add(radial.multiplyScalar(funBounds.radius));
        funState.speed *= 0.18;
        funState.targetSpeed = funState.speed;
      }
      funState.position.copy(candidatePosition);
      reportFunSpeedLevel(funState.speed);
      if (selectedIdRef.current) {
        const selectedSphere = sphereByNodeId.get(selectedIdRef.current);
        const selectedWorldPosition = new THREE.Vector3();
        selectedSphere?.getWorldPosition(selectedWorldPosition);
        const selectedDistance = selectedSphere ? selectedWorldPosition.distanceTo(funState.position) - ((selectedSphere.userData.baseRadius as number | undefined) ?? 0) : Number.POSITIVE_INFINITY;
        if (selectedDistance > FUN_HOVER_PROXIMITY_RADIUS) {
          selectedIdRef.current = "";
          onDeselectRef.current();
        }
      }
      vehicleGroup.visible = true;
      vehicleLight.visible = true;
      const speedRatio = clamp(Math.abs(funState.speed) / FUN_MAX_FORWARD_SPEED, 0, 1);
      const forwardSpeedRatio = clamp(Math.max(funState.speed, 0) / FUN_MAX_FORWARD_SPEED, 0, 1);
      const visualYawBlend = THREE.MathUtils.smoothstep(funState.speed / FUN_MAX_FORWARD_SPEED, 0.02, 0.32);
      const targetVisualYaw = funState.steerX * (1 - visualYawBlend * 2) * FUN_MAX_VISUAL_YAW * clamp(speedRatio, 0.35, 1);
      funState.visualYaw += (targetVisualYaw - funState.visualYaw) * (1 - Math.exp(-dt / FUN_VISUAL_YAW_EASE_MS));
      const visualPitchSpeed = THREE.MathUtils.smoothstep(speedRatio, 0.12, 0.75);
      const targetVisualPitch = -funState.steerY * FUN_MAX_VISUAL_PITCH * visualPitchSpeed;
      funState.visualPitch += (targetVisualPitch - funState.visualPitch) * (1 - Math.exp(-dt / FUN_VISUAL_PITCH_EASE_MS));
      const targetVisualRoll = -funState.steerX * 0.32 * clamp(1 - speedRatio, 0.34, 1);
      funState.visualRoll += (targetVisualRoll - funState.visualRoll) * (1 - Math.exp(-dt / FUN_VISUAL_ROLL_EASE_MS));
      const shapeLight = vehicleGroup.userData.shapeLight as THREE.DirectionalLight | undefined;
      const shapeSpot = vehicleGroup.userData.shapeSpot as THREE.SpotLight | undefined;
      const shapeLightTarget = vehicleGroup.userData.shapeLightTarget as THREE.Object3D | undefined;
      const shapeRightLight = vehicleGroup.userData.shapeRightLight as THREE.DirectionalLight | undefined;
      const shapeRightSpot = vehicleGroup.userData.shapeRightSpot as THREE.SpotLight | undefined;
      const shapeRightLightTarget = vehicleGroup.userData.shapeRightLightTarget as THREE.Object3D | undefined;
      const shapeCenterLight = vehicleGroup.userData.shapeCenterLight as THREE.DirectionalLight | undefined;
      const shapeLowerSpot = vehicleGroup.userData.shapeLowerSpot as THREE.SpotLight | undefined;
      const shapeCenterLightTarget = vehicleGroup.userData.shapeCenterLightTarget as THREE.Object3D | undefined;
      if (shapeLightTarget) {
        const shapeTargetX = 10 + funState.visualYaw * 18 + funState.visualRoll * 8;
        shapeLightTarget.position.set(shapeTargetX, -8 + funState.visualPitch * 18, 22 - Math.abs(funState.visualPitch) * 8);
        shapeRightLightTarget?.position.set(-shapeTargetX, -8 + funState.visualPitch * 18, 22 - Math.abs(funState.visualPitch) * 8);
        shapeCenterLightTarget?.position.set(0, -8 + funState.visualPitch * 18, 22 - Math.abs(funState.visualPitch) * 8);
      }
      shapeLightEuler.set(funState.visualPitch * 1.05, funState.visualYaw * 1.35, funState.visualRoll * 0.8, "YXZ");
      shapeLightPosition.copy(shapeLightBase).applyEuler(shapeLightEuler);
      shapeSpotPosition.copy(shapeSpotBase).applyEuler(shapeLightEuler);
      shapeRightLightPosition.copy(shapeRightLightBase).applyEuler(shapeLightEuler);
      shapeRightSpotPosition.copy(shapeRightSpotBase).applyEuler(shapeLightEuler);
      shapeCenterLightPosition.copy(shapeCenterLightBase).applyEuler(shapeLightEuler);
      shapeLowerSpotPosition.copy(shapeLowerSpotBase).applyEuler(shapeLightEuler);
      shapeLight?.position.copy(shapeLightPosition);
      shapeSpot?.position.copy(shapeSpotPosition);
      shapeRightLight?.position.copy(shapeRightLightPosition);
      shapeRightSpot?.position.copy(shapeRightSpotPosition);
      shapeCenterLight?.position.copy(shapeCenterLightPosition);
      shapeLowerSpot?.position.copy(shapeLowerSpotPosition);
      vehicleGroup.position.copy(funState.position);
      vehicleGroup.lookAt(funState.position.clone().add(funState.direction));
      vehicleGroup.rotateY(Math.PI);
      vehicleGroup.rotateY(funState.visualYaw);
      vehicleGroup.rotateX(funState.visualPitch);
      vehicleGroup.rotateZ(funState.visualRoll);
      const aura = vehicleGroup.userData.aura as THREE.Sprite | undefined;
      if (aura) {
        const material = aura.material as THREE.SpriteMaterial;
        const glowPulse = 0.5 + Math.sin(now * 0.004) * 0.5;
        material.opacity = 0.2 + speedRatio * 0.12 + glowPulse * 0.04;
        aura.scale.set(110 + speedRatio * 24, 70 + speedRatio * 18, 1);
      }
      const vehicleGlowNodes = vehicleGroup.userData.vehicleGlowNodes as Array<{ core: THREE.Sprite; glow: THREE.Sprite; light: THREE.PointLight; coreOpacity: number; glowOpacity: number; lightIntensity: number }> | undefined;
      vehicleGlowNodes?.forEach((node) => {
        (node.core.material as THREE.SpriteMaterial).opacity = clamp(node.coreOpacity + forwardSpeedRatio * FUN_VEHICLE_GLOW_FORWARD_CORE_OPACITY_BOOST, 0, 1);
        (node.glow.material as THREE.SpriteMaterial).opacity = clamp(node.glowOpacity + forwardSpeedRatio * FUN_VEHICLE_GLOW_FORWARD_OPACITY_BOOST, 0, 1);
        node.light.intensity = node.lightIntensity * (1 + forwardSpeedRatio * FUN_VEHICLE_GLOW_FORWARD_LIGHT_BOOST);
      });
      const trail = vehicleGroup.userData.trail as THREE.Group | undefined;
      if (trail) {
        trail.visible = false;
      }
      const tailLightTrails = vehicleGroup.userData.tailLightTrails as THREE.Group | undefined;
      if (tailLightTrails) {
        tailLightTrails.visible = false;
      }
      const tailGlowStreaks = vehicleGroup.userData.tailGlowStreaks as THREE.Group | undefined;
      if (tailGlowStreaks) {
        const streaks = tailGlowStreaks.userData.streaks as TailGlowStreak[] | undefined;
        tailGlowStreaks.visible = forwardSpeedRatio > 0.01;
        streaks?.forEach((streak) => {
          const coreMaterial = streak.core.material as LineMaterial;
          const haloMaterial = streak.halo.material as LineMaterial;
          if (forwardSpeedRatio <= 0.01) {
            streak.history.length = 0;
            coreMaterial.opacity = 0;
            haloMaterial.opacity = 0;
            return;
          }
          const emitterWorld = streak.localEmitter.clone();
          vehicleGroup.localToWorld(emitterWorld);
          if (streak.history.length === 0 || emitterWorld.distanceTo(streak.history[0]) >= FUN_TAIL_STREAK_SAMPLE_MIN_DISTANCE) {
            streak.history.unshift(emitterWorld);
            if (streak.history.length > FUN_TAIL_STREAK_POINT_COUNT) {
              streak.history.pop();
            }
          } else {
            streak.history[0].copy(emitterWorld);
          }
          const exhaustDirection = new THREE.Vector3(0, 0, 1).transformDirection(vehicleGroup.matrixWorld);
          const positions: number[] = [];
          const fallback = streak.history[streak.history.length - 1] ?? emitterWorld;
          for (let index = 0; index < FUN_TAIL_STREAK_POINT_COUNT; index += 1) {
            const rawPoint = streak.history[index] ?? fallback;
            const point = rawPoint.clone();
            if (index > 0 && index < FUN_TAIL_STREAK_STRAIGHTEN_POINTS) {
              const projectedDistance = Math.max(0, rawPoint.clone().sub(emitterWorld).dot(exhaustDirection));
              const projectedPoint = emitterWorld.clone().addScaledVector(exhaustDirection, projectedDistance);
              const straightMix = FUN_TAIL_STREAK_STRAIGHTEN_STRENGTH * (1 - index / FUN_TAIL_STREAK_STRAIGHTEN_POINTS);
              point.lerp(projectedPoint, straightMix);
            }
            positions.push(point.x, point.y, point.z);
          }
          streak.core.geometry.setPositions(positions);
          streak.halo.geometry.setPositions(positions);
          coreMaterial.opacity = FUN_TAIL_STREAK_MAX_OPACITY * forwardSpeedRatio;
          haloMaterial.opacity = FUN_TAIL_STREAK_HALO_MAX_OPACITY * forwardSpeedRatio;
          haloMaterial.linewidth = FUN_TAIL_STREAK_HALO_LINEWIDTH * (0.5 + forwardSpeedRatio * 0.5);
        });
      }
      const stardust = vehicleGroup.userData.stardust as THREE.Group | undefined;
      if (stardust) {
        stardust.visible = false;
      }
      const cameraEase = 1 - Math.exp(-dt / FUN_CAMERA_EASE_MS);
      const cameraTarget = funState.position.clone().sub(funState.direction.clone().multiplyScalar(FUN_CAMERA_DISTANCE)).add(new THREE.Vector3(0, FUN_CAMERA_HEIGHT, 0));
      funState.cameraPosition.lerp(cameraTarget, cameraEase);
      camera.position.copy(funState.cameraPosition);
      const cameraQuaternion = camera.quaternion.clone();
      camera.lookAt(funState.position.clone().add(funState.direction.clone().multiplyScalar(FUN_LOOK_AHEAD)));
      const targetCameraQuaternion = camera.quaternion.clone();
      camera.quaternion.copy(cameraQuaternion).slerp(targetCameraQuaternion, cameraEase);
      vehicleLight.intensity = 2.2 + speedRatio * 2.4;
      vehicleLight.position.copy(funState.position).add(new THREE.Vector3(0, 24, 22));
      skySphere.position.copy(camera.position);
      skySphere.rotation.y += funState.speed * dt * 0.000045;
      skySphere.rotation.x += (funState.pitch * 0.08 - skySphere.rotation.x) * 0.03;
      shootingStarGroup.position.copy(camera.position);
    }

    function updateFunProximityOverlay(rect: DOMRect) {
      if (funHoverTarget) {
        const target = funHoverTarget;
        const hoverSphere = sphereByNodeId.get(target.node.id);
        const hoverWorldPosition = new THREE.Vector3();
        hoverSphere?.getWorldPosition(hoverWorldPosition);
        const hoverDistance = hoverSphere ? hoverWorldPosition.distanceTo(funState.position) - ((hoverSphere.userData.baseRadius as number | undefined) ?? 0) : Number.POSITIVE_INFINITY;
        if (hoverDistance <= FUN_HOVER_PROXIMITY_RADIUS) {
          hoverNodeIdRef.current = target.node.id;
          setHover((current) => {
            const next = { node: target.node, x: target.x, y: target.y };
            return current?.node.id === next.node.id && Math.abs(current.x - next.x) < 1 && Math.abs(current.y - next.y) < 1 ? current : next;
          });
          updateNeighborOverlays(showHoverOverlaysRef.current ? target.node : null, rect);
          return;
        }
        funHoverTarget = null;
      }
      let nearestNode: CodeNode | null = null;
      let nearestSphere: THREE.Mesh | null = null;
      let nearestDistance = FUN_PROXIMITY_RADIUS;
      const worldPosition = new THREE.Vector3();
      for (const sphere of sphereObjects) {
        if (sphere.userData.screenCulled) {
          continue;
        }
        sphere.getWorldPosition(worldPosition);
        const distance = worldPosition.distanceTo(funState.position) - ((sphere.userData.baseRadius as number | undefined) ?? 0);
        if (distance < nearestDistance) {
          const nodeId = sphere.userData.nodeId as string;
          nearestNode = graphNodeById.get(nodeId) ?? null;
          nearestSphere = sphere;
          nearestDistance = distance;
        }
      }
      if (!nearestNode || !nearestSphere) {
        hoverNodeIdRef.current = null;
        setHover(null);
        updateNeighborOverlays(null, rect);
        return;
      }
      nearestSphere.getWorldPosition(worldPosition);
      const projected = worldPosition.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) {
        hoverNodeIdRef.current = null;
        setHover(null);
        updateNeighborOverlays(null, rect);
        return;
      }
      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      hoverNodeIdRef.current = nearestNode.id;
      setHover((current) => {
        const next = { node: nearestNode, x: screenX, y: screenY };
        return current?.node.id === next.node.id && Math.abs(current.x - next.x) < 1 && Math.abs(current.y - next.y) < 1 ? current : next;
      });
      updateNeighborOverlays(showHoverOverlaysRef.current ? nearestNode : null, rect);
    }

    function animate() {
      frame = requestAnimationFrame(animate);
      frameIndex += 1;
      const selectedNodeId = selectedIdRef.current;
      const now = performance.now();
      const rawDt = Math.max(1, now - lastFrameAt);
      const dt = Math.min(48, rawDt);
      lastFrameAt = now;
      const currentFunMode = funModeRef.current;
      if (currentFunMode !== lastFunMode) {
        if (currentFunMode) {
          enterFunMode();
        } else {
          exitFunMode();
        }
        lastFunMode = currentFunMode;
      }
      rollingFps += ((1000 / rawDt) - rollingFps) * FPS_SMOOTHING;
      if (now >= fpsNextReportAt) {
        onFpsChangeRef.current(Math.round(rollingFps));
        fpsNextReportAt = now + 300;
      }
      const performanceTier = performanceTierForFps(rollingFps);
      const emergencyEffects = performanceTier === PERFORMANCE_TIERS.emergency;
      const glowIntensityMultiplier = clamp(glowIntensityRef.current, 0.5, 2);
      const shouldCheckLod = now >= lodNextCheckAt;
      if (shouldCheckLod) {
        lodNextCheckAt = now + performanceTier.lodCheckMs;
      }
      if (selectedNodeId !== packetNodeId) {
        packetNodeId = selectedNodeId;
        functionMarkerCycleStartedAt = now;
        packetInitialBurstPending = true;
        packetNextLaunchAt = now + (hasActiveTrace ? TRACE_PACKET_STAGGER_MS : PACKET_STAGGER_MS);
        packetCooldownUntil.clear();
        hidePackets();
      }
      if (currentFunMode) {
        updateFunMode(dt, now);
      } else {
        const resetActive = resetViewActiveRef.current;
        const targetKey = hasActiveTrace
          ? resetActive ? `trace-reset:${activeTrace?.trace_id ?? [...traceNodeIds].join(",")}:${resetViewSignalRef.current}` : `trace:${activeTrace?.trace_id ?? [...traceNodeIds].join(",")}`
          : resetActive ? `reset:${resetViewSignalRef.current}` : `node:${selectedNodeId}`;
        if (resetActive) {
          const targetDistance = fitCameraDistance(initialCameraExtent, minCameraDistance, maxCameraDistance);
          camera.position.z += (targetDistance - camera.position.z) * 0.12;
        }
        if (targetKey !== focusedTargetKey) {
          focusTransition = { from: graphGroup.position.clone(), startAt: now, duration: hasActiveTrace ? 1450 : 1250 };
          focusedTargetKey = targetKey;
        }
        const targetPosition = focusTarget();
        if (targetPosition) {
          if (focusTransition) {
            const progress = clamp((now - focusTransition.startAt) / focusTransition.duration, 0, 1);
            graphGroup.position.copy(focusTransition.from).lerp(targetPosition, easedCruise(progress));
            if (progress >= 1) {
              focusTransition = null;
            }
          } else {
            graphGroup.position.lerp(targetPosition, 0.12);
          }
        } else {
          graphGroup.position.lerp(panOffsetRef.current, 0.12);
        }
        skySphere.position.copy(camera.position);
        starfield.rotation.x += (graphGroup.rotation.x * 0.22 - starfield.rotation.x) * 0.08;
        starfield.rotation.y += (graphGroup.rotation.y * 0.22 - starfield.rotation.y) * 0.08;
        starfield.position.x += (panOffsetRef.current.x * 0.18 - starfield.position.x) * 0.08;
        starfield.position.y += (panOffsetRef.current.y * 0.18 - starfield.position.y) * 0.08;
        shootingStarGroup.rotation.x += (graphGroup.rotation.x * 0.16 - shootingStarGroup.rotation.x) * 0.08;
        shootingStarGroup.rotation.y += (graphGroup.rotation.y * 0.16 - shootingStarGroup.rotation.y) * 0.08;
        shootingStarGroup.position.x += (panOffsetRef.current.x * 0.12 - shootingStarGroup.position.x) * 0.08;
        shootingStarGroup.position.y += (panOffsetRef.current.y * 0.12 - shootingStarGroup.position.y) * 0.08;
      }
      updateShootingStars(shootingStarObjects, now);
      const activeDepths = depthsRef.current;
      const hoverNodeId = hoverNodeIdRef.current;
      if (hoverNodeId !== lastHoverNodeId) {
        lastHoverNodeId = hoverNodeId;
      }
      const hoverSphere = hoverNodeId ? sphereByNodeId.get(hoverNodeId) : null;
      const hoverBasePosition = hoverSphere?.userData.basePosition as THREE.Vector3 | undefined;
      const selectedSphere = sphereByNodeId.get(selectedNodeId);
      const selectedBasePosition = selectedSphere?.userData.basePosition as THREE.Vector3 | undefined;
      const selectedNeighborIds = selectedNodeId ? connectedNodeIdsByNodeId.get(selectedNodeId) : undefined;
      const selectedParentId = selectedNodeId ? parentByNodeId.get(selectedNodeId) : undefined;
      const hoverNeighborIds = hoverNodeId ? connectedNodeIdsByNodeId.get(hoverNodeId) : undefined;
      const hoverProximityNodeIds = hoverProximityNodeIdsRef.current;
      for (const sphere of sphereObjects) {
        const nodeId = sphere.userData.nodeId as string;
        const material = sphere.material as THREE.MeshStandardMaterial;
        const basePosition = sphere.userData.basePosition as THREE.Vector3;
        const spreadTarget = basePosition.clone();
        if (selectedBasePosition && nodeId !== selectedNodeId) {
          applyNodeSpread(spreadTarget, basePosition, selectedBasePosition, SELECTED_SPREAD_RADIUS, SELECTED_SPREAD_STRENGTH, `selected-spread:${nodeId}`);
        }
        if (hoverBasePosition && nodeId !== hoverNodeId) {
          applyNodeSpread(spreadTarget, basePosition, hoverBasePosition, HOVER_SPREAD_RADIUS, HOVER_SPREAD_STRENGTH, `hover-spread:${nodeId}`);
        }
        const sphereMoved = sphere.position.distanceToSquared(spreadTarget) > 0.001;
        if (sphereMoved) {
          sphere.position.lerp(spreadTarget, HOVER_SPREAD_EASE);
        }
        const visualDepth = activeDepths.get(nodeId);
        const isSelected = nodeId === selectedNodeId;
        const isHover = nodeId === hoverNodeId;
        const isTraceNode = sphere.userData.isTraceNode as boolean;
        const traceDimmed = hasActiveTrace && !isTraceNode;
        const selectedEmphasis = isSelected && !traceDimmed;
        const connectedToFocus = Boolean(selectedNeighborIds?.has(nodeId) || hoverNeighborIds?.has(nodeId));
        const isTraceFocusNode = hasActiveTrace && isTraceNode;
        const nodeKind = sphere.userData.nodeKind as NodeKind;
        const isStructuralAuraNode = nodeKind === "service" || nodeKind === "file" || nodeKind === "config_file";
        const isCursorNear = hoverProximityNodeIds.has(nodeId);
        const hoverSpreadGlow = hoverBasePosition && nodeId !== hoverNodeId
          ? Math.max(0, 0.52 * Math.pow(1 - Math.min(basePosition.distanceTo(hoverBasePosition), HOVER_SPREAD_RADIUS) / HOVER_SPREAD_RADIUS, 2))
          : 0;
        const selectionDepthGlow = selectedNodeId && visualDepth !== undefined && visualDepth <= MAX_DEPTH && !traceDimmed ? Math.max(0.12, 0.62 - visualDepth * 0.14) : 0;
        const highlightTarget = Math.max(
          selectedEmphasis || isHover ? 1 : 0,
          isTraceFocusNode ? 0.82 : 0,
          connectedToFocus ? 0.58 : 0,
          selectionDepthGlow,
          isCursorNear ? 0.72 : 0,
          hoverSpreadGlow,
        );
        const previousHighlightIntensity = (sphere.userData.highlightIntensity as number | undefined) ?? 0;
        const highlightIntensity = previousHighlightIntensity + (highlightTarget - previousHighlightIntensity) * HIGHLIGHT_EASE;
        sphere.userData.highlightIntensity = highlightIntensity < HIGHLIGHT_IDLE_CUTOFF && highlightTarget === 0 ? 0 : highlightIntensity;
        const isHighlighted = highlightTarget > 0 || highlightIntensity > HIGHLIGHT_IDLE_CUTOFF;
        const isProtectedNode = isHighlighted || isTraceFocusNode || isCursorNear || hoverSpreadGlow > 0;
        const shouldRefreshMetrics = shouldCheckLod || isProtectedNode || sphereMoved;
        if (shouldRefreshMetrics) {
          updateSphereScreenMetrics(sphere, camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight, worldPositionScratch, projectedPositionScratch);
        }
        const projectedRadiusPx = (sphere.userData.projectedRadiusPx as number | undefined) ?? 0;
        const offscreen = Boolean(sphere.userData.offscreen);
        const rim = sphere.userData.rim as THREE.Mesh;
        const glow = sphere.userData.glow as THREE.Sprite;
        const cullBelowPx = tinyNodeCullBelowPxRef.current;
        const restoreAbovePx = Math.max(tinyNodeRestoreAbovePxRef.current, cullBelowPx);
        const wasScreenCulled = Boolean(sphere.userData.screenCulled);
        const screenCullCandidate = cullBelowPx > 0
          && screenCullKindsRef.current.has(nodeKind)
          && nodeKind !== "service"
          && !selectedEmphasis
          && !isHover
          && !isTraceFocusNode
          && !isCursorNear
          && hoverSpreadGlow <= 0;
        const screenCulled = screenCullCandidate
          ? wasScreenCulled ? projectedRadiusPx < restoreAbovePx : projectedRadiusPx < cullBelowPx
          : false;
        sphere.userData.screenCulled = screenCulled;
        if (screenCulled) {
          screenCulledNodeIds.add(nodeId);
          sphere.visible = false;
          rim.visible = false;
          glow.visible = false;
          continue;
        }
        screenCulledNodeIds.delete(nodeId);
        sphere.visible = true;
        const lodTier = resolvedNodeLod(projectedRadiusPx, selectedEmphasis, isHover, isTraceFocusNode, connectedToFocus, isHighlighted);
        if (shouldRefreshMetrics) {
          updateSphereLod(sphere, lodTier);
        }
        const foregroundNode = projectedRadiusPx >= 50;
        const foregroundUpdateFrame = frameIndex % performanceTier.neighborFrameInterval === 0;
        const backgroundUpdateFrame = frameIndex % performanceTier.backgroundFrameInterval === 0;
        const persistentStructuralAura = isStructuralAuraNode && !traceDimmed && !emergencyEffects;
        const idleStructuralTwinkle = twinkleEnabledRef.current && persistentStructuralAura && !selectedNodeId ? idleStructuralTwinkleStrength(idleTwinkleProfileByNodeId.get(nodeId), now) : 0;
        const shouldUpdateEffects = isHighlighted || isTraceFocusNode || isCursorNear || hoverSpreadGlow > 0 || idleStructuralTwinkle > 0 || persistentStructuralAura || (connectedToFocus && foregroundUpdateFrame) || (foregroundNode && foregroundUpdateFrame) || backgroundUpdateFrame;
        const renderEffects = !offscreen || isProtectedNode;
        rim.visible = renderEffects;
        glow.visible = renderEffects;
        if (!renderEffects || (!shouldUpdateEffects && !sphereMoved)) {
          continue;
        }
        let effectStrength = performanceTier.effectStrength * lodTier.effectScale;
        let glowEffectStrength = emergencyEffects ? performanceTier.effectStrength * lodTier.effectScale : 0.18;
        if (highlightIntensity > HIGHLIGHT_IDLE_CUTOFF) {
          effectStrength = Math.max(effectStrength, highlightIntensity * lodTier.effectScale);
          glowEffectStrength = Math.max(glowEffectStrength, highlightIntensity);
        }
        if (isCursorNear) {
          effectStrength = Math.max(effectStrength, 0.42 * lodTier.effectScale);
          glowEffectStrength = Math.max(glowEffectStrength, 0.72);
        }
        if (hoverSpreadGlow) {
          effectStrength = Math.max(effectStrength, hoverSpreadGlow * lodTier.effectScale);
          glowEffectStrength = Math.max(glowEffectStrength, hoverSpreadGlow);
        }
        if (idleStructuralTwinkle) {
          effectStrength = Math.max(effectStrength, (0.22 + idleStructuralTwinkle * 0.78) * lodTier.effectScale);
          glowEffectStrength = Math.max(glowEffectStrength, 0.48 + idleStructuralTwinkle * 0.52);
        }
        if (persistentStructuralAura && !selectedEmphasis && !isHover && !isTraceFocusNode) {
          const structuralAuraFloor = selectedNodeId ? visualDepth !== undefined ? Math.max(0.16, 0.36 - visualDepth * 0.055) : 0.16 : 0.36;
          glowEffectStrength = Math.max(glowEffectStrength, structuralAuraFloor);
        }
        const richEffect = effectStrength > 0.28 && (isHighlighted || (visualDepth !== undefined && visualDepth <= 1 && projectedRadiusPx >= 16));
        const richGlowEffect = glowEffectStrength > 0.12 && (isHighlighted || isCursorNear || hoverSpreadGlow > 0 || idleStructuralTwinkle > 0 || persistentStructuralAura || (visualDepth !== undefined && visualDepth <= 1 && projectedRadiusPx >= 16));
        const unselectedAura = persistentStructuralAura && !selectedEmphasis;
        const phase = sphere.userData.phase as number;
        const pulseSpeed = sphere.userData.pulseSpeed as number;
        const pulseAmount = sphere.userData.pulseAmount as number;
        const pulseWave = richEffect ? (Math.sin(now * pulseSpeed + phase) + 1) / 2 : 0.5;
        const baseOpacity = sphere.userData.baseOpacity as number;
        const normalTargetOpacity = hasActiveTrace ? Math.max(baseOpacity, depthOpacity(visualDepth)) : baseOpacity;
        const targetOpacity = traceDimmed ? Math.max(0.035, normalTargetOpacity * TRACE_DIM_FACTOR) : normalTargetOpacity;
        const targetScale = Math.max(depthScale(visualDepth, selectedEmphasis), 0.86 + highlightIntensity * 0.62, hasActiveTrace && isTraceNode ? 1.48 : 0);
        const stellarPulse = richEffect ? 1 + (pulseWave - 0.5) * 2 * (pulseAmount + highlightIntensity * 0.07) * effectStrength : 1;
        const baseColor = sphere.userData.baseColor as THREE.Color;
        const hotColor = sphere.userData.hotColor as THREE.Color;
        const twinkleColor = sphere.userData.twinkleColor as THREE.Color;
        const baseEmissive = sphere.userData.baseEmissive as number;
        const colorPulse = traceDimmed ? (0.02 + pulseWave * 0.04) * effectStrength : Math.max(highlightIntensity * (0.24 + pulseWave * 0.58), richEffect && visualDepth !== undefined ? (0.16 + pulseWave * 0.32) * effectStrength : 0.04 * effectStrength);
        const twinkleColorPulse = idleStructuralTwinkle ? 0.38 + idleStructuralTwinkle * 0.56 : 0;
        const activeColorPulse = Math.max(colorPulse, twinkleColorPulse);
        const brightness = traceDimmed ? TRACE_DIM_FACTOR : 1;
        material.opacity += (targetOpacity - material.opacity) * (traceDimmed ? 0.42 : 0.12);
        material.color.copy(baseColor).lerp(idleStructuralTwinkle ? twinkleColor : hotColor, activeColorPulse);
        const ambientEmissiveTarget = richEffect && visualDepth !== undefined ? baseEmissive * (1 + pulseWave * 0.58 * effectStrength) : baseEmissive * (0.48 + 0.14 * effectStrength);
        const highlightEmissiveTarget = baseEmissive * (0.48 + highlightIntensity * (0.98 + pulseWave * 0.78));
        material.emissiveIntensity += ((Math.max(ambientEmissiveTarget, highlightEmissiveTarget) * brightness) - material.emissiveIntensity) * (traceDimmed ? 0.42 : 0.12);
        sphere.scale.setScalar(sphere.scale.x + (targetScale * stellarPulse - sphere.scale.x) * 0.12);
        const rimMaterial = rim.material as THREE.ShaderMaterial;
        if (sphereMoved || richEffect) {
          rim.position.copy(sphere.position);
        }
        rim.scale.setScalar(targetScale * (richEffect ? 1.06 + pulseWave * 0.22 * effectStrength : 1.03));
        rimMaterial.uniforms.uPulse.value += ((richEffect ? pulseWave * effectStrength : 0) - rimMaterial.uniforms.uPulse.value) * 0.16;
        const rimTargetOpacity = Math.min(1, Math.max((hasActiveTrace || richEffect) ? (richEffect && visualDepth !== undefined ? 0.48 * effectStrength : 0.12) : 0.1 * effectStrength, highlightIntensity * 0.82) * brightness * glowIntensityMultiplier);
        rimMaterial.uniforms.uOpacity.value += (rimTargetOpacity - rimMaterial.uniforms.uOpacity.value) * (traceDimmed ? 0.42 : 0.12);
        const glowMaterial = glow.material as THREE.SpriteMaterial;
        const glowPhase = sphere.userData.glowPhase as number;
        const glowSpeed = sphere.userData.glowSpeed as number;
        const glowWave = richGlowEffect ? Math.sin(now * glowSpeed + glowPhase) * glowEffectStrength : 0;
        const glowBaseOpacity = richGlowEffect ? unselectedAura ? (0.3 + pulseWave * 0.18) * glowEffectStrength : (0.18 + pulseWave * 0.14) * glowEffectStrength : unselectedAura ? 0.14 * glowEffectStrength : 0.07 * glowEffectStrength;
        const highlightTargetOpacity = highlightIntensity ? 0.18 + highlightIntensity * 0.72 : 0;
        const idleTwinkleTargetOpacity = idleStructuralTwinkle ? 0.36 + idleStructuralTwinkle * 0.64 : 0;
        const glowTargetOpacity = Math.min(1, Math.max(
          ((hasActiveTrace || richGlowEffect) ? (richGlowEffect && visualDepth !== undefined ? (0.48 + pulseWave * 0.22) * glowEffectStrength : glowBaseOpacity) : glowBaseOpacity) * brightness,
          highlightTargetOpacity * brightness,
          idleTwinkleTargetOpacity * brightness,
        ) * glowIntensityMultiplier);
        glowMaterial.color.copy(baseColor).lerp(idleStructuralTwinkle ? twinkleColor : hotColor, Math.max(activeColorPulse, idleStructuralTwinkle ? 0.5 + idleStructuralTwinkle * 0.5 : 0));
        glowMaterial.opacity += (glowTargetOpacity - glowMaterial.opacity) * (traceDimmed ? 0.42 : 0.12);
        if (sphereMoved || richGlowEffect) {
          glow.position.copy(sphere.position);
        }
        glow.scale.setScalar((glow.userData.baseScale as number) * targetScale * ((unselectedAura ? 1.26 : 1.08) + highlightIntensity * 0.62 + idleStructuralTwinkle * 0.72 + glowWave * 0.16 + (richGlowEffect ? pulseWave * 0.12 * glowEffectStrength : 0)) * glowIntensityMultiplier);
      }
      for (const line of lineObjects) {
        const material = line.material as THREE.LineBasicMaterial | LineMaterial;
        const sourceNodeId = line.userData.source as string;
        const targetNodeId = line.userData.target as string;
        const edgeScreenCulled = screenCulledNodeIds.has(sourceNodeId) || screenCulledNodeIds.has(targetNodeId);
        if (edgeScreenCulled) {
          line.visible = false;
          const importDirectionMarkers = line.userData.importDirectionMarkers as ImportDirectionMarker[] | undefined;
          importDirectionMarkers?.forEach(hideImportDirectionMarker);
          continue;
        }
        line.visible = true;
        const sourceDepth = activeDepths.get(sourceNodeId);
        const targetDepth = activeDepths.get(targetNodeId);
        const touchesSelected = sourceNodeId === selectedNodeId || targetNodeId === selectedNodeId;
        const isSelectedParentEdge = Boolean(selectedParentId && ((sourceNodeId === selectedNodeId && targetNodeId === selectedParentId) || (targetNodeId === selectedNodeId && sourceNodeId === selectedParentId)));
        const closeToSelected = sourceDepth !== undefined && targetDepth !== undefined && sourceDepth <= 2 && targetDepth <= 2;
        const isTraceEdge = line.userData.isTraceEdge;
        const edgeUpdateFrame = isTraceEdge || touchesSelected || closeToSelected || frameIndex % performanceTier.backgroundFrameInterval === 0;
        if (!edgeUpdateFrame) {
          continue;
        }
        const sourceSphere = line.userData.sourceSphere as THREE.Mesh | null;
        const targetSphere = line.userData.targetSphere as THREE.Mesh | null;
        const sourcePoint = line.userData.sourcePoint as THREE.Vector3;
        const targetPoint = line.userData.targetPoint as THREE.Vector3;
        if (sourceSphere && targetSphere) {
          const moved = sourcePoint.distanceToSquared(sourceSphere.position) > 0.01 || targetPoint.distanceToSquared(targetSphere.position) > 0.01;
          sourcePoint.copy(sourceSphere.position);
          targetPoint.copy(targetSphere.position);
          if (moved) {
            updateGraphEdgeGeometry(line, sourcePoint, targetPoint);
          }
        }
        const isParentEdge = line.userData.kind === "contains_file" || line.userData.kind === "declares_api" || line.userData.kind === "contains" || line.userData.kind === "handled_by";
        const edgeDepth = Math.min(sourceDepth ?? 5, targetDepth ?? 5);
        const depthDim = Math.max(0.2, 1 - edgeDepth * 0.2);
        const baseTargetOpacity = isTraceEdge || isSelectedParentEdge ? 1 : touchesSelected ? 0.98 : line.userData.isServiceEdge ? 0.76 : closeToSelected ? (isParentEdge ? 0.74 : 0.62) : isParentEdge ? 0.46 : 0.34;
        const normalTargetOpacity = baseTargetOpacity * depthDim;
        const targetOpacity = isSelectedParentEdge ? 1 : hasActiveTrace ? (isTraceEdge ? 1 : normalTargetOpacity * TRACE_DIM_FACTOR) : normalTargetOpacity;
        material.opacity += (targetOpacity - material.opacity) * (hasActiveTrace ? 0.42 : 0.14);
        material.color.set(isSelectedParentEdge ? "#fff6c6" : line.userData.baseColor as number);
        if (line.userData.isWideLine) {
          const lineMaterial = material as LineMaterial;
          const baseLinewidth = line.userData.baseLinewidth as number;
          lineMaterial.linewidth += ((isSelectedParentEdge ? baseLinewidth * 4 : baseLinewidth) - lineMaterial.linewidth) * 0.18;
        }
        if (line.userData.isFunctionDependencyEdge) {
          let importDirectionMarkers = line.userData.importDirectionMarkers as ImportDirectionMarker[] | undefined;
          if (touchesSelected) {
            if (!importDirectionMarkers) {
              importDirectionMarkers = [];
              line.userData.importDirectionMarkers = importDirectionMarkers;
            }
            const travelMs = packetTravelMs(targetPoint, sourcePoint);
            const edgeLength = targetPoint.distanceTo(sourcePoint);
            const markerCount = importDirectionMarkerCount(edgeLength);
            while (importDirectionMarkers.length < markerCount) {
              const marker = makeImportDirectionMarker(0);
              marker.cone.frustumCulled = false;
              marker.glow.frustumCulled = false;
              marker.tail.frustumCulled = false;
              importDirectionMarkers.push(marker);
              graphGroup.add(marker.tail);
              graphGroup.add(marker.glow);
              graphGroup.add(marker.cone);
            }
            const baseProgress = ((now - functionMarkerCycleStartedAt) % travelMs) / travelMs;
            for (let index = 0; index < importDirectionMarkers.length; index += 1) {
              const marker = importDirectionMarkers[index];
              if (index >= markerCount) {
                hideImportDirectionMarker(marker);
                continue;
              }
              const progress = (baseProgress + index / markerCount) % 1;
              const fade = progress < 0.18 ? progress / 0.18 : progress > 0.82 ? (1 - progress) / 0.18 : 1;
              updateImportDirectionMarker(marker, targetPoint, sourcePoint, progress);
              setImportDirectionMarkerOpacity(marker, Math.min(1, Math.max(0, fade) * material.opacity * 1.85 * glowIntensityMultiplier));
            }
          } else if (importDirectionMarkers) {
            importDirectionMarkers.forEach(hideImportDirectionMarker);
          }
        }
      }
      if (packetInitialBurstPending) {
        launchPackets(hasActiveTrace ? TRACE_PACKET_INITIAL_BURST : PACKET_INITIAL_BURST, activeDepths, now);
        packetInitialBurstPending = false;
        packetNextLaunchAt = now + (hasActiveTrace ? TRACE_PACKET_STAGGER_MS : PACKET_STAGGER_MS);
      } else if (now >= packetNextLaunchAt) {
        launchPackets(hasActiveTrace ? TRACE_PACKET_PAIR_BURST : PACKET_PAIR_BURST, activeDepths, now);
        packetNextLaunchAt = now + (hasActiveTrace ? TRACE_PACKET_STAGGER_MS : PACKET_STAGGER_MS);
      }
      for (const packet of packetObjects) {
        const material = packet.material as THREE.MeshBasicMaterial;
        const packetEdge = packet.userData.edge as GraphEdgeObject | null;
        if (!packetEdge || !packetEdge.visible) {
          if (packetEdge && !packetEdge.visible) {
            packet.userData.edge = null;
            packet.userData.edgeId = null;
          }
          material.opacity += (0 - material.opacity) * 0.18;
          continue;
        }
        const sourcePoint = packetEdge.userData.sourcePoint as THREE.Vector3;
        const targetPoint = packetEdge.userData.targetPoint as THREE.Vector3;
        const elapsed = now - (packet.userData.startedAt as number);
        const travelMs = packet.userData.travelMs as number || packetTravelMs(sourcePoint, targetPoint);
        if (elapsed >= travelMs) {
          packet.userData.edge = null;
          packet.userData.edgeId = null;
          material.opacity += (0 - material.opacity) * 0.18;
          continue;
        }
        const progress = elapsed / travelMs;
        const direction = packet.userData.direction as number;
        const t = direction > 0 ? progress : 1 - progress;
        const pulseWindow = Math.sin(progress * Math.PI);
        packet.position.copy(sourcePoint).lerp(targetPoint, t);
        packet.scale.setScalar(packetEdge.userData.packetScale as number);
        material.opacity += ((0.32 + pulseWindow * 0.68) - material.opacity) * 0.16;
      }
      const shouldUpdateOverlays = dragState.active || focusTransition !== null || now >= overlayNextUpdateAt;
      if (shouldUpdateOverlays) {
        const rect = renderer.domElement.getBoundingClientRect();
        if (currentFunMode) {
          updateFunProximityOverlay(rect);
        } else {
          const hoverNode = hoverNodeIdRef.current ? graphNodeById.get(hoverNodeIdRef.current) ?? null : null;
          updateNeighborOverlays(hoverNode, rect);
        }
        overlayNextUpdateAt = now + (dragState.active || focusTransition !== null ? OVERLAY_UPDATE_MS : performanceTier.overlayUpdateMs);
      }
      if (!currentFunMode) {
        graphPositionRef.current.copy(graphGroup.position);
        graphRotationRef.current.copy(graphGroup.rotation);
        reportZoomLevel();
      }
      if (funModeRef.current) {
        const previousAutoClear = renderer.autoClear;
        camera.layers.set(FUN_GRAPH_LAYER);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        camera.layers.set(FUN_VEHICLE_LAYER);
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = previousAutoClear;
        camera.layers.set(FUN_GRAPH_LAYER);
      } else {
        camera.layers.set(FUN_GRAPH_LAYER);
        renderer.render(scene, camera);
      }
    }
    animate();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
      if (starfieldRef.current === starfield) {
        starfieldRef.current = null;
      }
      starfield.geometry.dispose();
      const starfieldMaterial = starfield.material;
      if (Array.isArray(starfieldMaterial)) {
        starfieldMaterial.forEach((item) => item.dispose());
      } else {
        starfieldMaterial.dispose();
      }
      for (const line of shootingStarObjects) {
        line.geometry.dispose();
        const material = line.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
      skySphere.geometry.dispose();
      const skyMaterial = skySphere.material as THREE.MeshBasicMaterial;
      skyMaterial.map?.dispose();
      skyMaterial.dispose();
      vehicleGroup.userData.disposed = true;
      vehicleGroup.traverse((object) => {
        disposeRenderableResources(object);
      });
      tailGlowStreaks.traverse((object) => {
        disposeRenderableResources(object);
      });
      glowTexture?.dispose();
      setNeighborOverlays([]);
      for (const object of graphGroup.children) {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else {
            material.dispose();
          }
        } else if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      }
      host.replaceChildren();
    };
  }, [activeTrace, graph.nodes, hasActiveTrace, maxUniverseExtent, maxUniverseRadius, parentByNodeId, spaceNodes, traceNodeIds, traceUniverseExtent, visibleEdges]);

  return (
    <div className="graph-space">
      <div className="graph-canvas-host" ref={hostRef} />
      {neighborOverlays.map((item) => (
        <aside
          key={item.id}
          className="neighbor-card"
          style={{
            left: `${item.x}px`,
            top: `${item.y}px`,
            borderColor: nodeColor(item.node),
          }}
        >
          <span style={{ color: nodeColor(item.node) }}>{KIND_LABELS[item.node.kind] ?? item.node.kind}</span>
          <strong>{item.node.label}</strong>
        </aside>
      ))}
      {hover && (
        <aside
          className="hover-card"
          style={{
            left: `${Math.min(hover.x + 18, Math.max((hostRef.current?.clientWidth ?? 320) - 270, 18))}px`,
            top: `${Math.max(hover.y - 18, 18)}px`,
            borderColor: nodeColor(hover.node),
          }}
        >
          <span style={{ color: nodeColor(hover.node) }}>{KIND_LABELS[hover.node.kind] ?? hover.node.kind}</span>
          <strong>{hover.node.label}</strong>
          <small>{hover.node.file}{hover.node.line_start ? `:${hover.node.line_start}` : ""}</small>
          <p>{hover.node.summary.agentic ?? hover.node.summary.deterministic}</p>
        </aside>
      )}
    </div>
  );
}

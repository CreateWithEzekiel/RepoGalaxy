import { ArrowLeft, BookOpen, CarFront, ChevronDown, ChevronRight, Eye, EyeOff, FileCode2, Filter, Folder, FolderOpen, Github, GitBranch, House, Linkedin, MapPin, MousePointer2, Play, RefreshCcw, Search, SlidersHorizontal, ThumbsDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import GraphScene from "./GraphScene";
import type { CodeEdge, CodeExcerpt, CodeGraph, CodeNode, NodeKind, TraceCustomEdge, TraceIndex, TraceIndexItem, TracePlan } from "./types";

const GRAPH_URL = "/codebase_cartographer/graph.json";
const TRACE_INDEX_URL = "/codebase_cartographer/traces/trace_index.json";
const TRACE_INDEX_REFRESH_MS = 4000;
const RIGHT_PANEL_EXIT_MS = 260;
const FUN_TRANSITION_MS = 3000;

type LeftPanelId = "focus" | "tree" | "kinds" | "summary" | "wiki" | "settings" | "creator";
const LEFT_PANEL_IDS: LeftPanelId[] = ["focus", "tree", "kinds", "summary", "wiki", "settings", "creator"];
type FunTransitionPhase = "entering" | "exiting";

const KIND_LABELS: Record<NodeKind, string> = {
  workspace: "Workspace",
  service: "Service",
  package: "Package",
  module: "Module",
  file: "File",
  config_file: "Config",
  api_endpoint: "API",
  websocket_endpoint: "WebSocket",
  route: "Route",
  background_task: "Task",
  cli_command: "CLI",
  api_client: "Client",
  component: "Component",
  hook: "Hook",
  context: "Context",
  provider: "Provider",
  page: "Page",
  layout: "Layout",
  form: "Form",
  store: "Store",
  reducer: "Reducer",
  function: "Function",
  method: "Method",
  constructor: "Constructor",
  class: "Class",
  exception: "Exception",
  decorator: "Decorator",
  schema: "Schema",
  model: "Model",
  dataclass: "Dataclass",
  pydantic_model: "Pydantic",
  typed_dict: "TypedDict",
  type: "Type",
  interface: "Interface",
  type_alias: "Type Alias",
  enum: "Enum",
  style: "Style",
  style_rule: "Style Rule",
  media_query: "Media",
  container_query: "Container",
  supports_rule: "Supports",
  keyframes: "Keyframes",
  font_face: "Font",
  css_layer: "CSS Layer",
  css_at_rule: "CSS Rule",
  html_document: "HTML Doc",
  template: "Template",
  html_element: "Element",
  database_schema: "DB Schema",
  table: "Table",
  view: "View",
  materialized_view: "Mat View",
  migration: "Migration",
  stored_procedure: "Procedure",
  sql_function: "SQL Func",
  trigger: "Trigger",
  index: "Index",
  constraint: "Constraint",
};

const KIND_ORDER: NodeKind[] = [
  "workspace",
  "service",
  "package",
  "module",
  "file",
  "config_file",
  "api_endpoint",
  "websocket_endpoint",
  "route",
  "api_client",
  "background_task",
  "cli_command",
  "component",
  "hook",
  "context",
  "provider",
  "page",
  "layout",
  "form",
  "store",
  "reducer",
  "function",
  "method",
  "constructor",
  "class",
  "exception",
  "decorator",
  "schema",
  "model",
  "dataclass",
  "pydantic_model",
  "typed_dict",
  "interface",
  "type_alias",
  "enum",
  "type",
  "style",
  "style_rule",
  "media_query",
  "container_query",
  "supports_rule",
  "keyframes",
  "font_face",
  "css_layer",
  "css_at_rule",
  "html_document",
  "template",
  "html_element",
  "database_schema",
  "table",
  "view",
  "materialized_view",
  "migration",
  "stored_procedure",
  "sql_function",
  "trigger",
  "index",
  "constraint",
];

const KIND_COLORS: Partial<Record<NodeKind, string>> = {
  workspace: "#ffdf6e",
  service: "#ffd35a",
  package: "#ffbd59",
  module: "#b5e7ff",
  file: "#fbfdff",
  config_file: "#b9fbc0",
  api_endpoint: "#ff4f78",
  websocket_endpoint: "#ff5bbd",
  route: "#ff719a",
  api_client: "#ffb000",
  background_task: "#a78bfa",
  cli_command: "#92f2ff",
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
  decorator: "#f0abfc",
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
  container_query: "#fde68a",
  supports_rule: "#fcd34d",
  keyframes: "#fbbf24",
  font_face: "#f59e0b",
  css_layer: "#eab308",
  css_at_rule: "#facc15",
  html_document: "#fca5a5",
  template: "#fdba74",
  html_element: "#fb923c",
  database_schema: "#34d399",
  table: "#10b981",
  view: "#6ee7b7",
  materialized_view: "#5eead4",
  migration: "#a7f3d0",
  stored_procedure: "#2dd4bf",
  sql_function: "#22d3ee",
  trigger: "#67e8f9",
  index: "#bef264",
  constraint: "#d9f99d",
};

const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
const CONTROL_KIND_COLORS: Partial<Record<NodeKind, string>> = {
  api_endpoint: "#ff7aa5",
};
const REACT_SERVICE_COLOR = "#35d3ff";

function kindColor(kind: NodeKind) {
  return KIND_COLORS[kind] ?? "#31ffc5";
}

function controlKindColor(kind: NodeKind) {
  return CONTROL_KIND_COLORS[kind] ?? kindColor(kind);
}

function displayKindLabel(kind: NodeKind) {
  return kind === "service" ? "Service / Repo / Sub Repo" : KIND_LABELS[kind];
}

function filterKindLabel(kind: NodeKind) {
  return displayKindLabel(kind);
}

function lodDistanceCullThresholds(lodDistance: number) {
  if (lodDistance >= 1) {
    return { cullBelowPx: 0, restoreAbovePx: 0 };
  }
  const levels = [
    { cullBelowPx: 12, restoreAbovePx: 14 },
    { cullBelowPx: 11, restoreAbovePx: 13 },
    { cullBelowPx: 10, restoreAbovePx: 12 },
    { cullBelowPx: 9, restoreAbovePx: 11 },
    { cullBelowPx: 8, restoreAbovePx: 10 },
    { cullBelowPx: 7, restoreAbovePx: 9 },
    { cullBelowPx: 6, restoreAbovePx: 8 },
    { cullBelowPx: 4, restoreAbovePx: 6 },
    { cullBelowPx: 2, restoreAbovePx: 4 },
    { cullBelowPx: 1, restoreAbovePx: 2 },
  ];
  return levels[Math.max(0, Math.min(levels.length - 1, Math.round(lodDistance * 10)))];
}

function stardustDensityCount(stardustDensity: number) {
  const normalizedDensity = Math.max(0, Math.min(1, stardustDensity));
  return Math.round(100 + normalizedDensity * 9900);
}

function nodeColor(node: CodeNode) {
  if (node.kind === "service" && node.metadata.majority_file_type === "react") {
    return REACT_SERVICE_COLOR;
  }
  return KIND_COLORS[node.kind] ?? node.color;
}

interface RepoTreeItem {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  nodeId: string | null;
  children: RepoTreeItem[];
}

function preferredStart(nodes: CodeNode[]): string {
  const preferred = nodes.find((node) => node.kind === "service" && node.metadata.service_role === "main_repo")
    ?? nodes.find((node) => node.kind === "service")
    ?? nodes.find((node) => node.kind === "api_endpoint")
    ?? nodes.find((node) => node.kind === "component")
    ?? nodes.find((node) => node.kind === "api_client")
    ?? nodes.find((node) => node.kind === "function")
    ?? nodes[0];
  return preferred?.id ?? "";
}

function formatJson(value: unknown): string {
  if (!value || (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isEmptyValue(value: unknown) {
  return value === null
    || value === undefined
    || value === ""
    || (Array.isArray(value) && value.length === 0)
    || (isPlainObject(value) && Object.keys(value).length === 0);
}

function codeExcerpt(node: CodeNode): CodeExcerpt | null {
  const excerpt = node.details?.code_excerpt;
  if (!excerpt || typeof excerpt.text !== "string" || !excerpt.text.trim()) {
    return null;
  }
  return excerpt;
}

function codeExcerptRows(excerpt: CodeExcerpt) {
  return excerpt.text.split(/\r?\n/).map((line, index) => ({
    line,
    number: excerpt.line_start + index,
  }));
}

function semanticPoints(node: CodeNode): string[] {
  const points = node.summary.agentic_points;
  if (!Array.isArray(points)) {
    return [];
  }
  return points.filter((point) => typeof point === "string" && point.trim());
}

function detailSections(node: CodeNode) {
  const details = node.details ?? {};
  const sections: Array<{ title: string; value: unknown }> = [
    { title: "Overview", value: details.overview ?? {
      kind: node.kind,
      language: node.language,
      file: node.file,
      line_start: node.line_start,
      line_end: node.line_end,
      status: node.deterministic_status,
    } },
  ];
  const kindSections: Record<string, string[]> = {
    api_endpoint: ["request", "response", "auth_or_dependencies", "calls", "raises", "side_effects"],
    websocket_endpoint: ["request", "response", "auth_or_dependencies", "calls", "raises", "side_effects"],
    api_client: ["api", "interface", "calls", "react"],
    function: ["interface", "calls", "raises", "side_effects"],
    method: ["interface", "calls", "raises", "side_effects"],
    constructor: ["interface", "calls", "raises", "side_effects"],
    background_task: ["interface", "calls", "raises", "side_effects"],
    cli_command: ["interface", "calls", "raises", "side_effects"],
    class: ["fields", "methods", "inheritance"],
    exception: ["fields", "methods", "inheritance"],
    schema: ["fields"],
    model: ["fields"],
    dataclass: ["fields", "methods", "inheritance"],
    pydantic_model: ["fields", "methods", "inheritance"],
    typed_dict: ["fields"],
    interface: ["fields", "interface"],
    type_alias: ["fields", "type_alias"],
    enum: ["fields"],
    component: ["react", "interface", "api", "calls"],
    hook: ["react", "interface", "api", "calls"],
    context: ["react", "interface", "calls"],
    provider: ["react", "interface", "calls"],
    page: ["react", "interface", "api", "calls"],
    layout: ["react", "interface", "calls"],
    form: ["react", "interface", "api", "calls"],
    store: ["interface", "calls"],
    reducer: ["interface", "calls"],
    style: ["style"],
    style_rule: ["style"],
    media_query: ["style"],
    container_query: ["style"],
    supports_rule: ["style"],
    keyframes: ["style"],
    font_face: ["style"],
    css_layer: ["style"],
    css_at_rule: ["style"],
    html_document: ["html"],
    template: ["html"],
    html_element: ["html"],
    table: ["sql"],
    view: ["sql"],
    materialized_view: ["sql"],
    migration: ["sql"],
    stored_procedure: ["sql"],
    sql_function: ["sql"],
    trigger: ["sql"],
    index: ["sql"],
    constraint: ["sql"],
    config_file: ["config"],
    file: ["file"],
    module: ["file"],
    package: ["file"],
  };
  for (const key of kindSections[node.kind] ?? []) {
    if (!isEmptyValue(details[key])) {
      sections.push({ title: titleCase(key), value: details[key] });
    }
  }
  return sections;
}

function contractSections(node: CodeNode) {
  const sections = [];
  if (["api_endpoint", "websocket_endpoint", "api_client"].includes(node.kind)) {
    sections.push({ title: "Request", contract: node.contracts.request });
    sections.push({ title: "Response", contract: node.contracts.response });
  } else if (["function", "method", "constructor", "hook", "background_task", "cli_command"].includes(node.kind)) {
    sections.push({ title: "Inputs", contract: node.contracts.request });
    sections.push({ title: "Returns", contract: node.contracts.response });
  } else if (["component", "form", "page", "layout", "provider"].includes(node.kind)) {
    sections.push({ title: "Props", contract: node.contracts.request });
    sections.push({ title: "Rendered Output", contract: node.contracts.response });
  } else if (["table", "view", "materialized_view"].includes(node.kind)) {
    sections.push({ title: "Columns", contract: node.contracts.response });
  }
  return sections;
}

function traceStepForNode(trace: TracePlan | null, nodeId: string) {
  return trace?.steps.find((step) => step.node_id === nodeId) ?? null;
}

function connectionMetadata(edge: CodeEdge) {
  const metadata = edge.metadata ?? {};
  const relationship = typeof metadata.relationship_type === "string" ? titleCase(metadata.relationship_type) : null;
  const confidence = typeof metadata.confidence === "number"
    ? `${Math.round(metadata.confidence * 100)}% confidence`
    : typeof metadata.confidence === "string" ? metadata.confidence : null;
  const source = typeof metadata.source === "string" ? titleCase(metadata.source) : null;
  return [relationship, confidence, source].filter(Boolean).join(" | ");
}

function buildRepoTree(nodes: CodeNode[]): RepoTreeItem[] {
  const root: RepoTreeItem = { id: "repo", name: "repo", path: "", kind: "folder", nodeId: null, children: [] };
  const serviceByPath = new Map(nodes.filter((node) => node.kind === "service").map((node) => [node.file || node.label, node.id]));
  const fileNodes = nodes.filter((node) => node.kind === "file" && node.file);
  const fileNodeByPath = new Map(fileNodes.map((node) => [node.file, node.id]));
  for (const filePath of [...fileNodeByPath.keys()].sort((a, b) => a.localeCompare(b))) {
    const parts = filePath.split("/").filter(Boolean);
    let cursor = root;
    let currentPath = "";
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let child = cursor.children.find((item) => item.name === part && item.kind === (isFile ? "file" : "folder"));
      if (!child) {
        child = {
          id: `${isFile ? "file" : "folder"}:${currentPath}`,
          name: part,
          path: currentPath,
          kind: isFile ? "file" : "folder",
          nodeId: isFile ? fileNodeByPath.get(filePath) ?? null : serviceByPath.get(currentPath) ?? null,
          children: [],
        };
        cursor.children.push(child);
      }
      cursor = child;
    });
  }
  function sortTree(items: RepoTreeItem[]) {
    items.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    items.forEach((item) => sortTree(item.children));
  }
  sortTree(root.children);
  return root.children;
}

function filterRepoTree(items: RepoTreeItem[], query: string, nodesById: Map<string, CodeNode>): RepoTreeItem[] {
  const normalised = query.trim().toLowerCase();
  if (!normalised) {
    return items;
  }
  return items.flatMap((item) => {
    const node = item.nodeId ? nodesById.get(item.nodeId) : null;
    const searchable = `${item.name} ${item.path} ${node?.kind ?? ""} ${node?.summary.deterministic ?? ""}`.toLowerCase();
    const children = filterRepoTree(item.children, query, nodesById);
    if (searchable.includes(normalised) || children.length) {
      return [{ ...item, children }];
    }
    return [];
  });
}

function serviceDirectory(node: CodeNode) {
  const directory = node.metadata.directory;
  return typeof directory === "string" && directory.trim() ? directory : node.file;
}

function nodeBelongsToService(node: CodeNode, service: CodeNode) {
  const directory = serviceDirectory(service);
  if (!directory || directory === ".") {
    return node.id === service.id;
  }
  return node.id === service.id || node.file === directory || node.file.startsWith(`${directory}/`);
}

function hiddenNodeIdsForServices(nodes: CodeNode[], hiddenServiceIds: Set<string>) {
  if (!hiddenServiceIds.size) {
    return new Set<string>();
  }
  const services = nodes.filter((node) => hiddenServiceIds.has(node.id));
  return new Set(nodes.filter((node) => services.some((service) => nodeBelongsToService(node, service))).map((node) => node.id));
}

function filterGraph(graph: CodeGraph, hiddenNodeIds: Set<string>): CodeGraph {
  if (!hiddenNodeIds.size) {
    return graph;
  }
  const nodes = graph.nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const visibleEdgeIds = new Set(edges.map((edge) => edge.id));
  const perspectives = Object.fromEntries(Object.entries(graph.perspectives).map(([key, perspective]) => [key, {
    ...perspective,
    node_ids: perspective.node_ids.filter((nodeId) => visibleNodeIds.has(nodeId)),
    edge_ids: perspective.edge_ids.filter((edgeId) => visibleEdgeIds.has(edgeId)),
  }]));
  return { ...graph, nodes, edges, perspectives };
}

function traceCustomEdgeToGraphEdge(edge: TraceCustomEdge): CodeEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind || "trace_inferred_handoff",
    reason: {
      deterministic: edge.reason,
      agentic: null,
      agentic_status: "trace_only",
    },
    deterministic_status: "inferred_from_usage",
    evidence: edge.evidence ?? [],
    metadata: {
      confidence: edge.confidence,
      trace_only: true,
    },
  };
}

function graphWithTraceCustomEdges(graph: CodeGraph | null, trace: TracePlan | null): CodeGraph | null {
  if (!graph || !trace?.custom_edges?.length) {
    return graph;
  }
  const existingEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const customEdges = trace.custom_edges
    .filter((edge) => edge.source && edge.target && !existingEdgeIds.has(edge.id))
    .map(traceCustomEdgeToGraphEdge);
  if (!customEdges.length) {
    return graph;
  }
  return {
    ...graph,
    edges: [...graph.edges, ...customEdges],
    perspectives: Object.fromEntries(Object.entries(graph.perspectives).map(([key, perspective]) => [
      key,
      {
        ...perspective,
        edge_ids: [...perspective.edge_ids, ...customEdges.map((edge) => edge.id)],
      },
    ])),
  };
}

function sameTraceIndexItems(left: TraceIndexItem[], right: TraceIndexItem[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other
      && item.trace_id === other.trace_id
      && item.path === other.path
      && item.generated_at === other.generated_at;
  });
}

function App() {
  const [graph, setGraph] = useState<CodeGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [rightPanelNode, setRightPanelNode] = useState<CodeNode | null>(null);
  const [rightPanelsExiting, setRightPanelsExiting] = useState(false);
  const [startId, setStartId] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [activeKinds, setActiveKinds] = useState<Set<NodeKind>>(new Set(KIND_ORDER));
  const [query, setQuery] = useState("");
  const [treeQuery, setTreeQuery] = useState("");
  const [expandedTree, setExpandedTree] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"explore" | "ask_trace" | "fun">("explore");
  const [traceIndex, setTraceIndex] = useState<TraceIndexItem[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState("");
  const [activeTrace, setActiveTrace] = useState<TracePlan | null>(null);
  const [showSelectedOverlays, setShowSelectedOverlays] = useState(true);
  const [showHoverOverlays, setShowHoverOverlays] = useState(true);
  const [twinkleEnabled, setTwinkleEnabled] = useState(true);
  const [glowIntensity, setGlowIntensity] = useState(1);
  const [lodDistance, setLodDistance] = useState(0.8);
  const [stardustDensity, setStardustDensity] = useState(0.1);
  const [hiddenServiceIds, setHiddenServiceIds] = useState<Set<string>>(new Set());
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [funSpeedLevel, setFunSpeedLevel] = useState(0.4);
  const [fpsLevel, setFpsLevel] = useState(60);
  const [funTransitionPhase, setFunTransitionPhase] = useState<FunTransitionPhase | null>(null);
  const [hoveredLeftPanel, setHoveredLeftPanel] = useState<LeftPanelId | null>(null);
  const [leftPanelRailActive, setLeftPanelRailActive] = useState(false);
  const [nearLeftPanel, setNearLeftPanel] = useState<LeftPanelId | null>(null);
  const controlPanelRef = useRef<HTMLElement>(null);
  const overviewBlockRef = useRef<HTMLElement>(null);
  const leftPanelRailActiveRef = useRef(false);
  const nearLeftPanelRef = useRef<LeftPanelId | null>(null);
  const funTransitionTimerRef = useRef<number | null>(null);
  const lastSeenTraceIdRef = useRef("");

  useEffect(() => {
    fetch(GRAPH_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Graph request failed with ${response.status}`);
        }
        return response.json();
      })
      .then((payload: CodeGraph) => {
        setGraph(payload);
        const initial = preferredStart(payload.nodes);
        setSelectedId("");
        setStartId(initial);
        setExpandedTree(new Set());
      })
      .catch((error: Error) => {
        setLoadError(error.message);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    function loadTraceIndex() {
      fetch(`${TRACE_INDEX_URL}?t=${Date.now()}`)
        .then((response) => response.ok ? response.json() : { traces: [] })
        .then((payload: TraceIndex) => {
          if (cancelled) {
            return;
          }
          const traces = payload.traces ?? [];
          const newestTraceId = traces[0]?.trace_id ?? "";
          setTraceIndex((current) => sameTraceIndexItems(current, traces) ? current : traces);
          setSelectedTraceId((current) => {
            if (!newestTraceId) {
              lastSeenTraceIdRef.current = "";
              return "";
            }
            const currentExists = traces.some((trace) => trace.trace_id === current);
            if (!currentExists || newestTraceId !== lastSeenTraceIdRef.current) {
              lastSeenTraceIdRef.current = newestTraceId;
              return newestTraceId;
            }
            return current;
          });
        })
        .catch(() => {
          if (!cancelled) {
            setTraceIndex((current) => current.length ? [] : current);
          }
        });
    }

    loadTraceIndex();
    const timer = window.setInterval(loadTraceIndex, TRACE_INDEX_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const item = traceIndex.find((trace) => trace.trace_id === selectedTraceId);
    if (!item) {
      setActiveTrace(null);
      return;
    }
    fetch(`/codebase_cartographer/traces/${item.path}?t=${Date.now()}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Trace request failed with ${response.status}`);
        }
        return response.json();
      })
      .then((payload: TracePlan) => {
        setActiveTrace(payload);
      })
      .catch(() => {
        setActiveTrace(null);
      });
  }, [selectedTraceId, traceIndex]);

  const allNodesById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph]);
  const isFunMode = mode === "fun";
  const isAskTraceMode = mode === "ask_trace";
  const effectiveHiddenServiceIds = useMemo(() => isFunMode ? new Set<string>() : hiddenServiceIds, [hiddenServiceIds, isFunMode]);
  const hiddenNodeIds = useMemo(() => hiddenNodeIdsForServices(graph?.nodes ?? [], effectiveHiddenServiceIds), [graph, effectiveHiddenServiceIds]);
  const hiddenServicePaths = useMemo(() => (graph?.nodes ?? [])
    .filter((node) => hiddenServiceIds.has(node.id))
    .map(serviceDirectory)
    .filter((item): item is string => Boolean(item && item !== ".")),
  [graph, hiddenServiceIds]);
  const visibleGraph = useMemo(() => graph ? filterGraph(graph, hiddenNodeIds) : null, [graph, hiddenNodeIds]);
  const navigationLevel = isFunMode ? funSpeedLevel : zoomLevel;
  const navigationIndicatorColor = isFunMode && funSpeedLevel < 0.4 ? "#ff4f5f" : "#ffd35a";
  const baseSceneGraph = isAskTraceMode ? graph : visibleGraph;
  const sceneTrace = isAskTraceMode ? activeTrace : null;
  const sceneGraph = useMemo(() => graphWithTraceCustomEdges(baseSceneGraph, sceneTrace), [baseSceneGraph, sceneTrace]);
  const sceneActiveKinds = activeKinds;
  const nodesById = useMemo(() => new Map((sceneGraph?.nodes ?? []).map((node) => [node.id, node])), [sceneGraph]);
  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;
  const repoTree = useMemo(() => buildRepoTree(graph?.nodes ?? []), [graph]);
  const visibleRepoTree = useMemo(() => filterRepoTree(repoTree, treeQuery, allNodesById), [allNodesById, repoTree, treeQuery]);
  const availableKinds = useMemo(() => {
    if (!graph) {
      return [];
    }
    const kinds = new Set(graph.nodes.map((node) => node.kind));
    return KIND_ORDER.filter((kind) => kinds.has(kind));
  }, [graph]);
  const kindFilterLevels = useMemo(() => {
    const primaryKinds: NodeKind[][] = [["service"], ["file", "config_file"]];
    const assignedKinds = new Set(primaryKinds.flat());
    const levels = primaryKinds
      .map((level) => level.filter((kind) => availableKinds.includes(kind)))
      .filter((level) => level.length);
    const remainingKinds = availableKinds.filter((kind) => !assignedKinds.has(kind));
    return remainingKinds.length ? [...levels, remainingKinds] : levels;
  }, [availableKinds]);
  const nodeTypeCounts = useMemo(() => {
    if (!graph) {
      return [];
    }
    const counts = new Map<NodeKind, number>();
    graph.nodes.forEach((node) => counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1));
    return KIND_ORDER
      .filter((kind) => counts.has(kind))
      .map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
  }, [graph]);
  const screenCullKinds = useMemo(() => new Set(nodeTypeCounts
    .filter((item) => item.kind !== "service" && item.count >= 400)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((item) => item.kind)),
  [nodeTypeCounts]);
  const tinyCullThresholds = useMemo(() => lodDistanceCullThresholds(lodDistance), [lodDistance]);
  const stardustCount = useMemo(() => stardustDensityCount(stardustDensity), [stardustDensity]);
  const perspectiveIds = useMemo(() => new Set(sceneGraph?.perspectives.overview?.node_ids ?? sceneGraph?.nodes.map((node) => node.id) ?? []), [sceneGraph]);
  const focusedPerspectiveIds = useMemo(() => {
    const ids = new Set(perspectiveIds);
    if (sceneTrace) {
      sceneTrace.steps.forEach((step) => ids.add(step.node_id));
    }
    return ids;
  }, [perspectiveIds, sceneTrace]);
  const scenePerspectiveIds = focusedPerspectiveIds;
  useEffect(() => {
    if (selectedNode) {
      setRightPanelNode(selectedNode);
      setRightPanelsExiting(false);
      return;
    }
    if (!rightPanelNode) {
      return;
    }
    setRightPanelsExiting(true);
    const timer = window.setTimeout(() => {
      setRightPanelNode(null);
      setRightPanelsExiting(false);
    }, RIGHT_PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [rightPanelNode, selectedNode]);

  const rightPanelConnections = useMemo(() => {
    if (!sceneGraph || !rightPanelNode) {
      return [];
    }
    return sceneGraph.edges.filter((edge) => edge.source === rightPanelNode.id || edge.target === rightPanelNode.id);
  }, [rightPanelNode, sceneGraph]);
  const nodeOptions = useMemo(() => {
    if (!sceneGraph) {
      return [];
    }
    const normalisedQuery = query.trim().toLowerCase();
    return sceneGraph.nodes
      .filter((node) => perspectiveIds.has(node.id))
      .filter((node) => !normalisedQuery || `${node.label} ${node.kind} ${node.file}`.toLowerCase().includes(normalisedQuery))
      .sort((a, b) => (KIND_RANK.get(a.kind) ?? 99) - (KIND_RANK.get(b.kind) ?? 99) || a.label.localeCompare(b.label))
      .slice(0, 240);
  }, [perspectiveIds, query, sceneGraph]);
  const rightPanelTraceStep = rightPanelNode ? traceStepForNode(activeTrace, rightPanelNode.id) : null;
  const rightPanelCodeExcerpt = rightPanelNode ? codeExcerpt(rightPanelNode) : null;
  const rightPanelSemanticPoints = rightPanelNode ? semanticPoints(rightPanelNode) : [];
  const activeLeftPanel = hoveredLeftPanel;

  useEffect(() => {
    const controlPanel = controlPanelRef.current;
    const overviewBlock = overviewBlockRef.current;
    if (!controlPanel || !overviewBlock) {
      return;
    }

    function updateAvailableHeight() {
      const styles = window.getComputedStyle(controlPanel);
      const gap = parseFloat(styles.rowGap || styles.gap || "14") || 14;
      const collapsedPanelCount = LEFT_PANEL_IDS.length - 1;
      const collapsedPanelHeight = 46;
      const available = controlPanel.clientHeight - overviewBlock.offsetHeight - (collapsedPanelCount * collapsedPanelHeight) - (gap * LEFT_PANEL_IDS.length);
      controlPanel.style.setProperty("--left-panel-available-height", `${Math.max(46, Math.floor(available))}px`);
    }

    updateAvailableHeight();
    const resizeObserver = new ResizeObserver(updateAvailableHeight);
    resizeObserver.observe(controlPanel);
    resizeObserver.observe(overviewBlock);
    window.addEventListener("resize", updateAvailableHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateAvailableHeight);
    };
  }, [activeLeftPanel, mode, traceIndex.length]);

  useEffect(() => {
    function updateRailActive(nextActive: boolean) {
      if (leftPanelRailActiveRef.current === nextActive) {
        return;
      }
      leftPanelRailActiveRef.current = nextActive;
      setLeftPanelRailActive(nextActive);
    }

    function updateNearPanel(nextPanel: LeftPanelId | null) {
      if (nearLeftPanelRef.current === nextPanel) {
        return;
      }
      nearLeftPanelRef.current = nextPanel;
      setNearLeftPanel(nextPanel);
    }

    function handlePointerMove(event: PointerEvent) {
      const controlPanel = controlPanelRef.current;
      if (!controlPanel) {
        updateRailActive(false);
        updateNearPanel(null);
        return;
      }
      const margin = 24;
      let nearestPanel: LeftPanelId | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      controlPanel.querySelectorAll<HTMLElement>(".left-panel-section").forEach((section) => {
        const panelId = section.dataset.leftPanelId as LeftPanelId | undefined;
        if (!panelId) {
          return;
        }
        const panelRect = section.getBoundingClientRect();
        const insidePanelRange = event.clientX >= panelRect.left - margin
          && event.clientX <= panelRect.right + margin
          && event.clientY >= panelRect.top - margin
          && event.clientY <= panelRect.bottom + margin;
        if (!insidePanelRange) {
          return;
        }
        const distance = event.clientY < panelRect.top
          ? panelRect.top - event.clientY
          : event.clientY > panelRect.bottom ? event.clientY - panelRect.bottom : 0;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPanel = panelId;
        }
      });
      updateRailActive(Boolean(nearestPanel));
      updateNearPanel(nearestPanel);
    }

    function handlePointerLeave() {
      updateRailActive(false);
      updateNearPanel(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, []);

  useEffect(() => {
    if (mode === "explore" && selectedId && hiddenNodeIds.has(selectedId)) {
      setSelectedId("");
      setHistory([]);
    }
  }, [hiddenNodeIds, mode, selectedId]);

  useEffect(() => () => {
    if (funTransitionTimerRef.current !== null) {
      window.clearTimeout(funTransitionTimerRef.current);
    }
  }, []);

  function selectStart(nodeId: string) {
    setStartId(nodeId);
    setSelectedId(nodeId);
    setHistory([]);
  }

  function navigateTo(nodeId: string) {
    if (nodeId === selectedId) {
      return;
    }
    setHistory((items) => [...items, selectedId].filter(Boolean));
    setSelectedId(nodeId);
  }

  function deselectNode() {
    if (!selectedId) {
      return;
    }
    setHistory((items) => [...items, selectedId].filter(Boolean));
    setSelectedId("");
  }

  function toggleTreePath(path: string) {
    setExpandedTree((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function goBack() {
    setHistory((items) => {
      const next = [...items];
      const previous = next.pop();
      if (previous) {
        setSelectedId(previous);
      }
      return next;
    });
  }

  function resetToStart() {
    setSelectedId(startId);
    setHistory([]);
  }

  function toggleKind(kind: NodeKind) {
    setActiveKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  function toggleServiceVisibility(nodeId: string) {
    setHiddenServiceIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
    setResetViewSignal((value) => value + 1);
  }

  function isNearLeftPanelNeighbor(panelId: LeftPanelId) {
    if (!nearLeftPanel) {
      return false;
    }
    return Math.abs(LEFT_PANEL_IDS.indexOf(panelId) - LEFT_PANEL_IDS.indexOf(nearLeftPanel)) === 1;
  }

  function leftPanelClass(panelId: LeftPanelId, baseClass: string) {
    return `${baseClass} left-panel-section ${activeLeftPanel === panelId ? "expanded" : ""} ${nearLeftPanel === panelId ? "near-panel" : ""} ${isNearLeftPanelNeighbor(panelId) ? "near-panel-neighbor" : ""}`;
  }

  function leftPanelHoverProps(panelId: LeftPanelId) {
    return {
      "data-left-panel-id": panelId,
      onMouseEnter: () => setHoveredLeftPanel(panelId),
      onMouseLeave: () => setHoveredLeftPanel((current) => current === panelId ? null : current),
      onFocus: () => setHoveredLeftPanel(panelId),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHoveredLeftPanel((current) => current === panelId ? null : current);
        }
      },
    };
  }

  function resetView() {
    setResetViewSignal((value) => value + 1);
  }

  function showFunTransition(phase: FunTransitionPhase) {
    setFunTransitionPhase(phase);
    if (funTransitionTimerRef.current !== null) {
      window.clearTimeout(funTransitionTimerRef.current);
    }
    funTransitionTimerRef.current = window.setTimeout(() => {
      setFunTransitionPhase(null);
      funTransitionTimerRef.current = null;
    }, FUN_TRANSITION_MS);
  }

  function toggleFunMode() {
    if (isFunMode) {
      showFunTransition("exiting");
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        setMode("explore");
        setResetViewSignal((value) => value + 1);
      }));
      return;
    }
    showFunTransition("entering");
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      setMode("fun");
      setSelectedId("");
      setHistory([]);
    }));
  }

  function renderTreeItem(item: RepoTreeItem, depth = 0) {
    const expanded = expandedTree.has(item.path) || Boolean(treeQuery.trim());
    const node = item.nodeId ? allNodesById.get(item.nodeId) : null;
    const selected = item.nodeId === selectedId;
    const pathHidden = hiddenServicePaths.some((path) => item.path === path || item.path.startsWith(`${path}/`));
    const hidden = item.nodeId ? hiddenNodeIds.has(item.nodeId) : pathHidden;
    const isService = node?.kind === "service";
    const serviceHidden = Boolean(isService && node && hiddenServiceIds.has(node.id));
    const canFocus = Boolean(item.nodeId && !hidden);
    const Icon = item.kind === "folder" ? expanded ? FolderOpen : Folder : FileCode2;
    const itemStyle = {
      paddingLeft: `${depth * 14 + 8}px`,
      "--node-color": node ? nodeColor(node) : "#31ffc5",
    } as CSSProperties;
    return (
      <li key={item.id}>
        <div
          className={`tree-item ${selected ? "selected" : ""} ${canFocus ? "focusable" : ""} ${hidden ? "hidden" : ""}`}
          style={itemStyle}
        >
          {item.kind === "folder" ? (
            <button type="button" className="tree-chevron" onClick={() => toggleTreePath(item.path)} aria-label={expanded ? "Collapse folder" : "Expand folder"}>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <button type="button" className="tree-target" disabled={!canFocus} onClick={() => item.nodeId && navigateTo(item.nodeId)} title={item.path}>
            <Icon size={14} />
            <span>{item.name}</span>
            {node && <small>{KIND_LABELS[node.kind]}</small>}
          </button>
          {isService && node ? (
            <button
              type="button"
              className="tree-visibility"
              onClick={(event) => {
                event.stopPropagation();
                toggleServiceVisibility(node.id);
              }}
              aria-label={serviceHidden ? "Show service" : "Hide service"}
              title={serviceHidden ? "Show service" : "Hide service"}
            >
              {serviceHidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          ) : (
            <span className="tree-visibility-spacer" />
          )}
        </div>
        {item.children.length > 0 && expanded && !serviceHidden && (
          <ul>
            {item.children.map((child) => renderTreeItem(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  if (loadError) {
    return (
      <main className="app-shell">
        <section className="empty-state">
          <h1>Codebase Cartographer</h1>
          <p>{loadError}</p>
        </section>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="app-shell">
        <section className="empty-state">
          <h1>Codebase Cartographer</h1>
          <p>Loading graph.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${isFunMode ? "fun-mode-active" : ""}`}>
      <aside className={`control-panel ${leftPanelRailActive ? "rail-active" : ""}`} ref={controlPanelRef}>
        <section className="overview-block" ref={overviewBlockRef}>
          <div className="brand-block">
            <span className="status-dot" />
            <div>
              <h1>{graph.repo.name}</h1>
              <p>{graph.validation.status} graph</p>
            </div>
          </div>

          <label className="field-label">Mode</label>
          <div className="mode-toggle" role="tablist" aria-label="Visualiser mode">
            <button type="button" className={mode === "explore" ? "active" : ""} onClick={() => setMode("explore")}>
              <GitBranch size={15} />
              Explore
            </button>
            <button type="button" className={mode === "ask_trace" ? "active" : ""} onClick={() => { setMode("ask_trace"); setSelectedId(""); setHistory([]); }} disabled={!activeTrace}>
              <Play size={15} />
              Ask & Trace
            </button>
          </div>

          {mode === "ask_trace" && traceIndex.length > 0 && (
            <>
              <label className="field-label" htmlFor="trace-select">Trace</label>
              <select id="trace-select" value={selectedTraceId} onChange={(event) => { setSelectedTraceId(event.target.value); setSelectedId(""); setHistory([]); }}>
                {traceIndex.map((trace) => (
                  <option key={trace.trace_id} value={trace.trace_id}>{trace.question}</option>
                ))}
              </select>
            </>
          )}
        </section>

        <section className={leftPanelClass("focus", "focus-block")} {...leftPanelHoverProps("focus")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "focus"}>
            <span>
              <Search size={16} />
              Focus Search
            </span>
            {activeLeftPanel === "focus" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body">
            <div className="search-box">
              <Search size={16} />
              <input id="node-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find any node" />
            </div>
            <select value={startId} onChange={(event) => selectStart(event.target.value)} size={12} className="node-select">
              {nodeOptions.map((node) => (
                <option key={node.id} value={node.id}>{KIND_LABELS[node.kind]} | {node.label}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={leftPanelClass("tree", "repo-tree-block")} {...leftPanelHoverProps("tree")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "tree"}>
            <span>
              <Folder size={16} />
              Repo Tree
            </span>
            {activeLeftPanel === "tree" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body">
            <div className="search-box tree-search">
              <Search size={15} />
              <input value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder="Filter files" />
            </div>
            <nav className="repo-tree" aria-label="Repository files">
              <ul>
                {visibleRepoTree.map((item) => renderTreeItem(item))}
              </ul>
            </nav>
          </div>
        </section>

        <section className={leftPanelClass("kinds", "filter-block")} {...leftPanelHoverProps("kinds")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "kinds"}>
            <span>
              <Filter size={16} />
              Node Types
            </span>
            {activeLeftPanel === "kinds" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body">
            <div className="kind-grid">
              {kindFilterLevels.map((level, index) => (
                <div key={level.join("-")} className={`kind-level kind-level-${index + 1}`}>
                  {level.map((kind) => (
                    <label key={kind} className="kind-toggle" style={{ "--kind-color": controlKindColor(kind) } as CSSProperties}>
                      <input type="checkbox" checked={activeKinds.has(kind)} onChange={() => toggleKind(kind)} />
                      <span>{filterKindLabel(kind)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={leftPanelClass("summary", "summary-block")} {...leftPanelHoverProps("summary")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "summary"}>
            <span>
              <GitBranch size={16} />
              Architecture Summary
            </span>
            {activeLeftPanel === "summary" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body">
            <p>{graph.summary.agentic ?? graph.summary.deterministic}</p>
            <dl>
              <div><dt>Nodes</dt><dd>{graph.nodes.length}</dd></div>
              <div><dt>Edges</dt><dd>{graph.edges.length}</dd></div>
              <div><dt>Generated</dt><dd>{new Date(graph.generated_at).toLocaleString()}</dd></div>
            </dl>
            <div className="node-count-breakdown" aria-label="Node type counts">
              {nodeTypeCounts.map(({ kind, count }) => (
                <div key={kind}>
                  <span>
                    <i style={{ background: controlKindColor(kind), color: controlKindColor(kind) }} />
                    {displayKindLabel(kind)}
                  </span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={leftPanelClass("wiki", "wiki-block")} {...leftPanelHoverProps("wiki")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "wiki"}>
            <span>
              <BookOpen size={16} />
              Visualiser Wiki
            </span>
            {activeLeftPanel === "wiki" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body wiki-body">
            <h3>How nodes are positioned spatially</h3>
            <p><strong>Technique:</strong> Bounded Structural Force Layout</p>
            <p>A deterministic spatial layout technique that uses structural affinity, relationship attraction, and bounded repulsion to shape the codebase graph into a readable architectural map while preserving the source-backed topology.</p>
            <ul>
              <li><strong>Anchored hierarchy:</strong> Nodes are placed around their service, file, or declaration parent, giving the map a stable architectural frame.</li>
              <li><strong>Structural affinity:</strong> Functions, APIs, contracts, UI elements, data objects, and other nodes are positioned around the files and parents they belong to.</li>
              <li><strong>Relationship attraction:</strong> Connected nodes are pulled closer together based on the strength of their relationship.</li>
              <li><strong>Collision repulsion:</strong> Nearby nodes push away from each other so the graph has more breathing room.</li>
              <li><strong>Sibling repulsion:</strong> Unrelated nodes under the same parent are pushed apart, allowing smaller clusters to emerge.</li>
              <li><strong>Adaptive bounds:</strong> Larger parent groups are given more space so dense areas do not collapse into tight clusters.</li>
              <li><strong>Source-faithful layout:</strong> Positions are adjusted for readability, while the graph's nodes and relationships remain unchanged.</li>
            </ul>
            <p>This helps architectural patterns, hidden dependencies, and local code clusters surface visually, making relationships easier to identify than they would be from reading source files alone.</p>
          </div>
        </section>

        <section className={leftPanelClass("settings", "settings-block")} {...leftPanelHoverProps("settings")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "settings"}>
            <span>
              <SlidersHorizontal size={16} />
              Settings
            </span>
            {activeLeftPanel === "settings" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body settings-body">
            <label className="setting-toggle">
              <span>
                <strong>Twinkle</strong>
              </span>
              <input type="checkbox" checked={twinkleEnabled} onChange={() => setTwinkleEnabled((value) => !value)} />
            </label>
            <label className="setting-slider">
              <span>
                <strong>Glow intensity</strong>
                <small>{glowIntensity.toFixed(1)}x</small>
              </span>
              <input type="range" min="0.5" max="2" step="0.1" value={glowIntensity} onChange={(event) => setGlowIntensity(Number(event.target.value))} />
            </label>
            <label className="setting-slider">
              <span>
                <strong>LOD Distance</strong>
                <small>{lodDistance.toFixed(1)}</small>
              </span>
              <input type="range" min="0" max="1" step="0.1" value={lodDistance} onChange={(event) => setLodDistance(Number(event.target.value))} />
            </label>
            <label className="setting-slider">
              <span>
                <strong>Stardust Density</strong>
                <small>{stardustCount}</small>
              </span>
              <input type="range" min="0" max="1" step="0.05" value={stardustDensity} onChange={(event) => setStardustDensity(Number(event.target.value))} />
            </label>
          </div>
        </section>

        <section className={leftPanelClass("creator", "creator-block")} {...leftPanelHoverProps("creator")}>
          <div className="left-panel-header" aria-expanded={activeLeftPanel === "creator"}>
            <span>
              <Linkedin size={16} />
              Connect with Creator
            </span>
            {activeLeftPanel === "creator" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="left-panel-body creator-body">
            <a href="https://linkedin.com/in/ezekielhoe" target="_blank" rel="noreferrer">
              <Linkedin size={17} />
              <span>linkedin.com/in/ezekielhoe</span>
            </a>
            <a href="https://github.com/CreateWithEzekiel" target="_blank" rel="noreferrer">
              <Github size={17} />
              <span>github.com/CreateWithEzekiel</span>
            </a>
          </div>
        </section>
      </aside>

      <section className="graph-stage" aria-label="Code graph">
        <GraphScene
          graph={sceneGraph ?? graph}
          selectedId={selectedId}
          activeKinds={sceneActiveKinds}
          perspectiveIds={scenePerspectiveIds}
          activeTrace={mode === "ask_trace" ? activeTrace : null}
          funMode={isFunMode}
          resetViewSignal={resetViewSignal}
          showSelectedOverlays={showSelectedOverlays}
          showHoverOverlays={showHoverOverlays}
          twinkleEnabled={twinkleEnabled}
          glowIntensity={glowIntensity}
          stardustCount={stardustCount}
          screenCullKinds={screenCullKinds}
          tinyNodeCullBelowPx={tinyCullThresholds.cullBelowPx}
          tinyNodeRestoreAbovePx={tinyCullThresholds.restoreAbovePx}
          onZoomChange={setZoomLevel}
          onFunSpeedChange={setFunSpeedLevel}
          onFpsChange={setFpsLevel}
          onSelect={navigateTo}
          onDeselect={deselectNode}
        />
        {funTransitionPhase && (
          <div className={`fun-transition-screen ${funTransitionPhase}`} role="status" aria-live="polite">
            <div>
              <span>{funTransitionPhase === "entering" ? "Fun Mode" : "Exiting Fun Mode"}</span>
              <strong className="fun-transition-line">
                {funTransitionPhase === "entering" ? (
                  "Activating Vehicular Space Exploration!"
                ) : (
                  <>
                    Boooooo
                    <ThumbsDown size={22} />
                  </>
                )}
              </strong>
            </div>
          </div>
        )}
        <div className="fps-counter" aria-label="Renderer frames per second">{Math.round(fpsLevel)} FPS</div>

        <aside className="detail-rail">
          <div className="selected-card">
            {selectedNode ? (
              <>
                <span className="node-kind" style={{ color: nodeColor(selectedNode) }}>{displayKindLabel(selectedNode.kind)}</span>
                <h2>{selectedNode.label}</h2>
                <p>{selectedNode.file}{selectedNode.line_start ? `:${selectedNode.line_start}` : ""}</p>
              </>
            ) : (
              <>
                <span className="node-kind">No selection</span>
                <h2>No node selected</h2>
                <p>Left-click any node to inspect it.</p>
              </>
            )}
            {mode === "ask_trace" && activeTrace && (
              <div className="trace-chip">
                <Play size={14} />
                <span>{activeTrace.question}</span>
              </div>
            )}
          </div>

          {rightPanelNode && (
            <div className={`right-context-panels ${rightPanelsExiting ? "exiting" : ""}`}>
          <div className="node-details">
            <h3>Details</h3>
                <section>
                  <h4>Summary</h4>
                  <p>{rightPanelNode.summary.agentic ?? rightPanelNode.summary.deterministic}</p>
                  {rightPanelSemanticPoints.length > 0 && (
                    <details className="semantic-breakdown">
                      <summary>
                        <span>Semantic Breakdown</span>
                        <small>{rightPanelSemanticPoints.length} insights</small>
                      </summary>
                      <ul>
                        {rightPanelSemanticPoints.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {rightPanelCodeExcerpt && (
                    <div className="code-excerpt">
                      <pre>
                        {codeExcerptRows(rightPanelCodeExcerpt).map((row) => (
                          <span className="code-excerpt-line" key={row.number}>
                            <span className="code-excerpt-line-number">{row.number}</span>
                            <code>{row.line || " "}</code>
                          </span>
                        ))}
                      </pre>
                      <p className="contract-status">
                        {rightPanelCodeExcerpt.file}:{rightPanelCodeExcerpt.line_start}-{rightPanelCodeExcerpt.line_end}
                        {rightPanelCodeExcerpt.omitted_lines > 0 ? ` | ${rightPanelCodeExcerpt.omitted_lines} lines omitted` : ""}
                      </p>
                    </div>
                  )}
                </section>
                {rightPanelTraceStep && (
                  <section className="trace-step-detail">
                    <h4>Ask & Trace Step</h4>
                    <p><strong>{rightPanelTraceStep.title}</strong></p>
                    <p>{rightPanelTraceStep.explanation || "No extra explanation recorded."}</p>
                    <p className="contract-status">{rightPanelTraceStep.phase} | {rightPanelTraceStep.confidence}</p>
                  </section>
                )}
                {contractSections(rightPanelNode).map((item) => (
                  <section key={item.title}>
                    <h4>{item.title}</h4>
                    <pre>{formatJson(item.contract.shape)}</pre>
                    <p className="contract-status">{item.contract.status} via {item.contract.source}</p>
                  </section>
                ))}
                {detailSections(rightPanelNode).map((item) => (
                  <section key={item.title}>
                    <h4>{item.title}</h4>
                    <pre>{formatJson(item.value)}</pre>
                  </section>
                ))}
                <section>
                  <h4>Evidence</h4>
                  <ul>
                    {rightPanelNode.evidence.map((item, index) => (
                      <li key={`${item.kind}-${index}`}>{item.kind} | {item.file}{item.line_start ? `:${item.line_start}` : ""} | {item.detail}</li>
                    ))}
                  </ul>
                </section>
          </div>

          <div className="connection-list">
            <h3>Connections</h3>
            {rightPanelConnections.map((edge) => {
              const nextId = edge.source === rightPanelNode.id ? edge.target : edge.source;
              const nextNode = nodesById.get(nextId);
              const metadata = connectionMetadata(edge);
              return (
                <button key={edge.id} type="button" onClick={() => navigateTo(nextId)} style={{ "--node-color": nextNode ? nodeColor(nextNode) : "#eef6ff" } as CSSProperties}>
                  <span>{edge.kind}</span>
                  <strong>{nextNode?.label ?? nextId}</strong>
                  <small>{edge.reason.agentic ?? edge.reason.deterministic}</small>
                  {metadata && <small>{metadata}</small>}
                </button>
              );
            })}
            {!rightPanelConnections.length && <p>No deterministic connections recorded.</p>}
          </div>
            </div>
          )}
        </aside>
      </section>

      <nav className={`navigation-panel ${isFunMode ? "fun-navigation" : ""}`} aria-label="Graph navigation">
        {isFunMode && (
          <div className="fun-control-legend" aria-label="Vehicle controls">
            <span>Left click: select / unselect node</span>
            <span>Right click: stop</span>
            <span>Scroll up: forward</span>
            <span>Scroll down: reverse</span>
            <span>Cursor from center: steer</span>
          </div>
        )}
        <div className="zoom-indicator" style={{ "--zoom-level": `${Math.round(navigationLevel * 100)}%`, "--indicator-color": navigationIndicatorColor } as CSSProperties} aria-label={isFunMode ? "Vehicle speed" : "Scene zoom level"}>
          <input type="range" min="0" max="100" value={Math.round(navigationLevel * 100)} onChange={() => undefined} aria-label={isFunMode ? "Vehicle speed" : "Zoom level"} />
        </div>
        {!isFunMode && (
          <>
            <button type="button" onClick={goBack} disabled={!history.length} aria-label="Back one node" title="Back one node">
              <ArrowLeft size={18} />
              <span>Back</span>
            </button>
            <button type="button" onClick={() => selectedId && setStartId(selectedId)} disabled={!selectedId} aria-label="Set selected as home" title="Set selected as home">
              <MapPin size={18} />
              <span>Set Home</span>
            </button>
            <button type="button" onClick={resetToStart} disabled={selectedId === startId} aria-label="Return to home" title="Return to home">
              <House size={18} />
              <span>Home</span>
            </button>
          </>
        )}
        <button type="button" className={`fun-mode-button ${isFunMode ? "active" : ""}`} onClick={toggleFunMode} aria-label={isFunMode ? "Exit Fun mode" : "Enter Fun mode"} title={isFunMode ? "Exit Fun mode" : "Enter Fun mode"}>
          <CarFront size={18} />
        </button>
        {!isFunMode && (
          <>
            <button type="button" onClick={resetView} aria-label="Reset view" title="Reset view">
              <RefreshCcw size={18} />
              <span>Reset View</span>
            </button>
            <button type="button" onClick={() => setShowSelectedOverlays((value) => !value)} aria-label={showSelectedOverlays ? "Hide selected overlays" : "Show selected overlays"} title={showSelectedOverlays ? "Hide selected overlays" : "Show selected overlays"}>
              {showSelectedOverlays ? <Eye size={18} /> : <EyeOff size={18} />}
              <span>{showSelectedOverlays ? "Labels On" : "Labels Off"}</span>
            </button>
          </>
        )}
        {isFunMode && (
          <button type="button" onClick={() => setShowSelectedOverlays((value) => !value)} aria-label={showSelectedOverlays ? "Hide selected overlays" : "Show selected overlays"} title={showSelectedOverlays ? "Hide selected overlays" : "Show selected overlays"}>
            {showSelectedOverlays ? <Eye size={18} /> : <EyeOff size={18} />}
            <span>{showSelectedOverlays ? "Labels On" : "Labels Off"}</span>
          </button>
        )}
        <button type="button" onClick={() => setShowHoverOverlays((value) => !value)} aria-label={showHoverOverlays ? "Hide hover labels" : "Show hover labels"} title={showHoverOverlays ? "Hide hover labels" : "Show hover labels"}>
          <i className={`nav-icon ${showHoverOverlays ? "" : "struck"}`} aria-hidden="true">
            <MousePointer2 size={18} />
          </i>
          <span>{showHoverOverlays ? "Hover On" : "Hover Off"}</span>
        </button>
      </nav>
    </main>
  );
}

export default App;

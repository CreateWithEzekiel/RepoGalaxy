export type ContractStatus =
  | "complete"
  | "partial"
  | "unknown"
  | "not_declared"
  | "inferred_from_usage";

export type NodeKind =
  | "workspace"
  | "service"
  | "package"
  | "module"
  | "file"
  | "config_file"
  | "function"
  | "class"
  | "method"
  | "constructor"
  | "exception"
  | "decorator"
  | "api_endpoint"
  | "websocket_endpoint"
  | "route"
  | "background_task"
  | "cli_command"
  | "schema"
  | "model"
  | "dataclass"
  | "pydantic_model"
  | "typed_dict"
  | "type"
  | "interface"
  | "type_alias"
  | "enum"
  | "component"
  | "hook"
  | "context"
  | "provider"
  | "page"
  | "layout"
  | "form"
  | "store"
  | "reducer"
  | "api_client"
  | "style"
  | "style_rule"
  | "media_query"
  | "container_query"
  | "supports_rule"
  | "keyframes"
  | "font_face"
  | "css_layer"
  | "css_at_rule"
  | "html_document"
  | "template"
  | "html_element"
  | "database_schema"
  | "table"
  | "view"
  | "materialized_view"
  | "migration"
  | "stored_procedure"
  | "sql_function"
  | "trigger"
  | "index"
  | "constraint";

export interface Evidence {
  kind: string;
  file: string;
  line_start: number | null;
  line_end: number | null;
  detail: string;
}

export interface Contract {
  status: ContractStatus;
  shape: unknown;
  source: string;
  evidence: Evidence[];
}

export interface CodeExcerpt {
  text: string;
  language: string;
  file: string;
  line_start: number;
  line_end: number;
  omitted_lines: number;
  truncation: string;
  source: string;
}

export interface CodeNode {
  id: string;
  kind: NodeKind;
  label: string;
  language: string;
  file: string;
  line_start: number | null;
  line_end: number | null;
  deterministic_status: ContractStatus;
  summary: {
    deterministic: string;
    agentic: string | null;
    agentic_status: string;
    agentic_points?: string[];
  };
  contracts: {
    request: Contract;
    response: Contract;
  };
  evidence: Evidence[];
  tags: string[];
  metadata: Record<string, unknown>;
  details: Record<string, unknown> & { code_excerpt?: CodeExcerpt };
  color: string;
}

export interface CodeEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  reason: {
    deterministic: string;
    agentic: string | null;
    agentic_status: string;
  };
  deterministic_status: ContractStatus;
  evidence: Evidence[];
  metadata?: Record<string, unknown>;
}

export interface Perspective {
  title: string;
  node_ids: string[];
  edge_ids: string[];
}

export interface CodeGraph {
  schema_version: string;
  generated_at: string;
  repo: {
    name: string;
    root: string;
  };
  summary: {
    deterministic: string;
    agentic: string | null;
    agentic_status: string;
    counts: {
      files: number;
      nodes: Record<string, number>;
      edges: Record<string, number>;
      languages: Record<string, number>;
    };
  };
  nodes: CodeNode[];
  edges: CodeEdge[];
  perspectives: Record<string, Perspective>;
  validation: {
    status: string;
    findings: Array<{ severity: string; message: string }>;
    warnings: string[];
    counts: Record<string, unknown>;
  };
}

export interface LayoutNode {
  node: CodeNode;
  x: number;
  y: number;
  scale: number;
  depth: number;
  opacity: number;
  inHistory: boolean;
}

export type TraceConfidence =
  | "deterministic"
  | "source_backed"
  | "inferred_from_usage"
  | "needs_confirmation";

export interface TraceStep {
  order: number;
  node_id: string;
  edge_id: string | null;
  phase: string;
  direction: "forward" | "reverse";
  title: string;
  explanation: string;
  packet_label: string;
  delay_ms: number;
  confidence: TraceConfidence;
  evidence: Evidence[];
}

export interface TraceCustomEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  reason: string;
  confidence: TraceConfidence;
  evidence: Evidence[];
}

export interface TracePlan {
  schema_version: string;
  trace_id: string;
  question: string;
  generated_at: string;
  start_node_id: string;
  confidence: TraceConfidence;
  mode: "ask_trace";
  loop: boolean;
  playback: {
    loop_delay_ms: number;
    default_step_delay_ms: number;
  };
  index: Record<string, unknown>;
  steps: TraceStep[];
  custom_edges?: TraceCustomEdge[];
  alternatives: Array<Record<string, unknown>>;
}

export interface TraceIndexItem {
  trace_id: string;
  question: string;
  start_node_id: string;
  confidence: TraceConfidence;
  path: string;
  generated_at: string;
}

export interface TraceIndex {
  traces: TraceIndexItem[];
}

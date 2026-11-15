/** Shared runtime/IR/profiling types for SYNAPSE. */
import type { Workflow, WorkflowNode, OpType } from "./schema.js";

export type { Workflow, WorkflowNode, OpType };

/** A single actionable compiler validation error. */
export interface CompileError {
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
}

/** Graph data shaped for the UI (nodes + edges + layered layout). */
export interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    op: OpType;
    level: number; // topological depth, used for layout columns
    deterministic: boolean;
    sideEffectSafe: boolean;
    adapter: string;
    model?: string;
  }>;
  edges: Array<{ from: string; to: string }>;
  /** Node ids grouped by level; nodes within a level are independent. */
  levels: string[][];
}

/** Compiled intermediate representation. */
export interface IR {
  irVersion: string; // content hash of the compiled plan
  workflowId: string;
  workflowVersion: string;
  schemaVersion: string;
  /** Topologically sorted execution order (stable). */
  order: string[];
  /** Adjacency: node id -> direct dependents. */
  dependents: Record<string, string[]>;
  /** node id -> direct dependencies. */
  dependencies: Record<string, string[]>;
  graph: GraphData;
  compiledAt: string;
}

export interface CompileResult {
  ok: boolean;
  errors: CompileError[];
  ir?: IR;
}

/** Per-node execution state. */
export type NodeStatus =
  | "pending"
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "memoized";

export type RunMode = "baseline" | "optimized";
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

/** Usage figures. Every field is explicitly tagged by source. */
export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * "simulated" (demo values), "provider-reported" (real provider returned
   * usage), "unavailable" (a real provider ran but returned no usage — we never
   * invent it), or "none" (no model/token work, e.g. a retrieval or transform).
   */
  source: "simulated" | "provider-reported" | "unavailable" | "none";
  model?: string;
}

/**
 * Where a node's output actually came from. Distinct from Usage.source so the UI
 * and MCP can state plainly whether a result is real or demo output.
 */
export type Provenance = "live" | "demo" | "cached" | "mocked" | "unavailable";

/**
 * A structured, citable source record produced by a retrieval adapter and
 * preserved unchanged through summarization and synthesis so the final answer
 * can cite claims to real retrieved documents.
 */
export interface SourceRecord {
  /** Stable, workflow-unique id (used as the citation marker, e.g. "a1"). */
  sourceId: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  /** Longer extracted content when the provider returns it. */
  content?: string;
  retrievedAt: string;
  /** Provider relevance score when available. */
  score?: number;
  /** "live" for a real provider, "demo" for simulated/deterministic sources. */
  provenance: Provenance;
}

/** A resolved citation in the final answer: a source id mapped to its record. */
export interface Citation {
  sourceId: string;
  title: string;
  url: string;
  publisher: string;
}

/** The delivered answer of a run (persisted — this is the product of the run). */
export interface RunResult {
  /** Human-readable answer, markdown, with inline [sourceId] citations. */
  answer: string;
  title?: string;
  /** Structured formatted document (sections + citations). */
  document: unknown;
  citations: Citation[];
  sources: SourceRecord[];
  provenance: Provenance;
}

export interface NodeSpan {
  nodeId: string;
  label: string;
  op: OpType;
  adapter: string;
  status: NodeStatus;
  dependsOn: string[];
  attempts: number;
  queuedAt?: number; // ms epoch
  startedAt?: number;
  endedAt?: number;
  queueMs: number; // time spent waiting before execution
  execMs: number; // measured wall-clock execution time
  error?: string;
  usage: Usage;
  /** True when the result was served from within-run memoization. */
  memoized: boolean;
  /** Where this node's output came from (set once the node runs). */
  provenance?: Provenance;
  /** Provider/model provenance (real adapters only; otherwise undefined). */
  model?: string;
  requestId?: string;
  finishReason?: string;
  /** Number of structured sources this node produced or carried. */
  sourceCount: number;
}

/** Run-level execution provenance summary (no secrets, no bodies). */
export interface ExecutionSummary {
  /** Distinct adapters that actually ran a node. */
  adapters: string[];
  /** Distinct real providers/models used (empty in demo mode). */
  providers: string[];
  liveNodeCount: number;
  demoNodeCount: number;
  /** True if ANY node ran against a real external provider. */
  liveExecution: boolean;
  /** Distinct sources retrieved across the run. */
  sourceCount: number;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowVersion: string;
  irVersion: string;
  mode: RunMode;
  concurrency: number;
  status: RunStatus;
  createdAt: string;
  startedAt?: number;
  endedAt?: number;
  /** Measured total wall-clock of the whole run (ms). */
  totalMs: number;
  /** Measured SYNAPSE scheduling/orchestration overhead (ms), separate. */
  overheadMs: number;
  spans: NodeSpan[];
  usage: Usage;
  /** Estimated cost in USD — CALCULATED, not a provider charge. */
  estimatedCostUsd: number;
  /** Which transformations were applied to produce this run. */
  appliedTransformations: string[];
  validation?: ValidationResult;
  error?: string;
  /** Execution provenance summary (which adapters/providers actually ran). */
  execution?: ExecutionSummary;
  /**
   * The delivered answer + cited sources. This IS persisted (it is the product
   * of the run). Intermediate prompts and node I/O bodies remain ephemeral.
   */
  result?: RunResult;
  /** Redaction-safe: we never persist raw prompt/output bodies by default. */
}

/** One correctness check outcome. */
export interface CheckResult {
  id: string;
  description: string;
  required: boolean;
  passed: boolean;
  detail: string;
  /**
   * "structural" = schema/graph/required-field invariants (deterministic).
   * "semantic" = grounding/citation/relevance evaluation (task-specific).
   * "estimate" = produced by an LLM judge or heuristic; NOT ground truth.
   */
  category: "structural" | "semantic" | "estimate";
}

export interface ValidationResult {
  passed: boolean; // all REQUIRED checks passed
  checks: CheckResult[];
}

/** A single optimizer decision, recorded for transparency. */
export interface TransformationDecision {
  id: string;
  title: string;
  rationale: string;
  preconditions: Array<{ description: string; met: boolean }>;
  confidence: number; // 0..1
  expectedBenefit: string;
  status: "accepted" | "rejected" | "noop";
  reason: string;
  affectedNodes: string[];
}

export interface OptimizationPlan {
  workflowId: string;
  irVersion: string;
  decisions: TransformationDecision[];
  /** Suggested concurrency for the optimized run. */
  suggestedConcurrency: number;
  memoizationEnabled: boolean;
  summary: string;
}

/** A labelled metric value: is it measured, estimated, or simulated? */
export interface LabeledValue {
  value: number;
  unit: string;
  label: "measured" | "estimated" | "simulated" | "provider-reported";
}

export interface RunComparison {
  baseline: RunRecord;
  optimized: RunRecord;
  sampleCount: number;
  metrics: {
    baselineTotalMs: LabeledValue;
    optimizedTotalMs: LabeledValue;
    speedup: LabeledValue; // ratio, measured
    deltaMs: LabeledValue;
    baselineOverheadMs: LabeledValue;
    optimizedOverheadMs: LabeledValue;
    baselineCalls: LabeledValue;
    optimizedCalls: LabeledValue;
    baselineTokens: LabeledValue;
    optimizedTokens: LabeledValue;
    baselineCostUsd: LabeledValue;
    optimizedCostUsd: LabeledValue;
  };
  note: string;
}

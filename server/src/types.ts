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
  /** "simulated" (demo), "provider-reported" (real), or "none". */
  source: "simulated" | "provider-reported" | "none";
  model?: string;
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
  /** Redaction-safe: we never persist raw prompt/output bodies by default. */
}

/** One correctness check outcome. */
export interface CheckResult {
  id: string;
  description: string;
  required: boolean;
  passed: boolean;
  detail: string;
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

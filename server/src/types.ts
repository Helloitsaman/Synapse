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

/**
 * Run-level provenance. "live" = every successful node ran against a real
 * provider; "demo" = every successful node was simulated; "mixed" = a genuine
 * blend (some live, some demo). A deterministic formatting node that only
 * re-assembles live data is counted as live (it carries live provenance), so a
 * fully-live research run is not mislabelled MIXED by its formatter.
 */
export type ProvenanceMode = "live" | "demo" | "mixed";

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
  /** True when BOTH live and demo nodes contributed to the result. */
  mixedExecution: boolean;
  /** Overall provenance label derived from ALL successful node provenance. */
  provenanceMode: ProvenanceMode;
  /** Distinct sources retrieved across the run. */
  sourceCount: number;
}

/** How cost was derived. "unavailable" = unknown, never shown as a $0 charge. */
export type CostLabel = "estimated" | "unavailable";

/** Provenance/pricing metadata for an estimated cost (never a provider charge). */
export interface CostEstimate {
  /** Estimated USD, or null when it cannot be estimated (unknown ≠ free). */
  usd: number | null;
  label: CostLabel;
  /** Which local price table produced this (version + date), for auditability. */
  pricingSource: string;
  /** Whether the model had a matching price row (vs. a fallback default rate). */
  modelMatched: boolean;
  model?: string;
}

/**
 * A privacy-safe, NON-REVERSIBLE fingerprint of the inputs/config that define
 * whether two runs are comparable. Hashes are one-way (sha256-derived); raw
 * inputs are never stored here.
 */
export interface RunFingerprint {
  workflowId: string;
  workflowVersion: string;
  irVersion: string;
  /** Hash of normalized workflow inputs (topic, etc.). */
  inputsHash: string;
  /** Hash of per-node adapter+model+canonical config. */
  configHash: string;
  /** Distinct adapters declared by the workflow. */
  adapters: string[];
  /** Distinct provider:model pairs declared for llm nodes. */
  models: string[];
  mode: RunMode;
  concurrency: number;
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
  /**
   * Estimated cost in USD — CALCULATED, not a provider charge. `null` means the
   * cost is UNKNOWN (a real provider ran but reported no usage); it is never
   * rendered as a $0 charge. See `cost` for provenance/pricing metadata.
   */
  estimatedCostUsd: number | null;
  /** Cost provenance + pricing source (always labelled, never a real charge). */
  cost: CostEstimate;
  /** Which transformations were applied to produce this run. */
  appliedTransformations: string[];
  validation?: ValidationResult;
  error?: string;
  /** Execution provenance summary (which adapters/providers actually ran). */
  execution?: ExecutionSummary;
  /** Privacy-safe fingerprint of the inputs/config that define comparability. */
  fingerprint?: RunFingerprint;
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

/** A labelled metric value: is it measured, estimated, simulated, or unknown? */
export interface LabeledValue {
  value: number;
  unit: string;
  label: "measured" | "estimated" | "simulated" | "provider-reported" | "unavailable" | "none";
}

/**
 * Whether two runs are actually comparable, derived from their fingerprints.
 * A comparison across mismatched inputs/config is apples-to-oranges and is
 * marked, never silently presented as a clean before/after.
 */
export interface ComparabilityReport {
  comparable: boolean;
  sameWorkflow: boolean;
  sameWorkflowVersion: boolean;
  sameInputs: boolean;
  sameConfig: boolean;
  /** Human-readable list of the fingerprint fields that differ. */
  mismatches: string[];
  /** True when either run lacks a fingerprint (older run) — comparability unknown. */
  fingerprintMissing: boolean;
}

/** Heuristic (ESTIMATE) comparison of the two delivered answers. */
export interface AnswerComparison {
  baselineProvenance?: Provenance;
  optimizedProvenance?: Provenance;
  baselineCitations: string[];
  optimizedCitations: string[];
  /** Lexical Jaccard similarity of the answers (0..1) — an estimate, not truth. */
  similarity: number;
  /** True when the SET of cited source ids matches exactly. */
  sameCitedSources: boolean;
  label: "estimate";
  note: string;
}

export interface RunComparison {
  baseline: RunRecord;
  optimized: RunRecord;
  sampleCount: number;
  /** Fingerprint-based comparability (matched vs. mismatched runs). */
  comparability: ComparabilityReport;
  /** True when both runs' required-check outcomes agree. */
  validationMatch: boolean;
  /** Heuristic answer comparison (estimate), when both runs produced answers. */
  answer?: AnswerComparison;
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

/** Summary statistics of a repeated measurement (all values measured). */
export interface Distribution {
  samples: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
  /** Population standard deviation. */
  stdev: number;
  unit: string;
  label: "measured";
  /** Raw per-sample values, in collection order. */
  values: number[];
}

export interface BenchmarkModeResult {
  mode: RunMode;
  runIds: string[];
  /** Runs that did not reach "succeeded". */
  failures: number;
  totalMs: Distribution;
  overheadMs: Distribution;
}

/**
 * A paired, repeated benchmark: N baseline + N optimized runs executed in
 * alternating/interleaved order against the SAME workflow + inputs, reported as
 * distributions (never a single sample, never an unqualified significance claim).
 */
export interface BenchmarkResult {
  workflowId: string;
  workflowVersion: string;
  repetitions: number;
  /** The interleaved execution order (for audit). */
  order: Array<{ mode: RunMode; runId: string; totalMs: number; status: RunStatus }>;
  baseline: BenchmarkModeResult;
  optimized: BenchmarkModeResult;
  /** baseline.median / optimized.median — a ratio of medians, measured. */
  speedupMedian: number;
  /** Comparability across the two sets (should be matched by construction). */
  comparability: ComparabilityReport;
  baselineKind: "synapse-sequential-graph";
  note: string;
}

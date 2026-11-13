// Mirror of the backend's API response shapes (the subset the UI consumes).

export type OpType = "llm" | "retrieval" | "tool" | "transform" | "decision";
export type NodeStatus =
  | "pending" | "queued" | "running" | "retrying"
  | "succeeded" | "failed" | "skipped" | "cancelled" | "memoized";
export type RunMode = "baseline" | "optimized";
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  nodeCount: number;
  builtin?: boolean;
}

export interface GraphData {
  nodes: Array<{
    id: string; label: string; op: OpType; level: number;
    deterministic: boolean; sideEffectSafe: boolean; adapter: string; model?: string;
  }>;
  edges: Array<{ from: string; to: string }>;
  levels: string[][];
}

export interface IR {
  irVersion: string; workflowId: string; workflowVersion: string; schemaVersion: string;
  order: string[]; dependents: Record<string, string[]>; dependencies: Record<string, string[]>;
  graph: GraphData; compiledAt: string;
}

export interface CompileError { code: string; message: string; nodeId?: string; path?: string; }
export interface CompileResult { ok: boolean; errors: CompileError[]; ir?: IR; }

export interface Usage {
  calls: number; inputTokens: number; outputTokens: number;
  source: "simulated" | "provider-reported" | "none"; model?: string;
}

export interface NodeSpan {
  nodeId: string; label: string; op: OpType; adapter: string; status: NodeStatus;
  dependsOn: string[]; attempts: number; queuedAt?: number; startedAt?: number; endedAt?: number;
  queueMs: number; execMs: number; error?: string; usage: Usage; memoized: boolean;
}

export interface CheckResult {
  id: string; description: string; required: boolean; passed: boolean; detail: string;
}
export interface ValidationResult { passed: boolean; checks: CheckResult[]; }

export interface RunRecord {
  id: string; workflowId: string; workflowVersion: string; irVersion: string;
  mode: RunMode; concurrency: number; status: RunStatus; createdAt: string;
  startedAt?: number; endedAt?: number; totalMs: number; overheadMs: number;
  spans: NodeSpan[]; usage: Usage; estimatedCostUsd: number;
  appliedTransformations: string[]; validation?: ValidationResult; error?: string;
}

export interface RunSummary {
  id: string; workflowId: string; mode: RunMode; status: RunStatus; createdAt: string;
  totalMs: number; overheadMs: number; validationPassed: boolean | null;
  estimatedCostUsd: number; usage: Usage;
}

export interface TransformationDecision {
  id: string; title: string; rationale: string;
  preconditions: Array<{ description: string; met: boolean }>;
  confidence: number; expectedBenefit: string;
  status: "accepted" | "rejected" | "noop"; reason: string; affectedNodes: string[];
}

export interface OptimizationPlan {
  workflowId: string; irVersion: string; decisions: TransformationDecision[];
  suggestedConcurrency: number; memoizationEnabled: boolean; summary: string;
}

export interface LabeledValue {
  value: number; unit: string;
  label: "measured" | "estimated" | "simulated" | "provider-reported";
}

export interface RunComparison {
  baseline: RunRecord; optimized: RunRecord; sampleCount: number;
  metrics: Record<string, LabeledValue>; note: string;
}

export interface Integrations {
  adapterContractVersion: string;
  adapters: Array<{
    id: string; contractVersion: string;
    capabilities: {
      ops: string[]; network: boolean; providerReportedUsage: boolean;
      credentialless: boolean; limitations: string[];
    };
    availability: { available: boolean; reason?: string };
  }>;
  hosts: Array<{ host: string; role: string; integration: string; notes: string }>;
  telemetry: { enabled: boolean; endpoint: string | null; serviceName: string; started: boolean };
}

export interface AppConfig {
  schemaVersion: string; adapterContractVersion: string;
  telemetry: { enabled: boolean; endpoint: string | null; serviceName: string; started: boolean };
  privacy: { redactBodies: boolean; telemetryMetadataOnly: boolean; runContextEphemeral: boolean; retention: string };
  demoMode: boolean;
}

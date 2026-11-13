import type { Workflow } from "../schema.js";
import { SCHEMA_VERSION } from "../schema.js";

/**
 * The flagship "Research Brief" workflow: two independent source
 * retrieval + summarization branches that feed a final synthesis, then a
 * deterministic formatting/validation transform.
 *
 * Branch A and Branch B are independent and side-effect-free, so the optimizer
 * can schedule them concurrently. The synthesis depends on both.
 */
export const researchBrief: Workflow = {
  schemaVersion: SCHEMA_VERSION,
  id: "research-brief",
  name: "Research Brief",
  description:
    "Two independent retrieval/summarization branches feed a final synthesis step.",
  version: "1.2.0",
  nodes: [
    {
      id: "retrieve_a",
      op: "retrieval",
      label: "Retrieve — Source A (Market Data)",
      dependsOn: [],
      inputs: ["topic"],
      outputs: ["docs_a"],
      timeoutMs: 8000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 2, backoffMs: 50 },
      config: { sourceId: "SRC-A", corpus: "market" },
    },
    {
      id: "summarize_a",
      op: "llm",
      label: "Summarize — Source A",
      dependsOn: ["retrieve_a"],
      inputs: ["docs_a"],
      outputs: ["summary_a"],
      timeoutMs: 15000,
      provider: { adapter: "demo", model: "synapse-sim-mini" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { section: "A", sourceId: "SRC-A" },
    },
    {
      id: "retrieve_b",
      op: "retrieval",
      label: "Retrieve — Source B (Filings)",
      dependsOn: [],
      inputs: ["topic"],
      outputs: ["docs_b"],
      timeoutMs: 8000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 2, backoffMs: 50 },
      config: { sourceId: "SRC-B", corpus: "filings" },
    },
    {
      id: "summarize_b",
      op: "llm",
      label: "Summarize — Source B",
      dependsOn: ["retrieve_b"],
      inputs: ["docs_b"],
      outputs: ["summary_b"],
      timeoutMs: 15000,
      provider: { adapter: "demo", model: "synapse-sim-mini" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { section: "B", sourceId: "SRC-B" },
    },
    {
      id: "synthesize",
      op: "llm",
      label: "Synthesize Brief",
      dependsOn: ["summarize_a", "summarize_b"],
      inputs: ["summary_a", "summary_b"],
      outputs: ["brief"],
      timeoutMs: 20000,
      provider: { adapter: "demo", model: "synapse-sim-pro" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { section: "synthesis" },
    },
    {
      id: "format_brief",
      op: "transform",
      label: "Format & Validate Output",
      dependsOn: ["synthesize"],
      inputs: ["brief"],
      outputs: ["document"],
      timeoutMs: 5000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { format: "brief-v1" },
    },
  ],
};

/**
 * A short linear workflow where there is no independent work to parallelize —
 * used to demonstrate the optimizer's no-op decision.
 */
export const quickLookup: Workflow = {
  schemaVersion: SCHEMA_VERSION,
  id: "quick-lookup",
  name: "Quick Lookup",
  description: "A short linear chain; optimization overhead is unlikely to pay off.",
  version: "1.0.0",
  nodes: [
    {
      id: "fetch",
      op: "retrieval",
      label: "Fetch Record",
      dependsOn: [],
      inputs: ["key"],
      outputs: ["record"],
      timeoutMs: 6000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { sourceId: "SRC-Q" },
    },
    {
      id: "explain",
      op: "llm",
      label: "Explain Record",
      dependsOn: ["fetch"],
      inputs: ["record"],
      outputs: ["answer"],
      timeoutMs: 12000,
      provider: { adapter: "demo", model: "synapse-sim-mini" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { section: "answer", sourceId: "SRC-Q" },
    },
  ],
};

/**
 * A workflow with an independent branch that performs a side-effecting tool
 * call. The optimizer must REFUSE to parallelize the unsafe node.
 */
export const notifyAndReport: Workflow = {
  schemaVersion: SCHEMA_VERSION,
  id: "notify-and-report",
  name: "Notify & Report",
  description:
    "Has an independent side-effecting notification the optimizer must not parallelize.",
  version: "1.0.0",
  nodes: [
    {
      id: "gather",
      op: "retrieval",
      label: "Gather Metrics",
      dependsOn: [],
      inputs: ["range"],
      outputs: ["metrics"],
      timeoutMs: 8000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { sourceId: "SRC-M" },
    },
    {
      id: "notify",
      op: "tool",
      label: "Send Notification (side-effecting)",
      dependsOn: [],
      inputs: ["channel"],
      outputs: ["ack"],
      timeoutMs: 6000,
      provider: { adapter: "demo" },
      deterministic: false,
      sideEffectSafe: false, // writes to an external channel
      idempotent: false,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { channel: "ops" },
    },
    {
      id: "report",
      op: "llm",
      label: "Write Report",
      dependsOn: ["gather", "notify"],
      inputs: ["metrics", "ack"],
      outputs: ["report"],
      timeoutMs: 15000,
      provider: { adapter: "demo", model: "synapse-sim-mini" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { section: "report", sourceId: "SRC-M" },
    },
  ],
};

export const SAMPLE_WORKFLOWS: Workflow[] = [
  researchBrief,
  quickLookup,
  notifyAndReport,
];

/** Ids of the built-in sample workflows (protected from deletion). */
export const BUILTIN_WORKFLOW_IDS: ReadonlySet<string> = new Set(
  SAMPLE_WORKFLOWS.map((w) => w.id),
);

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
      config: { sourceId: "A", corpus: "market", maxResults: 3 },
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
      config: { sourceId: "B", corpus: "filings", maxResults: 3 },
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

/**
 * The LIVE research workflow: same graph shape as Research Brief, but the two
 * retrieval branches call a real search provider (`search` adapter) and the
 * summary/synthesis nodes call a real model provider. The final formatting is
 * deterministic (demo adapter) so it stays free and reproducible.
 *
 * The model adapter/model is chosen from env at load time so a user can point it
 * at whichever provider they have a key for, without editing JSON:
 *   SYNAPSE_LIVE_MODEL_ADAPTER = anthropic | openai | gemini  (default anthropic)
 *   SYNAPSE_LIVE_MODEL         = a model id that adapter supports
 * Running it requires both SEARCH_PROVIDER + a search key AND the model key;
 * otherwise the run fails cleanly (SYNAPSE never falls back to demo silently).
 */
const DEFAULT_LIVE_MODELS: Record<string, string> = {
  anthropic: "claude-3-5-haiku-latest",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

export function makeResearchBriefLive(opts?: {
  modelAdapter?: string;
  model?: string;
}): Workflow {
  const modelAdapter = opts?.modelAdapter ?? process.env.SYNAPSE_LIVE_MODEL_ADAPTER ?? "anthropic";
  const model =
    opts?.model ?? process.env.SYNAPSE_LIVE_MODEL ?? DEFAULT_LIVE_MODELS[modelAdapter] ?? "gpt-4o-mini";
  const modelProvider = { adapter: modelAdapter, model };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "research-brief-live",
    name: "Research Brief (Live)",
    description:
      "LIVE: two real web-search branches feed real model summaries and a synthesis, " +
      "with source citations. Requires a configured search provider and model key.",
    version: "1.0.0",
    nodes: [
      {
        id: "retrieve_a",
        op: "retrieval",
        label: "Search — Overview & Key Facts",
        dependsOn: [],
        inputs: ["topic"],
        outputs: ["docs_a"],
        timeoutMs: 20000,
        provider: { adapter: "search" },
        deterministic: false,
        sideEffectSafe: true,
        idempotent: true,
        retry: { maxAttempts: 2, backoffMs: 400 },
        config: { sourceId: "A", angle: "overview and key facts", maxResults: 4 },
      },
      {
        id: "summarize_a",
        op: "llm",
        label: "Summarize — Overview Sources",
        dependsOn: ["retrieve_a"],
        inputs: ["docs_a"],
        outputs: ["summary_a"],
        timeoutMs: 40000,
        provider: modelProvider,
        deterministic: false,
        sideEffectSafe: true,
        idempotent: true,
        retry: { maxAttempts: 2, backoffMs: 500 },
        config: { section: "A" },
      },
      {
        id: "retrieve_b",
        op: "retrieval",
        label: "Search — Recent News & Analysis",
        dependsOn: [],
        inputs: ["topic"],
        outputs: ["docs_b"],
        timeoutMs: 20000,
        provider: { adapter: "search" },
        deterministic: false,
        sideEffectSafe: true,
        idempotent: true,
        retry: { maxAttempts: 2, backoffMs: 400 },
        config: { sourceId: "B", angle: "recent news and analysis", maxResults: 4 },
      },
      {
        id: "summarize_b",
        op: "llm",
        label: "Summarize — News Sources",
        dependsOn: ["retrieve_b"],
        inputs: ["docs_b"],
        outputs: ["summary_b"],
        timeoutMs: 40000,
        provider: modelProvider,
        deterministic: false,
        sideEffectSafe: true,
        idempotent: true,
        retry: { maxAttempts: 2, backoffMs: 500 },
        config: { section: "B" },
      },
      {
        id: "synthesize",
        op: "llm",
        label: "Synthesize Brief (cited)",
        dependsOn: ["summarize_a", "summarize_b"],
        inputs: ["summary_a", "summary_b"],
        outputs: ["brief"],
        timeoutMs: 45000,
        provider: modelProvider,
        deterministic: false,
        sideEffectSafe: true,
        idempotent: true,
        retry: { maxAttempts: 2, backoffMs: 500 },
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
}

export const researchBriefLive: Workflow = makeResearchBriefLive();

export const SAMPLE_WORKFLOWS: Workflow[] = [
  researchBrief,
  researchBriefLive,
  quickLookup,
  notifyAndReport,
];

/** Ids of the built-in sample workflows (protected from deletion). */
export const BUILTIN_WORKFLOW_IDS: ReadonlySet<string> = new Set(
  SAMPLE_WORKFLOWS.map((w) => w.id),
);

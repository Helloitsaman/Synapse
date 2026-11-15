/**
 * Versioned, provider-neutral adapter contract.
 *
 * Adapters are the ONLY place provider-specific logic lives. The compiler and
 * optimizer never import adapters directly — they reason about declared node
 * metadata only. An adapter turns a node + its resolved inputs into an output
 * plus usage figures, and declares its own capabilities and limitations.
 */
import type { Provenance, SourceRecord, Usage, WorkflowNode } from "../types.js";

export const ADAPTER_CONTRACT_VERSION = "1.1.0";

export interface AdapterCapabilities {
  /** Which op types this adapter can execute. */
  ops: string[];
  /** Does this adapter make real external network calls? */
  network: boolean;
  /** Does it return provider-reported usage (vs simulated)? */
  providerReportedUsage: boolean;
  /** Can it run with no credentials? */
  credentialless: boolean;
  /** Human-readable limitations. */
  limitations: string[];
}

export interface AdapterContext {
  node: WorkflowNode;
  /** Outputs of direct dependencies, keyed by dependency node id. */
  inputs: Record<string, unknown>;
  /** Cooperative cancellation + timeout. */
  signal: AbortSignal;
  /** Workflow-level inputs (topic, etc.). */
  workflowInputs: Record<string, unknown>;
}

export interface AdapterResult {
  output: unknown;
  usage: Usage;
  /** Where this output came from. Defaults to "demo" when omitted. */
  provenance?: Provenance;
  /** Structured, citable sources this node produced or carried forward. */
  sources?: SourceRecord[];
  /** Provider/model provenance for real adapters (never secrets). */
  meta?: {
    model?: string;
    requestId?: string;
    finishReason?: string;
    provider?: string;
  };
}

export interface Adapter {
  readonly id: string;
  readonly contractVersion: string;
  readonly capabilities: AdapterCapabilities;
  /** Is this adapter configured/usable right now (e.g. has credentials)? */
  isAvailable(): { available: boolean; reason?: string };
  supports(node: WorkflowNode): boolean;
  execute(ctx: AdapterContext): Promise<AdapterResult>;
}

/** Thrown by adapters to signal a clean, user-facing execution failure. */
export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code = "ADAPTER_ERROR",
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export const emptyUsage = (source: Usage["source"] = "none"): Usage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  source,
});

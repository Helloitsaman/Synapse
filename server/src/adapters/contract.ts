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

/**
 * Error codes that represent TRANSIENT failures — safe to retry (for an
 * idempotent node) because the request likely did not durably complete and a
 * retry has a real chance of succeeding.
 */
export const RETRYABLE_CODES = new Set([
  "RATE_LIMITED",
  "PROVIDER_UNREACHABLE",
  "TIMEOUT",
  "PROVIDER_OVERLOADED",
]);

/** Thrown by adapters to signal a clean, user-facing execution failure. */
export class AdapterError extends Error {
  /** Optional upstream HTTP status (lets the scheduler classify 5xx/4xx). */
  readonly status?: number;
  /** Server-requested wait before retrying (from a Retry-After header), ms. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    readonly code = "ADAPTER_ERROR",
    opts?: { status?: number; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "AdapterError";
    this.status = opts?.status;
    this.retryAfterMs = opts?.retryAfterMs;
  }

  /**
   * Is this error safe to retry? Transient codes and 408/429/5xx HTTP statuses
   * are retryable; a configuration/validation/4xx error is NOT (retrying only
   * wastes another paid call and repeats the same failure).
   */
  get retryable(): boolean {
    if (RETRYABLE_CODES.has(this.code)) return true;
    if (typeof this.status === "number") {
      if (this.status === 408 || this.status === 429) return true;
      if (this.status >= 500 && this.status <= 599) return true;
      return false;
    }
    return false;
  }
}

export const emptyUsage = (source: Usage["source"] = "none"): Usage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  source,
});

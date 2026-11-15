/**
 * Dependency-aware execution engine.
 *
 * Executes a compiled IR either sequentially (baseline, concurrency 1) or with
 * bounded parallelism (optimized). It NEVER starts a node before all of its
 * dependencies have succeeded. Supports per-node timeouts, retries with backoff,
 * cooperative cancellation, and optional within-run memoization for deterministic
 * side-effect-safe nodes.
 */
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Adapter } from "../adapters/contract.js";
import { AdapterError } from "../adapters/contract.js";
import type {
  ExecutionSummary,
  IR,
  NodeSpan,
  NodeStatus,
  Provenance,
  RunMode,
  RunRecord,
  SourceRecord,
  Usage,
  Workflow,
} from "../types.js";
import { contentHash } from "../util/hash.js";
import { estimateCost } from "./cost.js";

export interface RunOptions {
  mode: RunMode;
  concurrency: number;
  memoize: boolean;
  registry: AdapterRegistry;
  workflowInputs?: Record<string, unknown>;
  appliedTransformations?: string[];
  /** Emitted on every node state transition (for live status polling). */
  onEvent?: (run: RunRecord) => void;
  /** External cancellation. */
  cancelSignal?: AbortSignal;
}

export interface RunOutcome {
  record: RunRecord;
  /** Terminal node outputs, kept EPHEMERAL (never persisted by default). */
  outputs: Map<string, unknown>;
}

export async function executeRun(
  wf: Workflow,
  ir: IR,
  runId: string,
  opts: RunOptions,
): Promise<RunOutcome> {
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const outputs = new Map<string, unknown>();
  type MemoEntry = {
    output: unknown;
    usage: Usage;
    provenance?: Provenance;
    sources?: SourceRecord[];
    meta?: { model?: string; requestId?: string; finishReason?: string; provider?: string };
  };
  const memoCache = new Map<string, MemoEntry>();

  const spans = new Map<string, NodeSpan>();
  for (const n of wf.nodes) {
    spans.set(n.id, {
      nodeId: n.id,
      label: n.label,
      op: n.op,
      adapter: n.provider.adapter,
      status: "pending",
      dependsOn: [...n.dependsOn],
      attempts: 0,
      queueMs: 0,
      execMs: 0,
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, source: "none" },
      memoized: false,
      sourceCount: 0,
    });
  }

  const record: RunRecord = {
    id: runId,
    workflowId: wf.id,
    workflowVersion: wf.version,
    irVersion: ir.irVersion,
    mode: opts.mode,
    concurrency: Math.max(1, opts.concurrency),
    status: "running",
    createdAt: new Date().toISOString(),
    totalMs: 0,
    overheadMs: 0,
    spans: [...spans.values()],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, source: "simulated" },
    estimatedCostUsd: 0,
    cost: { usd: 0, label: "estimated", pricingSource: "", modelMatched: false },
    appliedTransformations: opts.appliedTransformations ?? [],
  };

  const emit = () => {
    record.spans = ir.order.map((id) => ({ ...spans.get(id)! }));
    opts.onEvent?.(record);
  };

  const remainingDeps = new Map<string, number>();
  for (const n of wf.nodes) remainingDeps.set(n.id, n.dependsOn.length);

  const ready: string[] = ir.order.filter((id) => remainingDeps.get(id) === 0);
  for (const id of ready) {
    spans.get(id)!.status = "queued";
    spans.get(id)!.queuedAt = Date.now();
  }

  let active = 0;
  let cancelled = false;
  let failed = false;
  const concurrency = Math.max(1, opts.concurrency);
  const t0 = Date.now();
  record.startedAt = t0;
  emit();

  const abortAll = new AbortController();
  if (opts.cancelSignal) {
    if (opts.cancelSignal.aborted) cancelled = true;
    opts.cancelSignal.addEventListener("abort", () => {
      cancelled = true;
      abortAll.abort();
    });
  }

  await new Promise<void>((resolve) => {
    const settleIfDone = () => {
      if (active === 0 && (ready.length === 0 || cancelled || failed)) {
        resolve();
      }
    };

    const pump = () => {
      if (cancelled || failed) {
        settleIfDone();
        return;
      }
      while (active < concurrency && ready.length > 0) {
        const id = ready.shift()!;
        active++;
        void runNode(id).then(onNodeSettled.bind(null, id));
      }
      settleIfDone();
    };

    const onNodeSettled = (id: string) => {
      active--;
      const span = spans.get(id)!;
      if (span.status === "succeeded" || span.status === "memoized") {
        for (const dep of ir.dependents[id] ?? []) {
          remainingDeps.set(dep, (remainingDeps.get(dep) ?? 0) - 1);
          if (remainingDeps.get(dep) === 0 && !cancelled && !failed) {
            const dspan = spans.get(dep)!;
            dspan.status = "queued";
            dspan.queuedAt = Date.now();
            ready.push(dep);
          }
        }
      } else if (span.status === "failed") {
        failed = true;
        // Mark everything still pending/queued as skipped.
        for (const s of spans.values()) {
          if (s.status === "pending" || s.status === "queued") s.status = "skipped";
        }
      }
      emit();
      pump();
    };

    const runNode = async (id: string): Promise<void> => {
      const node = byId.get(id)!;
      const span = spans.get(id)!;
      if (cancelled) {
        span.status = "cancelled";
        return;
      }
      const now = Date.now();
      span.queueMs = span.queuedAt ? now - span.queuedAt : 0;
      span.status = "running";
      span.startedAt = now;
      emit();

      const adapter = opts.registry.resolve(node);
      const inputs = resolveInputs(node.dependsOn, outputs);

      // Within-run memoization for deterministic, side-effect-safe nodes.
      //
      // The key deliberately EXCLUDES node identity. It is derived only from the
      // work itself — op, adapter, model, canonical config, and resolved inputs —
      // so two DIFFERENT nodes that compute the exact same thing share one cache
      // entry (real cross-node reuse), while a node whose config/inputs differ
      // never collides. Memoization is gated on deterministic && sideEffectSafe,
      // so nondeterministic or side-effecting work is never cached.
      const memoKey =
        opts.memoize && node.deterministic && node.sideEffectSafe
          ? contentHash({
              op: node.op,
              adapter: node.provider.adapter,
              model: node.provider.model ?? null,
              config: node.config,
              inputs,
            })
          : null;
      if (memoKey && memoCache.has(memoKey)) {
        const hit = memoCache.get(memoKey)!;
        outputs.set(id, hit.output);
        span.memoized = true;
        span.status = "memoized";
        span.endedAt = Date.now();
        span.execMs = 0;
        span.usage = { calls: 0, inputTokens: 0, outputTokens: 0, source: "none" };
        span.provenance = "cached";
        span.sourceCount = hit.sources?.length ?? 0;
        span.model = hit.meta?.model;
        return;
      }

      const result = await runWithRetries(node, adapter, inputs, opts, abortAll);
      if (result.cancelled) {
        span.status = "cancelled";
        span.endedAt = Date.now();
        return;
      }
      span.attempts = result.attempts;
      span.endedAt = Date.now();
      span.execMs = span.startedAt ? span.endedAt - span.startedAt : 0;
      if (result.error) {
        span.status = "failed";
        span.error = result.error;
        return;
      }
      outputs.set(id, result.output);
      span.usage = result.usage!;
      span.provenance = result.provenance ?? "demo";
      span.sourceCount = result.sources?.length ?? 0;
      span.model = result.meta?.model ?? result.usage?.model;
      span.requestId = result.meta?.requestId;
      span.finishReason = result.meta?.finishReason;
      span.status = "succeeded";
      if (memoKey)
        memoCache.set(memoKey, {
          output: result.output,
          usage: result.usage!,
          provenance: result.provenance,
          sources: result.sources,
          meta: result.meta,
        });
    };

    pump();
  });

  const tEnd = Date.now();
  record.endedAt = tEnd;
  record.totalMs = tEnd - t0;
  record.spans = ir.order.map((id) => ({ ...spans.get(id)! }));

  // Overhead = total wall-clock minus the time the engine was actually busy
  // executing node work (union of execution intervals). Measured value.
  const busyMs = unionBusyMs(record.spans);
  record.overheadMs = Math.max(0, record.totalMs - busyMs);

  // Aggregate usage from non-memoized spans only (memoized incurs no new cost).
  record.usage = aggregateUsage(record.spans);
  record.cost = estimateCost(record.usage);
  record.estimatedCostUsd = record.cost.usd;
  record.execution = summarizeExecution(record.spans, outputs);

  if (cancelled) record.status = "cancelled";
  else if (failed) {
    record.status = "failed";
    record.error = record.spans.find((s) => s.status === "failed")?.error;
  } else record.status = "succeeded";

  emit();
  return { record, outputs };
}

function resolveInputs(
  deps: string[],
  outputs: Map<string, unknown>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const d of deps) inputs[d] = outputs.get(d);
  return inputs;
}

interface AttemptResult {
  output?: unknown;
  usage?: Usage;
  provenance?: Provenance;
  sources?: SourceRecord[];
  meta?: { model?: string; requestId?: string; finishReason?: string; provider?: string };
  error?: string;
  attempts: number;
  cancelled?: boolean;
}

/**
 * Decide whether a failed attempt may be retried. A retry is allowed only when
 * ALL of these hold:
 *   1. the node is declared `idempotent` — so re-running cannot duplicate a paid
 *      call's side effect or an external action after a timeout/partial failure;
 *   2. attempts remain under maxAttempts;
 *   3. the failure is TRANSIENT — a timeout, or an AdapterError whose code/HTTP
 *      status is retryable (429/5xx/unreachable). A config/validation/4xx error
 *      is never retried (it would only repeat the same failure and cost).
 * A non-idempotent node is capped at a single attempt regardless of maxAttempts.
 */
function retryDecision(
  node: Workflow["nodes"][number],
  attempt: number,
  err: unknown,
  timedOut: boolean,
): { retry: boolean; waitMs: number; reason: string } {
  if (attempt >= node.retry.maxAttempts) return { retry: false, waitMs: 0, reason: "max-attempts" };
  if (!node.idempotent) return { retry: false, waitMs: 0, reason: "not-idempotent" };

  const transient =
    timedOut || (err instanceof AdapterError ? err.retryable : false);
  if (!transient) return { retry: false, waitMs: 0, reason: "non-retryable-error" };

  // Backoff: honor a server Retry-After, else exponential on the node's base
  // backoff, with bounded full jitter and a hard ceiling.
  const serverWait = err instanceof AdapterError ? err.retryAfterMs : undefined;
  const base = node.retry.backoffMs || 0;
  const expo = base > 0 ? base * 2 ** (attempt - 1) : 0;
  const jittered = expo > 0 ? Math.floor(Math.random() * expo) : 0;
  const waitMs = Math.min(30_000, Math.max(serverWait ?? 0, jittered));
  return { retry: true, waitMs, reason: timedOut ? "timeout" : "transient" };
}

async function runWithRetries(
  node: Workflow["nodes"][number],
  adapter: Adapter,
  inputs: Record<string, unknown>,
  opts: RunOptions,
  abortAll: AbortController,
): Promise<AttemptResult> {
  const max = node.retry.maxAttempts;
  let lastError = "";
  for (let attempt = 1; attempt <= max; attempt++) {
    if (abortAll.signal.aborted) return { attempts: attempt - 1, cancelled: true };

    // Per-node timeout composed with the global cancel signal.
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), node.timeoutMs);
    const onGlobalAbort = () => timeoutCtrl.abort();
    abortAll.signal.addEventListener("abort", onGlobalAbort, { once: true });

    try {
      const res = await adapter.execute({
        node,
        inputs,
        signal: timeoutCtrl.signal,
        workflowInputs: opts.workflowInputs ?? {},
      });
      clearTimeout(timer);
      abortAll.signal.removeEventListener("abort", onGlobalAbort);
      return {
        output: res.output,
        usage: res.usage,
        provenance: res.provenance,
        sources: res.sources,
        meta: res.meta,
        attempts: attempt,
      };
    } catch (err) {
      clearTimeout(timer);
      abortAll.signal.removeEventListener("abort", onGlobalAbort);
      if (abortAll.signal.aborted) return { attempts: attempt, cancelled: true };
      const timedOut = timeoutCtrl.signal.aborted;
      lastError = timedOut
        ? `Timed out after ${node.timeoutMs}ms`
        : err instanceof AdapterError
          ? `${err.code}: ${err.message}`
          : (err as Error).message;

      const decision = retryDecision(node, attempt, err, timedOut);
      if (decision.retry) {
        if (decision.waitMs > 0) await delay(decision.waitMs, abortAll.signal);
        continue;
      }
      return { error: lastError, attempts: attempt };
    }
  }
  return { error: lastError, attempts: max };
}

/** Cancellable delay (resolves early if the run is aborted). */
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    if (signal?.aborted) return r();
    const t = setTimeout(r, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      r();
    }, { once: true });
  });

/** Length of the union of [startedAt, endedAt] execution intervals, in ms. */
function unionBusyMs(spans: NodeSpan[]): number {
  const intervals = spans
    .filter((s) => s.startedAt && s.endedAt && s.execMs > 0)
    .map((s) => [s.startedAt!, s.endedAt!] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of intervals) {
    if (curEnd < 0) {
      curStart = s;
      curEnd = e;
    } else if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (curEnd >= 0) total += curEnd - curStart;
  return total;
}

function aggregateUsage(spans: NodeSpan[]): Usage {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawProvider = false;
  let sawSim = false;
  let sawUnavailable = false;
  for (const s of spans) {
    if (s.memoized) continue;
    calls += s.usage.calls;
    inputTokens += s.usage.inputTokens;
    outputTokens += s.usage.outputTokens;
    if (s.usage.source === "provider-reported") sawProvider = true;
    if (s.usage.source === "simulated") sawSim = true;
    if (s.usage.source === "unavailable") sawUnavailable = true;
  }
  // Precedence: a real provider's reported tokens dominate; otherwise simulated;
  // otherwise, if a real provider ran but reported nothing, say so honestly.
  let source: Usage["source"];
  if (sawProvider) source = "provider-reported";
  else if (sawSim) source = "simulated";
  else if (sawUnavailable) source = "unavailable";
  else source = "none";
  return { calls, inputTokens, outputTokens, source };
}

/** Build the run-level execution provenance summary from finished spans. */
export function summarizeExecution(
  spans: NodeSpan[],
  outputs: Map<string, unknown>,
): ExecutionSummary {
  const adapters = new Set<string>();
  const providers = new Set<string>();
  let liveNodeCount = 0;
  let demoNodeCount = 0;
  for (const s of spans) {
    if (s.status !== "succeeded" && s.status !== "memoized") continue;
    adapters.add(s.adapter);
    if (s.provenance === "live") liveNodeCount++;
    if (s.provenance === "demo") demoNodeCount++;
    if (s.provenance === "live" && s.model) providers.add(`${s.adapter}:${s.model}`);
  }
  const sourceIds = new Set<string>();
  for (const out of outputs.values()) {
    const srcs = (out as any)?.sources;
    if (Array.isArray(srcs)) for (const src of srcs) if (src?.sourceId) sourceIds.add(src.sourceId);
  }
  // Mode reflects ALL contributing node provenance: live only, demo only, or a
  // genuine blend. (A formatter that re-assembles live data is tagged live by
  // the adapter, so a fully-live run is not mislabelled MIXED by its formatter.)
  const mixedExecution = liveNodeCount > 0 && demoNodeCount > 0;
  const provenanceMode = mixedExecution ? "mixed" : liveNodeCount > 0 ? "live" : "demo";
  return {
    adapters: [...adapters].sort(),
    providers: [...providers].sort(),
    liveNodeCount,
    demoNodeCount,
    liveExecution: liveNodeCount > 0,
    mixedExecution,
    provenanceMode,
    sourceCount: sourceIds.size,
  };
}

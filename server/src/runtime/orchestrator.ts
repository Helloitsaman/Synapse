/**
 * Orchestrator: the service layer wiring compiler -> optimizer -> runtime ->
 * correctness -> telemetry -> persistence.
 */
import { randomBytes } from "node:crypto";
import { compileWorkflow } from "../compiler/compile.js";
import { buildOptimizationPlan } from "../optimizer/optimizer.js";
import { executeRun } from "./scheduler.js";
import { runCorrectness } from "../correctness/checks.js";
import { extractResult } from "./result.js";
import { assessComparability, compareRuns } from "./compare.js";
import { computeFingerprint } from "./fingerprint.js";
import { instrumentRun } from "../telemetry/instrument.js";
import { log } from "../telemetry/logger.js";
import { defaultRegistry } from "../adapters/registry.js";
import { store } from "../store/store.js";
import type {
  BenchmarkResult,
  CompileResult,
  Distribution,
  IR,
  OptimizationPlan,
  RunComparison,
  RunMode,
  RunRecord,
  Workflow,
} from "../types.js";

export class WorkflowNotFound extends Error {}

const cancelControllers = new Map<string, AbortController>();

function newRunId(): string {
  return `run_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

export function compile(workflowId: string): CompileResult {
  const wf = store.getWorkflow(workflowId);
  if (!wf) throw new WorkflowNotFound(`Unknown workflow "${workflowId}".`);
  return compileWorkflow(wf);
}

export function compileRaw(raw: unknown): CompileResult {
  return compileWorkflow(raw);
}

export function preview(workflowId: string): {
  ir: IR;
  plan: OptimizationPlan;
} {
  const result = compile(workflowId);
  if (!result.ok || !result.ir) {
    throw new CompileFailed(result.errors.map((e) => e.message).join("; "));
  }
  const wf = store.getWorkflow(workflowId)!;
  const plan = buildOptimizationPlan(wf, result.ir);
  return { ir: result.ir, plan };
}

export class CompileFailed extends Error {}

export interface StartRunInput {
  workflowId: string;
  mode: RunMode;
  concurrency?: number;
  workflowInputs?: Record<string, unknown>;
}

/** Starts a run asynchronously and returns the initial record immediately. */
export function startRun(input: StartRunInput): RunRecord {
  const wf = store.getWorkflow(input.workflowId);
  if (!wf) throw new WorkflowNotFound(`Unknown workflow "${input.workflowId}".`);

  const compiled = compileWorkflow(wf);
  if (!compiled.ok || !compiled.ir) {
    throw new CompileFailed(compiled.errors.map((e) => e.message).join("; "));
  }
  const ir = compiled.ir;
  const plan = buildOptimizationPlan(wf, ir);

  let concurrency = 1;
  let memoize = false;
  let appliedTransformations: string[] = [];
  if (input.mode === "optimized") {
    concurrency = input.concurrency ?? plan.suggestedConcurrency;
    memoize = plan.memoizationEnabled;
    appliedTransformations = plan.decisions
      .filter((d) => d.status === "accepted")
      .map((d) => d.id);
  }

  const runId = newRunId();
  const abort = new AbortController();
  cancelControllers.set(runId, abort);

  // Resolve effective inputs once (with the documented default) so the same
  // values drive both execution and the comparability fingerprint.
  const effectiveInputs = input.workflowInputs ?? { topic: "Q4 sector outlook" };
  const fingerprint = computeFingerprint(wf, ir, effectiveInputs, input.mode, concurrency);

  // Seed a pending live record so the UI can poll immediately.
  const seed: RunRecord = {
    id: runId,
    workflowId: wf.id,
    workflowVersion: wf.version,
    irVersion: ir.irVersion,
    mode: input.mode,
    concurrency,
    status: "pending",
    createdAt: new Date().toISOString(),
    totalMs: 0,
    overheadMs: 0,
    spans: wf.nodes.map((n) => ({
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
    })),
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, source: "simulated" },
    estimatedCostUsd: null,
    cost: { usd: null, label: "unavailable", pricingSource: "", modelMatched: false },
    appliedTransformations,
    fingerprint,
  };
  store.setLiveRun(seed);

  // Fire and forget — execution updates the live record via onEvent.
  void (async () => {
    try {
      const { record, outputs } = await executeRun(wf, ir, runId, {
        mode: input.mode,
        concurrency,
        memoize,
        registry: defaultRegistry,
        workflowInputs: effectiveInputs,
        appliedTransformations,
        cancelSignal: abort.signal,
        onEvent: (r) => {
          r.fingerprint = fingerprint;
          store.setLiveRun(r);
        },
      });
      record.fingerprint = fingerprint;

      // Extract the delivered answer (persisted) before bodies are discarded.
      if (record.status === "succeeded") {
        record.result = extractResult(ir, outputs);
      }

      // Correctness checks on ephemeral outputs (bodies are then discarded).
      if (record.status === "succeeded") {
        record.validation = runCorrectness({
          workflowId: wf.id,
          outputs,
          ir,
        });
        // A failed REQUIRED check must not be reported as success.
        if (!record.validation.passed) {
          record.status = "failed";
          record.error = "One or more required correctness checks failed.";
        }
      }

      instrumentRun(record);
      store.finalizeRun(record);
      log("info", "run.finalized", {
        runId,
        mode: record.mode,
        status: record.status,
        totalMs: record.totalMs,
        overheadMs: record.overheadMs,
        validationPassed: record.validation?.passed,
      });
    } catch (err) {
      const live = store.getLiveRun(runId);
      if (live) {
        live.status = "failed";
        live.error = (err as Error).message;
        store.finalizeRun(live);
      }
      log("error", "run.crashed", { runId, error: (err as Error).message });
    } finally {
      cancelControllers.delete(runId);
    }
  })();

  return seed;
}

/** Resolve the concurrency/memoization/transformations for a mode. */
function planFor(
  plan: OptimizationPlan,
  mode: RunMode,
  concurrency?: number,
): { concurrency: number; memoize: boolean; appliedTransformations: string[] } {
  if (mode === "optimized") {
    return {
      concurrency: concurrency ?? plan.suggestedConcurrency,
      memoize: plan.memoizationEnabled,
      appliedTransformations: plan.decisions.filter((d) => d.status === "accepted").map((d) => d.id),
    };
  }
  return { concurrency: 1, memoize: false, appliedTransformations: [] };
}

/** Execute one run to completion (awaited), persist it, and return the record. */
async function executeAndFinalize(
  wf: Workflow,
  ir: IR,
  mode: RunMode,
  concurrency: number,
  memoize: boolean,
  appliedTransformations: string[],
  inputs: Record<string, unknown>,
): Promise<RunRecord> {
  const runId = newRunId();
  const fingerprint = computeFingerprint(wf, ir, inputs, mode, concurrency);
  const { record, outputs } = await executeRun(wf, ir, runId, {
    mode,
    concurrency,
    memoize,
    registry: defaultRegistry,
    workflowInputs: inputs,
    appliedTransformations,
  });
  record.fingerprint = fingerprint;
  if (record.status === "succeeded") {
    record.result = extractResult(ir, outputs);
    record.validation = runCorrectness({ workflowId: wf.id, outputs, ir });
    if (!record.validation.passed) {
      record.status = "failed";
      record.error = "One or more required correctness checks failed.";
    }
  }
  instrumentRun(record);
  store.finalizeRun(record);
  return record;
}

export interface BenchmarkInput {
  workflowId: string;
  repetitions: number;
  concurrency?: number;
  workflowInputs?: Record<string, unknown>;
}

const MAX_BENCHMARK_REPS = 10;

/**
 * Paired, repeated benchmark: runs N baseline + N optimized executions of the
 * SAME workflow + inputs in interleaved order (alternating which mode leads each
 * round to reduce ordering bias) and reports distributions — never a single
 * sample, never an unqualified significance claim.
 */
export async function runBenchmark(input: BenchmarkInput): Promise<BenchmarkResult> {
  const wf = store.getWorkflow(input.workflowId);
  if (!wf) throw new WorkflowNotFound(`Unknown workflow "${input.workflowId}".`);
  const compiled = compileWorkflow(wf);
  if (!compiled.ok || !compiled.ir) {
    throw new CompileFailed(compiled.errors.map((e) => e.message).join("; "));
  }
  const ir = compiled.ir;
  const plan = buildOptimizationPlan(wf, ir);
  const reps = Math.max(1, Math.min(MAX_BENCHMARK_REPS, Math.floor(input.repetitions)));
  const inputs = input.workflowInputs ?? { topic: "Q4 sector outlook" };

  const basePlan = planFor(plan, "baseline");
  const optPlan = planFor(plan, "optimized", input.concurrency);

  const order: BenchmarkResult["order"] = [];
  const baselineRuns: RunRecord[] = [];
  const optimizedRuns: RunRecord[] = [];

  for (let i = 0; i < reps; i++) {
    const sequence: RunMode[] = i % 2 === 0 ? ["baseline", "optimized"] : ["optimized", "baseline"];
    for (const mode of sequence) {
      const p = mode === "baseline" ? basePlan : optPlan;
      const rec = await executeAndFinalize(wf, ir, mode, p.concurrency, p.memoize, p.appliedTransformations, inputs);
      (mode === "baseline" ? baselineRuns : optimizedRuns).push(rec);
      order.push({ mode, runId: rec.id, totalMs: rec.totalMs, status: rec.status });
    }
  }

  const baseline = modeResult("baseline", baselineRuns);
  const optimized = modeResult("optimized", optimizedRuns);
  const speedupMedian =
    optimized.totalMs.median > 0 ? Math.round((baseline.totalMs.median / optimized.totalMs.median) * 100) / 100 : 1;

  // All runs share workflow + inputs by construction → comparable.
  const comparability =
    baselineRuns[0] && optimizedRuns[0]
      ? assessComparability(baselineRuns[0], optimizedRuns[0])
      : { comparable: true, sameWorkflow: true, sameWorkflowVersion: true, sameInputs: true, sameConfig: true, mismatches: [], fingerprintMissing: false };

  return {
    workflowId: wf.id,
    workflowVersion: wf.version,
    repetitions: reps,
    order,
    baseline,
    optimized,
    speedupMedian,
    comparability,
    baselineKind: "synapse-sequential-graph",
    note:
      `Paired benchmark: ${reps} run(s) per mode, interleaved. Baseline = sequential ` +
      `graph execution (concurrency 1), NOT a host-native chat prompt. Distributions ` +
      `are measured wall-clock; spread reflects real run-to-run/provider variation. ` +
      `${baseline.failures + optimized.failures} run(s) failed. A median speedup is a ` +
      `summary, not a significance test.`,
  };
}

function modeResult(mode: RunMode, runs: RunRecord[]) {
  const succeeded = runs.filter((r) => r.status === "succeeded");
  return {
    mode,
    runIds: runs.map((r) => r.id),
    failures: runs.length - succeeded.length,
    totalMs: distribution(succeeded.map((r) => r.totalMs), "ms"),
    overheadMs: distribution(succeeded.map((r) => r.overheadMs), "ms"),
  };
}

/** Summary statistics for a set of measured samples. */
export function distribution(values: number[], unit: string): Distribution {
  const vals = [...values].sort((a, b) => a - b);
  const n = vals.length;
  const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
  const pct = (p: number) => (n ? vals[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))] : 0);
  return {
    samples: n,
    min: n ? vals[0] : 0,
    median: pct(0.5),
    p95: pct(0.95),
    max: n ? vals[n - 1] : 0,
    mean: Math.round(mean * 100) / 100,
    stdev: Math.round(Math.sqrt(variance) * 100) / 100,
    unit,
    label: "measured",
    values,
  };
}

export function cancelRun(runId: string): boolean {
  const ctrl = cancelControllers.get(runId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export function getComparison(baselineId: string, optimizedId: string): RunComparison {
  const baseline = store.getRun(baselineId);
  const optimized = store.getRun(optimizedId);
  if (!baseline) throw new Error(`Baseline run "${baselineId}" not found.`);
  if (!optimized) throw new Error(`Optimized run "${optimizedId}" not found.`);
  return compareRuns(baseline, optimized);
}

/**
 * Orchestrator: the service layer wiring compiler -> optimizer -> runtime ->
 * correctness -> telemetry -> persistence.
 */
import { randomBytes } from "node:crypto";
import { compileWorkflow } from "../compiler/compile.js";
import { buildOptimizationPlan } from "../optimizer/optimizer.js";
import { executeRun } from "./scheduler.js";
import { runCorrectness } from "../correctness/checks.js";
import { compareRuns } from "./compare.js";
import { instrumentRun } from "../telemetry/instrument.js";
import { log } from "../telemetry/logger.js";
import { defaultRegistry } from "../adapters/registry.js";
import { store } from "../store/store.js";
import type {
  CompileResult,
  IR,
  OptimizationPlan,
  RunComparison,
  RunMode,
  RunRecord,
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
    })),
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, source: "simulated" },
    estimatedCostUsd: 0,
    appliedTransformations,
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
        workflowInputs: input.workflowInputs ?? { topic: "Q4 sector outlook" },
        appliedTransformations,
        cancelSignal: abort.signal,
        onEvent: (r) => store.setLiveRun(r),
      });

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

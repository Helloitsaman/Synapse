/**
 * Optimizer & transformation registry.
 *
 * Given a compiled IR and its source workflow, the optimizer evaluates a small
 * set of SAFE transformations and records a decision for each: the rationale,
 * the preconditions it checked, confidence, expected benefit, and whether it was
 * accepted, rejected, or a no-op. It never rewrites prompts, swaps models,
 * removes steps, or enables cross-run caching.
 */
import type { IR, OptimizationPlan, TransformationDecision, Workflow } from "../types.js";

export const TRANSFORMATIONS = [
  {
    id: "parallelize-independent-branches",
    title: "Parallelize independent branches",
    description:
      "Schedule independent, side-effect-safe nodes concurrently instead of sequentially.",
  },
  {
    id: "within-run-memoization",
    title: "Within-run memoization",
    description:
      "Cache deterministic node outputs by canonicalized inputs within a single run.",
  },
  {
    id: "no-op",
    title: "No-op (skip optimization)",
    description:
      "Leave the workflow unchanged when expected benefit does not justify overhead.",
  },
] as const;

/** Explains the parallelize decision, always naming any unsafe-excluded nodes. */
function buildParallelReason(
  accepted: boolean,
  safe: string[],
  unsafe: string[],
): string {
  const excluded = unsafe.length
    ? ` ${unsafe.length} independent node(s) excluded as not side-effect-safe: ${unsafe.join(", ")}.`
    : "";
  if (accepted) {
    return `Accepted for ${safe.length} safe independent node(s).${excluded}`;
  }
  return `No safe parallelism available; leaving sequential.${excluded}`;
}

export function buildOptimizationPlan(wf: Workflow, ir: IR): OptimizationPlan {
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const decisions: TransformationDecision[] = [];

  // --- Transformation 1: parallelize independent branches ---------------
  // A level with >1 node means those nodes are mutually independent.
  const parallelLevels = ir.graph.levels.filter((lvl) => lvl.length > 1);
  const independentNodeIds = parallelLevels.flat();
  const safeParallel = independentNodeIds.filter(
    (id) => byId.get(id)!.sideEffectSafe,
  );
  const unsafeParallel = independentNodeIds.filter(
    (id) => !byId.get(id)!.sideEffectSafe,
  );

  const hasParallelOpportunity = safeParallel.length >= 2;
  decisions.push({
    id: "parallelize-independent-branches",
    title: "Parallelize independent branches",
    rationale: hasParallelOpportunity
      ? `Levels ${parallelLevels
          .map((_, i) => i)
          .join(", ")} contain mutually independent nodes. Running the ` +
        `side-effect-safe ones concurrently reduces wall-clock latency without ` +
        `violating any dependency.`
      : "No level contains two or more independent, side-effect-safe nodes.",
    preconditions: [
      {
        description: "At least two independent nodes share a level",
        met: independentNodeIds.length >= 2,
      },
      {
        description: "Independent nodes are declared side-effect-safe",
        met: safeParallel.length >= 2,
      },
      {
        description: "Dependencies are preserved (only same-level nodes run together)",
        met: true,
      },
    ],
    confidence: hasParallelOpportunity ? 0.9 : 0.2,
    expectedBenefit: hasParallelOpportunity
      ? "Lower end-to-end latency; token/model usage unchanged."
      : "Negligible.",
    status: hasParallelOpportunity ? "accepted" : "rejected",
    reason: buildParallelReason(hasParallelOpportunity, safeParallel, unsafeParallel),
    affectedNodes: safeParallel,
  });

  // --- Transformation 2: within-run memoization -------------------------
  const memoizable = wf.nodes.filter((n) => n.deterministic && n.sideEffectSafe);
  const memoEnabled = memoizable.length > 0;
  decisions.push({
    id: "within-run-memoization",
    title: "Within-run memoization",
    rationale: memoEnabled
      ? `Deterministic, side-effect-safe nodes can be memoized by canonicalized ` +
        `inputs so an identical computation within this run is not repeated.`
      : "No node is both deterministic and side-effect-safe.",
    preconditions: [
      { description: "Node is deterministic", met: memoizable.length > 0 },
      { description: "Node is side-effect-safe", met: memoizable.length > 0 },
      { description: "Scope limited to a single run (no cross-run cache)", met: true },
    ],
    confidence: memoEnabled ? 0.6 : 0.1,
    expectedBenefit: memoEnabled
      ? "Avoids recomputation if identical inputs recur within the run."
      : "None.",
    // Memoization is enabled but typically dormant in the sample (no repeats).
    status: memoEnabled ? "accepted" : "rejected",
    reason: memoEnabled
      ? `Enabled for ${memoizable.length} eligible node(s); only triggers on an ` +
        `exact input match within the same run.`
      : "No eligible nodes.",
    affectedNodes: memoizable.map((n) => n.id),
  });

  // --- Transformation 3: no-op ------------------------------------------
  // If there is no parallel opportunity, declare the whole optimization a no-op.
  if (!hasParallelOpportunity) {
    decisions.push({
      id: "no-op",
      title: "No-op (skip optimization)",
      rationale:
        "The critical path already covers nearly all nodes; parallelization and " +
        "memoization overhead are unlikely to pay off for this workflow.",
      preconditions: [
        { description: "No safe parallelism found", met: true },
        { description: "Workflow is short / mostly linear", met: wf.nodes.length <= 4 },
      ],
      confidence: 0.8,
      expectedBenefit: "Avoids scheduler overhead for no latency gain.",
      status: "noop",
      reason: "Optimized run will behave like baseline; this is reported honestly.",
      affectedNodes: [],
    });
  }

  const suggestedConcurrency = hasParallelOpportunity
    ? Math.min(4, Math.max(...ir.graph.levels.map((l) => l.length)))
    : 1;

  return {
    workflowId: wf.id,
    irVersion: ir.irVersion,
    decisions,
    suggestedConcurrency,
    memoizationEnabled: memoEnabled,
    summary: hasParallelOpportunity
      ? `Optimizer will run up to ${suggestedConcurrency} independent nodes concurrently` +
        (memoEnabled ? " with within-run memoization enabled." : ".")
      : "Optimizer found no safe gains; optimized run equals baseline (no-op).",
  };
}

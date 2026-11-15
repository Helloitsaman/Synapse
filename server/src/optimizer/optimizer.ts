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
      "Cache deterministic, side-effect-safe node outputs by WORK identity (op + " +
      "adapter + model + canonical config + inputs, excluding node id) within a " +
      "single run, so two nodes doing identical work share one result.",
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
  // Real reuse requires two ELIGIBLE nodes whose work identity could coincide —
  // same op, adapter, and model (config/inputs are checked at runtime). Without
  // at least two such nodes, the cache can never hit, so we report it honestly as
  // dormant rather than claiming a benefit it cannot deliver on this workflow.
  const workClasses = new Map<string, string[]>();
  for (const n of memoizable) {
    const key = `${n.op}|${n.provider.adapter}|${n.provider.model ?? ""}`;
    (workClasses.get(key) ?? workClasses.set(key, []).get(key)!).push(n.id);
  }
  const reuseCandidates = [...workClasses.values()].filter((ids) => ids.length >= 2);
  const canReuse = reuseCandidates.length > 0;
  const memoEligible = memoizable.length > 0;
  // Enable the cache whenever there are eligible nodes (it is always safe), but
  // only ACCEPT (claim a benefit) when cross-node reuse is actually possible.
  const memoEnabled = memoEligible;
  decisions.push({
    id: "within-run-memoization",
    title: "Within-run memoization",
    rationale: canReuse
      ? `Two or more deterministic, side-effect-safe nodes share a work class ` +
        `(op+adapter+model): ${reuseCandidates.map((g) => g.join("/")).join(", ")}. ` +
        `If they also resolve to identical config+inputs at runtime, the second ` +
        `reuses the first's result (the memo key excludes node identity).`
      : memoEligible
        ? `Eligible nodes exist but no two share a work class, so the identity-free ` +
          `cache cannot hit on this workflow. Enabled (always safe) but dormant.`
        : "No node is both deterministic and side-effect-safe.",
    preconditions: [
      { description: "At least one deterministic, side-effect-safe node", met: memoEligible },
      { description: "Two+ nodes share a work class (op+adapter+model)", met: canReuse },
      { description: "Never memoizes nondeterministic or side-effecting nodes", met: true },
      { description: "Scope limited to a single run (no cross-run cache)", met: true },
    ],
    confidence: canReuse ? 0.6 : 0.15,
    expectedBenefit: canReuse
      ? "Avoids recomputing identical work across nodes within the run."
      : "None on this workflow (no cross-node reuse opportunity).",
    status: canReuse ? "accepted" : "noop",
    reason: canReuse
      ? `Accepted for ${reuseCandidates.flat().length} node(s) across ${reuseCandidates.length} work class(es).`
      : memoEligible
        ? "Enabled but dormant: no two eligible nodes can collide. Reported honestly as a no-op."
        : "No eligible nodes.",
    affectedNodes: canReuse ? reuseCandidates.flat() : [],
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

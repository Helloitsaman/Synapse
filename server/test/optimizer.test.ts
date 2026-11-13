import { describe, it, expect } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { buildOptimizationPlan } from "../src/optimizer/optimizer.js";
import { researchBrief, quickLookup, notifyAndReport } from "../src/workflows/samples.js";

describe("optimizer", () => {
  it("accepts parallelization for independent safe branches (Research Brief)", () => {
    const ir = compileWorkflow(researchBrief).ir!;
    const plan = buildOptimizationPlan(researchBrief, ir);
    const parallelize = plan.decisions.find((d) => d.id === "parallelize-independent-branches")!;
    expect(parallelize.status).toBe("accepted");
    expect(parallelize.affectedNodes).toContain("retrieve_a");
    expect(parallelize.affectedNodes).toContain("retrieve_b");
    expect(plan.suggestedConcurrency).toBeGreaterThanOrEqual(2);
  });

  it("emits a no-op decision for a short linear workflow (Quick Lookup)", () => {
    const ir = compileWorkflow(quickLookup).ir!;
    const plan = buildOptimizationPlan(quickLookup, ir);
    expect(plan.decisions.some((d) => d.status === "noop")).toBe(true);
    expect(plan.suggestedConcurrency).toBe(1);
  });

  it("refuses to parallelize side-effecting nodes (Notify & Report)", () => {
    const ir = compileWorkflow(notifyAndReport).ir!;
    const plan = buildOptimizationPlan(notifyAndReport, ir);
    const parallelize = plan.decisions.find((d) => d.id === "parallelize-independent-branches")!;
    // gather + notify are independent, but notify is not side-effect-safe.
    expect(parallelize.affectedNodes).not.toContain("notify");
    expect(parallelize.reason.toLowerCase()).toContain("notify");
  });

  it("records preconditions, confidence, and rationale for every decision", () => {
    const ir = compileWorkflow(researchBrief).ir!;
    const plan = buildOptimizationPlan(researchBrief, ir);
    for (const d of plan.decisions) {
      expect(d.preconditions.length).toBeGreaterThan(0);
      expect(typeof d.confidence).toBe("number");
      expect(d.rationale.length).toBeGreaterThan(0);
    }
  });
});

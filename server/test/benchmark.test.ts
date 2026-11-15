/**
 * Paired benchmark + comparability fingerprints: repeated runs produce
 * distributions, and comparisons detect matched vs. mismatched configurations.
 */
import { describe, it, expect } from "vitest";
import { runBenchmark } from "../src/runtime/orchestrator.js";
import { assessComparability } from "../src/runtime/compare.js";
import { computeFingerprint } from "../src/runtime/fingerprint.js";
import { compileWorkflow } from "../src/compiler/compile.js";
import { researchBrief } from "../src/workflows/samples.js";
import type { RunRecord } from "../src/types.js";

describe("paired benchmark", () => {
  it("runs N baseline + N optimized and reports distributions", async () => {
    const result = await runBenchmark({
      workflowId: "research-brief",
      repetitions: 2,
      workflowInputs: { topic: "benchmark topic" },
    });
    expect(result.repetitions).toBe(2);
    expect(result.baseline.totalMs.samples).toBe(2);
    expect(result.optimized.totalMs.samples).toBe(2);
    expect(result.order.length).toBe(4); // 2 per mode, interleaved
    expect(result.baseline.totalMs.median).toBeGreaterThan(0);
    expect(result.optimized.totalMs.median).toBeGreaterThan(0);
    // Matched by construction (same workflow + inputs).
    expect(result.comparability.comparable).toBe(true);
    expect(result.baselineKind).toBe("synapse-sequential-graph");
    // p95 >= median >= min for a real distribution.
    expect(result.baseline.totalMs.p95).toBeGreaterThanOrEqual(result.baseline.totalMs.median);
  });
});

function fakeRun(fp: ReturnType<typeof computeFingerprint>): RunRecord {
  return {
    id: "x", workflowId: fp.workflowId, workflowVersion: fp.workflowVersion, irVersion: fp.irVersion,
    mode: fp.mode, concurrency: fp.concurrency, status: "succeeded", createdAt: new Date().toISOString(),
    totalMs: 10, overheadMs: 1, spans: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, source: "none" },
    estimatedCostUsd: 0, cost: { usd: 0, label: "estimated", pricingSource: "t", modelMatched: false },
    appliedTransformations: [], fingerprint: fp,
  };
}

describe("comparability fingerprints", () => {
  const ir = compileWorkflow(researchBrief).ir!;

  it("marks a matched pair (same inputs/config) comparable", () => {
    const a = fakeRun(computeFingerprint(researchBrief, ir, { topic: "x" }, "baseline", 1));
    const b = fakeRun(computeFingerprint(researchBrief, ir, { topic: "X " }, "optimized", 2)); // normalized equal
    const report = assessComparability(a, b);
    expect(report.sameInputs).toBe(true);
    expect(report.comparable).toBe(true);
  });

  it("flags mismatched inputs as not comparable", () => {
    const a = fakeRun(computeFingerprint(researchBrief, ir, { topic: "alpha" }, "baseline", 1));
    const b = fakeRun(computeFingerprint(researchBrief, ir, { topic: "beta" }, "optimized", 2));
    const report = assessComparability(a, b);
    expect(report.sameInputs).toBe(false);
    expect(report.comparable).toBe(false);
    expect(report.mismatches.join(" ")).toMatch(/inputs/i);
  });

  it("reports unknown comparability when a fingerprint is missing", () => {
    const a = fakeRun(computeFingerprint(researchBrief, ir, { topic: "x" }, "baseline", 1));
    const b = fakeRun(computeFingerprint(researchBrief, ir, { topic: "x" }, "optimized", 2));
    delete (b as RunRecord).fingerprint;
    const report = assessComparability(a, b);
    expect(report.fingerprintMissing).toBe(true);
    expect(report.comparable).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { runCorrectness } from "../src/correctness/checks.js";
import { extractResult } from "../src/runtime/result.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { DemoAdapter } from "../src/adapters/demo.js";
import { researchBrief } from "../src/workflows/samples.js";

const registry = new AdapterRegistry([new DemoAdapter()]);

describe("correctness", () => {
  it("passes all required checks for a clean Research Brief run", async () => {
    const ir = compileWorkflow(researchBrief).ir!;
    const { outputs } = await executeRun(researchBrief, ir, "c1", {
      mode: "optimized",
      concurrency: 2,
      memoize: true,
      registry,
      workflowInputs: { topic: "renewable energy storage" },
    });
    const validation = runCorrectness({ workflowId: "research-brief", outputs, ir });
    expect(validation.passed).toBe(true);
    // Structural + semantic checks exist and pass.
    expect(validation.checks.find((c) => c.id === "sources-retrieved")!.passed).toBe(true);
    expect(validation.checks.find((c) => c.id === "citations-resolve")!.passed).toBe(true);
    expect(validation.checks.find((c) => c.id === "no-hallucinated-citations")!.passed).toBe(true);
    // Categories are separated.
    expect(validation.checks.some((c) => c.category === "structural")).toBe(true);
    expect(validation.checks.some((c) => c.category === "semantic")).toBe(true);

    // The delivered result carries a cited answer and resolvable sources.
    const result = extractResult(ir, outputs);
    expect(result).toBeDefined();
    expect(result!.answer).toContain("renewable");
    expect(result!.sources.length).toBeGreaterThan(0);
    expect(result!.provenance).toBe("demo");
    // Every citation resolves to a retrieved source.
    const sourceIds = new Set(result!.sources.map((s) => s.sourceId));
    expect(result!.citations.every((c) => sourceIds.has(c.sourceId))).toBe(true);
  });

  it("fails required checks when the terminal output is missing", () => {
    const ir = compileWorkflow(researchBrief).ir!;
    const validation = runCorrectness({
      workflowId: "research-brief",
      outputs: new Map(),
      ir,
    });
    expect(validation.passed).toBe(false);
  });
});

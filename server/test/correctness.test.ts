import { describe, it, expect } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { runCorrectness } from "../src/correctness/checks.js";
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
    });
    const validation = runCorrectness({ workflowId: "research-brief", outputs, ir });
    expect(validation.passed).toBe(true);
    expect(validation.checks.find((c) => c.id === "source-ids")!.passed).toBe(true);
    expect(validation.checks.find((c) => c.id === "exact-source-mapping")!.passed).toBe(true);
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

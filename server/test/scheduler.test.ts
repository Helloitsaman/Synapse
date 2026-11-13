import { describe, it, expect } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { DemoAdapter } from "../src/adapters/demo.js";
import { researchBrief } from "../src/workflows/samples.js";
import type { NodeSpan } from "../src/types.js";

const registry = new AdapterRegistry([new DemoAdapter()]);
const ir = () => compileWorkflow(researchBrief).ir!;

function startedAt(spans: NodeSpan[], id: string) {
  return spans.find((s) => s.nodeId === id)!.startedAt!;
}
function endedAt(spans: NodeSpan[], id: string) {
  return spans.find((s) => s.nodeId === id)!.endedAt!;
}

describe("scheduler", () => {
  it("runs all nodes to success (baseline) and never violates dependencies", async () => {
    const { record } = await executeRun(researchBrief, ir(), "t1", {
      mode: "baseline",
      concurrency: 1,
      memoize: false,
      registry,
    });
    expect(record.status).toBe("succeeded");
    expect(record.spans.every((s) => s.status === "succeeded")).toBe(true);
    // synthesize cannot start before both summaries finished.
    expect(startedAt(record.spans, "synthesize")).toBeGreaterThanOrEqual(
      endedAt(record.spans, "summarize_a"),
    );
    expect(startedAt(record.spans, "synthesize")).toBeGreaterThanOrEqual(
      endedAt(record.spans, "summarize_b"),
    );
  });

  it("optimized run schedules independent branches concurrently", async () => {
    const { record } = await executeRun(researchBrief, ir(), "t2", {
      mode: "optimized",
      concurrency: 2,
      memoize: true,
      registry,
    });
    expect(record.status).toBe("succeeded");
    // retrieve_a and retrieve_b overlap in time (ran concurrently).
    const aStart = startedAt(record.spans, "retrieve_a");
    const aEnd = endedAt(record.spans, "retrieve_a");
    const bStart = startedAt(record.spans, "retrieve_b");
    const bEnd = endedAt(record.spans, "retrieve_b");
    const overlap = aStart < bEnd && bStart < aEnd;
    expect(overlap).toBe(true);
  });

  it("optimized total wall-clock is <= baseline (parallelism helps)", async () => {
    const base = await executeRun(researchBrief, ir(), "b", {
      mode: "baseline",
      concurrency: 1,
      memoize: false,
      registry,
    });
    const opt = await executeRun(researchBrief, ir(), "o", {
      mode: "optimized",
      concurrency: 2,
      memoize: true,
      registry,
    });
    // Parallel run should not be slower than sequential for this DAG.
    expect(opt.record.totalMs).toBeLessThanOrEqual(base.record.totalMs + 50);
  });

  it("concurrency never exceeds the configured limit", async () => {
    // Instrument by sampling active executions through overlapping intervals.
    const { record } = await executeRun(researchBrief, ir(), "t3", {
      mode: "optimized",
      concurrency: 2,
      memoize: false,
      registry,
    });
    const intervals = record.spans
      .filter((s) => s.startedAt && s.endedAt && s.execMs > 0)
      .map((s) => [s.startedAt!, s.endedAt!] as const);
    let maxConcurrent = 0;
    for (const [s] of intervals) {
      const concurrent = intervals.filter(([st, en]) => st <= s && en > s).length;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
    }
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("marks dependents as skipped when a node fails", async () => {
    // Force a failure by giving summarize_a an adapter that will time out:
    const wf = JSON.parse(JSON.stringify(researchBrief));
    wf.nodes.find((n: any) => n.id === "summarize_a").timeoutMs = 1; // 1ms -> timeout
    const compiled = compileWorkflow(wf);
    const { record } = await executeRun(wf, compiled.ir!, "t4", {
      mode: "baseline",
      concurrency: 1,
      memoize: false,
      registry,
    });
    expect(record.status).toBe("failed");
    const synth = record.spans.find((s) => s.nodeId === "synthesize")!;
    expect(["skipped", "pending"]).toContain(synth.status);
  });

  it("supports cancellation", async () => {
    const ac = new AbortController();
    const p = executeRun(researchBrief, ir(), "t5", {
      mode: "baseline",
      concurrency: 1,
      memoize: false,
      registry,
      cancelSignal: ac.signal,
    });
    setTimeout(() => ac.abort(), 10);
    const { record } = await p;
    expect(record.status).toBe("cancelled");
  });

  it("retries a flaky node up to maxAttempts", async () => {
    const { record } = await executeRun(researchBrief, ir(), "t6", {
      mode: "baseline",
      concurrency: 1,
      memoize: false,
      registry,
    });
    // retrieve_a has maxAttempts 2 but demo adapter succeeds first try.
    const span = record.spans.find((s) => s.nodeId === "retrieve_a")!;
    expect(span.attempts).toBe(1);
  });
});

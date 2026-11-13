import { describe, it, expect } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { researchBrief } from "../src/workflows/samples.js";
import { SCHEMA_VERSION } from "../src/schema.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("compiler", () => {
  it("compiles the Research Brief into a valid IR", () => {
    const r = compileWorkflow(researchBrief);
    expect(r.ok).toBe(true);
    expect(r.ir).toBeDefined();
    // 6 nodes, topological order with retrieve_* before summarize_* before synthesize.
    const order = r.ir!.order;
    expect(order.indexOf("retrieve_a")).toBeLessThan(order.indexOf("summarize_a"));
    expect(order.indexOf("summarize_a")).toBeLessThan(order.indexOf("synthesize"));
    expect(order.indexOf("summarize_b")).toBeLessThan(order.indexOf("synthesize"));
    expect(order.indexOf("synthesize")).toBeLessThan(order.indexOf("format_brief"));
    // retrieve_a and retrieve_b are independent -> same level 0.
    expect(r.ir!.graph.levels[0].sort()).toEqual(["retrieve_a", "retrieve_b"]);
  });

  it("rejects duplicate node ids", () => {
    const wf = clone(researchBrief);
    wf.nodes.push({ ...wf.nodes[0] });
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("rejects missing dependencies", () => {
    const wf = clone(researchBrief);
    wf.nodes[1].dependsOn = ["does_not_exist"];
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "MISSING_DEPENDENCY")).toBe(true);
  });

  it("detects cycles", () => {
    const wf = clone(researchBrief);
    // Make retrieve_a depend on format_brief -> cycle.
    wf.nodes[0].dependsOn = ["format_brief"];
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("rejects unbounded/oversized timeouts", () => {
    const wf = clone(researchBrief);
    wf.nodes[0].timeoutMs = 10_000_000;
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "SCHEMA_INVALID" || e.code === "UNSAFE_TIMEOUT")).toBe(true);
  });

  it("rejects unsupported operation types via schema", () => {
    const wf = clone(researchBrief) as any;
    wf.nodes[0].op = "quantum";
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed retrieval config (missing sourceId)", () => {
    const wf = clone(researchBrief) as any;
    delete wf.nodes[0].config.sourceId;
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "MALFORMED_CONFIG")).toBe(true);
  });

  it("rejects wrong schema version", () => {
    const wf = clone(researchBrief) as any;
    wf.schemaVersion = "9.9.9";
    const r = compileWorkflow(wf);
    expect(r.ok).toBe(false);
  });

  it("produces a stable irVersion for identical input", () => {
    const a = compileWorkflow(researchBrief);
    const b = compileWorkflow(researchBrief);
    expect(a.ir!.irVersion).toBe(b.ir!.irVersion);
    expect(a.ir!.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

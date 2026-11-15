/**
 * End-to-end vertical slice: the LIVE research workflow (real search adapter +
 * real model adapter code paths) executed against deterministic fake provider
 * servers — no network, no paid keys. Proves the full chain: live retrieval →
 * grounded model summaries → synthesis → cited answer, with honest provenance
 * and passing correctness checks, in both baseline and optimized modes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { runCorrectness } from "../src/correctness/checks.js";
import { extractResult } from "../src/runtime/result.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { makeResearchBriefLive } from "../src/workflows/samples.js";
import { startServer, sendJson, markersIn, type FakeServer } from "./fakes.js";

const ENV = ["SEARCH_PROVIDER", "TAVILY_API_KEY", "TAVILY_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"];
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let search: FakeServer | undefined;
let model: FakeServer | undefined;

afterEach(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await search?.close();
  await model?.close();
  search = model = undefined;
});

async function setupFakes() {
  search = await startServer((req, res) => {
    const n = Math.min(req.body.max_results ?? 3, 4);
    sendJson(res, 200, {
      query: req.body.query,
      results: Array.from({ length: n }, (_, i) => ({
        title: `Doc ${i + 1}: ${req.body.query}`,
        url: `https://src${i + 1}.test/a`,
        content: `Finding ${i + 1} about ${req.body.query}.`,
        raw_content: `Detailed finding ${i + 1} about ${req.body.query}.`,
        score: 0.9 - i * 0.1,
      })),
    });
  });
  model = await startServer((req, res) => {
    const user = req.body?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    const cites = markersIn(user).slice(0, 2).map((m) => `[${m}]`).join(" ");
    sendJson(res, 200, {
      id: "chatcmpl-live-fake",
      choices: [{ message: { role: "assistant", content: `Grounded analysis referencing ${cites}.` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 200, completion_tokens: 60 },
    });
  });
  process.env.SEARCH_PROVIDER = "tavily";
  process.env.TAVILY_API_KEY = "test";
  process.env.TAVILY_BASE_URL = search.url;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = model.url;
}

async function runMode(mode: "baseline" | "optimized") {
  const wf = makeResearchBriefLive({ modelAdapter: "openai", model: "gpt-4o-mini" });
  const ir = compileWorkflow(wf).ir!;
  const { record, outputs } = await executeRun(wf, ir, `live-${mode}`, {
    mode,
    concurrency: mode === "optimized" ? 2 : 1,
    memoize: mode === "optimized",
    registry: new AdapterRegistry(),
    workflowInputs: { topic: "grid scale battery storage" },
  });
  const validation = runCorrectness({ workflowId: wf.id, outputs, ir });
  const result = extractResult(ir, outputs);
  return { record, validation, result };
}

describe("live vertical slice (fake providers)", () => {
  it("retrieves live sources, produces a cited answer, and reports live provenance", async () => {
    await setupFakes();
    const { record, validation, result } = await runMode("optimized");

    expect(record.status).toBe("succeeded");
    // Honest provenance: real providers ran.
    expect(record.execution?.liveExecution).toBe(true);
    expect(record.execution?.providers).toContain("openai:gpt-4o-mini");
    expect(record.execution?.adapters).toEqual(expect.arrayContaining(["search", "openai", "demo"]));
    expect(record.usage.source).toBe("provider-reported");
    expect(record.usage.inputTokens).toBeGreaterThan(0);

    // Correctness: structural + semantic, all required pass, no hallucinated cites.
    expect(validation.passed).toBe(true);
    expect(validation.checks.find((c) => c.id === "no-hallucinated-citations")!.passed).toBe(true);
    expect(validation.checks.find((c) => c.id === "citations-resolve")!.passed).toBe(true);

    // Delivered answer is grounded and cited.
    expect(result).toBeDefined();
    expect(result!.provenance).toBe("live");
    expect(result!.answer).toContain("grid scale battery storage");
    expect(result!.sources.length).toBeGreaterThan(0);
    expect(result!.citations.length).toBeGreaterThan(0);
    const sourceIds = new Set(result!.sources.map((s) => s.sourceId));
    expect(result!.citations.every((c) => sourceIds.has(c.sourceId))).toBe(true);
    // Sources came from BOTH independent branches (a* and b*).
    expect(result!.sources.some((s) => s.sourceId.startsWith("a"))).toBe(true);
    expect(result!.sources.some((s) => s.sourceId.startsWith("b"))).toBe(true);
  });

  it("baseline and optimized produce materially equivalent cited sources", async () => {
    await setupFakes();
    const base = await runMode("baseline");
    const opt = await runMode("optimized");
    expect(base.record.status).toBe("succeeded");
    expect(opt.record.status).toBe("succeeded");
    const ids = (r: typeof base) => r.result!.citations.map((c) => c.sourceId).sort();
    expect(ids(base)).toEqual(ids(opt));
    expect(base.validation.passed).toBe(true);
    expect(opt.validation.passed).toBe(true);
  });

  it("fails cleanly (no demo fallback) when the model provider is unavailable", async () => {
    await setupFakes();
    delete process.env.OPENAI_API_KEY; // search configured, model not
    const { record } = await runMode("baseline");
    expect(record.status).toBe("failed");
    // The failing node is a model node, surfaced honestly.
    expect(record.spans.find((s) => s.status === "failed")?.adapter).toBe("openai");
  });
});

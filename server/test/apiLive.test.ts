/**
 * API-level live slice: run a live research workflow through the real HTTP API
 * (compile → run → poll → read result) against fake providers, proving the
 * orchestrator persists a cited answer with honest live provenance and that
 * /config and /integrations advertise live readiness — all without paid keys.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { api } from "../src/api/routes.js";
import { makeResearchBriefLive } from "../src/workflows/samples.js";
import { startServer, sendJson, markersIn, type FakeServer } from "./fakes.js";

let server: Server;
let base: string;
let search: FakeServer;
let model: FakeServer;

const ENV = ["SEARCH_PROVIDER", "TAVILY_API_KEY", "TAVILY_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"];
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  search = await startServer((req, res) =>
    sendJson(res, 200, {
      query: req.body.query,
      results: Array.from({ length: Math.min(req.body.max_results ?? 3, 4) }, (_, i) => ({
        title: `Doc ${i + 1}`,
        url: `https://src${i + 1}.test/a`,
        content: `About ${req.body.query}`,
        raw_content: `Detail about ${req.body.query}`,
      })),
    }),
  );
  model = await startServer((req, res) => {
    const user = req.body?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    const cites = markersIn(user).slice(0, 2).map((m) => `[${m}]`).join(" ");
    sendJson(res, 200, {
      id: "chatcmpl-api",
      choices: [{ message: { content: `Grounded ${cites}.` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 150, completion_tokens: 45 },
    });
  });
  process.env.SEARCH_PROVIDER = "tavily";
  process.env.TAVILY_API_KEY = "test";
  process.env.TAVILY_BASE_URL = search.url;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = model.url;

  const app = express();
  app.use(express.json());
  app.use("/api", api);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  server?.close();
  await search?.close();
  await model?.close();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const get = (p: string): Promise<any> => fetch(base + p).then((r) => r.json());
const post = (p: string, body?: unknown) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

async function waitForRun(id: string, timeoutMs = 10000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await get(`/api/runs/${id}`);
    if (["succeeded", "failed", "cancelled"].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 80));
  }
  throw new Error("run did not finish in time");
}

describe("API live slice", () => {
  it("advertises live readiness in /config and /integrations", async () => {
    const cfg = await get("/api/config");
    expect(cfg.demoMode).toBe(false);
    expect(cfg.live.researchReady).toBe(true);
    expect(cfg.live.modelAdapters).toContain("openai");
    const integ = await get("/api/integrations");
    expect(integ.live.searchAvailable).toBe(true);
    expect(JSON.stringify(integ)).not.toMatch(/sk-test/); // no keys leaked
  });

  it("runs a live research workflow and returns a cited answer with live provenance", async () => {
    const wf = { ...makeResearchBriefLive({ modelAdapter: "openai", model: "gpt-4o-mini" }), id: "rbl-apitest" };
    const imp = await post("/api/workflows", wf);
    expect(imp.status).toBe(201);

    const started: any = await post("/api/runs", {
      workflowId: "rbl-apitest",
      mode: "optimized",
      workflowInputs: { topic: "offshore wind capacity" },
    }).then((r) => r.json());
    const run = await waitForRun(started.id);

    expect(run.status).toBe("succeeded");
    expect(run.execution.liveExecution).toBe(true);
    expect(run.execution.providers).toContain("openai:gpt-4o-mini");
    expect(run.usage.source).toBe("provider-reported");
    expect(run.validation.passed).toBe(true);

    // The delivered, persisted answer is grounded and cited.
    expect(run.result).toBeDefined();
    expect(run.result.provenance).toBe("live");
    expect(run.result.answer).toContain("offshore wind");
    expect(run.result.citations.length).toBeGreaterThan(0);
    const sourceIds = new Set(run.result.sources.map((s: any) => s.sourceId));
    expect(run.result.citations.every((c: any) => sourceIds.has(c.sourceId))).toBe(true);

    // No secrets leak into the persisted/served record.
    expect(JSON.stringify(run)).not.toMatch(/sk-test/);
  });
});

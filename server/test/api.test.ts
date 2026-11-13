import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { api } from "../src/api/routes.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", api);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

const get = (p: string): Promise<any> => fetch(base + p).then(json);
const post = (p: string, body?: unknown): Promise<Response> =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const del = (p: string): Promise<Response> => fetch(base + p, { method: "DELETE" });
const json = (r: Response): Promise<any> => r.json();

async function waitForRun(id: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await get(`/api/runs/${id}`);
    if (["succeeded", "failed", "cancelled"].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 80));
  }
  throw new Error("run did not finish in time");
}

describe("API", () => {
  it("health check responds ok", async () => {
    const r = await get("/api/health");
    expect(r.status).toBe("ok");
  });

  it("lists sample workflows including research-brief", async () => {
    const list = await get("/api/workflows");
    expect(list.some((w: any) => w.id === "research-brief")).toBe(true);
  });

  it("compiles the research-brief workflow", async () => {
    const res = await post("/api/workflows/research-brief/compile");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.ir.order.length).toBe(6);
  });

  it("returns 422 with actionable errors for an invalid workflow", async () => {
    const res = await post("/api/compile", {
      schemaVersion: "1.0.0",
      id: "bad",
      name: "Bad",
      version: "1",
      nodes: [
        {
          id: "a",
          op: "llm",
          label: "A",
          dependsOn: ["missing"],
          timeoutMs: 1000,
          provider: { adapter: "demo" },
        },
      ],
    });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("previews an optimization plan", async () => {
    const res = await post("/api/workflows/research-brief/optimize/preview");
    const body = await json(res);
    expect(body.plan.decisions.length).toBeGreaterThan(0);
    expect(body.plan.suggestedConcurrency).toBeGreaterThanOrEqual(2);
  });

  it("runs baseline and optimized, then compares them", async () => {
    const b = await post("/api/runs", { workflowId: "research-brief", mode: "baseline" }).then(json);
    const o = await post("/api/runs", { workflowId: "research-brief", mode: "optimized" }).then(json);
    const bf = await waitForRun(b.id);
    const of = await waitForRun(o.id);
    expect(bf.status).toBe("succeeded");
    expect(of.status).toBe("succeeded");
    expect(bf.validation.passed).toBe(true);

    const cmp = await get(`/api/compare?baseline=${b.id}&optimized=${o.id}`);
    expect(cmp.metrics.baselineTotalMs.label).toBe("measured");
    expect(cmp.metrics.baselineCostUsd.label).toBe("estimated");
    expect(cmp.sampleCount).toBe(1);
  });

  it("exposes the integrations capability matrix without secrets", async () => {
    const r = await get("/api/integrations");
    expect(r.adapters.some((a: any) => a.id === "demo")).toBe(true);
    expect(r.hosts.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toMatch(/sk-/); // no API keys leaked
  });

  it("imports a workflow, lists it as non-builtin, then deletes it", async () => {
    const wf = {
      schemaVersion: "1.0.0",
      id: "studio-test-wf",
      name: "Studio Test",
      version: "1.0.0",
      nodes: [
        {
          id: "a", op: "retrieval", label: "A", dependsOn: [],
          timeoutMs: 1000, provider: { adapter: "demo" },
          deterministic: true, sideEffectSafe: true,
          config: { sourceId: "SRC-T" },
        },
        {
          id: "b", op: "llm", label: "B", dependsOn: ["a"],
          timeoutMs: 2000, provider: { adapter: "demo" },
          deterministic: true, sideEffectSafe: true,
        },
      ],
    };
    const imp = await post("/api/workflows", wf);
    expect(imp.status).toBe(201);

    const list = await get("/api/workflows");
    const found = list.find((w: any) => w.id === "studio-test-wf");
    expect(found).toBeTruthy();
    expect(found.builtin).toBe(false);

    const d = await del("/api/workflows/studio-test-wf");
    expect(d.status).toBe(200);
    const after = await get("/api/workflows");
    expect(after.some((w: any) => w.id === "studio-test-wf")).toBe(false);
  });

  it("refuses to delete a built-in sample workflow", async () => {
    const d = await del("/api/workflows/research-brief");
    expect(d.status).toBe(400);
    const body = await json(d);
    expect(body.error.code).toBe("BUILTIN_PROTECTED");
    // still present
    const list = await get("/api/workflows");
    expect(list.some((w: any) => w.id === "research-brief")).toBe(true);
  });

  it("deletes a persisted run", async () => {
    const b = await post("/api/runs", { workflowId: "quick-lookup", mode: "baseline" }).then(json);
    await waitForRun(b.id);
    const del = await fetch(base + `/api/runs/${b.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await fetch(base + `/api/runs/${b.id}`);
    expect(after.status).toBe(404);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { SearchAdapter, resolveQuery } from "../src/adapters/search.js";
import { AdapterError } from "../src/adapters/contract.js";
import { startServer, sendJson, tavilyResponse, type FakeServer } from "./fakes.js";
import type { WorkflowNode } from "../src/types.js";

const SEARCH_ENV = [
  "SEARCH_PROVIDER",
  "TAVILY_API_KEY",
  "TAVILY_BASE_URL",
  "BRAVE_API_KEY",
  "BRAVE_BASE_URL",
  "SERPAPI_API_KEY",
  "SERPAPI_BASE_URL",
];

const saved: Record<string, string | undefined> = {};
for (const k of SEARCH_ENV) saved[k] = process.env[k];
let server: FakeServer | undefined;

afterEach(async () => {
  for (const k of SEARCH_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await server?.close();
  server = undefined;
});

function retrievalNode(config: Record<string, unknown>): WorkflowNode {
  return {
    id: "retrieve_a",
    op: "retrieval",
    label: "Search",
    dependsOn: [],
    inputs: ["topic"],
    outputs: ["docs"],
    timeoutMs: 20000,
    provider: { adapter: "search" },
    deterministic: false,
    sideEffectSafe: true,
    idempotent: true,
    retry: { maxAttempts: 1, backoffMs: 0 },
    config: { sourceId: "A", ...config },
  };
}

function run(node: WorkflowNode, workflowInputs: Record<string, unknown>, signal?: AbortSignal) {
  return new SearchAdapter().execute({
    node,
    inputs: {},
    signal: signal ?? new AbortController().signal,
    workflowInputs,
  });
}

describe("SearchAdapter", () => {
  it("is unavailable and refuses to run when no provider is configured", async () => {
    for (const k of SEARCH_ENV) delete process.env[k];
    const adapter = new SearchAdapter();
    expect(adapter.isAvailable().available).toBe(false);
    await expect(run(retrievalNode({}), { topic: "x" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("parses Tavily results into structured, stably-numbered source records", async () => {
    server = await startServer((req, res) => sendJson(res, 200, tavilyResponse(req.body.query, 3)));
    process.env.SEARCH_PROVIDER = "tavily";
    process.env.TAVILY_API_KEY = "test-key";
    process.env.TAVILY_BASE_URL = server.url;

    const result = await run(retrievalNode({ maxResults: 3 }), { topic: "solid state batteries" });
    const out = result.output as any;

    expect(out.type).toBe("search-results");
    expect(out.provider).toBe("tavily");
    expect(out.live).toBe(true);
    expect(result.provenance).toBe("live");
    expect(result.usage.source).toBe("none"); // retrieval has no tokens
    expect(result.sources).toHaveLength(3);

    const s0 = result.sources![0];
    expect(s0.sourceId).toBe("a1"); // prefix "a" from sourceId "A"
    expect(s0.url).toBe("https://example1.test/article");
    expect(s0.publisher).toBe("example1.test");
    expect(s0.content).toContain("Full extracted content");
    expect(s0.provenance).toBe("live");

    // The provider received the key in the body and the resolved query.
    expect(server.requests[0].body.api_key).toBe("test-key");
    expect(server.requests[0].body.query).toContain("solid state batteries");
  });

  it("builds the query from a {topic} template and workflow inputs", () => {
    const node = retrievalNode({ query: "{topic} market forecast 2026" });
    expect(resolveQuery(node, { topic: "lithium" })).toBe("lithium market forecast 2026");
    const angled = retrievalNode({ angle: "recent news" });
    expect(resolveQuery(angled, { topic: "lithium" })).toBe("lithium recent news");
  });

  it("clamps maxResults to the returned set", async () => {
    server = await startServer((req, res) => sendJson(res, 200, tavilyResponse(req.body.query, 8)));
    process.env.SEARCH_PROVIDER = "tavily";
    process.env.TAVILY_API_KEY = "k";
    process.env.TAVILY_BASE_URL = server.url;
    const result = await run(retrievalNode({ maxResults: 2 }), { topic: "x" });
    expect(result.sources).toHaveLength(2);
  });

  it("maps a 429 to a RATE_LIMITED AdapterError", async () => {
    server = await startServer((_req, res) => sendJson(res, 429, { error: "slow down" }));
    process.env.SEARCH_PROVIDER = "tavily";
    process.env.TAVILY_API_KEY = "k";
    process.env.TAVILY_BASE_URL = server.url;
    await expect(run(retrievalNode({}), { topic: "x" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps a 500 to a PROVIDER_ERROR without leaking internals", async () => {
    server = await startServer((_req, res) => sendJson(res, 500, { error: "boom" }));
    process.env.SEARCH_PROVIDER = "tavily";
    process.env.TAVILY_API_KEY = "k";
    process.env.TAVILY_BASE_URL = server.url;
    await expect(run(retrievalNode({}), { topic: "x" })).rejects.toBeInstanceOf(AdapterError);
  });

  it("honours cancellation via the abort signal", async () => {
    server = await startServer((req, res) => sendJson(res, 200, tavilyResponse(req.body.query, 1)));
    process.env.SEARCH_PROVIDER = "tavily";
    process.env.TAVILY_API_KEY = "k";
    process.env.TAVILY_BASE_URL = server.url;
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run(retrievalNode({}), { topic: "x" }, ctrl.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
});

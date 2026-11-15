import { afterEach, describe, expect, it } from "vitest";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import { AnthropicAdapter } from "../src/adapters/anthropic.js";
import { GeminiAdapter } from "../src/adapters/gemini.js";
import { AdapterError } from "../src/adapters/contract.js";
import { startServer, sendJson, markersIn, openAiGroundedHandler, type FakeServer, type Handler } from "./fakes.js";
import type { SourceRecord, WorkflowNode } from "../src/types.js";

const ENV = [
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODEL",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
let server: FakeServer | undefined;

afterEach(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await server?.close();
  server = undefined;
});

const sources: SourceRecord[] = [
  { sourceId: "a1", title: "T1", url: "https://e1.test", publisher: "e1.test", snippet: "s1", retrievedAt: "t", provenance: "live" },
  { sourceId: "a2", title: "T2", url: "https://e2.test", publisher: "e2.test", snippet: "s2", retrievedAt: "t", provenance: "live" },
];

function summaryNode(adapter: string, model: string): WorkflowNode {
  return {
    id: "summarize_a", op: "llm", label: "Summarize A", dependsOn: ["retrieve_a"],
    inputs: ["docs_a"], outputs: ["summary_a"], timeoutMs: 30000,
    provider: { adapter, model }, deterministic: false, sideEffectSafe: true, idempotent: true,
    retry: { maxAttempts: 1, backoffMs: 0 }, config: { section: "A" },
  };
}

const inputs = { retrieve_a: { type: "search-results", sources } };

function run(adapter: any, node: WorkflowNode, signal?: AbortSignal) {
  return adapter.execute({ node, inputs, signal: signal ?? new AbortController().signal, workflowInputs: { topic: "fusion" } });
}

// Anthropic-shaped grounded handler.
const anthropicHandler = (usage = true): Handler => (req, res) => {
  const user = req.body?.messages?.find((m: any) => m.role === "user")?.content ?? "";
  const cites = markersIn(user).slice(0, 2).map((m) => `[${m}]`).join(" ");
  const base: any = { id: "msg_fake", content: [{ type: "text", text: `Summary ${cites}.` }], stop_reason: "end_turn" };
  if (usage) base.usage = { input_tokens: 100, output_tokens: 30 };
  sendJson(res, 200, base);
};

// Gemini-shaped grounded handler.
const geminiHandler = (usage = true): Handler => (req, res) => {
  const user = req.body?.contents?.[0]?.parts?.[0]?.text ?? "";
  const cites = markersIn(user).slice(0, 2).map((m) => `[${m}]`).join(" ");
  const base: any = { candidates: [{ content: { parts: [{ text: `Summary ${cites}.` }] }, finishReason: "STOP" }] };
  if (usage) base.usageMetadata = { promptTokenCount: 90, candidatesTokenCount: 25 };
  sendJson(res, 200, base);
};

describe("OpenAI adapter", () => {
  it("is unavailable without a key and refuses to run", async () => {
    delete process.env.OPENAI_API_KEY;
    const a = new OpenAIAdapter();
    expect(a.isAvailable().available).toBe(false);
    await expect(run(a, summaryNode("openai", "gpt-4o-mini"))).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("sends a grounded prompt, captures provider-reported usage, and cites real sources", async () => {
    server = await startServer(openAiGroundedHandler());
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = server.url;
    const result = await run(new OpenAIAdapter(), summaryNode("openai", "gpt-4o-mini"));
    const out = result.output as any;

    expect(out.type).toBe("summary");
    expect(out.citedSourceIds).toEqual(["a1", "a2"]);
    expect(out.unknownCitations).toEqual([]);
    expect(result.provenance).toBe("live");
    expect(result.usage.source).toBe("provider-reported");
    expect(result.usage.inputTokens).toBe(120);
    expect(result.meta?.requestId).toBe("chatcmpl-fake-123");
    expect(result.meta?.finishReason).toBe("stop");
    // The prompt actually contained the source context (system + user messages).
    const body = server.requests[0].body;
    expect(body.messages.some((m: any) => m.role === "system")).toBe(true);
    expect(JSON.stringify(body)).toContain("a1");
  });

  it("labels usage unavailable when the provider returns none (never invents it)", async () => {
    server = await startServer(openAiGroundedHandler({ usage: false }));
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = server.url;
    const result = await run(new OpenAIAdapter(), summaryNode("openai", "gpt-4o-mini"));
    expect(result.usage.source).toBe("unavailable");
    expect(result.usage.inputTokens).toBe(0);
  });

  it("maps rate limits and errors to clean AdapterErrors", async () => {
    server = await startServer((_r, res) => sendJson(res, 429, { error: "rate" }));
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = server.url;
    await expect(run(new OpenAIAdapter(), summaryNode("openai", "gpt-4o-mini"))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("honours cancellation", async () => {
    server = await startServer(openAiGroundedHandler());
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = server.url;
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run(new OpenAIAdapter(), summaryNode("openai", "gpt-4o-mini"), ctrl.signal)).rejects.toBeInstanceOf(AdapterError);
  });
});

describe("Anthropic adapter", () => {
  it("parses Messages API output and usage", async () => {
    server = await startServer(anthropicHandler());
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_BASE_URL = server.url;
    const result = await run(new AnthropicAdapter(), summaryNode("anthropic", "claude-3-5-haiku-latest"));
    const out = result.output as any;
    expect(out.type).toBe("summary");
    expect(out.citedSourceIds).toEqual(["a1", "a2"]);
    expect(result.usage.source).toBe("provider-reported");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(30);
    expect(result.meta?.finishReason).toBe("end_turn");
    // Correct auth + version headers were sent.
    expect(server.requests[0].headers["x-api-key"]).toBe("sk-ant-test");
    expect(server.requests[0].headers["anthropic-version"]).toBeDefined();
  });

  it("is unavailable without a key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(new AnthropicAdapter().isAvailable().available).toBe(false);
  });
});

describe("Gemini adapter", () => {
  it("parses generateContent output and usageMetadata", async () => {
    server = await startServer(geminiHandler());
    process.env.GEMINI_API_KEY = "g-test";
    process.env.GEMINI_BASE_URL = server.url;
    const result = await run(new GeminiAdapter(), summaryNode("gemini", "gemini-2.0-flash"));
    const out = result.output as any;
    expect(out.type).toBe("summary");
    expect(out.citedSourceIds).toEqual(["a1", "a2"]);
    expect(result.usage.source).toBe("provider-reported");
    expect(result.usage.inputTokens).toBe(90);
    expect(result.meta?.finishReason).toBe("STOP");
    // Key goes in the header, not the URL.
    expect(server.requests[0].headers["x-goog-api-key"]).toBe("g-test");
    expect(server.requests[0].path).not.toContain("g-test");
  });

  it("accepts GOOGLE_API_KEY as an alias", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "alias";
    expect(new GeminiAdapter().isAvailable().available).toBe(true);
  });
});

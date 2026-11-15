/**
 * Deterministic fake provider servers for adapter tests. These let us exercise
 * the real adapter code paths (request shape, parsing, usage provenance, errors,
 * rate limits, cancellation, input flow) with NO network and NO paid API keys.
 */
import http from "node:http";
import { AddressInfo } from "node:net";

export interface FakeServer {
  url: string;
  /** Requests captured in order: { method, path, headers, body }. */
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

export interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export type Handler = (
  req: CapturedRequest,
  res: http.ServerResponse,
) => void | Promise<void>;

/** Start a one-off HTTP server on an ephemeral loopback port. */
export async function startServer(handler: Handler): Promise<FakeServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any = raw;
      try {
        body = raw ? JSON.parse(raw) : "";
      } catch {
        /* keep raw */
      }
      const captured: CapturedRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body,
      };
      requests.push(captured);
      try {
        await handler(captured, res);
      } catch (err) {
        if (!res.headersSent) res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Extract [id] citation markers present in a text blob. */
export function markersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([a-z][a-z0-9]{0,11})\]/gi)) out.push(m[1]);
  return [...new Set(out)];
}

/** A Tavily-shaped search response for N deterministic results. */
export function tavilyResponse(query: string, n = 3) {
  return {
    query,
    results: Array.from({ length: n }, (_, i) => ({
      title: `Result ${i + 1} for ${query}`,
      url: `https://example${i + 1}.test/article`,
      content: `Snippet ${i + 1} about ${query}.`,
      raw_content: `Full extracted content ${i + 1} discussing ${query} in detail.`,
      score: 0.9 - i * 0.1,
    })),
  };
}

/**
 * An OpenAI chat-completions handler that grounds its reply in the sources it was
 * given: it echoes back the first two [id] markers found in the user prompt, so
 * citations always resolve to retrieved sources.
 */
export function openAiGroundedHandler(opts?: { usage?: boolean }): Handler {
  return (req, res) => {
    const userMsg: string =
      req.body?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    const cites = markersIn(userMsg).slice(0, 2).map((m) => `[${m}]`).join(" ");
    const content = `Grounded summary referencing ${cites || "(no sources)"}.`;
    const base: any = {
      id: "chatcmpl-fake-123",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    };
    if (opts?.usage !== false) base.usage = { prompt_tokens: 120, completion_tokens: 40 };
    sendJson(res, 200, base);
  };
}

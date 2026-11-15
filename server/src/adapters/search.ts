/**
 * Live search / retrieval adapter (opt-in).
 *
 * Handles `retrieval` nodes whose `provider.adapter` is "search". It calls a
 * configured real search provider (Tavily, Brave, or SerpAPI) through that
 * provider's official HTTPS API and returns structured, citable source records.
 * Page content comes from the provider's own extract field, so SYNAPSE does not
 * fetch arbitrary user-supplied URLs here (no SSRF surface in this adapter; the
 * generic http-tool adapter is the place for raw fetches, with its allowlist).
 *
 * Credentials are server-side only and never logged. When unconfigured it
 * reports itself unavailable; SYNAPSE never silently falls back to demo output
 * for a node that requested a live provider.
 */
import type { Adapter, AdapterContext, AdapterResult } from "./contract.js";
import { ADAPTER_CONTRACT_VERSION, AdapterError } from "./contract.js";
import type { SourceRecord, Usage, WorkflowNode } from "../types.js";
import { DEFAULT_MAX_RESULTS, citePrefix, makeSourceId } from "./research.js";

type ProviderId = "tavily" | "brave" | "serpapi";

const MAX_RESULTS_CAP = 10;
const MAX_CONTENT_CHARS = 4000;

function configuredProvider(): ProviderId | null {
  const p = (process.env.SEARCH_PROVIDER ?? "").trim().toLowerCase();
  if (p === "tavily" || p === "brave" || p === "serpapi") return p;
  // Infer from whichever key is present if SEARCH_PROVIDER is unset.
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_API_KEY) return "brave";
  if (process.env.SERPAPI_API_KEY) return "serpapi";
  return null;
}

function providerKey(p: ProviderId): string {
  return (
    {
      tavily: process.env.TAVILY_API_KEY,
      brave: process.env.BRAVE_API_KEY,
      serpapi: process.env.SERPAPI_API_KEY,
    }[p] ?? ""
  );
}

function providerBaseUrl(p: ProviderId): string {
  const fallback = {
    tavily: "https://api.tavily.com",
    brave: "https://api.search.brave.com",
    serpapi: "https://serpapi.com",
  }[p];
  return (
    {
      tavily: process.env.TAVILY_BASE_URL,
      brave: process.env.BRAVE_BASE_URL,
      serpapi: process.env.SERPAPI_BASE_URL,
    }[p] ?? fallback
  ).replace(/\/$/, "");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Resolve the effective query for a node from config + workflow inputs. */
export function resolveQuery(node: WorkflowNode, workflowInputs: Record<string, unknown>): string {
  const cfg = node.config as Record<string, any>;
  const topic = String(workflowInputs.topic ?? cfg.topic ?? "").trim();
  const template = typeof cfg.query === "string" ? cfg.query : "";
  if (template) {
    return template.replace(/\{topic\}/gi, topic).trim();
  }
  const angle = typeof cfg.angle === "string" ? ` ${cfg.angle}` : "";
  return `${topic}${angle}`.trim();
}

export class SearchAdapter implements Adapter {
  readonly id = "search";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["retrieval"],
    network: true,
    providerReportedUsage: false,
    credentialless: false,
    limitations: [
      "Requires SEARCH_PROVIDER + the matching API key (TAVILY/BRAVE/SERPAPI).",
      "Content comes from the provider's extract; raw page fetching is out of scope here.",
      "Token usage is not applicable to retrieval; usage.source is \"none\".",
    ],
  };

  isAvailable() {
    const p = configuredProvider();
    if (!p) {
      return {
        available: false,
        reason: "No search provider configured. Set SEARCH_PROVIDER + its API key.",
      };
    }
    if (!providerKey(p)) {
      return { available: false, reason: `SEARCH_PROVIDER=${p} but its API key is not set.` };
    }
    return { available: true };
  }

  supports(node: WorkflowNode): boolean {
    return node.provider.adapter === "search" && node.op === "retrieval";
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const avail = this.isAvailable();
    if (!avail.available) throw new AdapterError(avail.reason!, "NOT_CONFIGURED");

    const provider = configuredProvider()!;
    const { node, signal, workflowInputs } = ctx;
    const cfg = node.config as Record<string, any>;
    const query = resolveQuery(node, workflowInputs);
    if (!query) throw new AdapterError("Search query resolved to empty (no topic).", "BAD_INPUT");

    const maxResults = clampInt(
      cfg.maxResults ?? (workflowInputs as any).maxResults,
      DEFAULT_MAX_RESULTS,
      1,
      MAX_RESULTS_CAP,
    );
    const prefix = citePrefix(String(cfg.sourceId ?? node.id), node.id.slice(0, 2));

    const raw = await this.callProvider(provider, query, maxResults, signal);
    const retrievedAt = new Date().toISOString();
    const sources: SourceRecord[] = raw.slice(0, maxResults).map((r, i) => ({
      sourceId: makeSourceId(prefix, i),
      title: r.title || "(untitled)",
      url: r.url,
      publisher: r.publisher || hostnameOf(r.url),
      snippet: (r.snippet || "").slice(0, 600),
      content: r.content ? r.content.slice(0, MAX_CONTENT_CHARS) : undefined,
      retrievedAt,
      score: r.score,
      provenance: "live",
    }));

    const usage: Usage = { calls: 1, inputTokens: 0, outputTokens: 0, source: "none" };
    return {
      output: {
        type: "search-results",
        provider,
        query,
        retrievedAt,
        live: true,
        sources,
      },
      usage,
      provenance: "live",
      sources,
      meta: { provider },
    };
  }

  private async callProvider(
    provider: ProviderId,
    query: string,
    maxResults: number,
    signal: AbortSignal,
  ): Promise<NormalizedResult[]> {
    switch (provider) {
      case "tavily":
        return this.callTavily(query, maxResults, signal);
      case "brave":
        return this.callBrave(query, maxResults, signal);
      case "serpapi":
        return this.callSerpApi(query, maxResults, signal);
    }
  }

  private async doFetch(url: string, init: RequestInit, provider: ProviderId): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new AdapterError("cancelled", "CANCELLED");
      throw new AdapterError(`Search provider unreachable: ${(err as Error).message}`, "PROVIDER_UNREACHABLE");
    }
    if (res.status === 429) {
      throw new AdapterError(`${provider} rate limit (429). Retry later or lower concurrency.`, "RATE_LIMITED");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AdapterError(`${provider} returned ${res.status}: ${body.slice(0, 160)}`, "PROVIDER_ERROR");
    }
    return res.json();
  }

  private async callTavily(query: string, maxResults: number, signal: AbortSignal): Promise<NormalizedResult[]> {
    const base = providerBaseUrl("tavily");
    const data = await this.doFetch(
      `${base}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: providerKey("tavily"),
          query,
          max_results: maxResults,
          search_depth: "basic",
          include_raw_content: true,
        }),
        signal,
      },
      "tavily",
    );
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? "",
      content: r.raw_content ?? r.content ?? "",
      publisher: hostnameOf(r.url),
      score: typeof r.score === "number" ? r.score : undefined,
    }));
  }

  private async callBrave(query: string, maxResults: number, signal: AbortSignal): Promise<NormalizedResult[]> {
    const base = providerBaseUrl("brave");
    const url = `${base}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const data = await this.doFetch(
      url,
      {
        method: "GET",
        headers: { accept: "application/json", "X-Subscription-Token": providerKey("brave") },
        signal,
      },
      "brave",
    );
    const results = Array.isArray(data?.web?.results) ? data.web.results : [];
    return results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
      content: r.description ?? "",
      publisher: r.profile?.name ?? hostnameOf(r.url),
      score: undefined,
    }));
  }

  private async callSerpApi(query: string, maxResults: number, signal: AbortSignal): Promise<NormalizedResult[]> {
    const base = providerBaseUrl("serpapi");
    const url =
      `${base}/search.json?engine=google&num=${maxResults}` +
      `&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(providerKey("serpapi"))}`;
    const data = await this.doFetch(url, { method: "GET", headers: { accept: "application/json" }, signal }, "serpapi");
    const results = Array.isArray(data?.organic_results) ? data.organic_results : [];
    return results.map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? "",
      content: r.snippet ?? "",
      publisher: r.source ?? hostnameOf(r.link),
      score: undefined,
    }));
  }
}

interface NormalizedResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
  publisher: string;
  score?: number;
}

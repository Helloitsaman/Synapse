/**
 * OpenAI-compatible model adapter (opt-in).
 *
 * Configured ENTIRELY through server-side environment variables. The API key is
 * never sent to or exposed in the browser. When not configured (or the network
 * is unreachable) it reports itself unavailable and the app stays in demo mode.
 *
 * Captures provider-reported usage when the endpoint returns it.
 */
import type { Adapter, AdapterContext, AdapterResult } from "./contract.js";
import { ADAPTER_CONTRACT_VERSION, AdapterError } from "./contract.js";
import type { Usage, WorkflowNode } from "../types.js";

export class OpenAIAdapter implements Adapter {
  readonly id = "openai";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["llm"],
    network: true,
    providerReportedUsage: true,
    credentialless: false,
    limitations: [
      "Requires OPENAI_API_KEY (+ optional OPENAI_BASE_URL/OPENAI_MODEL).",
      "Only `llm` nodes are supported.",
      "Non-deterministic: not used for the deterministic demo comparison.",
    ],
  };

  private get apiKey() {
    return process.env.OPENAI_API_KEY ?? "";
  }
  private get baseUrl() {
    return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }
  private get defaultModel() {
    return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  }

  isAvailable() {
    if (!this.apiKey) {
      return { available: false, reason: "OPENAI_API_KEY is not set on the server." };
    }
    return { available: true };
  }

  supports(node: WorkflowNode): boolean {
    return node.provider.adapter === "openai" && node.op === "llm";
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const avail = this.isAvailable();
    if (!avail.available) throw new AdapterError(avail.reason!, "NOT_CONFIGURED");

    const { node, inputs, signal, workflowInputs } = ctx;
    const model = node.provider.model ?? this.defaultModel;
    const prompt = this.buildPrompt(node, inputs, workflowInputs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 400,
        }),
        signal,
      });
    } catch (err) {
      throw new AdapterError(
        `Provider request failed: ${(err as Error).message}`,
        "PROVIDER_UNREACHABLE",
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AdapterError(
        `Provider returned ${res.status}: ${body.slice(0, 200)}`,
        "PROVIDER_ERROR",
      );
    }

    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content ?? "";
    const usage: Usage = {
      calls: 1,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      source: data?.usage ? "provider-reported" : "none",
      model,
    };
    return { output: { type: "text", text, model }, usage };
  }

  private buildPrompt(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    workflowInputs: Record<string, unknown>,
  ): string {
    const topic = String(workflowInputs.topic ?? "");
    const context = Object.entries(inputs)
      .map(([k, v]) => `- ${k}: ${JSON.stringify(v).slice(0, 500)}`)
      .join("\n");
    return `Task: ${node.label}\nTopic: ${topic}\nContext:\n${context}\n\nRespond concisely.`;
  }
}

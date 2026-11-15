/**
 * OpenAI-compatible model adapter (opt-in).
 *
 * Configured ENTIRELY through server-side environment variables. The API key is
 * never sent to or exposed in the browser. When not configured it reports itself
 * unavailable; SYNAPSE never silently falls back to demo output for a node that
 * requested this provider.
 *
 * Captures provider-reported usage when the endpoint returns it, and labels it
 * "unavailable" (never invented) otherwise.
 */
import type { Adapter, AdapterContext, AdapterResult } from "./contract.js";
import { ADAPTER_CONTRACT_VERSION, AdapterError } from "./contract.js";
import type { WorkflowNode } from "../types.js";
import {
  MAX_OUTPUT_TOKENS,
  assembleOutput,
  buildPrompt,
  providerFetch,
  usageFrom,
} from "./modelBase.js";

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
      "Non-deterministic: excluded from the deterministic demo comparison.",
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
    const { system, user } = buildPrompt(node, inputs, workflowInputs);

    const data = await providerFetch(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal,
      },
      "OpenAI",
    );

    const choice = data?.choices?.[0];
    const text = choice?.message?.content ?? "";
    const usage = usageFrom(model, data?.usage?.prompt_tokens, data?.usage?.completion_tokens);
    const { output, sources } = assembleOutput(node, text, inputs, workflowInputs);

    return {
      output,
      usage,
      provenance: "live",
      sources,
      meta: {
        provider: "openai",
        model,
        requestId: typeof data?.id === "string" ? data.id : undefined,
        finishReason: choice?.finish_reason,
      },
    };
  }
}

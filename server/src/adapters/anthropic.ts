/**
 * Anthropic (Claude) model adapter (opt-in).
 *
 * Calls the Anthropic Messages API. Configured via server-side env only; the key
 * is never exposed to the browser. Captures provider-reported usage, or labels
 * it unavailable. A Claude Code MCP connection does NOT grant this adapter access
 * to the host's Claude subscription — it requires its own ANTHROPIC_API_KEY.
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

const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicAdapter implements Adapter {
  readonly id = "anthropic";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["llm"],
    network: true,
    providerReportedUsage: true,
    credentialless: false,
    limitations: [
      "Requires ANTHROPIC_API_KEY (+ optional ANTHROPIC_BASE_URL/ANTHROPIC_MODEL).",
      "Only `llm` nodes are supported.",
      "An MCP connection to a Claude host does NOT supply these credentials.",
    ],
  };

  private get apiKey() {
    return process.env.ANTHROPIC_API_KEY ?? "";
  }
  private get baseUrl() {
    return (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  }
  private get defaultModel() {
    return process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
  }

  isAvailable() {
    if (!this.apiKey) return { available: false, reason: "ANTHROPIC_API_KEY is not set on the server." };
    return { available: true };
  }

  supports(node: WorkflowNode): boolean {
    return node.provider.adapter === "anthropic" && node.op === "llm";
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const avail = this.isAvailable();
    if (!avail.available) throw new AdapterError(avail.reason!, "NOT_CONFIGURED");

    const { node, inputs, signal, workflowInputs } = ctx;
    const model = node.provider.model ?? this.defaultModel;
    const { system, user } = buildPrompt(node, inputs, workflowInputs);

    const data = await providerFetch(
      `${this.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal,
      },
      "Anthropic",
    );

    const text = Array.isArray(data?.content)
      ? data.content
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text)
          .join("")
      : "";
    const usage = usageFrom(model, data?.usage?.input_tokens, data?.usage?.output_tokens);
    const { output, sources } = assembleOutput(node, text, inputs, workflowInputs);

    return {
      output,
      usage,
      provenance: "live",
      sources,
      meta: {
        provider: "anthropic",
        model,
        requestId: typeof data?.id === "string" ? data.id : undefined,
        finishReason: data?.stop_reason,
      },
    };
  }
}

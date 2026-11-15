/**
 * Google Gemini model adapter (opt-in).
 *
 * Calls the Generative Language API (generateContent). Configured via server-side
 * env only. Captures provider-reported usage (usageMetadata) or labels it
 * unavailable.
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

export class GeminiAdapter implements Adapter {
  readonly id = "gemini";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["llm"],
    network: true,
    providerReportedUsage: true,
    credentialless: false,
    limitations: [
      "Requires GEMINI_API_KEY (or GOOGLE_API_KEY) (+ optional GEMINI_BASE_URL/GEMINI_MODEL).",
      "Only `llm` nodes are supported.",
    ],
  };

  private get apiKey() {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
  }
  private get baseUrl() {
    return (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }
  private get defaultModel() {
    return process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  }

  isAvailable() {
    if (!this.apiKey) return { available: false, reason: "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set." };
    return { available: true };
  }

  supports(node: WorkflowNode): boolean {
    return node.provider.adapter === "gemini" && node.op === "llm";
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const avail = this.isAvailable();
    if (!avail.available) throw new AdapterError(avail.reason!, "NOT_CONFIGURED");

    const { node, inputs, signal, workflowInputs } = ctx;
    const model = node.provider.model ?? this.defaultModel;
    const { system, user } = buildPrompt(node, inputs, workflowInputs);

    // API key goes in the header (x-goog-api-key), never in the logged URL.
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const data = await providerFetch(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
        }),
        signal,
      },
      "Gemini",
    );

    const candidate = data?.candidates?.[0];
    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts.map((p: any) => p?.text ?? "").join("")
      : "";
    const usage = usageFrom(
      model,
      data?.usageMetadata?.promptTokenCount,
      data?.usageMetadata?.candidatesTokenCount,
    );
    const { output, sources } = assembleOutput(node, text, inputs, workflowInputs);

    return {
      output,
      usage,
      provenance: "live",
      sources,
      meta: { provider: "gemini", model, finishReason: candidate?.finishReason },
    };
  }
}

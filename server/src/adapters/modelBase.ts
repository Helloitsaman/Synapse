/**
 * Shared building blocks for live model adapters (OpenAI, Anthropic, Gemini).
 *
 * All three turn a workflow `llm` node + its resolved inputs into a grounded,
 * source-citing prompt, call their provider, capture provider-reported usage (or
 * mark it unavailable — never invented), and assemble the SAME structured output
 * shape the demo path uses, so downstream nodes and correctness checks are
 * provider-agnostic.
 */
import { AdapterError } from "./contract.js";
import type { SourceRecord, Usage } from "../types.js";
import type { WorkflowNode } from "../types.js";
import {
  buildSummaryOutput,
  buildSynthesisOutput,
  collectSources,
  renderSourcesForPrompt,
} from "./research.js";

export const MAX_OUTPUT_TOKENS = 600;

export function sectionOf(node: WorkflowNode): string {
  const cfg = node.config as Record<string, any>;
  return String(cfg.section ?? "generic");
}

export function topicOf(workflowInputs: Record<string, unknown>, node: WorkflowNode): string {
  const cfg = node.config as Record<string, any>;
  return String(workflowInputs.topic ?? cfg.topic ?? "the topic");
}

export interface Prompt {
  system: string;
  user: string;
}

/** Build a grounded, citation-instructed prompt for a research llm node. */
export function buildPrompt(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  workflowInputs: Record<string, unknown>,
): Prompt {
  const section = sectionOf(node);
  const topic = topicOf(workflowInputs, node);

  const system =
    "You are a careful research analyst. Use ONLY the provided sources. " +
    "Ground every factual claim in a source and cite it inline using its " +
    "bracketed id exactly as given, e.g. [a1]. Never cite an id that is not " +
    "listed. If the sources are insufficient, say so plainly. Be concise.";

  if (section === "synthesis") {
    const summaries = Object.values(inputs)
      .filter((v: any) => v?.type === "summary")
      .map((v: any) => `### Section ${v.section}\n${v.text}`)
      .join("\n\n");
    const sources = renderSourcesForPrompt(collectSources(inputs));
    return {
      system,
      user:
        `Topic: ${topic}\n\nWrite a cohesive synthesis (4-6 sentences) combining the ` +
        `section summaries below. Preserve and reuse the inline bracketed source-id ` +
        `citations that already appear in the summaries; do not introduce any id that ` +
        `is not listed under Sources.\n\n` +
        `Section summaries:\n${summaries}\n\nSources:\n${sources}`,
    };
  }

  // Summary of one retrieval branch (section A/B) or a generic answer.
  const sources = renderSourcesForPrompt(collectSources(inputs));
  const label = section === "A" || section === "B" ? `Source set ${section}` : node.label;
  return {
    system,
    user:
      `Topic: ${topic}\n\nSummarize what ${label} says about the topic in 3-5 sentences. ` +
      `Cite each claim inline with the bracketed source id.\n\nSources:\n${sources}`,
  };
}

/** Assemble the structured output (shared with the demo path). */
export function assembleOutput(
  node: WorkflowNode,
  text: string,
  inputs: Record<string, unknown>,
  workflowInputs: Record<string, unknown>,
): { output: unknown; sources: SourceRecord[] } {
  const section = sectionOf(node);
  if (section === "synthesis") {
    const out = buildSynthesisOutput(topicOf(workflowInputs, node), text, inputs);
    return { output: out, sources: out.sources };
  }
  if (section === "A" || section === "B") {
    const branch = collectSources(inputs);
    const out = buildSummaryOutput(section, text, branch);
    return { output: out, sources: out.sources };
  }
  const sources = collectSources(inputs);
  return { output: { type: "text", section, text, sources }, sources };
}

/** Usage from reported input/output token counts, or "unavailable" if absent. */
export function usageFrom(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): Usage {
  const has = typeof inputTokens === "number" || typeof outputTokens === "number";
  return {
    calls: 1,
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    source: has ? "provider-reported" : "unavailable",
    model,
  };
}

/** Map a provider fetch failure to a clean AdapterError (never leaks secrets). */
export async function providerFetch(
  url: string,
  init: RequestInit,
  provider: string,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new AdapterError("cancelled", "CANCELLED");
    throw new AdapterError(`${provider} request failed: ${(err as Error).message}`, "PROVIDER_UNREACHABLE");
  }
  if (res.status === 429) {
    throw new AdapterError(`${provider} rate limit (429). Retry later or lower concurrency.`, "RATE_LIMITED");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdapterError(`${provider} returned ${res.status}: ${body.slice(0, 200)}`, "PROVIDER_ERROR");
  }
  return res.json();
}

/**
 * Cost ESTIMATION. These are calculated figures from a demo price table, not a
 * charge from any provider. Always surfaced to the UI labelled "estimated".
 */
import type { Usage } from "../types.js";

/**
 * Prices in USD per 1K tokens. The synapse-sim-* rows are illustrative demo
 * prices. The real-provider rows are a LOCAL, hand-maintained estimate table and
 * may be stale — providers do not return a dollar charge, so any cost figure
 * SYNAPSE shows is always labelled "estimated", never "provider-reported".
 */
export const DEMO_PRICES: Record<string, { in: number; out: number }> = {
  "synapse-sim-mini": { in: 0.00015, out: 0.0006 },
  "synapse-sim-pro": { in: 0.0025, out: 0.01 },
  // Approximate public list prices (subject to change; verify with the provider).
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "claude-3-5-haiku-latest": { in: 0.0008, out: 0.004 },
  "claude-3-5-haiku-20241022": { in: 0.0008, out: 0.004 },
  "gemini-2.0-flash": { in: 0.0001, out: 0.0004 },
  "gemini-1.5-flash": { in: 0.000075, out: 0.0003 },
  default: { in: 0.0005, out: 0.0015 },
};

/**
 * Returns an ESTIMATED cost, or null when it cannot be estimated (a real
 * provider ran but reported no usage — we never invent tokens or cost).
 */
export function estimateCostUsd(usage: Usage, model?: string): number {
  if (usage.source === "unavailable" || usage.source === "none") return 0;
  const price = DEMO_PRICES[model ?? usage.model ?? "default"] ?? DEMO_PRICES.default;
  const cost = (usage.inputTokens / 1000) * price.in + (usage.outputTokens / 1000) * price.out;
  return Math.round(cost * 1e6) / 1e6;
}

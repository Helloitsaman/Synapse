/**
 * Cost ESTIMATION. These are calculated figures from a demo price table, not a
 * charge from any provider. Always surfaced to the UI labelled "estimated".
 */
import type { Usage } from "../types.js";

/** Illustrative demo prices in USD per 1K tokens. NOT real provider prices. */
export const DEMO_PRICES: Record<string, { in: number; out: number }> = {
  "synapse-sim-mini": { in: 0.00015, out: 0.0006 },
  "synapse-sim-pro": { in: 0.0025, out: 0.01 },
  default: { in: 0.0005, out: 0.0015 },
};

export function estimateCostUsd(usage: Usage, model?: string): number {
  const price = DEMO_PRICES[model ?? usage.model ?? "default"] ?? DEMO_PRICES.default;
  const cost = (usage.inputTokens / 1000) * price.in + (usage.outputTokens / 1000) * price.out;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Cost ESTIMATION. These are calculated figures from a local price table, not a
 * charge from any provider. Always surfaced labelled "estimated", and UNKNOWN
 * cost is represented as `null` — never rendered as a $0 charge.
 */
import type { CostEstimate, Usage } from "../types.js";

/** Version + date of the local price table (shown for auditability). */
export const PRICING_VERSION = "synapse-local-pricetable@2026-11-15";

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
 * Returns a labelled cost estimate. `usd` is null (label "unavailable") when the
 * cost cannot be estimated — a real provider ran but reported no usage (we never
 * invent tokens or cost), or there was no model/token work at all. A simulated
 * run still gets an estimate (clearly labelled), because its token counts are
 * known demo values.
 */
export function estimateCost(usage: Usage, model?: string): CostEstimate {
  const resolvedModel = model ?? usage.model;
  // Unknown: a real provider ran but gave no usage. Unknown ≠ free.
  if (usage.source === "unavailable") {
    return { usd: null, label: "unavailable", pricingSource: PRICING_VERSION, modelMatched: false, model: resolvedModel };
  }
  // No token-bearing work (retrieval/transform only) → genuinely $0, not unknown.
  if (usage.source === "none") {
    return { usd: 0, label: "estimated", pricingSource: PRICING_VERSION, modelMatched: false, model: resolvedModel };
  }
  const key = resolvedModel ?? "default";
  const modelMatched = Object.prototype.hasOwnProperty.call(DEMO_PRICES, key);
  const price = DEMO_PRICES[key] ?? DEMO_PRICES.default;
  const cost = (usage.inputTokens / 1000) * price.in + (usage.outputTokens / 1000) * price.out;
  return {
    usd: Math.round(cost * 1e6) / 1e6,
    label: "estimated",
    pricingSource: PRICING_VERSION,
    modelMatched,
    model: resolvedModel,
  };
}

/** Back-compat numeric helper: estimated USD, or null when unknown. */
export function estimateCostUsd(usage: Usage, model?: string): number | null {
  return estimateCost(usage, model).usd;
}

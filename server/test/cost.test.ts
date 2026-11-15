/** Cost estimation: unknown usage must read as UNKNOWN (null), never free $0. */
import { describe, it, expect } from "vitest";
import { estimateCost, PRICING_VERSION } from "../src/runtime/cost.js";
import type { Usage } from "../src/types.js";

const usage = (source: Usage["source"], inp = 0, out = 0, model?: string): Usage => ({
  calls: 1, inputTokens: inp, outputTokens: out, source, model,
});

describe("cost estimation", () => {
  it("returns null (unavailable) when a provider ran but reported no usage", () => {
    const c = estimateCost(usage("unavailable", 0, 0, "gpt-4o-mini"));
    expect(c.usd).toBeNull();
    expect(c.label).toBe("unavailable");
  });

  it("estimates provider-reported usage and records pricing provenance", () => {
    const c = estimateCost(usage("provider-reported", 1000, 1000, "gpt-4o-mini"));
    expect(typeof c.usd).toBe("number");
    expect(c.usd).toBeGreaterThan(0);
    expect(c.label).toBe("estimated");
    expect(c.modelMatched).toBe(true);
    expect(c.pricingSource).toBe(PRICING_VERSION);
  });

  it("falls back to a default rate for an unknown model and flags it unmatched", () => {
    const c = estimateCost(usage("provider-reported", 1000, 0, "some-unlisted-model"));
    expect(c.modelMatched).toBe(false);
    expect(c.usd).toBeGreaterThan(0);
  });

  it("treats a no-token-work run (retrieval/transform only) as a real $0 estimate", () => {
    const c = estimateCost(usage("none"));
    expect(c.usd).toBe(0);
    expect(c.label).toBe("estimated");
  });
});

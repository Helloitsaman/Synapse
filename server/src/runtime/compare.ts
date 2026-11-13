/** Builds a labelled comparison between a baseline and an optimized run. */
import type { LabeledValue, RunComparison, RunRecord } from "../types.js";

const measured = (value: number, unit: string): LabeledValue => ({
  value,
  unit,
  label: "measured",
});
const estimated = (value: number, unit: string): LabeledValue => ({
  value,
  unit,
  label: "estimated",
});

function usageLabel(r: RunRecord): LabeledValue["label"] {
  return r.usage.source === "provider-reported" ? "provider-reported" : "simulated";
}

export function compareRuns(baseline: RunRecord, optimized: RunRecord): RunComparison {
  const speedup =
    optimized.totalMs > 0 ? baseline.totalMs / optimized.totalMs : 1;
  const sampleCount = 1; // one run each — explicitly surfaced to avoid implying significance

  return {
    baseline,
    optimized,
    sampleCount,
    metrics: {
      baselineTotalMs: measured(baseline.totalMs, "ms"),
      optimizedTotalMs: measured(optimized.totalMs, "ms"),
      speedup: { value: Math.round(speedup * 100) / 100, unit: "x", label: "measured" },
      deltaMs: measured(baseline.totalMs - optimized.totalMs, "ms"),
      baselineOverheadMs: measured(baseline.overheadMs, "ms"),
      optimizedOverheadMs: measured(optimized.overheadMs, "ms"),
      baselineCalls: {
        value: baseline.usage.calls,
        unit: "calls",
        label: usageLabel(baseline),
      },
      optimizedCalls: {
        value: optimized.usage.calls,
        unit: "calls",
        label: usageLabel(optimized),
      },
      baselineTokens: {
        value: baseline.usage.inputTokens + baseline.usage.outputTokens,
        unit: "tokens",
        label: usageLabel(baseline),
      },
      optimizedTokens: {
        value: optimized.usage.inputTokens + optimized.usage.outputTokens,
        unit: "tokens",
        label: usageLabel(optimized),
      },
      baselineCostUsd: estimated(baseline.estimatedCostUsd, "usd"),
      optimizedCostUsd: estimated(optimized.estimatedCostUsd, "usd"),
    },
    note:
      sampleCount < 2
        ? "Based on a single run per mode. Timings vary run-to-run; this is not a statistically significant benchmark."
        : "",
  };
}

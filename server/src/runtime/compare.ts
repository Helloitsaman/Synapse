/** Builds a labelled, comparability-aware comparison between two runs. */
import type {
  AnswerComparison,
  ComparabilityReport,
  LabeledValue,
  RunComparison,
  RunRecord,
} from "../types.js";

const measured = (value: number, unit: string): LabeledValue => ({ value, unit, label: "measured" });

function usageLabel(r: RunRecord): LabeledValue["label"] {
  switch (r.usage.source) {
    case "provider-reported":
      return "provider-reported";
    case "simulated":
      return "simulated";
    case "unavailable":
      return "unavailable";
    default:
      return "none";
  }
}

/** Cost as a labelled value; unknown cost is surfaced as "unavailable", not $0. */
function costValue(r: RunRecord): LabeledValue {
  if (r.cost?.usd == null) return { value: 0, unit: "usd", label: "unavailable" };
  return { value: r.cost.usd, unit: "usd", label: "estimated" };
}

/** Derive whether two runs are comparable from their fingerprints. */
export function assessComparability(a: RunRecord, b: RunRecord): ComparabilityReport {
  const fa = a.fingerprint;
  const fb = b.fingerprint;
  const mismatches: string[] = [];

  if (!fa || !fb) {
    // One run predates fingerprinting — fall back to the coarse signals we have.
    const sameWorkflow = a.workflowId === b.workflowId;
    const sameWorkflowVersion = a.workflowVersion === b.workflowVersion;
    if (!sameWorkflow) mismatches.push(`workflow (${a.workflowId} vs ${b.workflowId})`);
    if (!sameWorkflowVersion) mismatches.push(`workflow version (${a.workflowVersion} vs ${b.workflowVersion})`);
    mismatches.push("input/config fingerprint unavailable for one run");
    return {
      comparable: false,
      sameWorkflow,
      sameWorkflowVersion,
      sameInputs: false,
      sameConfig: false,
      mismatches,
      fingerprintMissing: true,
    };
  }

  const sameWorkflow = fa.workflowId === fb.workflowId;
  const sameWorkflowVersion = fa.workflowVersion === fb.workflowVersion;
  const sameInputs = fa.inputsHash === fb.inputsHash;
  const sameConfig = fa.configHash === fb.configHash;

  if (!sameWorkflow) mismatches.push(`workflow (${fa.workflowId} vs ${fb.workflowId})`);
  if (!sameWorkflowVersion) mismatches.push(`workflow version (${fa.workflowVersion} vs ${fb.workflowVersion})`);
  if (!sameInputs) mismatches.push("normalized inputs differ");
  if (!sameConfig) mismatches.push("adapter/model/config differ");
  if (fa.models.join("|") !== fb.models.join("|")) mismatches.push("declared models differ");

  // A legitimately matched pair differs only in mode/concurrency (the thing being
  // compared). Everything else must match for the comparison to be meaningful.
  const comparable = sameWorkflow && sameWorkflowVersion && sameInputs && sameConfig;
  return {
    comparable,
    sameWorkflow,
    sameWorkflowVersion,
    sameInputs,
    sameConfig,
    mismatches,
    fingerprintMissing: false,
  };
}

const WORD_RE = /[a-z0-9]{3,}/gi;
function wordSet(text: string): Set<string> {
  const s = new Set<string>();
  for (const m of String(text ?? "").toLowerCase().matchAll(WORD_RE)) s.add(m[0]);
  return s;
}

/** Heuristic (ESTIMATE) answer comparison — lexical overlap + cited-source sets. */
function compareAnswers(a: RunRecord, b: RunRecord): AnswerComparison | undefined {
  const ra = a.result;
  const rb = b.result;
  if (!ra || !rb) return undefined;
  const wa = wordSet(ra.answer);
  const wb = wordSet(rb.answer);
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  const similarity = union === 0 ? 1 : Math.round((inter / union) * 1000) / 1000;

  const ca = [...new Set(ra.citations.map((c) => c.sourceId))].sort();
  const cb = [...new Set(rb.citations.map((c) => c.sourceId))].sort();
  const sameCitedSources = ca.length === cb.length && ca.every((id, i) => id === cb[i]);

  return {
    baselineProvenance: ra.provenance,
    optimizedProvenance: rb.provenance,
    baselineCitations: ca,
    optimizedCitations: cb,
    similarity,
    sameCitedSources,
    label: "estimate",
    note:
      "Lexical similarity is a heuristic ESTIMATE, not a judgment of factual " +
      "equivalence. It does not verify that claims are true or that a cited " +
      "source supports a claim; a human (or an opt-in LLM judge) must review that.",
  };
}

export function compareRuns(baseline: RunRecord, optimized: RunRecord): RunComparison {
  const speedup = optimized.totalMs > 0 ? baseline.totalMs / optimized.totalMs : 1;
  const sampleCount = 1; // one run each — explicitly surfaced to avoid implying significance
  const comparability = assessComparability(baseline, optimized);
  const validationMatch = (baseline.validation?.passed ?? null) === (optimized.validation?.passed ?? null);
  const answer = compareAnswers(baseline, optimized);

  const baseNote =
    "Baseline here = sequential (concurrency 1) execution of the SAME SYNAPSE " +
    "graph, NOT a user's normal Claude chat prompt. It measures graph scheduling, " +
    "not host-native prompting.";
  const sampleNote =
    "Based on a single run per mode. Timings vary run-to-run; this is not a " +
    "statistically significant benchmark — use the paired benchmark for repeated runs.";
  const mismatchNote = comparability.comparable
    ? ""
    : ` ⚠ These runs are NOT a matched pair (${comparability.mismatches.join("; ")}); treat any delta as apples-to-oranges.`;

  return {
    baseline,
    optimized,
    sampleCount,
    comparability,
    validationMatch,
    answer,
    metrics: {
      baselineTotalMs: measured(baseline.totalMs, "ms"),
      optimizedTotalMs: measured(optimized.totalMs, "ms"),
      speedup: { value: Math.round(speedup * 100) / 100, unit: "x", label: "measured" },
      deltaMs: measured(baseline.totalMs - optimized.totalMs, "ms"),
      baselineOverheadMs: measured(baseline.overheadMs, "ms"),
      optimizedOverheadMs: measured(optimized.overheadMs, "ms"),
      baselineCalls: { value: baseline.usage.calls, unit: "calls", label: usageLabel(baseline) },
      optimizedCalls: { value: optimized.usage.calls, unit: "calls", label: usageLabel(optimized) },
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
      baselineCostUsd: costValue(baseline),
      optimizedCostUsd: costValue(optimized),
    },
    note: `${sampleNote} ${baseNote}${mismatchNote}`,
  };
}

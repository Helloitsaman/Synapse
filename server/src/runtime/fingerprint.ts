/**
 * Privacy-safe run fingerprints.
 *
 * A fingerprint captures everything that determines whether two runs are
 * comparable — workflow version, normalized inputs, and per-node adapter/model/
 * config — as NON-REVERSIBLE hashes (sha256-derived). The raw inputs and config
 * are never stored in the fingerprint, so persisting it leaks nothing sensitive,
 * yet two runs can be checked for a matched configuration before comparison.
 */
import type { IR, RunFingerprint, RunMode, Workflow } from "../types.js";
import { contentHash, stableStringify } from "../util/hash.js";

/** Normalize workflow inputs so cosmetic differences don't break matching. */
function normalizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(inputs).sort()) {
    const v = inputs[key];
    out[key] = typeof v === "string" ? v.trim().toLowerCase() : v;
  }
  return out;
}

export function computeFingerprint(
  wf: Workflow,
  ir: IR,
  inputs: Record<string, unknown>,
  mode: RunMode,
  concurrency: number,
): RunFingerprint {
  const adapters = [...new Set(wf.nodes.map((n) => n.provider.adapter))].sort();
  const models = [
    ...new Set(
      wf.nodes
        .filter((n) => n.op === "llm")
        .map((n) => `${n.provider.adapter}:${n.provider.model ?? "default"}`),
    ),
  ].sort();

  // Per-node adapter + model + canonical config (hashed, one-way).
  const configShape = wf.nodes
    .map((n) => ({ id: n.id, adapter: n.provider.adapter, model: n.provider.model ?? null, config: n.config }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    workflowId: wf.id,
    workflowVersion: wf.version,
    irVersion: ir.irVersion,
    inputsHash: contentHash(normalizeInputs(inputs)),
    configHash: contentHash(stableStringify(configShape)),
    adapters,
    models,
    mode,
    concurrency,
  };
}

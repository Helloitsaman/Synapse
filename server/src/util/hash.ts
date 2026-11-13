import { createHash } from "node:crypto";

/** Stable short content hash (hex, 12 chars) of any JSON-serializable value. */
export function contentHash(value: unknown): string {
  const json = stableStringify(value);
  return createHash("sha256").update(json).digest("hex").slice(0, 12);
}

/** Deterministic JSON stringify with sorted object keys (for canonicalization). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

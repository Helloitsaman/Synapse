/**
 * Extracts the delivered answer (final document + citations + sources) from a
 * run's ephemeral terminal outputs. This RunResult is the product of the run and
 * is persisted with the run record; intermediate prompts/outputs are not.
 *
 * Privacy: by default the persisted result keeps only CITATION METADATA for each
 * source (id, title, url, publisher, retrievedAt, score, provenance) and drops
 * the provider-extracted page `content` AND the retrieved `snippet` — so
 * persisted data does not silently exceed what the privacy summary promises. Set
 * SYNAPSE_PERSIST_SOURCE_CONTENT=1 to retain both (then say so in your retention
 * policy). The inline answer text itself is always kept — it is the product the
 * user asked for, and already contains the grounded prose.
 */
import type { Citation, IR, RunResult, SourceRecord } from "../types.js";

function leafIds(ir: IR): string[] {
  return Object.entries(ir.dependents)
    .filter(([, deps]) => deps.length === 0)
    .map(([id]) => id);
}

/** Whether to persist provider-extracted page content (default: no). */
export function persistSourceContent(): boolean {
  const v = (process.env.SYNAPSE_PERSIST_SOURCE_CONTENT ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Keep citation metadata; drop retrieved content/snippet unless retained. */
function sanitizeSource(s: SourceRecord): SourceRecord {
  if (persistSourceContent()) return s;
  const { content: _content, snippet: _snippet, ...rest } = s;
  void _content;
  void _snippet;
  // Keep the shape stable (snippet is required on the type) with an empty value.
  return { ...rest, snippet: "" };
}

/** Deep-sanitize any `sources` arrays inside the formatted document, too. */
function sanitizeDocument(doc: unknown): unknown {
  if (persistSourceContent() || !doc || typeof doc !== "object") return doc;
  const d = doc as Record<string, unknown>;
  if (Array.isArray(d.sources)) {
    return { ...d, sources: (d.sources as SourceRecord[]).map(sanitizeSource) };
  }
  return doc;
}

export function extractResult(ir: IR, outputs: Map<string, unknown>): RunResult | undefined {
  const leaves = leafIds(ir).map((id) => outputs.get(id));

  const doc = leaves.find((o: any) => o?.type === "document" && o.answer) as any;
  if (doc) {
    return {
      answer: String(doc.answer),
      title: doc.title,
      document: sanitizeDocument(doc),
      citations: (doc.citations ?? []) as Citation[],
      sources: ((doc.sources ?? []) as SourceRecord[]).map(sanitizeSource),
      provenance: doc.provenance ?? "demo",
    };
  }

  // Fallback: any leaf carrying text/answer and (optionally) sources.
  const textual = leaves.find((o: any) => o?.text || o?.answer) as any;
  if (textual) {
    const sources = (textual.sources ?? []) as SourceRecord[];
    return {
      answer: String(textual.answer ?? textual.text),
      document: sanitizeDocument(textual),
      citations: sources.map((s) => ({
        sourceId: s.sourceId,
        title: s.title,
        url: s.url,
        publisher: s.publisher,
      })),
      sources: sources.map(sanitizeSource),
      provenance: textual.provenance ?? (sources.some((s) => s.provenance === "live") ? "live" : "demo"),
    };
  }
  return undefined;
}

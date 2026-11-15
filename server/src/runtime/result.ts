/**
 * Extracts the delivered answer (final document + citations + sources) from a
 * run's ephemeral terminal outputs. This RunResult is the product of the run and
 * is persisted with the run record; intermediate prompts/outputs are not.
 */
import type { Citation, IR, RunResult, SourceRecord } from "../types.js";

function leafIds(ir: IR): string[] {
  return Object.entries(ir.dependents)
    .filter(([, deps]) => deps.length === 0)
    .map(([id]) => id);
}

export function extractResult(ir: IR, outputs: Map<string, unknown>): RunResult | undefined {
  const leaves = leafIds(ir).map((id) => outputs.get(id));

  const doc = leaves.find((o: any) => o?.type === "document" && o.answer) as any;
  if (doc) {
    return {
      answer: String(doc.answer),
      title: doc.title,
      document: doc,
      citations: (doc.citations ?? []) as Citation[],
      sources: (doc.sources ?? []) as SourceRecord[],
      provenance: doc.provenance ?? "demo",
    };
  }

  // Fallback: any leaf carrying text/answer and (optionally) sources.
  const textual = leaves.find((o: any) => o?.text || o?.answer) as any;
  if (textual) {
    const sources = (textual.sources ?? []) as SourceRecord[];
    return {
      answer: String(textual.answer ?? textual.text),
      document: textual,
      citations: sources.map((s) => ({
        sourceId: s.sourceId,
        title: s.title,
        url: s.url,
        publisher: s.publisher,
      })),
      sources,
      provenance: textual.provenance ?? (sources.some((s) => s.provenance === "live") ? "live" : "demo"),
    };
  }
  return undefined;
}

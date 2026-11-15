/**
 * Shared source-grounding helpers for research workflows.
 *
 * These functions define the ONE data shape that flows through a research
 * workflow — retrieval → summary → synthesis → formatted document — so the demo
 * path and the live path (real search + real model) are structurally identical.
 * Only the provenance labels and the free text differ. Correctness checks and
 * the UI therefore work the same way in both modes.
 *
 * Citation markers are the source ids themselves, wrapped in brackets, e.g.
 * `[a1]`. `extractCitations` recovers them from model prose and separates valid
 * citations (resolve to a retrieved source) from unknown ones (hallucinated or
 * mis-typed), which the correctness layer flags.
 */
import type { Citation, Provenance, SourceRecord } from "../types.js";

export const DEFAULT_MAX_RESULTS = 4;

/** Normalize a human label into a short citation prefix (e.g. "SRC-A" → "a"). */
export function citePrefix(raw: string, fallback: string): string {
  const cleaned = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const letters = cleaned.replace(/[0-9]/g, "");
  return (letters || cleaned || fallback).slice(0, 6) || fallback;
}

/** Build a stable, workflow-unique source id. */
export function makeSourceId(prefix: string, index: number): string {
  return `${prefix}${index + 1}`;
}

/** Collect every SourceRecord carried by the given upstream inputs. */
export function collectSources(inputs: Record<string, unknown>): SourceRecord[] {
  const out: SourceRecord[] = [];
  for (const v of Object.values(inputs)) {
    const srcs = (v as any)?.sources;
    if (Array.isArray(srcs)) {
      for (const s of srcs) if (s && typeof s.sourceId === "string") out.push(s as SourceRecord);
    }
  }
  return dedupeSources(out);
}

/** De-duplicate by sourceId, keeping first occurrence (stable order). */
export function dedupeSources(list: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>();
  const out: SourceRecord[] = [];
  for (const s of list) {
    if (seen.has(s.sourceId)) continue;
    seen.add(s.sourceId);
    out.push(s);
  }
  return out;
}

/** Render sources as a compact, promptable context block with [id] markers. */
export function renderSourcesForPrompt(sources: SourceRecord[]): string {
  if (sources.length === 0) return "(no sources were retrieved)";
  return sources
    .map((s) => {
      const body = (s.content && s.content.length > s.snippet.length ? s.content : s.snippet) || "";
      return `[${s.sourceId}] ${s.title} — ${s.publisher} (${s.url})\n${body.slice(0, 1200)}`;
    })
    .join("\n\n");
}

const MARKER_RE = /\[([A-Za-z][A-Za-z0-9]{0,11})\]/g;

/**
 * Recover citation markers from prose. Returns the valid cited ids (resolve to a
 * retrieved source) and any unknown markers (do NOT resolve) for honest flagging.
 */
export function extractCitations(
  text: string,
  sources: SourceRecord[],
): { citedSourceIds: string[]; unknownCitations: string[] } {
  const known = new Map(sources.map((s) => [s.sourceId.toLowerCase(), s.sourceId]));
  const cited: string[] = [];
  const unknown: string[] = [];
  const seenCited = new Set<string>();
  const seenUnknown = new Set<string>();
  for (const m of String(text ?? "").matchAll(MARKER_RE)) {
    const token = m[1].toLowerCase();
    const real = known.get(token);
    if (real) {
      if (!seenCited.has(real)) {
        seenCited.add(real);
        cited.push(real);
      }
    } else if (!seenUnknown.has(token)) {
      seenUnknown.add(token);
      unknown.push(m[1]);
    }
  }
  return { citedSourceIds: cited, unknownCitations: unknown };
}

export interface SummaryOutput {
  type: "summary";
  section: string;
  text: string;
  sources: SourceRecord[];
  citedSourceIds: string[];
  unknownCitations: string[];
}

/** Assemble a summary node's output (identical shape for demo and live). */
export function buildSummaryOutput(
  section: string,
  text: string,
  branchSources: SourceRecord[],
): SummaryOutput {
  const { citedSourceIds, unknownCitations } = extractCitations(text, branchSources);
  return {
    type: "summary",
    section,
    text,
    sources: dedupeSources(branchSources),
    citedSourceIds,
    unknownCitations,
  };
}

export interface BriefOutput {
  type: "brief";
  topic: string;
  text: string;
  sources: SourceRecord[];
  sections: Record<string, SummaryOutput>;
  citedSourceIds: string[];
  unknownCitations: string[];
}

/** Assemble a synthesis node's output from its upstream summaries + text. */
export function buildSynthesisOutput(
  topic: string,
  text: string,
  inputs: Record<string, unknown>,
): BriefOutput {
  const sections: Record<string, SummaryOutput> = {};
  const all: SourceRecord[] = [];
  for (const v of Object.values(inputs)) {
    const s = v as SummaryOutput;
    if (s?.type === "summary" && s.section) {
      sections[s.section] = s;
      all.push(...(s.sources ?? []));
    }
  }
  const sources = dedupeSources(all);
  const { citedSourceIds, unknownCitations } = extractCitations(text, sources);
  return { type: "brief", topic, text, sources, sections, citedSourceIds, unknownCitations };
}

export function toCitations(sources: SourceRecord[]): Citation[] {
  return sources.map((s) => ({
    sourceId: s.sourceId,
    title: s.title,
    url: s.url,
    publisher: s.publisher,
  }));
}

export interface ResearchDocument {
  type: "document";
  format: string;
  topic: string;
  title: string;
  provenance: Provenance;
  sources: SourceRecord[];
  citations: Citation[];
  unknownCitations: string[];
  sections: Array<{ heading: string; body: string; sourceIds: string[] }>;
  answer: string;
}

/**
 * Deterministic final assembly (runs on the demo adapter in BOTH modes, so
 * formatting is free and reproducible). Produces the citable document + a
 * readable markdown answer.
 */
export function buildDocument(brief: BriefOutput, format = "brief-v1"): ResearchDocument {
  const sources = dedupeSources(brief.sources ?? []);
  const provenance: Provenance = sources.some((s) => s.provenance === "live") ? "live" : "demo";

  const sa = brief.sections?.A;
  const sb = brief.sections?.B;
  const sections = [
    { heading: "Source A — Summary", body: sa?.text ?? "", sourceIds: sa?.citedSourceIds ?? [] },
    { heading: "Source B — Summary", body: sb?.text ?? "", sourceIds: sb?.citedSourceIds ?? [] },
    { heading: "Synthesis", body: brief.text ?? "", sourceIds: brief.citedSourceIds ?? [] },
  ];

  // Union of all cited ids across the document, in a stable order.
  const citedIds: string[] = [];
  const seen = new Set<string>();
  for (const s of sections)
    for (const id of s.sourceIds)
      if (!seen.has(id)) {
        seen.add(id);
        citedIds.push(id);
      }
  const citedSources = citedIds
    .map((id) => sources.find((s) => s.sourceId === id))
    .filter((s): s is SourceRecord => !!s);

  const unknown = Array.from(
    new Set([
      ...(sa?.unknownCitations ?? []),
      ...(sb?.unknownCitations ?? []),
      ...(brief.unknownCitations ?? []),
    ]),
  );

  const answer = renderAnswerMarkdown(brief.topic, sections, citedSources, sources);

  return {
    type: "document",
    format,
    topic: brief.topic,
    title: `Research Brief: ${brief.topic}`,
    provenance,
    sources,
    citations: toCitations(citedSources),
    unknownCitations: unknown,
    sections,
    answer,
  };
}

function renderAnswerMarkdown(
  topic: string,
  sections: Array<{ heading: string; body: string }>,
  citedSources: SourceRecord[],
  allSources: SourceRecord[],
): string {
  const lines: string[] = [`# Research Brief: ${topic}`, ""];
  for (const s of sections) {
    if (!s.body) continue;
    lines.push(`## ${s.heading}`, "", s.body, "");
  }
  const refList = citedSources.length ? citedSources : allSources;
  if (refList.length) {
    lines.push("## Sources", "");
    for (const s of refList) {
      lines.push(`- [${s.sourceId}] ${s.title} — ${s.publisher}. ${s.url}`);
    }
  }
  return lines.join("\n").trim();
}

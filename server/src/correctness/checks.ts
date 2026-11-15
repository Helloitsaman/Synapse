/**
 * Pluggable correctness tests.
 *
 * Structural checks (schema, required fields, graph invariants) are kept separate
 * from semantic checks (citation validity, grounding, relevance). A run with any
 * FAILED required check must not be reported as successful (enforced by the
 * orchestrator). LLM-judge/heuristic checks are category "estimate" and are never
 * treated as ground truth.
 */
import type { CheckResult, Citation, IR, SourceRecord, ValidationResult } from "../types.js";

export interface CorrectnessContext {
  workflowId: string;
  /** Map of terminal/leaf node id -> output. */
  outputs: Map<string, unknown>;
  ir: IR;
}

export type Checker = (ctx: CorrectnessContext) => CheckResult[];

/** Leaf nodes = nodes with no dependents (the workflow's outputs). */
export function leafOutputs(ctx: CorrectnessContext): unknown[] {
  const leaves = Object.entries(ctx.ir.dependents)
    .filter(([, deps]) => deps.length === 0)
    .map(([id]) => id);
  return leaves.map((id) => ctx.outputs.get(id)).filter((v) => v !== undefined);
}

/** Research document checker: structural shape + citation/grounding validity. */
const researchDocChecker: Checker = (ctx) => {
  const checks: CheckResult[] = [];
  const doc = leafOutputs(ctx).find((o: any) => o?.type === "document" && "sections" in o) as any;

  // --- Structural ---------------------------------------------------------
  checks.push({
    id: "output-schema",
    category: "structural",
    description: "Final output is a document with three sections and a non-empty answer",
    required: true,
    passed: !!doc && Array.isArray(doc.sections) && doc.sections.length === 3 && !!doc.answer,
    detail: doc ? `type=${doc.type}, sections=${doc.sections?.length}, answerLen=${doc.answer?.length ?? 0}` : "no document output",
  });

  const headings = (doc?.sections ?? []).map((s: any) => s.heading);
  const requiredHeadings = ["Source A — Summary", "Source B — Summary", "Synthesis"];
  checks.push({
    id: "required-sections",
    category: "structural",
    description: "Document contains the three required sections",
    required: true,
    passed: requiredHeadings.every((h) => headings.includes(h)),
    detail: `found: ${headings.join(" | ") || "none"}`,
  });

  const sources: SourceRecord[] = doc?.sources ?? [];
  const citations: Citation[] = doc?.citations ?? [];
  const unknown: string[] = doc?.unknownCitations ?? [];

  // --- Semantic / grounding ----------------------------------------------
  checks.push({
    id: "sources-retrieved",
    category: "semantic",
    description: "At least one source was retrieved and carried into the answer",
    required: true,
    passed: sources.length > 0,
    detail: `${sources.length} source(s): ${sources.map((s) => s.sourceId).join(", ") || "none"}`,
  });

  const sourceIds = new Set(sources.map((s) => s.sourceId));
  const danglingCitations = citations.filter((c) => !sourceIds.has(c.sourceId)).map((c) => c.sourceId);
  checks.push({
    id: "citations-resolve",
    category: "semantic",
    description: "Every cited source id resolves to a retrieved source (no dangling citations)",
    required: true,
    passed: danglingCitations.length === 0,
    detail: danglingCitations.length ? `dangling: ${danglingCitations.join(", ")}` : `${citations.length} citation(s) all resolve`,
  });

  checks.push({
    id: "no-hallucinated-citations",
    category: "semantic",
    description: "The model did not cite any source id that was not retrieved",
    required: true,
    passed: unknown.length === 0,
    detail: unknown.length ? `unknown markers: ${unknown.join(", ")}` : "none",
  });

  // Grounding coverage — flagged, not required (an honest weak-grounding signal).
  const synthesis = (doc?.sections ?? []).find((s: any) => s.heading === "Synthesis");
  checks.push({
    id: "synthesis-grounded",
    category: "semantic",
    description: "The synthesis cites at least one retrieved source",
    required: false,
    passed: Array.isArray(synthesis?.sourceIds) && synthesis.sourceIds.length > 0,
    detail: `synthesis cites: ${(synthesis?.sourceIds ?? []).join(", ") || "none"}`,
  });

  // Relevance heuristic — explicitly an estimate, never ground truth.
  const topic = String(doc?.topic ?? "");
  const topicTerms = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const answerLower = String(doc?.answer ?? "").toLowerCase();
  const mentioned = topicTerms.filter((t) => answerLower.includes(t)).length;
  checks.push({
    id: "topic-relevance-heuristic",
    category: "estimate",
    description: "Heuristic: the answer mentions the topic's key terms (not a factual judgment)",
    required: false,
    passed: topicTerms.length === 0 || mentioned > 0,
    detail: `${mentioned}/${topicTerms.length} topic term(s) present (heuristic estimate)`,
  });

  return checks;
};

/** Generic fallback: at least one leaf produced a non-null output. */
const genericChecker: Checker = (ctx) => {
  const leaves = leafOutputs(ctx);
  return [
    {
      id: "has-output",
      category: "structural",
      description: "Workflow produced at least one terminal output",
      required: true,
      passed: leaves.length > 0 && leaves.some((o) => o != null),
      detail: `${leaves.length} terminal output(s)`,
    },
  ];
};

const CHECKERS: Record<string, Checker> = {
  "research-brief": researchDocChecker,
  "research-brief-live": researchDocChecker,
};

export function runCorrectness(ctx: CorrectnessContext): ValidationResult {
  const checker = CHECKERS[ctx.workflowId] ?? genericChecker;
  const checks = checker(ctx);
  const passed = checks.filter((c) => c.required).every((c) => c.passed);
  return { passed, checks };
}

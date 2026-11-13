/**
 * Pluggable correctness tests.
 *
 * A checker receives the terminal node outputs of a run (ephemeral) and returns
 * a list of check results. A run with any FAILED required check must not be
 * reported as successful (enforced by the orchestrator).
 */
import type { CheckResult, IR, ValidationResult } from "../types.js";

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

/** Research Brief: validate the formatted document thoroughly. */
const researchBriefChecker: Checker = (ctx) => {
  const checks: CheckResult[] = [];
  const doc = leafOutputs(ctx).find((o: any) => o?.type === "document") as any;

  checks.push({
    id: "output-schema",
    description: "Final output is a document with a non-empty sections array",
    required: true,
    passed: !!doc && Array.isArray(doc.sections) && doc.sections.length === 3,
    detail: doc ? `type=${doc.type}, sections=${doc.sections?.length}` : "no document output",
  });

  const headings = (doc?.sections ?? []).map((s: any) => s.heading);
  const requiredHeadings = ["Source A Summary", "Source B Summary", "Synthesis"];
  checks.push({
    id: "required-sections",
    description: "Document contains the required sections",
    required: true,
    passed: requiredHeadings.every((h) => headings.includes(h)),
    detail: `found: ${headings.join(" | ") || "none"}`,
  });

  const sources: string[] = doc?.sources ?? [];
  checks.push({
    id: "source-ids",
    description: "Both source IDs (SRC-A, SRC-B) are cited",
    required: true,
    passed: sources.includes("SRC-A") && sources.includes("SRC-B"),
    detail: `sources: ${sources.join(", ") || "none"}`,
  });

  // Exact expected output: deterministic demo permits an exact structural match.
  const a = doc?.sections?.[0];
  const b = doc?.sections?.[1];
  checks.push({
    id: "exact-source-mapping",
    description: "Section A maps to SRC-A and Section B maps to SRC-B (exact)",
    required: true,
    passed: a?.sourceId === "SRC-A" && b?.sourceId === "SRC-B",
    detail: `A=${a?.sourceId}, B=${b?.sourceId}`,
  });

  // Semantic invariant: no required section body is empty.
  const nonEmpty = (doc?.sections ?? []).every((s: any) => (s.body ?? "").length > 0);
  checks.push({
    id: "non-empty-bodies",
    description: "Every section has a non-empty body (semantic invariant)",
    required: false,
    passed: nonEmpty,
    detail: nonEmpty ? "all sections populated" : "one or more empty sections",
  });

  return checks;
};

/** Generic fallback: at least one leaf produced a non-null output. */
const genericChecker: Checker = (ctx) => {
  const leaves = leafOutputs(ctx);
  return [
    {
      id: "has-output",
      description: "Workflow produced at least one terminal output",
      required: true,
      passed: leaves.length > 0 && leaves.some((o) => o != null),
      detail: `${leaves.length} terminal output(s)`,
    },
  ];
};

const CHECKERS: Record<string, Checker> = {
  "research-brief": researchBriefChecker,
};

export function runCorrectness(ctx: CorrectnessContext): ValidationResult {
  const checker = CHECKERS[ctx.workflowId] ?? genericChecker;
  const checks = checker(ctx);
  const passed = checks.filter((c) => c.required).every((c) => c.passed);
  return { passed, checks };
}

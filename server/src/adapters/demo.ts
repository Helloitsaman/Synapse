/**
 * Demo adapter — fully deterministic, no credentials required.
 *
 * It produces structured, reproducible outputs for each op type and simulates
 * realistic per-node work by sleeping for a deterministic duration derived from
 * the node id. The wall-clock timing we measure around this sleep is REAL; the
 * token/model usage it reports is clearly labelled "simulated" and every output
 * is tagged provenance "demo" so it can never be mistaken for live research.
 *
 * It emits the SAME source-grounded, cited shape the live path uses (via the
 * shared research helpers), so one workflow graph and one set of correctness
 * checks cover both modes — only the provenance labels and the text differ.
 */
import type { Adapter, AdapterContext, AdapterResult } from "./contract.js";
import { ADAPTER_CONTRACT_VERSION, AdapterError } from "./contract.js";
import type { SourceRecord, Usage, WorkflowNode } from "../types.js";
import { contentHash } from "../util/hash.js";
import {
  buildDocument,
  buildSummaryOutput,
  buildSynthesisOutput,
  citePrefix,
  collectSources,
  makeSourceId,
} from "./research.js";

/** Deterministic integer in [min, max] from a seed string. */
function seededInt(seed: string, min: number, max: number): number {
  const h = contentHash(seed);
  const n = parseInt(h.slice(0, 8), 16);
  return min + (n % (max - min + 1));
}

/** Cancellable sleep that rejects if aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AdapterError("cancelled", "CANCELLED"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AdapterError("cancelled", "CANCELLED"));
      },
      { once: true },
    );
  });
}

/** Simulated "work" duration (real sleep) for a node, deterministic. */
export function simDurationMs(node: WorkflowNode): number {
  switch (node.op) {
    case "retrieval":
      return seededInt(node.id + "|ret", 120, 260);
    case "llm":
      return seededInt(node.id + "|llm", 260, 520);
    case "tool":
      return seededInt(node.id + "|tool", 150, 300);
    case "transform":
      return seededInt(node.id + "|xf", 40, 110);
    case "decision":
      return seededInt(node.id + "|dec", 30, 80);
  }
}

function simUsage(node: WorkflowNode): Usage {
  if (node.op === "llm") {
    return {
      calls: 1,
      inputTokens: seededInt(node.id + "|in", 300, 900),
      outputTokens: seededInt(node.id + "|out", 120, 400),
      source: "simulated",
      model: node.provider.model ?? "synapse-sim",
    };
  }
  if (node.op === "retrieval" || node.op === "tool") {
    return { calls: 1, inputTokens: 0, outputTokens: 0, source: "simulated" };
  }
  return { calls: 0, inputTokens: 0, outputTokens: 0, source: "none" };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic";
}

export class DemoAdapter implements Adapter {
  readonly id = "demo";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["llm", "retrieval", "tool", "transform", "decision"],
    network: false,
    providerReportedUsage: false,
    credentialless: true,
    limitations: [
      "Outputs and usage are simulated, not from a real model or search provider.",
      "Token counts and costs are illustrative demo values.",
      "Every output is labelled provenance \"demo\".",
    ],
  };

  isAvailable() {
    return { available: true };
  }

  supports(node: WorkflowNode): boolean {
    return node.provider.adapter === "demo";
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const { node, inputs, signal } = ctx;
    await sleep(simDurationMs(node), signal);
    const output = this.computeOutput(node, inputs, ctx.workflowInputs);
    const sources = (output as any)?.sources as SourceRecord[] | undefined;
    return { output, usage: simUsage(node), provenance: "demo", sources };
  }

  private computeOutput(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    workflowInputs: Record<string, unknown>,
  ): unknown {
    const cfg = node.config as Record<string, any>;
    const topic = String(workflowInputs.topic ?? cfg.topic ?? "Q4 outlook");
    switch (node.op) {
      case "retrieval": {
        const prefix = citePrefix(String(cfg.sourceId ?? node.id), node.id.slice(0, 2));
        const corpus = String(cfg.corpus ?? "reference");
        const count = Math.min(6, Math.max(1, Number(cfg.maxResults) || 3));
        const retrievedAt = new Date(0).toISOString(); // fixed for determinism
        const sources: SourceRecord[] = Array.from({ length: count }, (_, i) => {
          const sid = makeSourceId(prefix, i);
          return {
            sourceId: sid,
            title: `${topic} — ${corpus} note ${i + 1}`,
            url: `https://${prefix}-demo-${i + 1}.example/${slug(topic)}`,
            publisher: `${corpus} archive (demo)`,
            snippet: `Deterministic demo source ${sid} about "${topic}" (${corpus}). Not a real document.`,
            retrievedAt,
            provenance: "demo",
          };
        });
        return { type: "search-results", provider: "demo", query: topic, retrievedAt, live: false, sources };
      }
      case "llm": {
        const section = String(cfg.section ?? "generic");
        if (section === "A" || section === "B") {
          const branch = collectSources(inputs);
          const cites = branch.map((s) => `[${s.sourceId}]`).join(" ");
          const text =
            `Summary for source set ${section} on "${topic}": the retrieved material is ` +
            `represented by ${cites || "(no sources)"}. Deterministic demo text — not model-generated.`;
          return buildSummaryOutput(section, text, branch);
        }
        if (section === "synthesis") {
          const union = buildSynthesisOutput(topic, "", inputs).sources;
          const cites = union.map((s) => `[${s.sourceId}]`).join(" ");
          const text =
            `Synthesis on "${topic}" combining both source sets ${cites || "(no sources)"}. ` +
            `Deterministic demo text — not model-generated.`;
          return buildSynthesisOutput(topic, text, inputs);
        }
        // Generic answer/report.
        const sources = collectSources(inputs);
        const cites = sources.map((s) => `[${s.sourceId}]`).join(" ");
        return {
          type: "text",
          section,
          text: `Response[${section}] for "${topic}" grounded in ${cites || "(no sources)"}. Demo text.`,
          sources,
        };
      }
      case "transform": {
        const brief = Object.values(inputs)[0] as any;
        if (brief?.type === "brief") {
          return buildDocument(brief, String(cfg.format ?? "brief-v1"));
        }
        return {
          type: "document",
          provenance: "demo",
          passthrough: brief ?? null,
          sources: [],
          citations: [],
          sections: [],
          answer: "",
        };
      }
      case "tool": {
        return { type: "ack", channel: cfg.channel ?? "default", ok: true, provenance: "demo" };
      }
      case "decision": {
        return { type: "decision", branch: "default", provenance: "demo" };
      }
    }
  }
}

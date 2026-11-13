/**
 * Demo adapter — fully deterministic, no credentials required.
 *
 * It produces structured, reproducible outputs for each op type and simulates
 * realistic per-node work by sleeping for a deterministic duration derived from
 * the node id. The wall-clock timing we measure around this sleep is REAL; the
 * token/model usage it reports is clearly labelled "simulated".
 */
import type { Adapter, AdapterContext, AdapterResult } from "./contract.js";
import { ADAPTER_CONTRACT_VERSION, AdapterError } from "./contract.js";
import type { Usage, WorkflowNode } from "../types.js";
import { contentHash } from "../util/hash.js";

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

export class DemoAdapter implements Adapter {
  readonly id = "demo";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["llm", "retrieval", "tool", "transform", "decision"],
    network: false,
    providerReportedUsage: false,
    credentialless: true,
    limitations: [
      "Outputs and usage are simulated, not from a real model provider.",
      "Token counts and costs are illustrative demo values.",
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
    return { output, usage: simUsage(node) };
  }

  private computeOutput(
    node: WorkflowNode,
    inputs: Record<string, unknown>,
    workflowInputs: Record<string, unknown>,
  ): unknown {
    const cfg = node.config as Record<string, any>;
    const topic = String(workflowInputs.topic ?? "Q4 outlook");
    switch (node.op) {
      case "retrieval": {
        const sourceId = String(cfg.sourceId);
        const items = [`${sourceId}#1`, `${sourceId}#2`, `${sourceId}#3`];
        return { type: "docs", sourceId, topic, items };
      }
      case "llm": {
        const section = String(cfg.section ?? "generic");
        if (section === "A" || section === "B") {
          const dep = Object.values(inputs)[0] as any;
          const sourceId = String(cfg.sourceId ?? dep?.sourceId ?? "SRC");
          const items: string[] = dep?.items ?? [];
          return {
            type: "summary",
            section,
            sourceId,
            facts: items,
            text: `Summary[${section}] from ${sourceId}: ${items.join(", ")} on "${topic}".`,
          };
        }
        if (section === "synthesis") {
          const summaries = Object.values(inputs) as any[];
          const bySection: Record<string, any> = {};
          const sources: string[] = [];
          for (const s of summaries) {
            if (s?.section) bySection[s.section] = s;
            if (s?.sourceId) sources.push(s.sourceId);
          }
          sources.sort();
          return {
            type: "brief",
            topic,
            sources,
            sections: bySection,
            text: `Synthesis on "${topic}" combining ${sources.join(" + ")}.`,
          };
        }
        // generic answer / report
        const dep = Object.values(inputs)[0] as any;
        return {
          type: "text",
          section,
          sourceId: cfg.sourceId ?? dep?.sourceId,
          text: `Response[${section}] for "${topic}".`,
        };
      }
      case "transform": {
        const brief = Object.values(inputs)[0] as any;
        if (brief?.type === "brief") {
          const sa = brief.sections?.A;
          const sb = brief.sections?.B;
          const document = {
            type: "document",
            format: cfg.format ?? "brief-v1",
            topic: brief.topic,
            title: `Research Brief: ${brief.topic}`,
            sources: brief.sources ?? [],
            sections: [
              { heading: "Source A Summary", body: sa?.text ?? "", sourceId: sa?.sourceId },
              { heading: "Source B Summary", body: sb?.text ?? "", sourceId: sb?.sourceId },
              { heading: "Synthesis", body: brief.text ?? "" },
            ],
          };
          return { ...document, checksum: contentHash(document) };
        }
        return { type: "document", passthrough: brief ?? null };
      }
      case "tool": {
        return { type: "ack", channel: cfg.channel ?? "default", ok: true };
      }
      case "decision": {
        return { type: "decision", branch: "default" };
      }
    }
  }
}

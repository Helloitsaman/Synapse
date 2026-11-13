/** Adapter registry: resolves the adapter that should run a given node. */
import type { Adapter } from "./contract.js";
import type { WorkflowNode } from "../types.js";
import { DemoAdapter } from "./demo.js";
import { OpenAIAdapter } from "./openai.js";
import { HttpToolAdapter } from "./httpTool.js";

export class AdapterRegistry {
  private adapters: Adapter[];

  constructor(adapters?: Adapter[]) {
    this.adapters = adapters ?? [
      new DemoAdapter(),
      new OpenAIAdapter(),
      new HttpToolAdapter(),
    ];
  }

  resolve(node: WorkflowNode): Adapter {
    const a = this.adapters.find((x) => x.supports(node));
    if (!a) {
      throw new Error(
        `No adapter supports node "${node.id}" (adapter=${node.provider.adapter}, op=${node.op}).`,
      );
    }
    return a;
  }

  get(id: string): Adapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  list(): Adapter[] {
    return this.adapters;
  }

  /** Capability matrix for the Integrations view (no secrets). */
  matrix() {
    return this.adapters.map((a) => ({
      id: a.id,
      contractVersion: a.contractVersion,
      capabilities: a.capabilities,
      availability: a.isAvailable(),
    }));
  }
}

export const defaultRegistry = new AdapterRegistry();

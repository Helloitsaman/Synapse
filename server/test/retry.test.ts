/**
 * Retry-safety: the scheduler must not duplicate non-idempotent or non-retryable
 * calls, must retry transient failures for idempotent nodes, and must honor the
 * error classification on AdapterError.
 */
import { describe, it, expect } from "vitest";
import { compileWorkflow } from "../src/compiler/compile.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { AdapterError, type Adapter, type AdapterContext, type AdapterResult } from "../src/adapters/contract.js";
import { SCHEMA_VERSION } from "../src/schema.js";
import type { Workflow } from "../src/types.js";

/** An adapter that fails a configurable number of times, counting attempts. */
class FlakyAdapter implements Adapter {
  readonly id = "demo"; // pose as "demo" so nodes resolve to it
  readonly contractVersion = "1.1.0";
  readonly capabilities = { ops: ["tool"], network: false, providerReportedUsage: false, credentialless: true, limitations: [] };
  calls = 0;
  constructor(private readonly failTimes: number, private readonly code: string, private readonly status?: number) {}
  isAvailable() {
    return { available: true };
  }
  supports(node: any) {
    return node.provider.adapter === "demo";
  }
  async execute(_ctx: AdapterContext): Promise<AdapterResult> {
    this.calls++;
    if (this.calls <= this.failTimes) {
      throw new AdapterError("boom", this.code, this.status ? { status: this.status } : undefined);
    }
    return { output: { ok: true }, usage: { calls: 1, inputTokens: 0, outputTokens: 0, source: "none" }, provenance: "demo" };
  }
}

function oneToolWorkflow(opts: { idempotent: boolean; maxAttempts: number }): Workflow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "retry-wf",
    name: "Retry WF",
    description: "",
    version: "1.0.0",
    nodes: [
      {
        id: "t",
        op: "tool",
        label: "Flaky Tool",
        dependsOn: [],
        inputs: [],
        outputs: ["ack"],
        timeoutMs: 5000,
        provider: { adapter: "demo" },
        deterministic: false,
        sideEffectSafe: false,
        idempotent: opts.idempotent,
        retry: { maxAttempts: opts.maxAttempts, backoffMs: 0 },
        config: { channel: "x" },
      },
    ],
  };
}

async function run(wf: Workflow, adapter: FlakyAdapter) {
  const ir = compileWorkflow(wf).ir!;
  const { record } = await executeRun(wf, ir, "r", {
    mode: "baseline",
    concurrency: 1,
    memoize: false,
    registry: new AdapterRegistry([adapter]),
  });
  return record;
}

describe("retry classification", () => {
  it("retries a transient (RATE_LIMITED) failure for an IDEMPOTENT node", async () => {
    const adapter = new FlakyAdapter(1, "RATE_LIMITED", 429);
    const record = await run(oneToolWorkflow({ idempotent: true, maxAttempts: 3 }), adapter);
    expect(record.status).toBe("succeeded");
    expect(adapter.calls).toBe(2); // one failure + one success
  });

  it("does NOT retry a NON-idempotent node, even on a transient error", async () => {
    const adapter = new FlakyAdapter(5, "RATE_LIMITED", 429);
    const record = await run(oneToolWorkflow({ idempotent: false, maxAttempts: 3 }), adapter);
    expect(record.status).toBe("failed");
    expect(adapter.calls).toBe(1); // capped at a single attempt — no duplicate side effect
  });

  it("does NOT retry a NON-retryable error (4xx / validation), even if idempotent", async () => {
    const adapter = new FlakyAdapter(5, "PROVIDER_ERROR", 400);
    const record = await run(oneToolWorkflow({ idempotent: true, maxAttempts: 3 }), adapter);
    expect(record.status).toBe("failed");
    expect(adapter.calls).toBe(1); // 400 is not retryable
  });

  it("classifies AdapterError retryability by code and HTTP status", () => {
    expect(new AdapterError("x", "RATE_LIMITED").retryable).toBe(true);
    expect(new AdapterError("x", "PROVIDER_UNREACHABLE").retryable).toBe(true);
    expect(new AdapterError("x", "PROVIDER_OVERLOADED").retryable).toBe(true);
    expect(new AdapterError("x", "PROVIDER_ERROR", { status: 503 }).retryable).toBe(true);
    expect(new AdapterError("x", "PROVIDER_ERROR", { status: 400 }).retryable).toBe(false);
    expect(new AdapterError("x", "NOT_CONFIGURED").retryable).toBe(false);
    expect(new AdapterError("x", "BAD_INPUT").retryable).toBe(false);
  });
});

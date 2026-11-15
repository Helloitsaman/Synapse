/** SYNAPSE MCP server. It delegates to the existing HTTP API so MCP and the
 * dashboard share the same workflow/run store and execution runtime. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;

export interface SynapseMcpOptions {
  apiBaseUrl?: string;
  apiToken?: string;
}

function asToolResult(data: unknown, summary: string) {
  return {
    structuredContent: data as JsonRecord,
    content: [{ type: "text" as const, text: `${summary}\n${JSON.stringify(data, null, 2)}` }],
  };
}

function asToolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown SYNAPSE error.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/** Human summary of a run record emphasizing provenance (live/demo/mixed). */
function formatRunSummary(run: any): string {
  const lines: string[] = [];
  const mode = (run?.execution?.provenanceMode ?? (run?.execution?.liveExecution ? "live" : "demo")) as string;
  lines.push(`Run ${run.id}: ${run.status} (${run.mode} mode).`);
  if (run?.execution) {
    const e = run.execution;
    lines.push(
      `Execution: ${mode.toUpperCase()} — adapters [${(e.adapters ?? []).join(", ")}]` +
        (e.providers?.length ? `, providers [${e.providers.join(", ")}]` : "") +
        `, live/demo nodes ${e.liveNodeCount ?? 0}/${e.demoNodeCount ?? 0}` +
        `, ${e.sourceCount ?? 0} source(s) retrieved.`,
    );
    if (mode === "mixed") {
      lines.push("  ⚠ MIXED: part of this output came from demo adapters — see node provenance.");
    }
  }
  if (run?.usage) {
    const cost =
      run.estimatedCostUsd == null
        ? "unknown (provider reported no usage; not $0)"
        : `~$${run.estimatedCostUsd} (estimated, not a provider charge)`;
    lines.push(
      `Usage: ${run.usage.calls} call(s), ${run.usage.inputTokens + run.usage.outputTokens} tokens ` +
        `(${run.usage.source}); cost ${cost}.`,
    );
  }
  lines.push(`Latency: total ${run.totalMs}ms (measured), SYNAPSE overhead ${run.overheadMs}ms (measured).`);
  if (run?.validation) {
    const failed = (run.validation.checks ?? []).filter((c: any) => c.required && !c.passed).map((c: any) => c.id);
    lines.push(
      `Correctness: ${run.validation.passed ? "all required checks passed" : `FAILED (${failed.join(", ")})`}.`,
    );
  }
  if (run?.result) {
    const r = run.result;
    lines.push(`Answer provenance: ${r.provenance}. ${r.sources?.length ?? 0} cited source(s):`);
    for (const c of (r.citations ?? []).slice(0, 8)) lines.push(`  [${c.sourceId}] ${c.title} — ${c.url}`);
    if (r.answer) lines.push("", "----- ANSWER -----", String(r.answer));
  } else if (["succeeded"].includes(run.status)) {
    lines.push("No structured answer was produced by this workflow.");
  }
  return lines.join("\n");
}

export function createSynapseMcpServer(options: SynapseMcpOptions = {}): McpServer {
  const apiBaseUrl = (options.apiBaseUrl ?? process.env.SYNAPSE_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
  const apiToken = options.apiToken ?? process.env.SYNAPSE_API_TOKEN ?? process.env.API_AUTH_TOKEN ?? "";

  async function request(path: string, init?: RequestInit): Promise<any> {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    if (init?.body) headers.set("content-type", "application/json");
    if (apiToken) headers.set("authorization", `Bearer ${apiToken}`);

    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/api${path}`, { ...init, headers });
    } catch {
      throw new Error(`Cannot reach SYNAPSE at ${apiBaseUrl}. Start the SYNAPSE backend and check SYNAPSE_API_BASE_URL.`);
    }

    const bodyText = await response.text();
    let body: any;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = { error: { message: "SYNAPSE returned an invalid response." } };
    }
    if (!response.ok) {
      const message = body?.error?.message ?? `SYNAPSE returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return body;
  }

  const server = new McpServer(
    { name: "synapse", version: "0.2.0" },
    {
      instructions:
        "Use SYNAPSE to validate and inspect explicit agent workflows, preview safe optimizations, and run or compare workflows. First inspect available workflows or compile a supplied workflow. Preview before execution. A run can invoke configured models or tools; only run it when the user requested execution. SYNAPSE cannot access hidden host chat context unless the user or host explicitly supplies it.",
    },
  );

  server.registerTool(
    "synapse_list_workflows",
    {
      title: "List SYNAPSE workflows",
      description: "List workflows already available in SYNAPSE. Use this to discover a workflow before previewing or running it.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const data = await request("/workflows");
        return asToolResult({ workflows: data }, `Found ${data.length} SYNAPSE workflow(s).`);
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_compile_workflow",
    {
      title: "Compile a workflow",
      description: "Validate a SYNAPSE workflow JSON document and return its dependency graph and intermediate representation. This does not save or execute the workflow.",
      inputSchema: {
        workflowJson: z.string().min(2).max(65_536).describe("A JSON-encoded SYNAPSE workflow definition."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ workflowJson }) => {
      try {
        let workflow: unknown;
        try {
          workflow = JSON.parse(workflowJson);
        } catch {
          return asToolError(new Error("workflowJson is not valid JSON."));
        }
        const data = await request("/compile", { method: "POST", body: JSON.stringify(workflow) });
        return asToolResult(data, data.ok ? "Workflow compiled successfully." : "Workflow validation failed.");
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_preview_optimization",
    {
      title: "Preview workflow optimization",
      description: "Compile a saved workflow and preview SYNAPSE's proposed safe transformations without executing it.",
      inputSchema: { workflowId: z.string().min(1).max(120) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ workflowId }) => {
      try {
        const data = await request(`/workflows/${encodeURIComponent(workflowId)}/optimize/preview`, { method: "POST", body: "{}" });
        return asToolResult(data, "Optimization preview ready. Review the plan and preconditions before running.");
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_import_workflow",
    {
      title: "Import a workflow into SYNAPSE",
      description: "Validate and save a supplied workflow definition in SYNAPSE. This changes SYNAPSE's local workflow store; only call when the user requested importing or running this workflow.",
      inputSchema: { workflowJson: z.string().min(2).max(65_536).describe("A JSON-encoded SYNAPSE workflow definition." ) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ workflowJson }) => {
      try {
        let workflow: unknown;
        try {
          workflow = JSON.parse(workflowJson);
        } catch {
          return asToolError(new Error("workflowJson is not valid JSON."));
        }
        const data = await request("/workflows", { method: "POST", body: JSON.stringify(workflow) });
        return asToolResult(data, "Workflow validated and imported into SYNAPSE.");
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_start_workflow_run",
    {
      title: "Run a SYNAPSE workflow",
      description: "Start a saved SYNAPSE workflow in baseline or optimized mode. Execution may call configured model providers and external tools. Only call when the user requests execution.",
      inputSchema: {
        workflowId: z.string().min(1).max(120),
        mode: z.enum(["baseline", "optimized"]),
        concurrency: z.number().int().min(1).max(16).optional(),
        workflowInputsJson: z.string().max(32_768).optional().describe("Optional JSON object of workflow inputs, such as topic."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ workflowId, mode, concurrency, workflowInputsJson }) => {
      try {
        let workflowInputs: unknown;
        if (workflowInputsJson) {
          try {
            workflowInputs = JSON.parse(workflowInputsJson);
          } catch {
            return asToolError(new Error("workflowInputsJson is not valid JSON."));
          }
          if (!workflowInputs || typeof workflowInputs !== "object" || Array.isArray(workflowInputs)) {
            return asToolError(new Error("workflowInputsJson must encode a JSON object."));
          }
        }
        const data = await request("/runs", {
          method: "POST",
          body: JSON.stringify({ workflowId, mode, concurrency, workflowInputs }),
        });
        return asToolResult(data, `SYNAPSE run started (${mode}). Use synapse_get_run_result with runId ${data.id} to check progress.`);
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_get_run_result",
    {
      title: "Get SYNAPSE run result",
      description: "Read the current or final status, node timings, usage provenance, and correctness checks for a SYNAPSE run.",
      inputSchema: { runId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ runId }) => {
      try {
        const data = await request(`/runs/${encodeURIComponent(runId)}`);
        return asToolResult(data, formatRunSummary(data));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_compare_runs",
    {
      title: "Compare SYNAPSE runs",
      description: "Compare a baseline run with an optimized run and return labeled latency, usage, cost, and validation metrics.",
      inputSchema: { baselineRunId: z.string().min(1), optimizedRunId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ baselineRunId, optimizedRunId }) => {
      try {
        const query = new URLSearchParams({ baseline: baselineRunId, optimized: optimizedRunId });
        const data = await request(`/compare?${query.toString()}`);
        return asToolResult(
          data,
          data?.comparability?.comparable === false
            ? `Run comparison ready, but the runs are NOT a matched pair (${(data.comparability.mismatches ?? []).join("; ")}). Treat the delta cautiously.`
            : "Run comparison ready (matched pair). Metrics carry measured/estimated/simulated/unavailable labels.",
        );
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "synapse_benchmark_workflow",
    {
      title: "Benchmark a SYNAPSE workflow (paired, repeated)",
      description:
        "Run a saved workflow N times in baseline AND optimized mode (interleaved) against the same inputs, and return measured distributions (median, p95, spread, failures). Baseline = sequential graph execution, NOT a host-native chat prompt. Execution may call configured providers; only call when the user requests a benchmark.",
      inputSchema: {
        workflowId: z.string().min(1).max(120),
        repetitions: z.number().int().min(1).max(10).describe("Runs per mode (1-10)."),
        concurrency: z.number().int().min(1).max(16).optional(),
        workflowInputsJson: z.string().max(32_768).optional().describe("Optional JSON object of workflow inputs, such as topic."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ workflowId, repetitions, concurrency, workflowInputsJson }) => {
      try {
        let workflowInputs: unknown;
        if (workflowInputsJson) {
          try {
            workflowInputs = JSON.parse(workflowInputsJson);
          } catch {
            return asToolError(new Error("workflowInputsJson is not valid JSON."));
          }
          if (!workflowInputs || typeof workflowInputs !== "object" || Array.isArray(workflowInputs)) {
            return asToolError(new Error("workflowInputsJson must encode a JSON object."));
          }
        }
        const data = await request("/benchmark", {
          method: "POST",
          body: JSON.stringify({ workflowId, repetitions, concurrency, workflowInputs }),
        });
        const summary =
          `Benchmark: ${data.repetitions} run(s)/mode. ` +
          `Baseline median ${data.baseline?.totalMs?.median}ms (p95 ${data.baseline?.totalMs?.p95}ms), ` +
          `Optimized median ${data.optimized?.totalMs?.median}ms (p95 ${data.optimized?.totalMs?.p95}ms), ` +
          `median speedup ${data.speedupMedian}x. Distributions are measured; not a significance test.`;
        return asToolResult(data, summary);
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  return server;
}

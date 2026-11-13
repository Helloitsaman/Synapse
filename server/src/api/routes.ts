/** SYNAPSE HTTP API. */
import { Router, type Request, type Response } from "express";
import { store } from "../store/store.js";
import {
  CompileFailed,
  WorkflowNotFound,
  cancelRun,
  compile,
  compileRaw,
  getComparison,
  preview,
  startRun,
} from "../runtime/orchestrator.js";
import { defaultRegistry } from "../adapters/registry.js";
import { HOST_MATRIX } from "../adapters/hosts.js";
import { BUILTIN_WORKFLOW_IDS } from "../workflows/samples.js";
import { otelConfig } from "../telemetry/otel.js";
import { ADAPTER_CONTRACT_VERSION } from "../adapters/contract.js";
import { SCHEMA_VERSION } from "../schema.js";

export const api = Router();

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

api.get("/health", (_req, res) => {
  res.json({ status: "ok", schemaVersion: SCHEMA_VERSION, time: new Date().toISOString() });
});

api.get("/config", (_req, res) => {
  res.json({
    schemaVersion: SCHEMA_VERSION,
    adapterContractVersion: ADAPTER_CONTRACT_VERSION,
    telemetry: otelConfig(),
    privacy: {
      redactBodies: true,
      telemetryMetadataOnly: true,
      runContextEphemeral: true,
      retention: "Run summaries persist locally until deleted; node I/O bodies are not persisted.",
    },
    demoMode: !defaultRegistry.get("openai")?.isAvailable().available,
  });
});

// --- workflows ---
api.get("/workflows", (_req, res) => {
  res.json(
    store.listWorkflows().map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      version: w.version,
      nodeCount: w.nodes.length,
      builtin: BUILTIN_WORKFLOW_IDS.has(w.id),
    })),
  );
});

api.get("/workflows/:id", (req, res) => {
  const wf = store.getWorkflow(req.params.id);
  if (!wf) return fail(res, 404, "NOT_FOUND", `Unknown workflow "${req.params.id}".`);
  res.json(wf);
});

// Compile + validate a stored workflow.
api.post("/workflows/:id/compile", (req, res) => {
  try {
    const result = compile(req.params.id);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (err) {
    if (err instanceof WorkflowNotFound) return fail(res, 404, "NOT_FOUND", err.message);
    fail(res, 500, "COMPILE_ERROR", (err as Error).message);
  }
});

// Compile + validate an arbitrary workflow body (import/validation).
api.post("/compile", (req, res) => {
  const result = compileRaw(req.body);
  res.status(result.ok ? 200 : 422).json(result);
});

// Import/save a workflow (validated first).
api.post("/workflows", (req, res) => {
  const result = compileRaw(req.body);
  if (!result.ok) return res.status(422).json(result);
  store.saveWorkflow(req.body);
  res.status(201).json({ ok: true, ir: result.ir });
});

// Delete an imported workflow (built-in samples are protected).
api.delete("/workflows/:id", (req, res) => {
  const { id } = req.params;
  if (BUILTIN_WORKFLOW_IDS.has(id)) {
    return fail(res, 400, "BUILTIN_PROTECTED", `"${id}" is a built-in sample and cannot be deleted.`);
  }
  const ok = store.deleteWorkflow(id);
  if (!ok) return fail(res, 404, "NOT_FOUND", `Unknown workflow "${id}".`);
  res.json({ ok: true });
});

// Optimization preview.
api.post("/workflows/:id/optimize/preview", (req, res) => {
  try {
    res.json(preview(req.params.id));
  } catch (err) {
    if (err instanceof WorkflowNotFound) return fail(res, 404, "NOT_FOUND", err.message);
    if (err instanceof CompileFailed) return fail(res, 422, "COMPILE_FAILED", err.message);
    fail(res, 500, "PREVIEW_ERROR", (err as Error).message);
  }
});

// --- runs ---
api.post("/runs", (req, res) => {
  const { workflowId, mode, concurrency, workflowInputs } = req.body ?? {};
  if (!workflowId || (mode !== "baseline" && mode !== "optimized")) {
    return fail(res, 400, "BAD_REQUEST", "workflowId and mode (baseline|optimized) are required.");
  }
  if (concurrency !== undefined && (typeof concurrency !== "number" || concurrency < 1 || concurrency > 16)) {
    return fail(res, 400, "BAD_REQUEST", "concurrency must be between 1 and 16.");
  }
  try {
    const run = startRun({ workflowId, mode, concurrency, workflowInputs });
    res.status(201).json(run);
  } catch (err) {
    if (err instanceof WorkflowNotFound) return fail(res, 404, "NOT_FOUND", err.message);
    if (err instanceof CompileFailed) return fail(res, 422, "COMPILE_FAILED", err.message);
    fail(res, 500, "RUN_ERROR", (err as Error).message);
  }
});

api.get("/runs", (_req, res) => {
  res.json(
    store.listRuns().map((r) => ({
      id: r.id,
      workflowId: r.workflowId,
      mode: r.mode,
      status: r.status,
      createdAt: r.createdAt,
      totalMs: r.totalMs,
      overheadMs: r.overheadMs,
      validationPassed: r.validation?.passed ?? null,
      estimatedCostUsd: r.estimatedCostUsd,
      usage: r.usage,
    })),
  );
});

api.get("/runs/:id", (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return fail(res, 404, "NOT_FOUND", `Unknown run "${req.params.id}".`);
  res.json(run);
});

// Live node events via Server-Sent Events (robust polling fallback is GET /runs/:id).
api.get("/runs/:id/events", (req: Request, res: Response) => {
  const run = store.getRun(req.params.id);
  if (!run) return fail(res, 404, "NOT_FOUND", `Unknown run "${req.params.id}".`);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let lastSerialized = "";
  const tick = () => {
    const current = store.getRun(req.params.id);
    if (!current) return;
    const serialized = JSON.stringify(current);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      res.write(`data: ${serialized}\n\n`);
    }
    if (["succeeded", "failed", "cancelled"].includes(current.status)) {
      res.write("event: done\ndata: {}\n\n");
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(tick, 120);
  tick();
  req.on("close", () => clearInterval(timer));
});

api.post("/runs/:id/cancel", (req, res) => {
  const ok = cancelRun(req.params.id);
  if (!ok) return fail(res, 409, "NOT_CANCELLABLE", "Run is not active or already finished.");
  res.json({ ok: true });
});

api.delete("/runs/:id", (req, res) => {
  const ok = store.deleteRun(req.params.id);
  if (!ok) return fail(res, 404, "NOT_FOUND", `Unknown run "${req.params.id}".`);
  res.json({ ok: true });
});

// --- comparison ---
api.get("/compare", (req, res) => {
  const baseline = String(req.query.baseline ?? "");
  const optimized = String(req.query.optimized ?? "");
  if (!baseline || !optimized) {
    return fail(res, 400, "BAD_REQUEST", "baseline and optimized query params are required.");
  }
  try {
    res.json(getComparison(baseline, optimized));
  } catch (err) {
    fail(res, 404, "NOT_FOUND", (err as Error).message);
  }
});

// --- integrations / capability matrix (no secrets) ---
api.get("/integrations", (_req, res) => {
  res.json({
    adapterContractVersion: ADAPTER_CONTRACT_VERSION,
    adapters: defaultRegistry.matrix(),
    hosts: HOST_MATRIX,
    telemetry: otelConfig(),
  });
});

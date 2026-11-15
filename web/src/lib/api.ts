import type {
  AppConfig, BenchmarkResult, CompileResult, Integrations, IR, OptimizationPlan,
  RunComparison, RunRecord, RunSummary, WorkflowSummary,
} from "./types";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body?.error?.message ?? body?.errors?.map((e: any) => e.message).join("; ") ?? msg;
    } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const api = {
  config: () => req<AppConfig>("/config"),
  health: () => req<{ status: string }>("/health"),
  workflows: () => req<WorkflowSummary[]>("/workflows"),
  workflow: (id: string) => req<any>(`/workflows/${id}`),
  compile: (id: string) => req<CompileResult>(`/workflows/${id}/compile`, { method: "POST" }),
  compileRaw: (body: unknown) =>
    req<CompileResult>(`/compile`, { method: "POST", body: JSON.stringify(body) }),
  importWorkflow: (body: unknown) =>
    req<{ ok: boolean; ir: IR }>(`/workflows`, { method: "POST", body: JSON.stringify(body) }),
  deleteWorkflow: (id: string) =>
    req<{ ok: boolean }>(`/workflows/${id}`, { method: "DELETE" }),
  preview: (id: string) =>
    req<{ ir: IR; plan: OptimizationPlan }>(`/workflows/${id}/optimize/preview`, { method: "POST" }),
  startRun: (
    workflowId: string,
    mode: "baseline" | "optimized",
    concurrency?: number,
    workflowInputs?: Record<string, unknown>,
  ) =>
    req<RunRecord>("/runs", {
      method: "POST",
      body: JSON.stringify({ workflowId, mode, concurrency, workflowInputs }),
    }),
  runs: () => req<RunSummary[]>("/runs"),
  run: (id: string) => req<RunRecord>(`/runs/${id}`),
  cancelRun: (id: string) => req<{ ok: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),
  deleteRun: (id: string) => req<{ ok: boolean }>(`/runs/${id}`, { method: "DELETE" }),
  compare: (baseline: string, optimized: string) =>
    req<RunComparison>(`/compare?baseline=${baseline}&optimized=${optimized}`),
  benchmark: (
    workflowId: string,
    repetitions: number,
    concurrency?: number,
    workflowInputs?: Record<string, unknown>,
  ) =>
    req<BenchmarkResult>("/benchmark", {
      method: "POST",
      body: JSON.stringify({ workflowId, repetitions, concurrency, workflowInputs }),
    }),
  integrations: () => req<Integrations>("/integrations"),
};

/** Subscribe to a run's live node events via SSE. Returns an unsubscribe fn. */
export function subscribeRun(
  id: string,
  onUpdate: (run: RunRecord) => void,
  onDone?: () => void,
): () => void {
  const es = new EventSource(`${BASE}/runs/${id}/events`);
  es.onmessage = (e) => {
    try {
      onUpdate(JSON.parse(e.data) as RunRecord);
    } catch { /* ignore */ }
  };
  es.addEventListener("done", () => {
    es.close();
    onDone?.();
  });
  es.onerror = () => {
    es.close();
    onDone?.();
  };
  return () => es.close();
}

/**
 * Lightweight local persistence.
 *
 * Workflow definitions and run SUMMARIES are persisted to JSON files. Run
 * context (node I/O bodies) is ephemeral by default and never written. Live runs
 * are held in memory while executing so the API can poll their status.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord, Workflow } from "../types.js";
import { SAMPLE_WORKFLOWS } from "../workflows/samples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SYNAPSE_DATA_DIR ?? join(__dirname, "../../data");
const WORKFLOWS_FILE = join(DATA_DIR, "workflows.json");
const RUNS_FILE = join(DATA_DIR, "runs.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir();
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export class Store {
  private workflows = new Map<string, Workflow>();
  private runs = new Map<string, RunRecord>();
  /** Live (in-progress) runs, ephemeral. */
  private liveRuns = new Map<string, RunRecord>();

  constructor() {
    ensureDir();
    const persistedWf = readJson<Workflow[]>(WORKFLOWS_FILE, []);
    const seed = new Map<string, Workflow>();
    // Load user-imported workflows first, then let the built-in samples take
    // authority over their own ids (so the code definition — including the
    // env-configured live workflow — is always current and can't be shadowed by
    // a stale persisted copy). Built-in ids are protected from deletion anyway.
    for (const wf of persistedWf) seed.set(wf.id, wf);
    for (const wf of SAMPLE_WORKFLOWS) seed.set(wf.id, wf);
    this.workflows = seed;
    this.persistWorkflows();

    const persistedRuns = readJson<RunRecord[]>(RUNS_FILE, []);
    for (const r of persistedRuns) this.runs.set(r.id, r);
  }

  // --- workflows ---
  listWorkflows(): Workflow[] {
    return [...this.workflows.values()];
  }
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }
  saveWorkflow(wf: Workflow) {
    this.workflows.set(wf.id, wf);
    this.persistWorkflows();
  }
  deleteWorkflow(id: string): boolean {
    const existed = this.workflows.delete(id);
    if (existed) this.persistWorkflows();
    return existed;
  }
  private persistWorkflows() {
    writeJson(WORKFLOWS_FILE, [...this.workflows.values()]);
  }

  // --- live runs (ephemeral) ---
  setLiveRun(run: RunRecord) {
    this.liveRuns.set(run.id, run);
  }
  getLiveRun(id: string): RunRecord | undefined {
    return this.liveRuns.get(id);
  }

  // --- persisted run summaries ---
  finalizeRun(run: RunRecord) {
    this.liveRuns.delete(run.id);
    this.runs.set(run.id, run);
    this.persistRuns();
  }
  listRuns(): RunRecord[] {
    return [...this.runs.values(), ...this.liveRuns.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
  getRun(id: string): RunRecord | undefined {
    return this.liveRuns.get(id) ?? this.runs.get(id);
  }
  deleteRun(id: string): boolean {
    const existed = this.runs.delete(id) || this.liveRuns.delete(id);
    if (existed) this.persistRuns();
    return existed;
  }
  clearRuns() {
    this.runs.clear();
    this.persistRuns();
  }
  private persistRuns() {
    writeJson(RUNS_FILE, [...this.runs.values()]);
  }
}

export const store = new Store();

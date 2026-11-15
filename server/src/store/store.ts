/**
 * Lightweight local persistence (PROTOTYPE durability).
 *
 * Workflow definitions and run SUMMARIES are persisted to JSON files. Run
 * context (node I/O bodies) is ephemeral by default and never written. Live runs
 * are held in memory while executing so the API can poll their status.
 *
 * Durability hardening within the prototype's scope:
 *  - writes are ATOMIC (write a temp file, then rename over the target) so a
 *    crash mid-write cannot leave a half-written JSON file;
 *  - a corrupt file is NOT silently treated as empty — it is backed up and the
 *    corruption is logged, so data loss is visible rather than hidden;
 *  - a retention cap bounds how many finished runs are retained on disk.
 *
 * This is still NOT safe for concurrent multi-process hosted use; a transactional
 * database with migrations and backups is required before that (see docs).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord, Workflow } from "../types.js";
import { SAMPLE_WORKFLOWS } from "../workflows/samples.js";
import { log } from "../telemetry/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SYNAPSE_DATA_DIR ?? join(__dirname, "../../data");
const WORKFLOWS_FILE = join(DATA_DIR, "workflows.json");
const RUNS_FILE = join(DATA_DIR, "runs.json");

/** Max finished runs retained on disk (oldest dropped first). 0 = unlimited. */
const MAX_RUNS = Math.max(0, Number(process.env.SYNAPSE_MAX_RUNS ?? 200));

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Read + parse JSON. On a parse failure the corrupt file is preserved (renamed
 * aside) and the event is logged — we never silently discard persistent data.
 */
function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, backup);
    } catch {
      /* best-effort; keep going with fallback */
    }
    log("error", "store.corrupt_file", {
      file,
      backup,
      error: (err as Error).message,
      message: "Persisted data was unreadable and has been set aside for inspection (not deleted).",
    });
    return fallback;
  }
}

/** Atomic write: temp file then rename over the target. */
function writeJson(file: string, value: unknown) {
  ensureDir();
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, file);
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
    this.enforceRetention();
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
  /** Drop the oldest finished runs beyond the retention cap (visible in logs). */
  private enforceRetention() {
    if (MAX_RUNS === 0 || this.runs.size <= MAX_RUNS) return;
    const ordered = [...this.runs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const dropCount = this.runs.size - MAX_RUNS;
    for (let i = 0; i < dropCount; i++) this.runs.delete(ordered[i].id);
    log("info", "store.retention_evict", { dropped: dropCount, cap: MAX_RUNS });
  }
  private persistRuns() {
    writeJson(RUNS_FILE, [...this.runs.values()]);
  }
}

export const store = new Store();

/**
 * Workflow compiler.
 *
 * Validates a raw workflow object against the schema and a set of structural
 * rules, then compiles it into a DAG-based IR with an execution plan and graph
 * data for the UI. All failures are returned as actionable {@link CompileError}s
 * rather than thrown, so the API can surface them to the user.
 */
import { workflowSchema, OP_TYPES, MAX_TIMEOUT_MS } from "../schema.js";
import type { Workflow, WorkflowNode } from "../schema.js";
import type { CompileError, CompileResult, GraphData, IR } from "../types.js";
import { contentHash } from "../util/hash.js";

const KNOWN_ADAPTERS = new Set(["demo", "openai", "http-tool"]);

export function compileWorkflow(raw: unknown): CompileResult {
  const errors: CompileError[] = [];

  // 1. Schema validation (types, required fields, enum ops, timeout bounds).
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        code: "SCHEMA_INVALID",
        message: issue.message,
        path: issue.path.join("."),
        nodeId: nodeIdFromPath(raw, issue.path),
      });
    }
    return { ok: false, errors };
  }

  const wf = parsed.data;
  const ids = new Set<string>();
  const seen = new Set<string>();

  // 2. Duplicate node IDs.
  for (const node of wf.nodes) {
    if (seen.has(node.id)) {
      errors.push({
        code: "DUPLICATE_ID",
        message: `Duplicate node id "${node.id}".`,
        nodeId: node.id,
      });
    }
    seen.add(node.id);
    ids.add(node.id);
  }

  // 3. Per-node structural checks.
  for (const node of wf.nodes) {
    // Unsupported op (defense in depth; enum already guards this).
    if (!OP_TYPES.includes(node.op)) {
      errors.push({
        code: "UNSUPPORTED_OP",
        message: `Unsupported operation "${node.op}".`,
        nodeId: node.id,
      });
    }

    // Unknown adapter.
    if (!KNOWN_ADAPTERS.has(node.provider.adapter)) {
      errors.push({
        code: "UNKNOWN_ADAPTER",
        message: `Node "${node.id}" references unknown adapter "${node.provider.adapter}".`,
        nodeId: node.id,
      });
    }

    // Unsafe / unbounded timeout (schema enforces bounds; re-check for clarity).
    if (!Number.isFinite(node.timeoutMs) || node.timeoutMs <= 0) {
      errors.push({
        code: "UNSAFE_TIMEOUT",
        message: `Node "${node.id}" has an unbounded or non-positive timeout.`,
        nodeId: node.id,
      });
    } else if (node.timeoutMs > MAX_TIMEOUT_MS) {
      errors.push({
        code: "UNSAFE_TIMEOUT",
        message: `Node "${node.id}" timeout ${node.timeoutMs}ms exceeds max ${MAX_TIMEOUT_MS}ms.`,
        nodeId: node.id,
      });
    }

    // Missing dependency targets + self-dependency.
    for (const dep of node.dependsOn) {
      if (dep === node.id) {
        errors.push({
          code: "SELF_DEPENDENCY",
          message: `Node "${node.id}" depends on itself.`,
          nodeId: node.id,
        });
      } else if (!ids.has(dep)) {
        errors.push({
          code: "MISSING_DEPENDENCY",
          message: `Node "${node.id}" depends on unknown node "${dep}".`,
          nodeId: node.id,
        });
      }
    }

    // Op-specific config validation (malformed configuration).
    const cfgError = validateConfig(node);
    if (cfgError) errors.push(cfgError);
  }

  // 4. Cycle detection (only meaningful if deps resolve).
  const hasMissingOrDup = errors.some(
    (e) =>
      e.code === "MISSING_DEPENDENCY" ||
      e.code === "DUPLICATE_ID" ||
      e.code === "SELF_DEPENDENCY",
  );
  let order: string[] = [];
  if (!hasMissingOrDup) {
    const topo = topoSort(wf);
    if (topo.cycle) {
      errors.push({
        code: "CYCLE_DETECTED",
        message: `Workflow contains a dependency cycle: ${topo.cycle.join(" -> ")}.`,
      });
    } else {
      order = topo.order;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // 5. Build IR.
  const ir = buildIR(wf, order);
  return { ok: true, errors: [], ir };
}

function validateConfig(node: WorkflowNode): CompileError | null {
  const cfg = node.config ?? {};
  switch (node.op) {
    case "retrieval":
      if (typeof cfg.sourceId !== "string" || !cfg.sourceId) {
        return {
          code: "MALFORMED_CONFIG",
          message: `Retrieval node "${node.id}" must declare a string config.sourceId.`,
          nodeId: node.id,
        };
      }
      return null;
    case "tool":
      // http-tool adapter requires a url; demo tool just needs a channel/name.
      if (
        node.provider.adapter === "http-tool" &&
        typeof cfg.url !== "string"
      ) {
        return {
          code: "MALFORMED_CONFIG",
          message: `HTTP tool node "${node.id}" must declare a string config.url.`,
          nodeId: node.id,
        };
      }
      return null;
    case "llm":
      if (node.provider.adapter === "openai" && !node.provider.model) {
        return {
          code: "MALFORMED_CONFIG",
          message: `OpenAI llm node "${node.id}" must declare provider.model.`,
          nodeId: node.id,
        };
      }
      return null;
    default:
      return null;
  }
}

/** Kahn-style topological sort returning order or the first cycle found. */
export function topoSort(wf: Workflow): { order: string[]; cycle?: string[] } {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of wf.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of wf.nodes) {
    for (const dep of n.dependsOn) {
      adj.get(dep)!.push(n.id);
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
    }
  }
  // Deterministic queue: sort by id so output is stable.
  const queue = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of (adj.get(id) ?? []).sort()) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if (indeg.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (order.length !== wf.nodes.length) {
    return { order: [], cycle: findCycle(wf) };
  }
  return { order };
}

/** DFS to recover a concrete cycle path for error messaging. */
function findCycle(wf: Workflow): string[] {
  const deps = new Map(wf.nodes.map((n) => [n.id, n.dependsOn]));
  const state = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 in-stack, 2 done
  const stack: string[] = [];
  let found: string[] | undefined;

  const dfs = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue;
      const s = state.get(dep) ?? 0;
      if (s === 1) {
        const idx = stack.indexOf(dep);
        found = [...stack.slice(idx), dep];
        return true;
      }
      if (s === 0 && dfs(dep)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };

  for (const n of wf.nodes) {
    if ((state.get(n.id) ?? 0) === 0 && dfs(n.id)) break;
  }
  return found ?? [];
}

function buildIR(wf: Workflow, order: string[]): IR {
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const dependencies: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};
  for (const n of wf.nodes) {
    dependencies[n.id] = [...n.dependsOn];
    dependents[n.id] = [];
  }
  for (const n of wf.nodes) {
    for (const dep of n.dependsOn) dependents[dep].push(n.id);
  }

  // Level = longest path from a root. Nodes sharing a level are independent.
  const level = new Map<string, number>();
  for (const id of order) {
    const deps = dependencies[id];
    const lvl = deps.length
      ? Math.max(...deps.map((d) => (level.get(d) ?? 0) + 1))
      : 0;
    level.set(id, lvl);
  }
  const maxLevel = Math.max(0, ...[...level.values()]);
  const levels: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const id of order) levels[level.get(id) ?? 0].push(id);

  const graph: GraphData = {
    nodes: wf.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      op: n.op,
      level: level.get(n.id) ?? 0,
      deterministic: n.deterministic,
      sideEffectSafe: n.sideEffectSafe,
      adapter: n.provider.adapter,
      model: n.provider.model,
    })),
    edges: wf.nodes.flatMap((n) =>
      n.dependsOn.map((d) => ({ from: d, to: n.id })),
    ),
    levels,
  };

  const planFingerprint = {
    workflow: wf.id,
    version: wf.version,
    order,
    dependencies,
    nodes: wf.nodes.map((n) => ({
      id: n.id,
      op: n.op,
      deterministic: n.deterministic,
      sideEffectSafe: n.sideEffectSafe,
      adapter: n.provider.adapter,
      model: n.provider.model,
    })),
  };

  return {
    irVersion: contentHash(planFingerprint),
    workflowId: wf.id,
    workflowVersion: wf.version,
    schemaVersion: wf.schemaVersion,
    order,
    dependents,
    dependencies,
    graph,
    compiledAt: new Date().toISOString(),
  };
}

function nodeIdFromPath(raw: unknown, path: (string | number)[]): string | undefined {
  if (
    raw &&
    typeof raw === "object" &&
    "nodes" in raw &&
    Array.isArray((raw as any).nodes) &&
    path[0] === "nodes" &&
    typeof path[1] === "number"
  ) {
    return (raw as any).nodes[path[1]]?.id;
  }
  return undefined;
}

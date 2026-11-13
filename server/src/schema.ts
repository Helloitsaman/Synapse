/**
 * SYNAPSE versioned workflow schema.
 *
 * A workflow is a set of nodes forming a directed acyclic graph. Each node
 * declares its operation type, dependencies, safety/determinism properties and
 * retry policy. The compiler turns a validated workflow into an executable IR.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";

/** Supported operation types. Anything else is rejected by the compiler. */
export const OP_TYPES = [
  "llm",
  "retrieval",
  "tool",
  "transform",
  "decision",
] as const;
export type OpType = (typeof OP_TYPES)[number];

/** Hard safety bound: no node may declare an unbounded or absurd timeout. */
export const MAX_TIMEOUT_MS = 120_000;
export const MIN_TIMEOUT_MS = 1;

const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).default(1),
    backoffMs: z.number().int().min(0).max(30_000).default(0),
  })
  .strict();

const providerMetaSchema = z
  .object({
    /** Which adapter family handles this node (demo | openai | http-tool). */
    adapter: z.string().min(1),
    /** Optional model identifier, only meaningful for llm nodes. */
    model: z.string().optional(),
  })
  .strict();

/**
 * Op-specific configuration. Kept permissive but validated per-op in the
 * compiler. We never execute arbitrary code from this object.
 */
const nodeConfigSchema = z.record(z.unknown()).default({});

export const nodeSchema = z
  .object({
    id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, {
      message: "node id must be alphanumeric/underscore/dash",
    }),
    op: z.enum(OP_TYPES),
    label: z.string().min(1),
    dependsOn: z.array(z.string()).default([]),
    inputs: z.array(z.string()).default([]),
    outputs: z.array(z.string()).default([]),
    timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS),
    provider: providerMetaSchema,
    /** Deterministic nodes may be memoized within a single run. */
    deterministic: z.boolean().default(false),
    /** Safe for concurrent execution: no observable side effects. */
    sideEffectSafe: z.boolean().default(false),
    /** Retrying this node produces no duplicate side effects. */
    idempotent: z.boolean().default(false),
    retry: retryPolicySchema.default({ maxAttempts: 1, backoffMs: 0 }),
    config: nodeConfigSchema,
  })
  .strict();

export const workflowSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string().min(1),
    description: z.string().default(""),
    version: z.string().min(1),
    nodes: z.array(nodeSchema).min(1),
  })
  .strict();

export type WorkflowNode = z.infer<typeof nodeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

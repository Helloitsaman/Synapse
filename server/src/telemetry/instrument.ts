/**
 * Replays a finished run's recorded spans into OpenTelemetry as correlated
 * traces + metrics. Only safe metadata is attached. A no-op tracer is used when
 * telemetry is disabled, so this is always safe to call.
 */
import { getMeter, getTracer, SpanStatusCode } from "./otel.js";
import type { RunRecord } from "../types.js";

let runCounter: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let nodeDuration:
  | ReturnType<ReturnType<typeof getMeter>["createHistogram"]>
  | null = null;

function meters() {
  if (!runCounter) {
    const meter = getMeter();
    runCounter = meter.createCounter("synapse.runs", {
      description: "Count of SYNAPSE runs by mode and status",
    });
    nodeDuration = meter.createHistogram("synapse.node.duration_ms", {
      description: "Per-node execution duration in ms",
    });
  }
  return { runCounter: runCounter!, nodeDuration: nodeDuration! };
}

export function instrumentRun(run: RunRecord): void {
  const tracer = getTracer();
  const { runCounter, nodeDuration } = meters();

  const parent = tracer.startSpan(`run ${run.workflowId}`, {
    startTime: run.startedAt,
    attributes: {
      "synapse.run_id": run.id,
      "synapse.workflow_id": run.workflowId,
      "synapse.workflow_version": run.workflowVersion,
      "synapse.ir_version": run.irVersion,
      "synapse.mode": run.mode,
      "synapse.concurrency": run.concurrency,
      "synapse.total_ms": run.totalMs,
      "synapse.overhead_ms": run.overheadMs,
      "synapse.usage.calls": run.usage.calls,
      "synapse.usage.tokens": run.usage.inputTokens + run.usage.outputTokens,
      "synapse.usage.source": run.usage.source,
      // Cost may be UNKNOWN (null); surface -1 + a known flag rather than a
      // misleading 0 that would read as a free run.
      "synapse.estimated_cost_usd": run.estimatedCostUsd ?? -1,
      "synapse.cost_known": run.estimatedCostUsd != null,
      "synapse.provenance_mode": run.execution?.provenanceMode ?? "demo",
      "synapse.validation.passed": run.validation?.passed ?? false,
    },
  });

  for (const span of run.spans) {
    const child = tracer.startSpan(
      `node ${span.nodeId}`,
      {
        startTime: span.startedAt ?? run.startedAt,
        attributes: {
          "synapse.node_id": span.nodeId,
          "synapse.op": span.op,
          "synapse.adapter": span.adapter,
          "synapse.status": span.status,
          "synapse.attempts": span.attempts,
          "synapse.queue_ms": span.queueMs,
          "synapse.exec_ms": span.execMs,
          "synapse.memoized": span.memoized,
          "synapse.usage.calls": span.usage.calls,
          "synapse.usage.tokens": span.usage.inputTokens + span.usage.outputTokens,
        },
      },
    );
    if (span.status === "failed") {
      child.setStatus({ code: SpanStatusCode.ERROR, message: span.error });
    }
    nodeDuration.record(span.execMs, {
      op: span.op,
      adapter: span.adapter,
      mode: run.mode,
      status: span.status,
    });
    child.end(span.endedAt ?? run.endedAt);
  }

  parent.setStatus({
    code: run.status === "failed" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
  });
  runCounter.add(1, { mode: run.mode, status: run.status });
  parent.end(run.endedAt);
}

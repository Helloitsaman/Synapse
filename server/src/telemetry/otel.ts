/**
 * Optional OpenTelemetry wiring.
 *
 * SYNAPSE runs fully without telemetry. When OTEL is enabled (env), we start a
 * NodeSDK with an OTLP/HTTP exporter so a SigNoz instance can receive traces and
 * metrics. We export ONLY safe metadata (operation type, adapter, status,
 * duration, retries, usage totals) — never prompt/output bodies or secrets.
 */
import { trace, metrics, SpanStatusCode, type Tracer, type Meter } from "@opentelemetry/api";

let started = false;
let sdk: any = null;

export function otelEnabled(): boolean {
  return (
    process.env.SYNAPSE_OTEL_ENABLED === "1" ||
    process.env.SYNAPSE_OTEL_ENABLED === "true" ||
    !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  );
}

export function otelConfig() {
  return {
    enabled: otelEnabled(),
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
    serviceName: process.env.OTEL_SERVICE_NAME ?? "synapse",
    started,
  };
}

export async function initTelemetry(): Promise<void> {
  if (!otelEnabled() || started) return;
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    const { OTLPMetricExporter } = await import(
      "@opentelemetry/exporter-metrics-otlp-http"
    );
    const { PeriodicExportingMetricReader } = await import(
      "@opentelemetry/sdk-metrics"
    );
    const { Resource } = await import("@opentelemetry/resources");
    const { SemanticResourceAttributes } = await import(
      "@opentelemetry/semantic-conventions"
    );

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME ?? "synapse",
        [SemanticResourceAttributes.SERVICE_VERSION]: "0.1.0",
      }),
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 10_000,
      }) as any,
    });
    await sdk.start();
    started = true;
    // eslint-disable-next-line no-console
    console.log(`[telemetry] OpenTelemetry started -> ${endpoint}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[telemetry] Failed to start OpenTelemetry (continuing without it): ${(err as Error).message}`,
    );
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk && started) {
    try {
      await sdk.shutdown();
    } catch {
      /* ignore */
    }
  }
}

export function getTracer(): Tracer {
  return trace.getTracer("synapse");
}
export function getMeter(): Meter {
  return metrics.getMeter("synapse");
}
export { SpanStatusCode };

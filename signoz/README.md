# Observability — OpenTelemetry & SigNoz

SYNAPSE instruments every run and node with correlated OpenTelemetry **traces**
and **metrics**. Export is **off by default** and **never required** to run
SYNAPSE. Only safe metadata is exported — operation type, adapter, status,
duration, retry count, usage totals — **never** prompt/output bodies or secrets.

## What gets exported

| Signal | Name | Attributes (safe metadata only) |
| ------ | ---- | ------------------------------- |
| Span (run) | `run <workflowId>` | run id, workflow/ir version, mode, concurrency, total/overhead ms, usage totals, estimated cost, validation.passed |
| Span (node) | `node <nodeId>` | op, adapter, status, attempts, queue ms, exec ms, memoized, usage |
| Metric | `synapse.runs` (counter) | mode, status |
| Metric | `synapse.node.duration_ms` (histogram) | op, adapter, mode, status |

## Option A — quick verification (bundled collector)

Confirms SYNAPSE's OTLP export works, printing received telemetry to stdout. No
heavy stack required.

```bash
docker compose -f signoz/docker-compose.yml up        # starts an OTLP collector on 4317/4318

# In another shell, run SYNAPSE pointed at it:
SYNAPSE_OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm start
# Trigger a run from the UI — spans/metrics appear in the collector logs.
```

## Option B — full SigNoz UI

SigNoz gives you dashboards and a trace explorer.

```bash
git clone -b main https://github.com/SigNoz/signoz.git
cd signoz/deploy/docker
docker compose up -d                                  # SigNoz UI on http://localhost:3301
```

SigNoz's bundled OTel collector listens on OTLP `4317`/`4318`. Point SYNAPSE at it:

```bash
SYNAPSE_OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm start
```

Then open SigNoz → **Services** → `synapse` to see traces and the
`synapse.node.duration_ms` / `synapse.runs` metrics. In the SYNAPSE
**Integrations** view, the OTLP status reflects whether export is configured and
started.

> Note: SYNAPSE deliberately does **not** try to recreate SigNoz. It ships its
> own branded dashboard (workflow graphs, transformations, correctness,
> comparisons) and uses SigNoz only as the telemetry backend when you want one.

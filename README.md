# SYNAPSE

**An intelligent compiler and runtime for AI-agent workflows.** SYNAPSE analyzes
a workflow as a dependency graph, compiles it to a versioned intermediate
representation (IR), safely optimizes execution (dependency-aware parallelism +
within-run memoization), measures the results with clearly-labelled provenance,
and presents everything in a neon cyberpunk operations console.

Ships a **deterministic local demo that needs no API keys**. Simulated values are
labelled as such; SYNAPSE never presents simulated usage or estimated cost as a
real provider measurement.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Install & run](#install--run)
- [Environment variables](#environment-variables)
- [Test commands](#test-commands)
- [Architecture](#architecture)
- [API reference](#api-reference)
- [Optional: OpenAI-compatible model](#optional-openai-compatible-model)
- [Observability: OTLP / SigNoz](#observability-otlp--signoz)
- [Importing your own workflow](#importing-your-own-workflow)
- [Security & privacy](#security--privacy)
- [Known limitations](#known-limitations)

---

## Prerequisites

- **Node.js ≥ 20** (developed on Node 22) and npm
- Optional: **Docker** (only for SigNoz / an OTLP collector)

## Install & run

```bash
# from the synapse/ directory
npm run install:all          # installs server + web deps

# Option 1 — dev mode (hot reload): backend :4000 + Vite :5173 (proxies /api)
npm run dev
# open http://localhost:5173

# Option 2 — single-origin (build web, serve it from the backend)
npm run build                # builds web/dist
npm start                    # backend serves API + UI on http://localhost:4000
# open http://localhost:4000
```

First action in the UI: **▶ Run Demo Workflow** on the Overview — it runs a
baseline (sequential) then an optimized (parallel) execution of the *Research
Brief* workflow and drops you on the labelled comparison.

Want to try your own graph without touching the API? Open **Workflow Studio** in
the sidebar: edit (or clone) a workflow as JSON, validate it against the
versioned schema in place, then **Import & Open** to compile, optimize and run
it in the Workflow Lab. Imported workflows can be deleted from the same view;
built-in samples are protected.

> Windows note: this repo was built and verified on Windows 11 with Git Bash and
> PowerShell. All commands above are cross-platform via npm scripts.

## Environment variables

All optional — SYNAPSE runs fully in demo mode with none set. See
[`.env.example`](./.env.example). Secrets are **server-side only** and never sent
to the browser.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `PORT` | `4000` | Backend port |
| `RATE_LIMIT` | `600` | Max API requests / IP / minute |
| `SYNAPSE_DATA_DIR` | `server/data` | Where run summaries + workflow defs persist |
| `OPENAI_API_KEY` | — | Enables the opt-in OpenAI-compatible adapter |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default model for `openai` llm nodes |
| `TOOL_ALLOWLIST` | — (empty) | Comma-separated hostnames the HTTP tool adapter may reach |
| `SYNAPSE_OTEL_ENABLED` | `0` | Force-enable OpenTelemetry export |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP endpoint (also enables export) |
| `OTEL_SERVICE_NAME` | `synapse` | Service name in telemetry |

## Test commands

```bash
npm test            # backend unit + integration + API tests (vitest)
npm run typecheck   # strict TypeScript typecheck for server + web
```

**Latest result:** `32 passed (32)` across 5 files — compiler validation & cycle
detection, scheduler dependencies/concurrency/cancellation/retries, optimizer
preconditions & no-op, correctness validation, and API behaviour (incl. a
baseline-vs-optimized run + compare smoke check, workflow import/delete, and
built-in-sample delete protection). See
[Test commands output](#test-commands) in the delivery summary below.

## Architecture

```
synapse/
├── server/                      TypeScript backend (Express, ESM, tsx)
│   ├── src/
│   │   ├── schema.ts            Versioned workflow schema (Zod) + bounds
│   │   ├── compiler/compile.ts  Validate → topo-sort → DAG IR + graph data
│   │   ├── optimizer/           Transformation registry + decision records
│   │   ├── runtime/
│   │   │   ├── scheduler.ts     Dependency-aware engine: parallelism, timeouts,
│   │   │   │                    retries, cancellation, within-run memoization
│   │   │   ├── cost.ts          Cost ESTIMATION (demo price table)
│   │   │   ├── compare.ts       Labelled baseline/optimized comparison
│   │   │   └── orchestrator.ts  Service layer wiring it all together
│   │   ├── adapters/            Provider-neutral contract + demo/openai/http-tool
│   │   │   └── hosts.ts         Honest host capability matrix
│   │   ├── correctness/         Pluggable correctness tests
│   │   ├── telemetry/           OpenTelemetry (optional) + redacting logger
│   │   ├── store/               JSON persistence (ephemeral run context)
│   │   ├── workflows/           Sample workflows (incl. Research Brief)
│   │   └── api/routes.ts        Documented HTTP API
│   └── test/                    vitest suites
├── web/                         Vite + React + TypeScript frontend
│   └── src/
│       ├── views/               Overview, WorkflowLab, WorkflowStudio,
│       │                        RunComparison, RunDetails, Integrations
│       ├── graph/               Interactive SVG dependency graph
│       ├── components/          Design-token primitives (panels, spotlight, …)
│       └── styles/              Cyberpunk design tokens + global CSS
├── examples/                    Workflow import example (adapter path)
├── signoz/                      OTLP collector compose + SigNoz instructions
└── .env.example
```

### Compiler & IR
A workflow is a set of nodes, each with a stable id, op type (`llm`,
`retrieval`, `tool`, `transform`, `decision`), declared inputs/outputs,
dependencies, bounded timeout, provider metadata, and determinism / side-effect /
retry-idempotency flags. The compiler rejects invalid workflows with actionable
errors — duplicate ids, missing dependencies, cycles (with the concrete cycle
path), invalid schema/types, unsupported ops, unsafe/unbounded timeouts, and
malformed config — then emits a DAG IR with a stable content-hash `irVersion`, a
topological execution order, adjacency, and layered graph data for the UI.

### Optimizer
A transformation registry evaluates safe transformations and records a decision
for each (id, rationale, preconditions checked, confidence, expected benefit,
accepted/rejected/no-op, affected nodes):
- **Parallelize independent branches** — only nodes that share a level *and* are
  declared `sideEffectSafe`. Unsafe independent nodes are explicitly excluded and
  named.
- **Within-run memoization** — deterministic, side-effect-safe nodes keyed by
  canonicalized inputs; single-run scope only (no cross-run / cross-user cache).
- **No-op** — emitted for short/linear workflows where overhead would not pay off.

It never rewrites prompts, swaps models, removes steps, or uses cross-run
semantic caching.

### Runtime
Baseline = concurrency 1 (sequential). Optimized = bounded parallelism at the
optimizer's suggested concurrency, plus memoization. The engine never starts a
node before its dependencies succeed; it enforces per-node timeouts, retries with
backoff, cooperative cancellation, and per-node states
(`pending/queued/running/retrying/succeeded/failed/skipped/cancelled/memoized`).
Total latency and SYNAPSE overhead are measured and reported **separately**.

### Measurement provenance
Every number is tagged: **measured** (wall-clock, counts), **provider-reported**
(when a real provider returns usage), **estimated** (cost), or **simulated**
(demo usage). Comparisons use the same workflow + input, show the sample count
(1 per mode by default), and never imply statistical significance. If the
optimized run is similar or slower, SYNAPSE shows that honestly.

## API reference

Base path `/api`. Errors return `{ "error": { "code", "message" } }`; validation
failures return `422` with `{ ok:false, errors:[{code,message,nodeId?,path?}] }`.

| Method & path | Purpose |
| ------------- | ------- |
| `GET /health` | Liveness + schema version |
| `GET /config` | Feature flags, telemetry + privacy config, demo-mode (no secrets) |
| `GET /workflows` | List workflow summaries |
| `GET /workflows/:id` | Load a workflow definition |
| `POST /workflows/:id/compile` | Compile + validate a stored workflow → IR |
| `POST /compile` | Compile + validate an arbitrary workflow body |
| `POST /workflows` | Validate + import/save a workflow |
| `DELETE /workflows/:id` | Delete an imported workflow (built-in samples are protected) |
| `POST /workflows/:id/optimize/preview` | IR + optimization plan |
| `POST /runs` | Start a run `{ workflowId, mode, concurrency? }` |
| `GET /runs` | List run summaries |
| `GET /runs/:id` | Full run record (spans + validation) |
| `GET /runs/:id/events` | **SSE** live node-state stream (poll `GET /runs/:id` as fallback) |
| `POST /runs/:id/cancel` | Cancel an active run |
| `DELETE /runs/:id` | Delete a persisted run |
| `GET /compare?baseline=&optimized=` | Labelled comparison |
| `GET /integrations` | Adapter capability matrix + host matrix + telemetry status |

## Optional: OpenAI-compatible model

Set `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL` / `OPENAI_MODEL`) on the
**server**, then give an `llm` node `"provider": { "adapter": "openai", "model":
"…" }`. The adapter calls `/chat/completions`, captures **provider-reported**
usage when returned, and fails cleanly (keeping demo mode usable) if the provider
is unreachable or unconfigured. Keys are never exposed to the browser. The
deterministic demo comparison always uses the `demo` adapter.

## Observability: OTLP / SigNoz

Off by default and never required. See [`signoz/README.md`](./signoz/README.md).
Quick verify:

```bash
docker compose -f signoz/docker-compose.yml up        # OTLP collector on 4317/4318
SYNAPSE_OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm start
```

Runs and nodes become correlated traces; `synapse.runs` and
`synapse.node.duration_ms` become metrics. Only safe metadata is exported — never
prompt/output bodies or secrets.

## Importing your own workflow

Map your agent framework's graph onto the SYNAPSE node schema and POST it. A
working example lives in [`examples/`](./examples):

```bash
npm start                          # in one shell
node examples/import-workflow.mjs  # in another — compiles, imports, runs, compares
```

## Security & privacy

- **Instruction boundary:** workflow config is data, never executed as code.
- **Redaction:** prompt/output bodies are redacted from logs/traces by default;
  secrets are never logged. Telemetry is metadata-only.
- **Ephemeral run context:** node I/O bodies are not persisted; only run
  summaries + workflow defs are. Runs are deletable.
- **SSRF protection:** the HTTP tool adapter enforces a host allowlist, blocks
  private/loopback/metadata IP ranges (including IPv4-mapped IPv6), refuses
  redirects and credentials-in-URL, and caps response size. The outbound
  connection is **pinned to the validated IP address** (the original hostname is
  kept for the `Host` header and TLS certificate), closing the DNS
  time-of-check/time-of-use (rebinding) gap.
- **Network exposure:** the server **binds to loopback (`127.0.0.1`) by default**,
  so it is not reachable from the network unless you set `HOST=0.0.0.0`. Before
  exposing it, set `API_AUTH_TOKEN` (every `/api` request except `/health` must
  then send it as `Authorization: Bearer <token>` or `x-api-key`) and restrict
  cross-origin access with `CORS_ORIGINS` (empty = same-origin only). The
  unauthenticated, open-CORS mode is for local development only; the server logs
  a warning if it binds to a non-loopback address without a token.
- **Input limits:** JSON body cap, per-IP rate limiting (with a bounded,
  self-pruning client table), bounded timeouts, safe error responses that don't
  leak internals.
- **No hidden-context claims:** the host matrix describes each AI app accurately
  (workflow-optimization / model-tool-gateway / telemetry-only / unsupported).
  SYNAPSE does not claim access to private model context or transparent
  interception.

## Known limitations

- **Demo values are simulated.** With the demo adapter, node outputs, token
  counts and therefore costs are illustrative — labelled `simulated` /
  `estimated` throughout. Only wall-clock, counts and overhead are `measured`.
- **Single sample per mode.** Comparisons run once per mode by default; timings
  vary run-to-run and are not a statistically significant benchmark.
- **Persistence is a JSON file store**, suitable for a local prototype (chosen
  over a native DB for zero-build portability on Windows). Not for concurrent
  multi-process use.
- **OpenAI adapter is non-deterministic** and excluded from the deterministic
  comparison; it covers `llm` nodes only.
- **SigNoz is optional** and not bundled; the repo ships a lightweight OTLP
  collector for verification and instructions to connect a full SigNoz.
- The install step may warn that some dependencies' install scripts (e.g.
  `esbuild`) were blocked by the sandbox; the toolchain still builds and tests
  pass — approve them (`npm install`) outside a restricted sandbox if desired.

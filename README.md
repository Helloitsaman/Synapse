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
- [Live research slice (opt-in)](#live-research-slice-opt-in)
- [Optional: OpenAI-compatible model](#optional-openai-compatible-model)
- [MCP integrations](#mcp-integrations)
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
| `OPENAI_API_KEY` | — | Enables the opt-in OpenAI-compatible model adapter |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default model for `openai` llm nodes |
| `ANTHROPIC_API_KEY` | — | Enables the opt-in Anthropic (Claude) model adapter |
| `ANTHROPIC_MODEL` | `claude-3-5-haiku-latest` | Default model for `anthropic` llm nodes |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | — | Enables the opt-in Google Gemini model adapter |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Default model for `gemini` llm nodes |
| `SEARCH_PROVIDER` | — | `tavily` \| `brave` \| `serpapi` — enables the live `search` retrieval adapter |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPAPI_API_KEY` | — | Key for the chosen search provider |
| `SYNAPSE_LIVE_MODEL_ADAPTER` | `anthropic` | Which model adapter the built-in *Research Brief (Live)* uses |
| `SYNAPSE_LIVE_MODEL` | per-adapter default | Model id the live workflow requests |
| `TOOL_ALLOWLIST` | — (empty) | Comma-separated hostnames the HTTP tool adapter may reach |
| `SYNAPSE_OTEL_ENABLED` | `0` | Force-enable OpenTelemetry export |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP endpoint (also enables export) |
| `OTEL_SERVICE_NAME` | `synapse` | Service name in telemetry |
| `SYNAPSE_API_BASE_URL` | `http://127.0.0.1:4000` | Backend URL used by local stdio MCP process |
| `SYNAPSE_API_TOKEN` | `API_AUTH_TOKEN` | Optional bearer token for MCP-to-API calls |

## Test commands

```bash
npm test            # backend unit + integration + API tests (vitest)
npm run typecheck   # strict TypeScript typecheck for server + web
```

**Latest result:** `69 passed (69)` across 11 files — compiler validation & cycle
detection, scheduler dependencies/concurrency/cancellation/retries, optimizer
preconditions & no-op, correctness/citation validation, API behaviour, MCP tool
discovery/input validation, **live search adapter** parsing/errors/rate-limit/
cancellation, **model adapters** (OpenAI/Anthropic/Gemini) usage provenance &
citation extraction, and an **end-to-end live slice** (search → model → cited
answer) run against deterministic fake providers. Live tests use fake servers, so
no paid API credentials are needed to run the suite.

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
│   │   ├── adapters/            Provider-neutral contract + adapters:
│   │   │   │                    demo, search (tavily/brave/serpapi),
│   │   │   │                    openai, anthropic, gemini, http-tool
│   │   │   ├── research.ts      Shared source-grounding/citation helpers
│   │   │   ├── modelBase.ts     Shared grounded-prompt/usage helpers
│   │   │   └── hosts.ts         Honest host capability matrix
│   │   ├── mcp/                  MCP stdio server + shared tool definitions
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
| `POST /mcp` | Stateless Streamable HTTP MCP endpoint (POST JSON-RPC) |

## Live research slice (opt-in)

SYNAPSE ships two research workflows with the **same graph shape** so you can
compare demo and live honestly:

- **Research Brief** (`research-brief`) — the deterministic **demo** path. Needs
  no keys. Every output is labelled `provenance: "demo"` and usage `simulated`.
- **Research Brief (Live)** (`research-brief-live`) — the **live** path: two
  independent **real web-search** branches (`search` adapter) feed **real model**
  summaries + a synthesis (`openai` / `anthropic` / `gemini`), then a
  deterministic formatting transform. Outputs are labelled `provenance: "live"`
  and usage `provider-reported`.

Both produce one structured, **cited** document: each claim is grounded in
retrieved sources carried end-to-end (title, canonical URL, publisher, retrieval
time, snippet/content, stable source id), citations are inline `[sourceId]`
markers, and the correctness suite verifies every cited id resolves to a
retrieved source and flags any the model invented.

### Make the live slice work

1. Pick a **search** provider and set its key, e.g. `SEARCH_PROVIDER=tavily` +
   `TAVILY_API_KEY=…` (Brave and SerpAPI are also supported).
2. Pick a **model** provider and set its key, e.g. `ANTHROPIC_API_KEY=…`, and
   choose which the live workflow uses via `SYNAPSE_LIVE_MODEL_ADAPTER` /
   `SYNAPSE_LIVE_MODEL`.
3. Start the backend. `GET /api/config` → `demoMode: false` and
   `live.researchReady: true` confirm both are wired.
4. Run it (UI **Workflow Lab**, the API, or **Claude Code MCP** — see below). A
   live run calls paid providers; SYNAPSE marks it clearly and only runs on
   request.

Every number stays labelled: `measured` (wall-clock/counts), `provider-reported`
(real usage), `estimated` (cost — providers return no dollar charge), `simulated`
(demo), or `unavailable` (a real provider ran but returned no usage — never
invented). If a requested live provider is unconfigured, the node **fails
cleanly** — SYNAPSE never substitutes demo output for a live node.

### Run the live slice from Claude Code (MCP)

```text
list SYNAPSE workflows
run the research-brief-live workflow (optimized) with topic "<your topic>"
get the SYNAPSE run result for <runId>
```

The run result reports which adapters ran, the retrieved sources, live-vs-demo
provenance, provider-reported usage, latency + SYNAPSE overhead, the correctness
checks, and the cited answer. See
[`docs/LIVE-SLICE.md`](./docs/LIVE-SLICE.md) for a full walkthrough (including a
no-key smoke test against local fake providers).

## Optional: OpenAI-compatible model

Set `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL` / `OPENAI_MODEL`) on the
**server**, then give an `llm` node `"provider": { "adapter": "openai", "model":
"…" }`. The adapter calls `/chat/completions`, captures **provider-reported**
usage when returned (labelling it `unavailable` otherwise), and fails cleanly if
the provider is unreachable or unconfigured. `anthropic` and `gemini` adapters
work the same way for their APIs. Keys are never exposed to the browser. The
deterministic demo comparison always uses the `demo` adapter.

## MCP integrations

SYNAPSE exposes its existing backend to MCP clients. Local clients can spawn a
stdio server with `npm --prefix server run mcp`; the main backend also exposes a
stateless Streamable HTTP endpoint at `POST /mcp`. MCP tools list and compile
workflows, preview optimizations, import a validated workflow, start a run,
fetch run results, and compare runs. The stdio process talks to the same running
SYNAPSE API, so start the backend first (`npm run dev:server` or `npm start`).

See [`docs/MCP-INTEGRATIONS.md`](./docs/MCP-INTEGRATIONS.md) for setup examples
and the compatibility matrix. MCP connects supported **host applications**;
it does not make every model or consumer chat app installable, reveal hidden
conversation context, or automatically take over a host's own execution graph.
SYNAPSE runs a graph when the host or user explicitly supplies/imports it.

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
- **Live model/search adapters are non-deterministic** and excluded from the
  deterministic demo comparison. Model adapters cover `llm` nodes; the `search`
  adapter covers `retrieval` nodes.
- **Live providers are validated by automated integration tests against
  deterministic fake servers, and by a documented fake-provider MCP smoke run.** A
  real paid-provider smoke run requires your own keys and is opt-in — the suite
  never needs them. Citation grounding is checked structurally (every cited id
  resolves to a retrieved source, no invented ids); the topic-relevance check is a
  labelled heuristic, not a factual-accuracy judgment.
- **The delivered answer + cited source metadata are persisted** with the run (it
  is the product of the run); intermediate prompts and node I/O bodies remain
  ephemeral and are not persisted.
- **SigNoz is optional** and not bundled; the repo ships a lightweight OTLP
  collector for verification and instructions to connect a full SigNoz.
- The install step may warn that some dependencies' install scripts (e.g.
  `esbuild`) were blocked by the sandbox; the toolchain still builds and tests
  pass — approve them (`npm install`) outside a restricted sandbox if desired.

# SYNAPSE Problems 2: Live MCP, Real Adapters, and Honest Comparisons

## Purpose

Use this document as an implementation brief for turning the current SYNAPSE prototype into a genuinely useful MCP-connected workflow compiler and runtime. Read the existing `README.md`, `problems1.md`, `docs/MCP-INTEGRATIONS.md`, workflow schema, adapter contract, runtime, tests, and UI before changing code. Preserve the current demo mode; add real execution as an explicit, clearly-labelled mode.

## Current state and issues observed

The current project successfully exposes workflow tools over MCP and executes dependency-aware graphs. The sample `research-brief` run demonstrated that Claude Code can call SYNAPSE, but it used demo adapters. Its `retrieve_a` and `retrieve_b` nodes generated synthetic `SRC-A`/`SRC-B` records, and its model nodes generated deterministic placeholder summaries. It did not search the web or produce findings about OpenClaw.

The measured 1.52x improvement (1,665 ms baseline vs. 1,093 ms optimized) came from parallelizing artificial node delays. It demonstrates scheduler behavior only. The token counts and dollar cost were simulated/estimated. One run per mode is not a reliable benchmark. The memoization transformation was enabled but did no work because there was no duplicate computation.

The project has an opt-in OpenAI-compatible adapter, but the built-in research workflow selects the `demo` adapter. The OpenAI adapter supports only `llm` nodes; it does not provide live retrieval. The generic `http-tool` adapter is not a substitute for a maintained search/retrieval integration, source-quality controls, and citation handling. Passing an MCP workflow input also does not expose Claude Code's hidden conversation, account credentials, or model runtime to the SYNAPSE backend.

Correctness checks currently validate the expected shape and source labels of the sample output. That is useful for scheduler regression tests but does not establish factual accuracy, citation support, or answer equivalence for a real research task. Do not describe these checks as proving factual correctness.

The MCP connection itself works in local protocol tests and has local stdio plus a stateless Streamable HTTP endpoint. It has not been end-to-end verified against every supported host. Remote HTTP currently uses one shared API token; there is no per-user OAuth/account linking or tenant isolation. The local JSON store is suitable for a prototype, not concurrent multi-user hosting.

## Required outcome

Implement and document a real end-to-end workflow that accepts a user task and explicit inputs, retrieves live information, calls configured real model providers, produces a useful answer with source citations, records provenance and metrics, validates the answer, and can be run in baseline and optimized modes through both the UI and MCP. No output or metric may imply live execution when a demo adapter ran.

## Implementation requirements

### 1. Live model adapters

- Keep the provider-neutral adapter contract and add production-quality adapters for at least OpenAI, Anthropic, and Google Gemini, plus a generic OpenAI-compatible endpoint where practical.
- Select adapter/provider/model per workflow node. Keep credentials server-side, support cancellation, bounded timeouts, retry policy that respects provider errors/rate limits, and safe error messages. Never log keys, prompts, or full model outputs by default.
- Capture provider-reported input/output tokens, model/version, request ID where available, latency, finish state, and retry count. If a provider does not return usage, label it unavailable rather than inventing it.
- Make credential setup explicit and show adapter availability in `/integrations` and the UI. Never silently fall back from a requested live provider to demo output.
- A Claude Code MCP connection does not grant SYNAPSE access to Claude's subscription/session. Anthropic API execution requires credentials/configuration supported by the user. Do not claim that SYNAPSE can call a host model through MCP unless a separate, explicit host-delegation design is implemented and verified.

### 2. Live retrieval and source-grounded output

- Add a retrieval adapter for a real search provider (for example, a configurable Brave/Tavily/Serp provider) and a safe fetch/extract path for returned pages. Keep provider credentials on the server.
- Return structured results with title, canonical URL, publisher, retrieval time, snippet/content, and stable source ID. Preserve these records through summarization and synthesis so the final answer can cite claims to actual sources.
- Enforce domain/IP allowlists or safe search-provider APIs, SSRF protection, response-size/content-type limits, redirect policy, and clear source-fetch errors.
- Pass workflow inputs such as `topic`, dates, result limits, and user constraints into nodes. Ensure each adapter uses the inputs and upstream outputs rather than hard-coded demo values.
- Add a real research workflow with a live provider configuration and a clear mode selector (demo/live). Use at least two genuinely independent retrieval branches if the example is intended to demonstrate parallelism.
- Make clear in the UI and MCP result which adapters ran, which sources were retrieved, and whether retrieval/model outputs are live, cached, mocked, or unavailable.

### 3. MCP behavior and client verification

- Keep MCP tools aligned with the actual runtime capabilities: discover/import/compile workflows, preview optimization, run/cancel, retrieve detailed results, compare runs, and validate outputs. Return useful structured content and clear action/errors to hosts.
- Ensure a live run is only executed when requested; display that a run may incur provider charges or access external services. Validate inputs and avoid accidental duplicate/unsafe side effects.
- Maintain correct stdio behavior (JSON-RPC only on stdout; diagnostics on stderr) and conform to Streamable HTTP expectations, auth handling, request limits, and clean transport lifecycle.
- Test through the MCP SDK/Inspector and perform a documented end-to-end smoke test with Claude Code. Record separate, honest compatibility status for Claude Desktop/Claude.ai, Codex, Gemini CLI/API, and any other host; do not infer support for a model from another host's support.
- Document local setup, environment variables, example MCP configuration, live provider configuration, troubleshooting, data flow, privacy, and how to run the example. Keep secrets out of committed configs.

### 4. Correctness and quality evaluation

- Separate structural validation (schema, required fields, graph invariants) from semantic/factual evaluation (claim support, citation validity, relevance, completeness, and task-specific assertions).
- Let workflows define explicit correctness/evaluation cases and expected invariants. Add a repeatable evaluation set for the live research example and report per-check outcomes, not a single unexplained pass/fail.
- Verify each cited source exists in retrieved results and that cited claim/source mappings are valid. Where an LLM judge is used, label it as an estimate and retain a human-review option; do not treat it as ground truth.
- Compare baseline and optimized outputs for material equivalence using task-specific checks. Surface differences and failed checks. Never claim correctness is preserved merely because the JSON shape is unchanged.
- Add tests with deterministic fake provider servers for adapter parsing, errors, rate limits, cancellation, provenance, and workflow input flow; keep live integration tests opt-in so normal tests need no paid API credentials.

### 5. Fair baseline vs. SYNAPSE comparison

Provide two clearly distinguished comparisons:

1. **Runtime baseline vs. optimized:** Execute the same compiled workflow, inputs, provider/model versions, search provider/settings, and correctness suite. Baseline disables SYNAPSE transformations (sequential execution); optimized enables only precondition-approved transformations. Run multiple paired repetitions, randomize or alternate run order where possible, and report sample count, median and p95 latency, per-node timing, end-to-end time, SYNAPSE overhead, failures/retries, provider-reported tokens, actual provider-reported or carefully labelled estimated cost, and correctness/evaluation outcomes. Explain which graph transformation caused any difference. Do not promise savings: parallelism can be limited by provider latency/rate limits, and memoization only saves work when the same safe computation repeats.

2. **Regular prompting vs. SYNAPSE:** Define the baseline precisely. For an apples-to-apples runtime comparison, execute the equivalent unoptimized sequence through the same providers and retrieval sources. If comparing against a model host's normal chat prompt (for example, Claude Code without a SYNAPSE workflow), collect that run's prompt, model, tools, inputs, outputs, usage, and latency through a supported host/API integration or user-provided export. Mark missing/unverifiable metrics as unavailable. Do not compare unrelated prompts, different model versions, different source sets, or hidden host usage as if they were equivalent.

The dashboard and MCP comparison result must state whether the comparison is a controlled paired benchmark or an externally supplied host baseline. Include output-quality/correctness differences alongside speed and cost. Label every measurement as measured, provider-reported, estimated, simulated, or unavailable. Never compare a simulated SYNAPSE run against a live regular-prompt run and present the difference as a real gain.

### 6. Dashboard and telemetry

- Extend the existing dashboard and optional SigNoz/OpenTelemetry integration to show workflow DAG, node execution timeline, adapters/models, retrieved source links, optimization decisions and preconditions, correctness results, provenance, run repetitions, and baseline/optimized deltas.
- Clearly distinguish per-run performance from aggregate distributions. Show a no-gain/regression honestly. Include Synapse orchestration overhead so small workflows do not appear faster solely by hiding compiler/runtime cost.
- Keep telemetry metadata-only by default, redact credentials, and make prompt/content capture an explicit opt-in with retention controls. Avoid sending user workflow data to SigNoz unless configured.

### 7. Hosted use and data safety

- Keep local stdio usable without account setup. Before a shared hosted service, implement per-user authentication (OAuth for MCP clients where supported), authorization, tenant isolation, per-user provider credential management, audit trail, quotas, deletion/retention controls, and encrypted storage. A single shared API token is not multi-user account linking.
- Replace or wrap the local JSON store for concurrent hosted use with a transactional database, migrations, access control, and backup/recovery. Do not persist raw prompt/context/output unless explicitly enabled and documented.
- Document threat model, external tool permissions, cost/usage limits, and production deployment configuration.

## Suggested delivery order

1. Audit and document current code paths and limitations; add a live/demo indicator end to end.
2. Make one live vertical slice work: real retrieval → real model summarization/synthesis → cited answer through the API, dashboard, and Claude Code MCP.
3. Add the second provider adapter and configurable credentials; implement robust adapter tests.
4. Add structural and semantic evaluation cases and run baseline/optimized paired benchmarks with repetitions.
5. Improve dashboard/SigNoz views and document regular-prompt comparison limitations and procedure.
6. Add hosted auth, tenant isolation, database, deployment, and security review before multi-user launch.

## Definition of done

- A user can connect Claude Code to a running local SYNAPSE MCP server, supply a task and inputs, and receive a substantive answer based on live retrieved sources and a configured live model.
- The run record identifies every adapter, provider/model, source, provenance label, timing, usage/cost basis, retry/error, and evaluation outcome. No secrets or sensitive content are leaked to logs or telemetry.
- The same task can run baseline and optimized with controlled settings and several repetitions. The comparison reports distributions and quality/correctness differences, transparently labels unavailable/simulated values, and explains the transformations applied.
- Tests prove dependency/scheduling safety and adapter behavior; a Claude Code end-to-end guide is followed successfully. Unsupported host surfaces are clearly labelled instead of advertised as working.
- Demo mode still works without credentials, but cannot be mistaken for live research or real token/cost results.

## Instructions to the implementation agent

Inspect the repository before editing. Implement the working vertical slice rather than only changing documentation or adding placeholder adapters. Do not claim production readiness, live research, correctness, or cost savings until evidenced by tests and real-provider smoke runs. Keep provider calls opt-in and cost-conscious; run paid live tests only when credentials are configured and the user explicitly asks for them. Update the main README, MCP setup guide, example `.env.example`, UI, tests, and this problem log as implementation changes land. Report completed features separately from remaining limitations.

---

## Implementation status — 2026-11-15 (vertical slice landed)

### Completed (evidenced by tests + a fake-provider MCP smoke run)

- **Live retrieval adapter** (`server/src/adapters/search.ts`): provider-neutral,
  supports Tavily / Brave / SerpAPI, server-side keys, bounded timeout +
  cancellation, 429→`RATE_LIMITED` and error→`PROVIDER_ERROR` mapping, structured
  source records (title, canonical URL, publisher, retrieval time, snippet,
  provider-extract content, stable source id, `provenance: "live"`). Query is
  built from node config + workflow inputs (`{topic}` template / angle). Content
  comes from the provider's own extract API (no arbitrary page fetch → no new SSRF
  surface). Tests: `server/test/search.test.ts`.
- **Live model adapters** for **OpenAI, Anthropic, and Gemini**
  (`openai.ts`, `anthropic.ts`, `gemini.ts` on a shared `modelBase.ts`): grounded,
  citation-instructed prompts; provider-reported usage (model, tokens, request id,
  finish reason) captured and labelled `unavailable` when absent (never invented);
  per-node adapter/provider/model selection; clean errors; keys never logged or
  exposed. Tests: `server/test/modelAdapters.test.ts`.
- **Source-grounded, cited output** end-to-end: `research.ts` defines one shape
  used by both the demo and live paths; sources are preserved retrieval → summary
  → synthesis → formatted document; the final answer carries inline `[sourceId]`
  citations + a resolved citation list + source list. The demo path now emits the
  same cited shape, labelled `demo`/`simulated`.
- **Live research workflow** `research-brief-live` with a demo/live distinction,
  two genuinely independent search branches, and an env-selectable model provider.
- **Provenance everywhere**: node spans carry `provenance` (`live`/`demo`/
  `cached`) + model/request-id/finish-reason; run records carry an `execution`
  summary (`adapters`, `providers`, `liveExecution`, `sourceCount`) and the
  delivered `result`. `/config` + `/integrations` expose live readiness.
- **Correctness**: structural vs. semantic checks separated (+ labelled
  heuristic); every cited id is verified to resolve to a retrieved source and
  invented ids are flagged; a failed required check fails the run.
  Tests: `server/test/correctness.test.ts`.
- **MCP**: run-result tool now plainly states live-vs-demo, adapters, providers,
  sources, usage provenance, latency/overhead, correctness, and the cited answer.
- **End-to-end verification**: `69 passed` incl. `liveSlice.test.ts` and
  `apiLive.test.ts` (full slice against deterministic fake providers — no paid
  keys), plus a documented Claude Code MCP smoke run (demo + live via fakes). See
  `docs/LIVE-SLICE.md`.

### Remaining (not yet done — tracked honestly)

- **Paid-provider smoke run**: only fake-provider runs have been executed here (no
  keys available). A real Tavily/Anthropic/OpenAI/Gemini run is opt-in and
  user-driven.
- **UI**: the dashboard does not yet render the new provenance badges, retrieved
  source links, answer, or per-category checks (API/MCP surface them today).
- **Paired benchmarks** (requirement 5): multi-repetition baseline/optimized with
  median/p95, randomized order, and a defined regular-prompt comparison are not
  implemented; current comparison remains single-sample per mode.
- **LLM-judge evaluation** and a repeatable live evaluation set (requirement 4)
  are stubbed only by the labelled heuristic relevance check.
- **Hosted multi-user** (requirement 7): still single shared-token + JSON store;
  no per-user OAuth, tenant isolation, DB, quotas, or audit trail.
- **Other hosts** (Claude Desktop/Codex/Gemini) remain unverified and are labelled
  as such; only Claude Code is verified end-to-end.

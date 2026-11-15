# SYNAPSE live research slice

This is the end-to-end walkthrough for the working vertical slice: a user submits
a task through **Claude Code MCP** (or the API/UI), SYNAPSE retrieves **live**
information from a configured search provider, processes it with a **real model
provider**, and returns a **useful, source-cited answer** with honest usage and
latency provenance.

It covers:

1. [What the slice does](#1-what-the-slice-does)
2. [Data flow and provenance](#2-data-flow-and-provenance)
3. [Configure live providers](#3-configure-live-providers)
4. [Run it from Claude Code (MCP)](#4-run-it-from-claude-code-mcp)
5. [No-key smoke test against fake providers](#5-no-key-smoke-test-against-fake-providers)
6. [Correctness and honesty guarantees](#6-correctness-and-honesty-guarantees)
7. [Host compatibility status](#7-host-compatibility-status)

---

## 1. What the slice does

The built-in **Research Brief (Live)** workflow (`research-brief-live`) is a
6-node DAG:

```
retrieve_a (search) ─▶ summarize_a (model) ┐
                                            ├─▶ synthesize (model) ─▶ format_brief (transform)
retrieve_b (search) ─▶ summarize_b (model) ┘
```

- **retrieve_a / retrieve_b** — two *genuinely independent* live web searches on
  different angles ("overview & key facts" vs "recent news & analysis"). They are
  side-effect-safe, so the optimizer schedules them concurrently.
- **summarize_a / summarize_b** — a real model grounds a summary in that branch's
  retrieved sources, citing them inline as `[a1]`, `[b2]`, …
- **synthesize** — a real model combines both summaries into one cited brief.
- **format_brief** — a deterministic transform (demo adapter, free) assembles the
  final document: sections, a resolved citation list, a de-duplicated source list,
  and a readable markdown answer.

The identical graph exists in demo form as **Research Brief**
(`research-brief`) — no keys, deterministic, every value labelled `demo` /
`simulated`. Use it to see the shape; use the live one for real answers.

## 2. Data flow and provenance

A **source record** is created by the search adapter and preserved unchanged all
the way to the answer:

```json
{
  "sourceId": "a1",
  "title": "…",
  "url": "https://…",
  "publisher": "example.com",
  "snippet": "…",
  "content": "…(provider extract)…",
  "retrievedAt": "2026-…Z",
  "score": 0.95,
  "provenance": "live"
}
```

Every run record carries:

- `execution` — `{ adapters, providers, liveNodeCount, demoNodeCount,
  liveExecution, sourceCount }`. `liveExecution: true` means a real external
  provider actually ran.
- each `span` — `adapter`, `provenance` (`live`/`demo`/`cached`), `model`,
  `requestId`, `finishReason`, `sourceCount`, `usage` (with `source`:
  `provider-reported` / `simulated` / `unavailable` / `none`), `execMs`, retries.
- `result` — the delivered answer: `answer` (markdown with inline citations),
  `citations` (resolved), `sources`, and `provenance`. **This is persisted**
  (it is the product of the run); intermediate prompts/outputs are not.
- `validation` — structural + semantic + heuristic checks, each labelled.

Labels never lie: a demo run can never report `provider-reported` usage or `live`
provenance, and a live node that loses its provider **fails** rather than quietly
returning demo output.

## 3. Configure live providers

A live research run needs **both** a search provider and a model provider. Set
them server-side (never in the browser). See [`.env.example`](../.env.example).

```bash
# search (pick one)
export SEARCH_PROVIDER=tavily
export TAVILY_API_KEY=tvly-…           # or BRAVE_API_KEY / SERPAPI_API_KEY

# model (pick one) + tell the live workflow which to use
export ANTHROPIC_API_KEY=sk-ant-…
export SYNAPSE_LIVE_MODEL_ADAPTER=anthropic
export SYNAPSE_LIVE_MODEL=claude-3-5-haiku-latest

npm start
```

Confirm readiness:

```bash
curl -s http://127.0.0.1:4000/api/config
# → "demoMode": false, "live": { "researchReady": true, "modelAdapters": ["anthropic"], "searchAvailable": true }
```

`GET /api/integrations` shows the full adapter availability matrix (no secrets).

> A Claude Code MCP connection does **not** supply these credentials. SYNAPSE
> calls Anthropic/OpenAI/Gemini with **its own** server-side key — it cannot use
> the host's Claude subscription or session.

## 4. Run it from Claude Code (MCP)

Add the stdio server to `.mcp.json` (see
[`MCP-INTEGRATIONS.md`](./MCP-INTEGRATIONS.md)), start the backend, then in
Claude Code:

```text
list SYNAPSE workflows
run the research-brief-live workflow in optimized mode with topic
  "grid-scale battery storage economics"
get the SYNAPSE run result for <runId>
```

`synapse_get_run_result` returns a human summary plus the full structured record:

```
Run run_…: succeeded (optimized mode).
Execution: LIVE — adapters [demo, openai, search], providers [openai:gpt-4o-mini], 8 source(s) retrieved.
Usage: 5 call(s), 696 tokens (provider-reported); cost ~$0.0005 (estimated).
Latency: total 167ms (measured), SYNAPSE overhead 0ms (measured).
Correctness: all required checks passed.
Answer provenance: live. 4 cited source(s):
  [a1] … — https://…
  …
----- ANSWER -----
# Research Brief: …
## Source A — Summary
… [a1] [a2] …
```

Only run when you intend to; a live run calls paid providers and external
services. The tool is annotated `openWorldHint: true` and the backend validates
inputs and avoids duplicate side effects.

## 5. No-key smoke test against fake providers

You can exercise the **entire live code path** — real `search` + real model
adapters, orchestrator, correctness, result extraction — with **no keys and no
network**, by pointing the adapter base URLs at local fakes. This is exactly what
the automated suite does (`server/test/liveSlice.test.ts`,
`server/test/apiLive.test.ts`); it is also reproducible by hand:

1. Run two tiny fake servers: a Tavily-shaped search endpoint and an
   OpenAI-shaped chat endpoint that echoes the `[id]` markers it was given (so
   citations always resolve). A ready script lives in the test helpers
   (`server/test/fakes.ts`).
2. Start the backend wired to them:

   ```bash
   SEARCH_PROVIDER=tavily TAVILY_API_KEY=fake TAVILY_BASE_URL=http://127.0.0.1:5101 \
   OPENAI_API_KEY=fake OPENAI_BASE_URL=http://127.0.0.1:5102 \
   SYNAPSE_LIVE_MODEL_ADAPTER=openai SYNAPSE_LIVE_MODEL=gpt-4o-mini \
   npm start
   ```

3. Run `research-brief-live` through MCP or the API.

**Verified result of this smoke run** (fake providers): `status: succeeded`,
`execution.liveExecution: true`, `providers: ["openai:gpt-4o-mini"]`, usage
`provider-reported` (540 in / 156 out), two independent branches producing 8
sources (`a1…a4`, `b1…b4`), a cited answer whose every citation resolves, and all
required correctness checks passing. Running the same thing with a real search
key + model key produces a substantive real answer the same way.

The fastest way to run it is simply:

```bash
npm test        # includes the live-slice + API-live integration tests
```

## 6. Correctness and honesty guarantees

Structural and semantic checks are **separated** and each result is labelled by
`category` (`structural` / `semantic` / `estimate`):

| Check | Category | Required | What it proves |
| --- | --- | --- | --- |
| `output-schema` | structural | yes | Document has 3 sections + a non-empty answer |
| `required-sections` | structural | yes | The three expected sections exist |
| `sources-retrieved` | semantic | yes | ≥1 source retrieved and carried into the answer |
| `citations-resolve` | semantic | yes | Every cited id maps to a retrieved source |
| `no-hallucinated-citations` | semantic | yes | The model cited no id that was not retrieved |
| `synthesis-grounded` | semantic | no | The synthesis cites ≥1 source (weak-grounding signal) |
| `topic-relevance-heuristic` | estimate | no | Heuristic term overlap — **not** a factual judgment |

A failed **required** check marks the run `failed` — a run cannot be reported
successful with dangling or invented citations. The relevance row is an explicit
heuristic estimate; an LLM judge, if added, would likewise be labelled an
estimate and never treated as ground truth.

## 7. Host compatibility status

This slice was verified **end-to-end with Claude Code** over local stdio MCP
against a running backend: tool discovery, demo run, and a live run (fake
providers) all succeeded. Other hosts are **not** inferred from that — see the
honest matrix in [`MCP-INTEGRATIONS.md`](./MCP-INTEGRATIONS.md). Support belongs
to a host application/API integration, not to a model name.

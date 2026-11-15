# SYNAPSE Problems 3: Current Issues and Drawbacks

This file consolidates the issues identified in the current local code review and the remaining work from `problems2.md`. It distinguishes implemented prototype capability from verified, production-ready behavior. Preserve the existing demo mode and honest provenance labels while addressing these items.

## Current strengths and review scope

The project now contains a local MCP server, a live research workflow, search adapters for Tavily/Brave/SerpAPI, and LLM adapters for OpenAI-compatible APIs, Anthropic, and Gemini. The UI, API, and MCP can execute workflow runs. Automated live-path tests use fake provider servers, which exercise adapter code without paid keys or real vendor responses.

This was a source and documentation review only. Tests were not run, no real provider smoke test was performed, and Git could not report working-tree status (`git status` returned “this operation must be run in a work tree”), so local uncommitted changes could not be confirmed.

## Priority 1 — Correctness and benchmark trust

### 1. Comparisons do not enforce matched runs

`compareRuns` accepts any two run IDs. It does not require the same workflow version, inputs, model/provider configuration, or retrieval settings. Run records do not store a privacy-safe input/config fingerprint, so SYNAPSE cannot establish that two runs are comparable. The UI warns only when workflow IDs differ.

**Required:** persist non-reversible fingerprints for workflow version, normalized inputs, adapters/models, and relevant run configuration. Reject or prominently mark mismatched pairs. Compare results and required validation outcomes as well as time/cost.

### 2. Only one sample per comparison

The comparison reports one baseline and one optimized run. A single pair is sensitive to provider/network variation and cannot establish a repeatable gain.

**Required:** provide a paired benchmark mode with configurable repetitions, alternating or randomizing run order, and report sample count, median, p95, spread, failures, and per-run results. Never state statistical significance without appropriate evidence.

### 3. “Baseline” is not normal prompting in Claude

Current baseline mode means sequential execution of the same SYNAPSE workflow. It does not compare against a user’s regular Claude chat prompt. The host’s hidden prompts, context, token usage, tools, and timing are not captured by this MCP integration.

**Required:** label sequential-vs-optimized graph execution accurately. If offering regular-prompt comparison, define a separately instrumented host/API baseline or accept an explicit user-supplied baseline record. Mark missing metrics unavailable and prevent apples-to-oranges claims.

### 4. Correctness checks do not establish factual accuracy

Research checks validate output shape, source presence, and citation ID resolution. They do not verify that a cited source supports a claim, that claims are true, or that baseline and optimized answers are materially equivalent. A passing check is not a factuality guarantee.

**Required:** retain structural checks, add claim-to-evidence/citation support evaluation and task-specific evaluation cases, and label automated/LLM evaluations as estimates. Surface answer differences and allow human review. Do not imply citation resolution proves claim support.

### 5. Real provider behavior is not verified by fake-provider tests

The live integration tests use deterministic local fake search/model endpoints. They verify request/response paths and provenance, but not current vendor API compatibility, account permissions, rate-limit behavior in practice, real search quality, or actual answer quality.

**Required:** maintain opt-in, cost-conscious smoke tests for each real provider, with documented model/API versions and redacted results. Keep fake-provider tests for routine CI. Report which provider combinations were actually exercised.

## Priority 2 — Runtime, adapter, and product gaps

### 6. Workflow Lab does not accept a task/topic input

The Workflow Lab starts a run without passing `workflowInputs`; the backend then defaults the topic to “Q4 sector outlook.” MCP can pass a topic, but the UI cannot currently run the live research workflow on the user’s chosen topic.

**Required:** add a schema-aware workflow input form, pass inputs to the API, show the effective input before execution, and save a privacy-safe fingerprint for comparison.

### 7. Within-run memoization is unlikely to ever hit

The memoization key includes `node.id`. Since workflow nodes have unique IDs and execute at most once per run, equivalent work in different nodes cannot share a cache entry; a repeated execution of the same node does not normally occur in a DAG run.

**Required:** either redesign keys around operation, adapter/model, canonical config, inputs, and relevant workflow context (excluding node identity where safe), then prove cross-node reuse is semantically valid; or remove/rename the transformation until it can provide measurable reuse. Never memoize nondeterministic or side-effecting operations.

### 8. Retry policy can repeat non-retryable calls and side effects

The scheduler retries any failure when `maxAttempts` allows it. It does not visibly restrict retries to transient errors or enforce the schema’s `idempotent` declaration. This can repeat paid LLM calls or duplicate external actions after timeouts/errors.

**Required:** classify retryable errors (for example, selected network failures and 429/5xx responses), honor `Retry-After`, apply bounded jitter/backoff, and require idempotence or an idempotency key for side-effecting retries. Account for cost of every attempt.

### 9. Provider adapters have limited capability scope

OpenAI, Anthropic, and Gemini adapters handle LLM nodes; search handles retrieval nodes. They are direct API integrations, not access to a connected Claude/Gemini/Codex host session or subscription. Search selection and credentials are server-level environment settings, not per-user accounts or per-node credentials.

**Required:** document this boundary clearly, show configured capabilities, support safe user/project-level credentials if the product needs them, and never imply that connecting MCP exposes the host model’s private context or account access.

### 10. `.env` instructions may not work as users expect

`.env.example` suggests copying it to `server/.env`, but startup scripts do not visibly load `.env` and there is no dotenv dependency. Setting environment variables in the launching shell is the reliable documented path today.

**Required:** either implement explicit `.env` loading in server startup (with precedence and secret-safety rules) or update all setup instructions to show supported shell/OS-specific environment configuration. Verify PowerShell as well as Bash examples.

## Priority 3 — Security, privacy, and operational readiness

### 11. Persisted result can include extracted page content

The final run result stores its source records. Search records may contain extracted page content, so persisted data can exceed citation metadata and the user-facing privacy summary may understate what is retained.

**Required:** decide whether source content is persisted. Prefer storing citation metadata and answer only, or make content retention explicit, configurable, access-controlled, and subject to deletion/retention limits. Ensure MCP/API responses follow the same policy.

### 12. Shared API token and local JSON store do not support hosted multi-user use

Remote MCP auth is a shared token, with no user identity, per-user authorization, tenant isolation, OAuth account linking, or per-user provider credential vault. The JSON store is prototype-grade and not safe for concurrent multi-process hosted deployment.

**Required before multi-user hosting:** OAuth/per-user identity where supported, authorization and tenant isolation, encrypted credential management, audit trails, quotas, transactional database/migrations, backups, retention/deletion controls, and security review. Keep local stdio development simple.

### 13. Retrieved web content is untrusted input

Source snippets/content are inserted into model prompts. The prompt asks the model to use provided sources but does not clearly mark retrieved content as untrusted data or explicitly instruct the model to ignore embedded instructions. Web content can contain prompt injection.

**Required:** delimit source content as untrusted evidence, instruct models not to follow instructions found within it, constrain tool permissions independently of model output, and test prompt-injection examples. Prompt wording alone is not a security boundary.

### 14. Cost values are estimates, and unknown may look like zero

The price table is locally maintained and may be stale. The cost estimator returns zero when usage is unavailable/none, while UI/comparison can display an estimated `$0`; that can look like a free run rather than unknown cost. The comparison helper also labels any usage source other than provider-reported as simulated, conflating `none` and `unavailable` with simulated usage.

**Required:** represent unknown cost as `null`/unavailable, preserve distinct usage provenance (`provider-reported`, `simulated`, `unavailable`, `none`), include pricing source/version/date and model matching, and separately report retrieval/tool charges where known. Do not call estimates actual charges.

### 15. Mixed live/demo runs need clearer top-level status

Run-level `liveExecution` means at least one live node ran. A workflow with both live and demo nodes may consequently be labelled “LIVE,” even though part of the output came from demo adapters.

**Required:** show `LIVE`, `DEMO`, or `MIXED` based on all successful node provenance and show counts/adapters prominently in UI and MCP output. Preserve node-level provenance.

### 16. Local data store has prototype durability limits

JSON files are written synchronously and are not transactional or safe for concurrent multi-process use. Corrupt JSON is silently replaced with fallback state on read, potentially hiding data loss. There are no retention defaults for old runs.

**Required:** for production use add atomic/transactional persistence, schema migrations, corruption reporting/recovery, retention policies, backups, and concurrent access handling. Do not silently treat corrupted persistent data as an empty store.

### 17. MCP/client support is not universal or fully verified

MCP support varies by host application and product surface. Claude Code’s local stdio path is the documented target; remote endpoints and other clients need their own configuration/auth and end-to-end verification. A model name alone does not imply that its chat application supports installing MCP servers.

**Required:** maintain a tested host/version matrix, setup guides, reconnection/auth behavior, and clearly mark untested integrations. Do not advertise every Claude/OpenAI/Gemini product as compatible based only on MCP support elsewhere in that vendor’s ecosystem.

## Recommended order

1. Fix input collection in Workflow Lab and make demo/live/mixed provenance unmistakable.
2. Make comparison enforce matched configuration and add repeatable paired runs; distinguish graph baseline from host-native prompting.
3. Fix retry safety, usage/cost unknown labeling, and the ineffective memoization design.
4. Tighten factual evaluation and untrusted-source handling; clarify persisted source-content retention.
5. Perform opt-in real-provider smoke tests and update setup instructions for Windows and Unix shells.
6. Add OAuth, tenant isolation, database durability, retention, and deployment hardening before hosted multi-user use.

## Review acceptance criteria

- Real provider runs are opt-in, return substantive cited results, and never fall back silently to demo output.
- Every result identifies live/demo/mixed provenance per node and at the run level.
- Comparisons verify or disclose mismatched workflow/config/input fingerprints and report repeated-run distributions.
- Correctness claims distinguish structural validation, citation resolution, heuristic/LLM estimates, and human/factual review.
- Retry behavior cannot silently duplicate non-idempotent side effects; unknown usage/cost never appears as simulated/free.
- Privacy documentation exactly describes persisted answer, source metadata/content, logs, telemetry, and deletion behavior.
- Local setup works using documented PowerShell and Bash steps; provider setup errors are actionable and do not leak credentials.
- Hosted multi-user readiness is not claimed until identity, authorization, tenant isolation, durable storage, and operational controls are implemented.

---

## Implementation status — 2026-11-15 (addressing problems3)

Test suite: **84 passed** across 15 files (was 69/11). Server + web typecheck clean; both production builds succeed. Live tests still use deterministic fake providers (no paid keys). Verified end-to-end against a running backend (config, run provenance/cost/fingerprint, paired benchmark, mismatched-pair detection).

**Addressed in code:**

1. **Matched comparisons (#1, #3).** Each run stores a privacy-safe, non-reversible `fingerprint` (workflow version, normalized-inputs hash, adapter/model/config hash). `GET /compare` returns a `comparability` report (matched vs. apples-to-oranges, with the differing fields named) and a `validationMatch` flag; the UI banners mismatches. "Baseline" is now explicitly labelled *sequential graph execution, not a host-native chat prompt* in the compare note, benchmark, and MCP output. `fingerprint.ts`, `compare.ts`.
2. **Repeatable paired benchmark (#2).** New `POST /benchmark` + `synapse_benchmark_workflow` MCP tool + Run Comparison UI panel: N interleaved baseline/optimized runs reported as median/p95/min/max/stdev/failures with per-run order. Never claims significance. `orchestrator.runBenchmark`, `distribution()`.
3. **Factuality honesty (#4).** Added a `claim-support-heuristic` correctness check (category `estimate`) and a heuristic answer-diff (lexical similarity + cited-source-set match) in the comparison, both explicitly labelled estimates with a disclaimer that they do not verify claim truth or source support.
4. **Opt-in real-provider smoke (#5).** `npm run smoke:live` (`scripts/smoke-live.mts`) runs the live workflow once against real providers and prints a redacted report; CI keeps using fake-provider tests. README documents it.
5. **Workflow Lab input form (#6).** Topic field with a live "effective input" preview; inputs flow through `api.startRun` → `/runs` → fingerprint.
6. **Memoization redesign (#7).** Memo key now excludes node identity (keys on op+adapter+model+canonical config+inputs) so real cross-node reuse is possible; optimizer reports it honestly (accepts only when ≥2 nodes share a work class, else a no-op). Still gated on deterministic && sideEffectSafe.
7. **Retry safety (#8).** Retries only transient errors (timeout/429/5xx/unreachable, classified on `AdapterError.retryable` by code + HTTP status) and only for `idempotent` nodes; non-idempotent nodes are capped at one attempt. Honors `Retry-After`; bounded jittered exponential backoff. Tested in `retry.test.ts`.
8. **Adapter scope clarity (#9).** Capability matrix + host matrix state these are direct API integrations with server-level credentials, not host-session/subscription access; Integrations UI notes it.
9. **`.env` loading (#10).** Dependency-free `src/env.ts` loads `server/.env` at startup (shell vars win; never logs values); `.env.example` + README show PowerShell and Bash paths. `SYNAPSE_ENV_FILE` overrides the path.
10. **Persisted content policy (#11).** Persisted result keeps citation metadata + the answer only; provider-extracted `content` **and** `snippet` are dropped unless `SYNAPSE_PERSIST_SOURCE_CONTENT=1`. `/config.privacy` describes this exactly.
11. **Untrusted source handling (#13).** Retrieved content is wrapped in non-forgeable `<<<SOURCE>>>` delimiters and the system prompt instructs the model to treat it as data and ignore embedded instructions. `injection.test.ts`.
12. **Unknown-cost labeling (#14).** `estimateCost` returns `null` + `label:"unavailable"` when usage is unknown (never `$0`); distinct usage provenance preserved; pricing source/version/date surfaced (`/config.pricing`). `cost.test.ts`.
13. **LIVE/DEMO/MIXED status (#15).** `execution.provenanceMode` computed from all successful node provenance (a formatter that only re-assembles live data is counted live, so a fully-live run is not mislabelled MIXED). Shown in UI + MCP; MIXED warns.
14. **Store durability (#16).** Atomic writes (temp+rename); a corrupt file is backed up and logged (not silently emptied); retention cap (`SYNAPSE_MAX_RUNS`, default 200).
15. **Host/version matrix (#17).** Each host carries a `verification` level (verified/expected/untested) with what was exercised; Claude Code local stdio is the verified target, remote/other clients marked untested.

**Documented as not implemented (honestly surfaced, not built):**

- **Hosted multi-user (#12):** still a single-user local prototype — one optional shared token + local JSON store. `/config.deployment.multiUserReady` is `false` with an explicit note; the server warns on non-loopback bind; README states it plainly. Per-user OAuth/identity, tenant isolation, encrypted credential vault, transactional DB/migrations, quotas, audit remain future work.
- **Real paid-provider smoke runs (#5):** harness shipped and documented, but no paid run was performed here (no keys available).
- **DB migrations / backups (#16):** atomic writes + corruption reporting + retention are in; a transactional DB with migrations/backups remains future work for hosted use.
- **LLM-judge evaluation (#4):** a labelled heuristic claim-support check is in; a real LLM judge + a curated eval set remain opt-in future work.

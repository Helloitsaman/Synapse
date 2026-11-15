# SYNAPSE MCP integrations

SYNAPSE exposes its workflow compiler, optimizer, and runtime as MCP tools. The
MCP layer calls the existing SYNAPSE API; it does not create a second workflow
store. For the local stdio mode, keep the SYNAPSE backend running in another
terminal.

> For the live research vertical slice (real search + real model → cited answer
> through MCP), see [`LIVE-SLICE.md`](./LIVE-SLICE.md). It includes a no-key smoke
> test against local fake providers.

## Available MCP tools

| Tool | Purpose | Changes state / executes work? |
| --- | --- | --- |
| `synapse_list_workflows` | Find workflows already loaded in SYNAPSE | No |
| `synapse_compile_workflow` | Validate supplied workflow JSON and return IR/graph | No |
| `synapse_preview_optimization` | Preview transformations for a saved workflow | No |
| `synapse_import_workflow` | Validate and save a workflow definition | Yes, saves workflow |
| `synapse_start_workflow_run` | Start baseline or optimized execution | Yes, may call model/tool adapters |
| `synapse_get_run_result` | Read run state, spans, usage, and validation | No |
| `synapse_compare_runs` | Compare baseline and optimized run IDs | No |

Tool descriptions instruct hosts to preview first and only execute when the user
asked for a run. Hosts and users should still review tool calls; descriptions and
annotations do not replace authorization.

## Start SYNAPSE locally

From the repository root, in one terminal:

```powershell
npm run dev:server
```

The API listens on `http://127.0.0.1:4000` by default. In another terminal,
configure an MCP client to launch the stdio server. The MCP process calls the
already-running API. It does not start a second backend process.

Set these environment variables on the MCP process if needed:

- `SYNAPSE_API_BASE_URL` — defaults to `http://127.0.0.1:4000`.
- `SYNAPSE_API_TOKEN` — set to the same value as the backend's `API_AUTH_TOKEN`
  when API authentication is enabled.

## Host compatibility

MCP support belongs to the **host application or API integration**, not to a
model name by itself. Support below is based on the vendors' current docs; local
SYNAPSE MCP protocol checks do not replace installing and end-to-end testing in
each vendor's product.

| Host/application | MCP connection documented by vendor | SYNAPSE status |
| --- | --- | --- |
| Claude Code | MCP servers can be configured for Claude Code. | **Verified end-to-end**: tool discovery, a demo run, and a live run (fake providers) all succeeded over local stdio against a running backend. Add its launch command to Claude Code. |
| Claude Desktop / Claude.ai | Anthropic documents MCP integrations/connectors. | Remote MCP is the relevant path; requires a reachable hosted endpoint and compatible auth/configuration. |
| OpenAI Codex | Codex can connect to MCP servers through its MCP configuration. | Local stdio is the easiest local path; remote HTTP is available from the SYNAPSE backend. |
| OpenAI Agents API | Agents API supports remote HTTP MCP and stdio in an attached execution environment. | Remote HTTP works when the endpoint is reachable from the chosen execution environment. |
| ChatGPT custom MCP app | ChatGPT supports custom remote MCP servers/apps. | Requires deploying SYNAPSE at a reachable HTTPS URL. The current shared-token auth is not a complete OAuth product integration. |
| Gemini CLI | Gemini CLI supports MCP server entries using stdio commands and HTTP URLs. | Local stdio supported; HTTP can be used when the backend is reachable from the CLI. |
| Gemini API Interactions | The Interactions API supports remote MCP over Streamable HTTP (not legacy SSE). | The `/mcp` endpoint uses stateless Streamable HTTP. It must be hosted at a URL reachable by Google; use a compatible header for auth. |
| Gemini consumer chat app / other hosts | Support depends on each specific application and account. | Do not assume installability from model support alone; verify its MCP client capability. |

References: [Anthropic MCP overview](https://docs.anthropic.com/en/docs/mcp),
[OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server),
[OpenAI Agents API MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp),
[Gemini CLI MCP setup](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md),
and [Gemini API remote MCP](https://ai.google.dev/gemini-api/docs/function-calling).

## Example: Claude Code local stdio

Add an MCP server entry to the project `.mcp.json` (replace the path with the
actual absolute location of your checkout):

```json
{
  "mcpServers": {
    "synapse": {
      "type": "stdio",
      "command": "npm",
      "args": [
        "--prefix",
        "C:/path/to/synapse/server",
        "run",
        "mcp"
      ],
      "env": {
        "SYNAPSE_API_BASE_URL": "http://127.0.0.1:4000"
      }
    }
  }
}
```

Restart/reload the host after changing its MCP configuration, then ask it to
list SYNAPSE workflows. If API auth is enabled, set `SYNAPSE_API_TOKEN` in the
host's secure environment/config rather than committing a real token.

## Example: Gemini CLI local stdio

Add an equivalent entry under `mcpServers` in Gemini CLI's `settings.json`:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "npm",
      "args": ["--prefix", "C:/path/to/synapse/server", "run", "mcp"],
      "env": {
        "SYNAPSE_API_BASE_URL": "http://127.0.0.1:4000"
      },
      "timeout": 30000,
      "trust": false
    }
  }
}
```

Gemini CLI can also connect to HTTP MCP servers. Its configuration uses an
`httpUrl` field; use `https://your-host/mcp` after deploying SYNAPSE. Gemini CLI
supports environment expansion for configured headers, so do not hard-code a
production token in a shared settings file.

## OpenAI/Codex and other clients

Codex and other MCP-capable clients can launch the same stdio command or connect
to the Streamable HTTP endpoint. For remote HTTP, point the client to
`https://your-host/mcp`; configure its authorization header if `API_AUTH_TOKEN`
is set. Exact configuration syntax depends on the host/version, so use its
current MCP settings rather than copying another client's config verbatim.

For OpenAI API applications, configure a remote MCP tool in the application or
Agents API with the reachable endpoint. For Gemini Interactions API, configure a
remote MCP tool with `type: "mcp_server"`, a snake_case name such as `synapse`,
and the `/mcp` URL. Gemini remote MCP currently requires Streamable HTTP, which
is why SYNAPSE's remote endpoint is not the older SSE API.

## What "run in their workflows" means

After connecting, a host can discover SYNAPSE tools and call them during an
agent interaction. A typical sequence is:

1. The agent calls `synapse_list_workflows`, or builds a structured workflow
   from the user's task and calls `synapse_compile_workflow`.
2. The user/agent imports the validated definition when it should be saved.
3. The agent calls `synapse_preview_optimization` and presents the plan.
4. If execution was requested, the agent calls
   `synapse_start_workflow_run`, then polls `synapse_get_run_result`.
5. The agent can call `synapse_compare_runs` for a baseline/optimized pair.

This lets SYNAPSE execute the graph using its configured adapters. MCP does not
automatically hand over the host's complete conversation, hidden context, tools,
or existing execution graph. The user or host must explicitly provide the task
context and workflow. Without a model adapter/API credential configured in
SYNAPSE, real model nodes will not run; the demo adapter remains available.

### Live research example

With a search provider and a model provider configured (see
[`LIVE-SLICE.md`](./LIVE-SLICE.md)), the live path is:

1. `synapse_start_workflow_run` with `workflowId: "research-brief-live"`,
   `mode: "optimized"`, and `workflowInputsJson: {"topic": "…"}`.
2. `synapse_get_run_result` with the returned `runId`. The result states which
   adapters ran, the retrieved sources, **live-vs-demo provenance**,
   provider-reported usage, latency + SYNAPSE overhead, the per-check correctness
   outcomes, and the cited answer.

A live run calls paid providers and external services — only start one when the
user asked. A requested live provider that is unconfigured **fails cleanly**;
SYNAPSE never substitutes demo output for a live node.

## Local protocol smoke test

Run the MCP server through the official Inspector, or connect from a host and
confirm that all seven tools are listed. For a stdio server, launch:

```powershell
npm --prefix server run mcp
```

The process waits for an MCP client on stdin/stdout. Do not run it as a normal
interactive shell command expecting a web page. The browser dashboard remains
available separately at `http://localhost:5173` in development.

## Security and deployment notes

- The local stdio server inherits credentials from the host environment and
  sends them only to the configured SYNAPSE API URL.
- The HTTP MCP endpoint shares the backend's `API_AUTH_TOKEN` protection and
  loopback-by-default binding. For a remote AI service to reach it, deploy behind
  HTTPS with authentication and an appropriate public endpoint.
- The current auth is a shared API token, not per-user OAuth, tenant isolation,
  or an account-linking flow. ChatGPT app distribution and multi-user hosted
  deployments need a proper OAuth integration and security review.
- Run tools can trigger provider charges or external HTTP calls through
  workflow adapters. Review the workflow and allowlists before enabling them.
- Tool results report measured, estimated, provider-reported, simulated, or
  unavailable data with the provenance already used by the SYNAPSE API, and state
  whether each node ran live or in demo.

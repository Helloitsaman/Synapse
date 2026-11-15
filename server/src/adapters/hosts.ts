/**
 * Host capability matrix.
 *
 * Describes how SYNAPSE can integrate with other AI apps/hosts, honestly. We do
 * NOT claim access to hidden model context or universal transparent interception.
 * Each host is classified by the role SYNAPSE can actually play with it.
 */
export type HostRole =
  | "workflow-optimization"
  | "model-tool-gateway"
  | "telemetry-only"
  | "unsupported";

/** How far an integration has actually been exercised end-to-end. */
export type VerificationLevel = "verified" | "expected" | "untested";

export interface HostCapability {
  host: string;
  role: HostRole;
  integration: string;
  notes: string;
  /**
   * "verified" = exercised end-to-end in this project; "expected" = standard MCP
   * path that should work but is not yet verified here; "untested" = no
   * end-to-end verification. A model's name supporting MCP elsewhere does NOT
   * imply its chat app can install this server.
   */
  verification: VerificationLevel;
  /** What was actually exercised (or why it's untested). */
  verifiedWith?: string;
}

export const HOST_MATRIX: HostCapability[] = [
  {
    host: "Claude Code (local stdio MCP)",
    role: "workflow-optimization",
    integration: "Local stdio MCP server (the documented, primary target).",
    notes:
      "SYNAPSE optimizes an explicitly exported/declared workflow. It cannot see Claude's internal, hidden model context.",
    verification: "verified",
    verifiedWith: "Exercised end-to-end: list/compile/preview/run/get-result in demo + live-via-fake-providers.",
  },
  {
    host: "Claude Desktop / claude.ai (remote MCP)",
    role: "workflow-optimization",
    integration: "Streamable HTTP MCP endpoint (needs its own URL + auth config).",
    notes: "Remote endpoints need their own configuration/auth and verification; not yet verified here.",
    verification: "untested",
    verifiedWith: "No end-to-end verification in this project yet.",
  },
  {
    host: "Codex / other MCP coding agents",
    role: "workflow-optimization",
    integration: "Explicit workflow export, or MCP where the client supports it.",
    notes: "No transparent interception of the agent's private reasoning; MCP support varies by client/version.",
    verification: "untested",
    verifiedWith: "Standard MCP path; not verified against these clients here.",
  },
  {
    host: "OpenAI-compatible APIs",
    role: "model-tool-gateway",
    integration: "Server-side OpenAI-compatible model adapter (opt-in via env).",
    notes: "Acts as a model gateway for llm nodes; usage captured when returned. This is a direct API key, not host-session access.",
    verification: "verified",
    verifiedWith: "Adapter request/response/usage paths verified against deterministic fake endpoints.",
  },
  {
    host: "Anthropic / Gemini model APIs",
    role: "model-tool-gateway",
    integration: "Server-side Anthropic/Gemini model adapters (opt-in via env).",
    notes: "Direct API keys. An MCP connection to a Claude host does NOT supply these credentials.",
    verification: "verified",
    verifiedWith: "Adapter paths verified against fake endpoints; real paid smoke runs remain opt-in.",
  },
  {
    host: "Search providers (Tavily / Brave / SerpAPI)",
    role: "model-tool-gateway",
    integration: "Server-side search adapter (opt-in via env).",
    notes: "Retrieval only; content from the provider's extract field.",
    verification: "verified",
    verifiedWith: "Adapter paths verified against a fake Tavily-shaped endpoint; real smoke runs opt-in.",
  },
  {
    host: "Generic HTTP tools / services",
    role: "model-tool-gateway",
    integration: "Generic HTTP tool adapter with allowlist + SSRF protection.",
    notes: "Only allowlisted hosts are reachable.",
    verification: "verified",
    verifiedWith: "SSRF/allowlist behavior covered by tests.",
  },
  {
    host: "SigNoz / OTLP backends",
    role: "telemetry-only",
    integration: "OpenTelemetry OTLP/HTTP export (traces + metrics).",
    notes: "Receives safe metadata only; never prompt/output bodies.",
    verification: "expected",
    verifiedWith: "Standard OTLP export; collector not driven in automated tests.",
  },
  {
    host: "Arbitrary closed AI desktop apps",
    role: "unsupported",
    integration: "None without a supported API/SDK/MCP/export path.",
    notes: "SYNAPSE does not intercept or access private app internals.",
    verification: "untested",
  },
];

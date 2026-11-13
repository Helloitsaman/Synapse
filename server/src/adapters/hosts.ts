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

export interface HostCapability {
  host: string;
  role: HostRole;
  integration: string;
  notes: string;
}

export const HOST_MATRIX: HostCapability[] = [
  {
    host: "Claude (Anthropic)",
    role: "workflow-optimization",
    integration:
      "Import/instrument a structured workflow via the workflow adapter, or expose tools via MCP.",
    notes:
      "SYNAPSE optimizes an explicitly exported/declared workflow. It cannot see Claude's internal, hidden model context.",
  },
  {
    host: "Codex / coding agents",
    role: "workflow-optimization",
    integration: "Explicit workflow export or instrumentation through the workflow adapter.",
    notes: "No transparent interception of the agent's private reasoning.",
  },
  {
    host: "OpenAI-compatible APIs",
    role: "model-tool-gateway",
    integration: "Server-side OpenAI-compatible model adapter (opt-in via env).",
    notes: "Acts as a model gateway for llm nodes; usage captured when returned.",
  },
  {
    host: "Generic HTTP tools / services",
    role: "model-tool-gateway",
    integration: "Generic HTTP tool adapter with allowlist + SSRF protection.",
    notes: "Only allowlisted hosts are reachable.",
  },
  {
    host: "SigNoz / OTLP backends",
    role: "telemetry-only",
    integration: "OpenTelemetry OTLP/HTTP export (traces + metrics).",
    notes: "Receives safe metadata only; never prompt/output bodies.",
  },
  {
    host: "Arbitrary closed AI desktop apps",
    role: "unsupported",
    integration: "None without a supported API/SDK/MCP/export path.",
    notes: "SYNAPSE does not intercept or access private app internals.",
  },
];

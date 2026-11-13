import type { NodeStatus, OpType, RunStatus } from "./types";

export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);
export const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 6 : 4)}`;
export const int = (n: number) => n.toLocaleString();

export function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const OP_META: Record<OpType, { label: string; color: string; glyph: string }> = {
  llm: { label: "LLM", color: "var(--magenta)", glyph: "◈" },
  retrieval: { label: "RETRIEVAL", color: "var(--cyan)", glyph: "⊚" },
  tool: { label: "TOOL", color: "var(--warn)", glyph: "⚙" },
  transform: { label: "TRANSFORM", color: "var(--violet)", glyph: "⟐" },
  decision: { label: "DECISION", color: "var(--ok)", glyph: "◆" },
};

export function statusDot(status: NodeStatus | RunStatus): string {
  switch (status) {
    case "succeeded": return "ok";
    case "memoized": return "cyan";
    case "running": return "violet pulse";
    case "queued":
    case "retrying": return "warn pulse";
    case "pending": return "idle";
    case "failed": return "danger";
    case "cancelled": return "warn";
    case "skipped": return "idle";
    default: return "idle";
  }
}

export function labelClass(label: string): string {
  return label.replace(/\s+/g, "-").toLowerCase();
}

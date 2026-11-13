import { useMemo } from "react";
import type { GraphData, NodeSpan, NodeStatus } from "../lib/types";
import { OP_META } from "../lib/format";

const NODE_W = 158;
const NODE_H = 56;
const COL_GAP = 212;
const ROW_GAP = 82;
const PAD = 24;

interface Props {
  graph: GraphData;
  spans?: Record<string, NodeSpan>;
  selected?: string | null;
  onSelect?: (id: string) => void;
}

function statusStroke(status?: NodeStatus): string | null {
  switch (status) {
    case "running": return "var(--violet)";
    case "succeeded": return "var(--ok)";
    case "memoized": return "var(--cyan)";
    case "failed": return "var(--danger)";
    case "queued":
    case "retrying": return "var(--warn)";
    default: return null;
  }
}

export function WorkflowGraph({ graph, spans, selected, onSelect }: Props) {
  const { pos, width, height } = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    graph.levels.forEach((ids, level) => {
      const colX = PAD + level * COL_GAP;
      const total = ids.length;
      ids.forEach((id, i) => {
        // Center each column vertically relative to the tallest column.
        const y = PAD + i * ROW_GAP;
        pos[id] = { x: colX, y };
      });
      void total;
    });
    const maxRows = Math.max(1, ...graph.levels.map((l) => l.length));
    const width = PAD * 2 + graph.levels.length * COL_GAP - (COL_GAP - NODE_W);
    const height = PAD * 2 + maxRows * ROW_GAP - (ROW_GAP - NODE_H);
    return { pos, width, height };
  }, [graph]);

  return (
    <div style={{ overflow: "auto", width: "100%" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Workflow dependency graph"
        style={{ display: "block", minWidth: "100%" }}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="var(--edge-violet)" />
          </marker>
        </defs>

        {/* edges */}
        {graph.edges.map((e, i) => {
          const a = pos[e.from];
          const b = pos[e.to];
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const active =
            spans?.[e.from]?.status === "succeeded" || spans?.[e.from]?.status === "memoized";
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 7},${y2}`}
              fill="none"
              stroke={active ? "var(--violet)" : "var(--edge-strong)"}
              strokeWidth={active ? 2 : 1.4}
              markerEnd="url(#arrow)"
              opacity={active ? 0.95 : 0.7}
            />
          );
        })}

        {/* nodes */}
        {graph.nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const op = OP_META[n.op];
          const span = spans?.[n.id];
          const stroke = statusStroke(span?.status) ?? (selected === n.id ? "var(--magenta)" : "var(--edge-strong)");
          const isSel = selected === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: onSelect ? "pointer" : "default" }}
              onClick={() => onSelect?.(n.id)}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={(e) => {
                if (onSelect && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={isSel ? "var(--bg-3)" : "var(--bg-2)"}
                stroke={stroke}
                strokeWidth={isSel || span?.status === "running" ? 2 : 1.3}
                style={span?.status === "running" ? { filter: "drop-shadow(0 0 7px var(--violet))" } : undefined}
              />
              {/* op accent bar */}
              <rect width={4} height={NODE_H} rx={2} fill={op.color} />
              <text x={14} y={21} fontSize={9} fontFamily="var(--font-mono)" fill={op.color} letterSpacing="0.1em">
                {op.glyph} {op.label}
              </text>
              <text x={14} y={37} fontSize={11} fontFamily="var(--font-sans)" fill="var(--text-0)" fontWeight={500}>
                {truncate(n.label, 20)}
              </text>
              <text x={14} y={49} fontSize={8.5} fontFamily="var(--font-mono)" fill="var(--text-3)">
                {n.id} · {n.adapter}
              </text>
              {/* safety / status pip */}
              <circle
                cx={NODE_W - 13}
                cy={14}
                r={4}
                fill={pipColor(span?.status, n.sideEffectSafe)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function pipColor(status: NodeStatus | undefined, safe: boolean): string {
  if (status === "running") return "var(--violet)";
  if (status === "succeeded") return "var(--ok)";
  if (status === "memoized") return "var(--cyan)";
  if (status === "failed") return "var(--danger)";
  if (status === "queued" || status === "retrying") return "var(--warn)";
  return safe ? "var(--ok-dim)" : "var(--idle)";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

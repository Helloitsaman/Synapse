import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { Wordmark } from "./Logo";
import type { AppConfig } from "../lib/types";

const NAV = [
  { to: "/", label: "Overview", glyph: "▚", end: true },
  { to: "/lab", label: "Workflow Lab", glyph: "⟐" },
  { to: "/studio", label: "Workflow Studio", glyph: "✎" },
  { to: "/compare", label: "Run Comparison", glyph: "⇄" },
  { to: "/runs", label: "Run Details", glyph: "☰" },
  { to: "/integrations", label: "Integrations", glyph: "⊞" },
];

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="mono">{t.toLocaleTimeString([], { hour12: false })}</span>;
}

export function Sidebar({ config }: { config: AppConfig | null }) {
  return (
    <aside className="sidebar">
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid var(--edge)" }}>
        <Wordmark />
      </div>
      <nav style={{ padding: "12px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div className="section-label" style={{ padding: "4px 8px" }}>
          Console
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            <span className="nav-glyph mono">{n.glyph}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--edge)", fontSize: 11 }}>
        <div className="spread" style={{ marginBottom: 7 }}>
          <span className="mono muted">MODE</span>
          <span className="badge">
            <span className={`dot ${config?.demoMode ? "violet" : "ok"}`} />
            {config?.demoMode ? "DEMO" : "LIVE"}
          </span>
        </div>
        <div className="spread" style={{ marginBottom: 7 }}>
          <span className="mono muted">OTEL</span>
          <span className="badge">
            <span className={`dot ${config?.telemetry.started ? "ok" : "idle"}`} />
            {config?.telemetry.enabled ? (config?.telemetry.started ? "ON" : "CFG") : "OFF"}
          </span>
        </div>
        <div className="spread">
          <span className="mono muted">CLK</span>
          <span className="mono" style={{ color: "var(--magenta)" }}>
            <Clock />
          </span>
        </div>
      </div>
    </aside>
  );
}

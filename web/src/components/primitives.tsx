import React, { useRef, useState } from "react";
import { motion, useSpring } from "framer-motion";
import { labelClass } from "../lib/format";

/** Terminal-style window panel with title bar + dots. */
export function Panel({
  title,
  right,
  children,
  className = "",
  pad = true,
  style,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {title !== undefined && (
        <header className="panel-head">
          <div className="panel-title">
            <span className="panel-dots">
              <i className="m" />
              <i className="v" />
              <i />
            </span>
            {title}
          </div>
          {right}
        </header>
      )}
      <div className={pad ? "panel-body" : ""}>{children}</div>
    </section>
  );
}

/** Spotlight card — radial glow follows the cursor (React Bits pattern). */
export function SpotlightCard({
  children,
  className = "",
  glow = "rgba(180,120,255,0.16)",
}: {
  children: React.ReactNode;
  className?: string;
  glow?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);
  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`panel ${className}`}
      style={{ position: "relative", overflow: "hidden" }}
    >
      <div
        aria-hidden
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: -1,
          opacity,
          transition: "opacity 0.3s",
          background: `radial-gradient(420px circle at ${pos.x}px ${pos.y}px, ${glow}, transparent 42%)`,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}

/** Magnetic button — snaps toward the cursor within its bounds. */
export function MagneticButton({
  children,
  onClick,
  className = "",
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useSpring(0, { stiffness: 220, damping: 18, mass: 0.2 });
  const y = useSpring(0, { stiffness: 220, damping: 18, mass: 0.2 });
  return (
    <motion.button
      ref={ref}
      type="button"
      title={title}
      disabled={disabled}
      style={{ x, y }}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.25);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
      onClick={onClick}
      className={`btn ${className}`}
    >
      {children}
    </motion.button>
  );
}

/** Provenance label: measured | estimated | simulated | provider-reported. */
export function Label({ kind }: { kind: string }) {
  return <span className={`label ${labelClass(kind)}`}>{kind}</span>;
}

export function Badge({
  tone = "idle",
  pulse,
  children,
}: {
  tone?: string;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="badge">
      <span className={`dot ${tone}${pulse ? " pulse" : ""}`} />
      {children}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div style={{ padding: 28, textAlign: "center" }}>
      <span className="dot violet pulse" style={{ display: "inline-block" }} />
      <div className="mono muted" style={{ marginTop: 10, fontSize: 12 }}>
        {label}
      </div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 15, color: "var(--text-1)" }}>{title}</div>
      {hint && (
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: "12px 14px",
        border: "1px solid var(--danger)",
        borderRadius: "var(--r-md)",
        background: "rgba(255,91,110,0.08)",
        color: "#ffd0d6",
        fontSize: 13,
      }}
    >
      <strong className="mono" style={{ color: "var(--danger)" }}>
        ERROR&nbsp;
      </strong>
      {message}
    </div>
  );
}

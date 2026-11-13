export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="syn-g" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor="#ff43e0" />
          <stop offset="1" stopColor="#8a5cff" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="37" height="37" rx="9" fill="#120a1f" stroke="url(#syn-g)" strokeWidth="1.5" />
      {/* synapse: two nodes bridged by an axon */}
      <path d="M11 27c0-6 8-5 11-11" stroke="url(#syn-g)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13 13l5 2M27 25l-4-1" stroke="#b478ff" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      <circle cx="11" cy="27" r="4" fill="#ff43e0" />
      <circle cx="27" cy="13" r="4" fill="#37f5b3" />
      <circle cx="11" cy="27" r="7" stroke="#ff43e0" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Logo />
      <div style={{ lineHeight: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: "0.18em",
            color: "var(--text-0)",
          }}
        >
          SYNAPSE
        </div>
        <div
          className="mono"
          style={{ fontSize: 8.5, letterSpacing: "0.26em", color: "var(--text-3)", marginTop: 3 }}
        >
          WORKFLOW CONSOLE
        </div>
      </div>
    </div>
  );
}

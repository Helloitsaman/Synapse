import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AppConfig, Integrations as Integ } from "../lib/types";
import { Panel, Badge, Loading, ErrorBlock } from "../components/primitives";

export function IntegrationsView({ config }: { config: AppConfig | null }) {
  const [data, setData] = useState<Integ | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.integrations().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="content"><ErrorBlock message={error} /></div>;
  if (!data) return <div className="content"><Loading /></div>;

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 className="h-title">Integrations &amp; Settings</h1>
        <p className="h-sub">Adapter capabilities, provider status, telemetry, and privacy — contract v{data.adapterContractVersion}.</p>
      </div>

      <Panel title="LIVE RESEARCH READINESS" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ flexWrap: "wrap", gap: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono muted">mode</span>
            <Badge tone={data.live?.researchReady ? "ok" : "violet"}>
              {data.live?.researchReady ? "LIVE ready" : "DEMO only"}
            </Badge>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono muted">search</span>
            <Badge tone={data.live?.searchAvailable ? "ok" : "idle"}>
              {data.live?.searchAvailable ? "configured" : "not configured"}
            </Badge>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono muted">model providers</span>
            <span className="mono faint" style={{ fontSize: 12 }}>
              {data.live?.modelAdapters.length ? data.live.modelAdapters.join(", ") : "none configured"}
            </span>
          </div>
        </div>
        <p className="mono faint" style={{ fontSize: 10.5, marginBottom: 0 }}>
          A live research run (research-brief-live) needs BOTH a search provider and a model provider. SYNAPSE
          never falls back from a requested live provider to demo output. See docs/LIVE-SLICE.md.
        </p>
      </Panel>

      <Panel title="ADAPTER CAPABILITY MATRIX" style={{ marginBottom: 16 }}>
        <table className="matrix">
          <thead>
            <tr><th>Adapter</th><th>Ops</th><th>Network</th><th>Usage</th><th>Status</th><th>Limitations</th></tr>
          </thead>
          <tbody>
            {data.adapters.map((a) => (
              <tr key={a.id}>
                <td className="mono" style={{ color: "var(--text-0)" }}>{a.id}<div className="faint" style={{ fontSize: 10 }}>v{a.contractVersion}</div></td>
                <td className="mono faint" style={{ fontSize: 11 }}>{a.capabilities.ops.join(", ")}</td>
                <td>{a.capabilities.network ? <Badge tone="warn">net</Badge> : <Badge tone="idle">local</Badge>}</td>
                <td>
                  <span className="mono faint" style={{ fontSize: 11 }}>
                    {a.capabilities.providerReportedUsage ? "provider" : "simulated"}
                  </span>
                </td>
                <td>
                  <Badge tone={a.availability.available ? "ok" : "idle"}>
                    {a.availability.available ? "available" : "inactive"}
                  </Badge>
                  {a.availability.reason && <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>{a.availability.reason}</div>}
                </td>
                <td className="faint" style={{ fontSize: 11 }}>
                  <ul style={{ margin: 0, paddingLeft: 14 }}>
                    {a.capabilities.limitations.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="HOST CAPABILITY MATRIX" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
          How SYNAPSE integrates with other AI apps — described accurately. SYNAPSE does not claim access to
          hidden model context or universal transparent interception.
        </p>
        <table className="matrix">
          <thead><tr><th>Host</th><th>Role</th><th>Tested</th><th>Integration path</th><th>Notes</th></tr></thead>
          <tbody>
            {data.hosts.map((h) => (
              <tr key={h.host}>
                <td style={{ color: "var(--text-0)" }}>{h.host}</td>
                <td><span className={`role ${h.role}`}>{h.role}</span></td>
                <td>
                  <Badge tone={h.verification === "verified" ? "ok" : h.verification === "expected" ? "warn" : "idle"}>
                    {h.verification ?? "untested"}
                  </Badge>
                </td>
                <td className="faint" style={{ fontSize: 12 }} title={h.verifiedWith}>{h.integration}</td>
                <td className="faint" style={{ fontSize: 11.5 }}>{h.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mono faint" style={{ fontSize: 10.5, marginBottom: 0 }}>
          “Tested” = exercised end-to-end here. A model supporting MCP elsewhere does NOT imply its chat app can install this server.
          Adapters are direct API integrations with server-level credentials — not access to a host model's subscription or private context.
        </p>
      </Panel>

      {config?.deployment && !config.deployment.multiUserReady && (
        <Panel title="DEPLOYMENT READINESS" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="mono muted">hosted multi-user</span>
            <Badge tone="warn">not ready</Badge>
          </div>
          <p className="mono faint" style={{ fontSize: 11, marginBottom: 0, lineHeight: 1.6 }}>
            {config.deployment.note}
          </p>
        </Panel>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Panel title="OPENTELEMETRY / SIGNOZ">
          <div className="spread" style={{ marginBottom: 10 }}>
            <span className="mono muted">status</span>
            <Badge tone={data.telemetry.started ? "ok" : "idle"}>
              {data.telemetry.enabled ? (data.telemetry.started ? "exporting" : "configured, not started") : "disabled"}
            </Badge>
          </div>
          <div className="kv spread" style={{ marginBottom: 6 }}><span className="k">endpoint</span><span className="v">{data.telemetry.endpoint ?? "—"}</span></div>
          <div className="kv spread" style={{ marginBottom: 12 }}><span className="k">service</span><span className="v">{data.telemetry.serviceName}</span></div>
          <div className="section-label">Enable (SigNoz via Docker)</div>
          <pre className="code">{`# 1. Start a local SigNoz (see repo docker-compose)
docker compose -f signoz/docker-compose.yml up -d

# 2. Point SYNAPSE at the OTLP collector and restart
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
SYNAPSE_OTEL_ENABLED=1

# 3. Open SigNoz → service "synapse"
#    http://localhost:3301`}</pre>
          <p className="mono faint" style={{ fontSize: 10.5 }}>
            SigNoz is optional; SYNAPSE runs fully without it. Only safe metadata is exported — never bodies or secrets.
          </p>
        </Panel>

        <Panel title="PRIVACY &amp; RETENTION">
          <div className="stack" style={{ gap: 10 }}>
            <Setting label="Redact prompt/output bodies" on={config?.privacy.redactBodies ?? true} />
            <Setting label="Telemetry metadata-only" on={config?.privacy.telemetryMetadataOnly ?? true} />
            <Setting label="Run context ephemeral" on={config?.privacy.runContextEphemeral ?? true} />
            <hr className="sep" />
            <div className="muted" style={{ fontSize: 12.5 }}>{config?.privacy.retention}</div>
            <div className="mono faint" style={{ fontSize: 11 }}>
              Deleting a run removes its persisted summary. Node I/O bodies are never persisted by default.
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Setting({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="spread">
      <span style={{ fontSize: 13 }}>{label}</span>
      <span className={`pill ${on ? "on" : ""}`}><span /></span>
    </div>
  );
}

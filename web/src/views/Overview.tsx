import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { AppConfig, Integrations, OptimizationPlan, RunSummary } from "../lib/types";
import { Panel, SpotlightCard, MagneticButton, Badge, Loading, ErrorBlock, Empty } from "../components/primitives";
import { ms, relTime, statusDot } from "../lib/format";
import { useReveal } from "../lib/useReveal";

const DEMO_WF = "research-brief";

async function waitRun(id: string): Promise<RunSummary | undefined> {
  for (let i = 0; i < 120; i++) {
    const r = await api.run(id);
    if (["succeeded", "failed", "cancelled"].includes(r.status)) {
      return { ...r, validationPassed: r.validation?.passed ?? null } as unknown as RunSummary;
    }
    await new Promise((res) => setTimeout(res, 150));
  }
}

export function Overview({ config }: { config: AppConfig | null }) {
  const nav = useNavigate();
  const scope = useReveal([]);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [integ, setInteg] = useState<Integrations | null>(null);
  const [plan, setPlan] = useState<OptimizationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ running: boolean; step: string }>({ running: false, step: "" });

  const load = () => {
    Promise.all([api.runs(), api.integrations(), api.preview(DEMO_WF)])
      .then(([r, i, p]) => {
        setRuns(r);
        setInteg(i);
        setPlan(p.plan);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function runDemo() {
    setDemo({ running: true, step: "Compiling Research Brief…" });
    try {
      setDemo({ running: true, step: "Running baseline (sequential)…" });
      const b = await api.startRun(DEMO_WF, "baseline");
      await waitRun(b.id);
      setDemo({ running: true, step: "Running optimized (parallel)…" });
      const o = await api.startRun(DEMO_WF, "optimized");
      await waitRun(o.id);
      setDemo({ running: false, step: "" });
      nav(`/compare?baseline=${b.id}&optimized=${o.id}`);
    } catch (e) {
      setError((e as Error).message);
      setDemo({ running: false, step: "" });
    }
  }

  const succeeded = runs?.filter((r) => r.status === "succeeded") ?? [];
  const lastValidated = succeeded.find((r) => r.validationPassed !== null);
  const accepted = plan?.decisions.filter((d) => d.status === "accepted") ?? [];

  if (error) return <div className="content"><ErrorBlock message={error} /></div>;
  if (!runs || !integ || !plan) return <div className="content"><Loading label="Booting console…" /></div>;

  return (
    <div className="content" ref={scope}>
      <div className="spread reveal" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="h-title">Operations Overview</h1>
          <p className="h-sub">
            Compile, optimize and measure agent workflows.{" "}
            {config?.demoMode && <span className="mono" style={{ color: "var(--violet)" }}>Demo mode — values are simulated.</span>}
          </p>
        </div>
        <div className="stack" style={{ alignItems: "flex-end" }}>
          <MagneticButton className="primary" onClick={runDemo} disabled={demo.running}>
            {demo.running ? "● Running…" : "▶ Run Demo Workflow"}
          </MagneticButton>
          {demo.running && <span className="mono muted" style={{ fontSize: 11 }}>{demo.step}</span>}
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid reveal" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginBottom: 16 }}>
        <StatTile label="Total Runs" value={String(runs.length)} sub="persisted locally" glow="rgba(180,120,255,0.16)" />
        <StatTile
          label="Last Validation"
          value={lastValidated ? (lastValidated.validationPassed ? "PASS" : "FAIL") : "—"}
          sub={lastValidated ? relTime(lastValidated.createdAt) : "no runs yet"}
          tone={lastValidated ? (lastValidated.validationPassed ? "ok" : "danger") : "idle"}
          glow="rgba(55,245,179,0.14)"
        />
        <StatTile label="Safe Opportunities" value={String(accepted.length)} sub="accepted transforms" glow="rgba(70,230,255,0.14)" />
        <StatTile
          label="Adapters Online"
          value={`${integ.adapters.filter((a) => a.availability.available).length}/${integ.adapters.length}`}
          sub="integration health"
          glow="rgba(255,61,240,0.14)"
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Panel title="RECENT RUNS" className="reveal" right={<button className="btn ghost sm" onClick={load}>↻ Refresh</button>}>
          {runs.length === 0 ? (
            <Empty title="No runs yet" hint="Press ▶ Run Demo Workflow to generate a baseline + optimized comparison." />
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {runs.slice(0, 7).map((r) => (
                <button
                  key={r.id}
                  className="run-row"
                  onClick={() => nav(`/runs?focus=${r.id}`)}
                >
                  <span className={`dot ${statusDot(r.status)}`} />
                  <span className="mono" style={{ color: "var(--text-1)", width: 92 }}>{r.mode}</span>
                  <span style={{ flex: 1, color: "var(--text-2)" }}>{r.workflowId}</span>
                  <span className="mono" style={{ color: "var(--text-0)" }}>{ms(r.totalMs)}</span>
                  <span className="mono faint" style={{ width: 70, textAlign: "right" }}>{relTime(r.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div className="stack" style={{ gap: 16 }}>
          <Panel title="OPTIMIZATION OPPORTUNITIES" className="reveal">
            <div className="stack" style={{ gap: 10 }}>
              {plan.decisions.map((d) => (
                <div key={d.id} className="spread" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "var(--text-0)" }}>{d.title}</div>
                    <div className="mono faint" style={{ fontSize: 10.5, marginTop: 2 }}>
                      conf {(d.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                  <span className={`badge`}>
                    <span className={`dot ${d.status === "accepted" ? "ok" : d.status === "noop" ? "idle" : "warn"}`} />
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="INTEGRATION HEALTH" className="reveal">
            <div className="stack" style={{ gap: 8 }}>
              {integ.adapters.map((a) => (
                <div key={a.id} className="spread">
                  <span className="mono" style={{ color: "var(--text-1)" }}>{a.id}</span>
                  <Badge tone={a.availability.available ? "ok" : "idle"}>
                    {a.availability.available ? "available" : "inactive"}
                  </Badge>
                </div>
              ))}
              <div className="spread" style={{ marginTop: 4 }}>
                <span className="mono" style={{ color: "var(--text-1)" }}>telemetry</span>
                <Badge tone={integ.telemetry.started ? "ok" : "idle"}>
                  {integ.telemetry.enabled ? (integ.telemetry.started ? "exporting" : "configured") : "off"}
                </Badge>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, tone, glow }: { label: string; value: string; sub: string; tone?: string; glow?: string }) {
  return (
    <SpotlightCard glow={glow}>
      <div className="panel-body">
        <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
        <div className="stat" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
        <div className="mono faint" style={{ fontSize: 10.5, marginTop: 4 }}>{sub}</div>
      </div>
    </SpotlightCard>
  );
}

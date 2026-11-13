import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { RunComparison as Cmp, RunRecord, RunSummary } from "../lib/types";
import { Panel, Badge, Loading, ErrorBlock, Empty, Label } from "../components/primitives";
import { ms, usd, int, OP_META } from "../lib/format";

export function RunComparison() {
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [cmp, setCmp] = useState<Cmp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseline = params.get("baseline") ?? "";
  const optimized = params.get("optimized") ?? "";

  useEffect(() => {
    api.runs().then(setRuns).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (baseline && optimized) {
      setCmp(null);
      setError(null);
      api.compare(baseline, optimized).then(setCmp).catch((e) => setError(e.message));
    }
  }, [baseline, optimized]);

  const baselineRuns = runs.filter((r) => r.mode === "baseline" && r.status === "succeeded");
  const optimizedRuns = runs.filter((r) => r.mode === "optimized" && r.status === "succeeded");

  const setPair = (b: string, o: string) => setParams({ baseline: b, optimized: o });

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 className="h-title">Run Comparison</h1>
        <p className="h-sub">Before/after measurements on the same workflow &amp; input.</p>
      </div>

      <Panel title="SELECT RUNS" style={{ marginBottom: 16 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="section-label" style={{ margin: 0 }}>Baseline</span>
            <select className="select" value={baseline} onChange={(e) => setPair(e.target.value, optimized)}>
              <option value="">— choose —</option>
              {baselineRuns.map((r) => (
                <option key={r.id} value={r.id}>{r.workflowId} · {ms(r.totalMs)} · {r.id.slice(-6)}</option>
              ))}
            </select>
          </label>
          <span className="mono faint" style={{ fontSize: 20, marginTop: 18 }}>⇄</span>
          <label className="stack" style={{ gap: 4 }}>
            <span className="section-label" style={{ margin: 0 }}>Optimized</span>
            <select className="select" value={optimized} onChange={(e) => setPair(baseline, e.target.value)}>
              <option value="">— choose —</option>
              {optimizedRuns.map((r) => (
                <option key={r.id} value={r.id}>{r.workflowId} · {ms(r.totalMs)} · {r.id.slice(-6)}</option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      {error && <ErrorBlock message={error} />}
      {!baseline || !optimized ? (
        <Panel title="COMPARISON"><Empty title="Pick a baseline and an optimized run" hint="Or run the demo from Overview to generate a matched pair." /></Panel>
      ) : !cmp ? (
        <Loading label="Computing comparison…" />
      ) : (
        <ComparisonBody cmp={cmp} />
      )}
    </div>
  );
}

function ComparisonBody({ cmp }: { cmp: Cmp }) {
  const m = cmp.metrics;
  const faster = m.deltaMs.value > 0;
  const sameWf = cmp.baseline.workflowId === cmp.optimized.workflowId;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!sameWf && <ErrorBlock message="These runs are from different workflows — comparison may not be meaningful." />}

      {/* Headline */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <Metric title="Baseline" value={ms(m.baselineTotalMs.value)} label={m.baselineTotalMs.label} />
        <Metric title="Optimized" value={ms(m.optimizedTotalMs.value)} label={m.optimizedTotalMs.label} />
        <Metric
          title={faster ? "Speedup" : "Slowdown"}
          value={`${m.speedup.value}×`}
          label={m.speedup.label}
          tone={faster ? "ok" : "danger"}
        />
        <Metric
          title="Δ wall-clock"
          value={`${faster ? "−" : "+"}${ms(Math.abs(m.deltaMs.value))}`}
          label={m.deltaMs.label}
          tone={faster ? "ok" : "warn"}
        />
      </div>

      <Panel title="MEASUREMENT PROVENANCE" right={<span className="mono faint" style={{ fontSize: 10.5 }}>sample size: {cmp.sampleCount}</span>}>
        <table className="metrics">
          <thead>
            <tr><th>Metric</th><th>Baseline</th><th>Optimized</th><th>Provenance</th></tr>
          </thead>
          <tbody>
            <MetricRow name="Total wall-clock" b={ms(m.baselineTotalMs.value)} o={ms(m.optimizedTotalMs.value)} label={m.baselineTotalMs.label} />
            <MetricRow name="SYNAPSE overhead" b={ms(m.baselineOverheadMs.value)} o={ms(m.optimizedOverheadMs.value)} label={m.baselineOverheadMs.label} />
            <MetricRow name="Model/tool calls" b={int(m.baselineCalls.value)} o={int(m.optimizedCalls.value)} label={m.baselineCalls.label} />
            <MetricRow name="Tokens" b={int(m.baselineTokens.value)} o={int(m.optimizedTokens.value)} label={m.baselineTokens.label} />
            <MetricRow name="Est. cost" b={usd(m.baselineCostUsd.value)} o={usd(m.optimizedCostUsd.value)} label={m.baselineCostUsd.label} />
          </tbody>
        </table>
        <p className="mono faint" style={{ fontSize: 11, marginTop: 12, marginBottom: 0, lineHeight: 1.6 }}>
          {cmp.note} Token counts and cost are simulated/estimated demo values — not real provider charges.
        </p>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Panel title="BASELINE WATERFALL"><Waterfall run={cmp.baseline} /></Panel>
        <Panel title="OPTIMIZED WATERFALL"><Waterfall run={cmp.optimized} /></Panel>
      </div>

      <Panel title="TRANSFORMATIONS APPLIED">
        {cmp.optimized.appliedTransformations.length === 0 ? (
          <Empty title="No transformations" hint="This optimized run behaved like baseline (no-op)." />
        ) : (
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {cmp.optimized.appliedTransformations.map((t) => (
              <Badge key={t} tone="ok">{t}</Badge>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <ValidationPanel title="BASELINE CORRECTNESS" run={cmp.baseline} />
        <ValidationPanel title="OPTIMIZED CORRECTNESS" run={cmp.optimized} />
      </div>
    </div>
  );
}

function Metric({ title, value, label, tone }: { title: string; value: string; label: string; tone?: string }) {
  return (
    <Panel pad title={undefined as any}>
      <div className="section-label" style={{ marginBottom: 6 }}>{title}</div>
      <div className="stat" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      <div style={{ marginTop: 6 }}><Label kind={label} /></div>
    </Panel>
  );
}

function MetricRow({ name, b, o, label }: { name: string; b: string; o: string; label: string }) {
  return (
    <tr>
      <td>{name}</td>
      <td className="mono">{b}</td>
      <td className="mono">{o}</td>
      <td><Label kind={label} /></td>
    </tr>
  );
}

function Waterfall({ run }: { run: RunRecord }) {
  const t0 = run.startedAt ?? 0;
  const total = Math.max(run.totalMs, 1);
  const spans = useMemo(
    () => run.spans.filter((s) => s.startedAt).sort((a, b) => (a.startedAt! - b.startedAt!)),
    [run],
  );
  if (spans.length === 0) return <Empty title="No span data" />;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {spans.map((s) => {
        const offset = ((s.startedAt! - t0) / total) * 100;
        const width = Math.max((s.execMs / total) * 100, 1.2);
        const color = OP_META[s.op].color;
        return (
          <div key={s.nodeId} className="wf-row">
            <span className="wf-label mono" title={s.label}>{s.nodeId}</span>
            <div className="wf-track">
              <div
                className="wf-bar"
                style={{
                  left: `${offset}%`,
                  width: `${width}%`,
                  background: s.memoized ? "var(--cyan)" : color,
                  opacity: s.status === "skipped" ? 0.25 : 1,
                }}
                title={`${s.label} · ${ms(s.execMs)}${s.memoized ? " · memoized" : ""}`}
              />
            </div>
            <span className="wf-ms mono">{s.memoized ? "memo" : ms(s.execMs)}</span>
          </div>
        );
      })}
      <div className="spread" style={{ marginTop: 6 }}>
        <span className="mono faint" style={{ fontSize: 10.5 }}>total {ms(run.totalMs)} · overhead {ms(run.overheadMs)}</span>
        <span className="mono faint" style={{ fontSize: 10.5 }}>concurrency {run.concurrency}</span>
      </div>
    </div>
  );
}

function ValidationPanel({ title, run }: { title: string; run: RunRecord }) {
  return (
    <Panel title={title} right={<Badge tone={run.validation?.passed ? "ok" : "danger"}>{run.validation?.passed ? "pass" : "fail/none"}</Badge>}>
      {!run.validation ? (
        <Empty title="No validation" hint="Run did not reach validation." />
      ) : (
        <div className="stack" style={{ gap: 7 }}>
          {run.validation.checks.map((c) => (
            <div key={c.id} className="spread" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5 }}>
                  {c.description} {c.required && <span className="mono" style={{ color: "var(--magenta)", fontSize: 10 }}>REQ</span>}
                </div>
                <div className="mono faint" style={{ fontSize: 10.5 }}>{c.detail}</div>
              </div>
              <span className={`dot ${c.passed ? "ok" : "danger"}`} style={{ marginTop: 4 }} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

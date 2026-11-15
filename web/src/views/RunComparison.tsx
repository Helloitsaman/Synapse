import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { BenchmarkResult, RunComparison as Cmp, RunRecord, RunSummary } from "../lib/types";
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

      <div style={{ marginTop: 16 }}>
        <BenchmarkPanel runs={runs} />
      </div>
    </div>
  );
}

function BenchmarkPanel({ runs }: { runs: RunSummary[] }) {
  const workflowIds = useMemo(() => [...new Set(runs.map((r) => r.workflowId))], [runs]);
  const [wfId, setWfId] = useState<string>("");
  const [reps, setReps] = useState<number>(3);
  const [topic, setTopic] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [bench, setBench] = useState<BenchmarkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const effWf = wfId || workflowIds[0] || "research-brief";

  async function run() {
    setBusy(true); setErr(null); setBench(null);
    try {
      const inputs = topic.trim() ? { topic: topic.trim() } : undefined;
      setBench(await api.benchmark(effWf, reps, undefined, inputs));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="PAIRED BENCHMARK (REPEATED)" right={<span className="mono faint" style={{ fontSize: 10.5 }}>interleaved · distributions</span>}>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Runs N baseline + N optimized of the SAME workflow &amp; input, interleaved, and reports median / p95 / spread.
        Baseline = sequential graph execution, not a host-native chat prompt. A single pair is not a benchmark.
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="section-label" style={{ margin: 0 }}>Workflow</span>
          <select className="select" value={effWf} onChange={(e) => setWfId(e.target.value)}>
            {(workflowIds.length ? workflowIds : ["research-brief"]).map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="section-label" style={{ margin: 0 }}>Reps / mode</span>
          <input className="select" type="number" min={1} max={10} value={reps}
            onChange={(e) => setReps(Math.max(1, Math.min(10, +e.target.value)))} style={{ width: 80 }} />
        </label>
        <label className="stack" style={{ gap: 4, flex: 1, minWidth: 180 }}>
          <span className="section-label" style={{ margin: 0 }}>Topic (optional)</span>
          <input className="select" type="text" value={topic} placeholder="server default" onChange={(e) => setTopic(e.target.value)} />
        </label>
        <button className="btn primary" onClick={run} disabled={busy}>{busy ? "● Running…" : "▶ Run benchmark"}</button>
      </div>
      {err && <div style={{ marginTop: 12 }}><ErrorBlock message={err} /></div>}
      {bench && (
        <div style={{ marginTop: 14 }}>
          <div className="spread" style={{ flexWrap: "wrap", gap: 16, marginBottom: 10 }}>
            <div className="kv"><span className="k">median speedup</span>&nbsp;<span className="v">{bench.speedupMedian}×</span></div>
            <div className="kv"><span className="k">reps/mode</span>&nbsp;<span className="v">{bench.repetitions}</span></div>
            <div className="kv"><span className="k">comparable</span>&nbsp;<Badge tone={bench.comparability.comparable ? "ok" : "warn"}>{bench.comparability.comparable ? "matched" : "mismatched"}</Badge></div>
          </div>
          <table className="metrics">
            <thead><tr><th>Mode</th><th>min</th><th>median</th><th>p95</th><th>max</th><th>stdev</th><th>fails</th><th>Provenance</th></tr></thead>
            <tbody>
              <DistRow label="Baseline (sequential)" d={bench.baseline} />
              <DistRow label="Optimized" d={bench.optimized} />
            </tbody>
          </table>
          <p className="mono faint" style={{ fontSize: 10.5, marginTop: 10, marginBottom: 0, lineHeight: 1.6 }}>{bench.note}</p>
        </div>
      )}
    </Panel>
  );
}

function DistRow({ label, d }: { label: string; d: BenchmarkResult["baseline"] }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="mono">{ms(d.totalMs.min)}</td>
      <td className="mono">{ms(d.totalMs.median)}</td>
      <td className="mono">{ms(d.totalMs.p95)}</td>
      <td className="mono">{ms(d.totalMs.max)}</td>
      <td className="mono">{ms(d.totalMs.stdev)}</td>
      <td className="mono">{d.failures}</td>
      <td><Label kind="measured" /></td>
    </tr>
  );
}

function ComparisonBody({ cmp }: { cmp: Cmp }) {
  const m = cmp.metrics;
  const faster = m.deltaMs.value > 0;
  const comp = cmp.comparability;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!comp.comparable && (
        <ErrorBlock
          message={
            comp.fingerprintMissing
              ? "Comparability unknown: one run predates input/config fingerprinting. Treat any delta cautiously."
              : `These runs are NOT a matched pair (${comp.mismatches.join("; ")}). Any delta is apples-to-oranges.`
          }
        />
      )}
      {comp.comparable && (
        <div className="row" style={{ gap: 8, fontSize: 12 }}>
          <Badge tone="ok">matched pair</Badge>
          <span className="mono faint">same workflow · version · inputs · config (fingerprint-verified)</span>
        </div>
      )}

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
          {cmp.note} Cost is an estimate from a local price table — never a real provider charge; unknown cost shows as “unknown”, not $0.
        </p>
      </Panel>

      {cmp.answer && (
        <Panel title="ANSWER COMPARISON" right={<Label kind="estimate" />}>
          <div className="spread" style={{ flexWrap: "wrap", gap: 16 }}>
            <div className="kv"><span className="k">lexical similarity</span>&nbsp;<span className="v">{(cmp.answer.similarity * 100).toFixed(0)}%</span></div>
            <div className="kv">
              <span className="k">cited sources match</span>&nbsp;
              <Badge tone={cmp.answer.sameCitedSources ? "ok" : "warn"}>{cmp.answer.sameCitedSources ? "yes" : "differ"}</Badge>
            </div>
            <div className="kv"><span className="k">required checks agree</span>&nbsp;
              <Badge tone={cmp.validationMatch ? "ok" : "danger"}>{cmp.validationMatch ? "yes" : "no"}</Badge>
            </div>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <span className="mono faint" style={{ fontSize: 11 }}>baseline cites: {cmp.answer.baselineCitations.join(", ") || "none"}</span>
            <span className="mono faint" style={{ fontSize: 11 }}>optimized cites: {cmp.answer.optimizedCitations.join(", ") || "none"}</span>
          </div>
          <p className="mono faint" style={{ fontSize: 10.5, marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
            {cmp.answer.note}
          </p>
        </Panel>
      )}

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

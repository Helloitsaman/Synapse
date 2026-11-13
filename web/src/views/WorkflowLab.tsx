import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, subscribeRun } from "../lib/api";
import type {
  CompileResult, NodeSpan, OptimizationPlan, RunRecord, WorkflowSummary,
} from "../lib/types";
import { Panel, Badge, Loading, ErrorBlock, Label } from "../components/primitives";
import { WorkflowGraph } from "../graph/WorkflowGraph";
import { ms, OP_META, statusDot } from "../lib/format";

export function WorkflowLab() {
  const [searchParams] = useSearchParams();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [wfId, setWfId] = useState<string>(searchParams.get("wf") ?? "research-brief");
  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [plan, setPlan] = useState<OptimizationPlan | null>(null);
  const [view, setView] = useState<"original" | "optimized">("original");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"baseline" | "optimized">("optimized");
  const [concurrency, setConcurrency] = useState<number>(2);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.workflows().then(setWorkflows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setCompiled(null);
    setPlan(null);
    setRun(null);
    setSelected(null);
    setError(null);
    api.compile(wfId).then(setCompiled).catch((e) => setError(e.message));
    api.preview(wfId)
      .then((p) => {
        setPlan(p.plan);
        setConcurrency(p.plan.suggestedConcurrency);
      })
      .catch(() => setPlan(null));
  }, [wfId]);

  const ir = compiled?.ir ?? null;
  const spansMap = useMemo(() => {
    const m: Record<string, NodeSpan> = {};
    run?.spans.forEach((s) => (m[s.nodeId] = s));
    return m;
  }, [run]);

  const acceptedNodes = useMemo(() => {
    const set = new Set<string>();
    plan?.decisions
      .filter((d) => d.status === "accepted" && d.id === "parallelize-independent-branches")
      .forEach((d) => d.affectedNodes.forEach((n) => set.add(n)));
    return set;
  }, [plan]);

  async function startRun() {
    setError(null);
    setRunning(true);
    setRun(null);
    try {
      const seed = await api.startRun(wfId, mode, mode === "optimized" ? concurrency : undefined);
      setRun(seed);
      subscribeRun(
        seed.id,
        (r) => setRun(r),
        () => setRunning(false),
      );
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  const selNode = ir?.graph.nodes.find((n) => n.id === selected);
  const selSpan = selected ? spansMap[selected] : undefined;
  const wfMeta = workflows.find((w) => w.id === wfId);

  return (
    <div className="content">
      <div className="spread" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="h-title">Workflow Lab</h1>
          <p className="h-sub">Inspect the dependency graph, compile to IR, and run live.</p>
        </div>
        <div className="row">
          <select className="select" value={wfId} onChange={(e) => setWfId(e.target.value)}>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div style={{ marginBottom: 14 }}><ErrorBlock message={error} /></div>}

      {/* Compile status bar */}
      <Panel
        title="COMPILER / IR"
        className="reveal"
        right={
          compiled ? (
            compiled.ok ? (
              <Badge tone="ok">valid · ir {ir?.irVersion}</Badge>
            ) : (
              <Badge tone="danger">{compiled.errors.length} error(s)</Badge>
            )
          ) : (
            <Badge tone="idle">compiling…</Badge>
          )
        }
      >
        {!compiled ? (
          <Loading />
        ) : !compiled.ok ? (
          <div className="stack" style={{ gap: 8 }}>
            {compiled.errors.map((er, i) => (
              <div key={i} className="mono" style={{ fontSize: 12, color: "var(--danger)" }}>
                [{er.code}] {er.message} {er.nodeId && <span className="faint">@{er.nodeId}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="spread" style={{ flexWrap: "wrap", gap: 16 }}>
            <div className="kv"><span className="k">nodes</span>&nbsp;<span className="v">{wfMeta?.nodeCount}</span></div>
            <div className="kv"><span className="k">levels</span>&nbsp;<span className="v">{ir?.graph.levels.length}</span></div>
            <div className="kv"><span className="k">schema</span>&nbsp;<span className="v">{ir?.schemaVersion}</span></div>
            <div className="kv"><span className="k">wf.version</span>&nbsp;<span className="v">{ir?.workflowVersion}</span></div>
            <div className="row">
              <span className="section-label" style={{ margin: 0 }}>View</span>
              <div className="toggle">
                <button className={view === "original" ? "on" : ""} onClick={() => setView("original")}>Original</button>
                <button className={view === "optimized" ? "on" : ""} onClick={() => setView("optimized")}>Optimized</button>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {ir && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 320px", marginTop: 16, alignItems: "start" }}>
          <Panel
            title={`DEPENDENCY GRAPH · ${view.toUpperCase()}`}
            className="reveal"
            right={
              view === "optimized" ? (
                <span className="mono faint" style={{ fontSize: 10.5 }}>violet edges = parallelized branches</span>
              ) : undefined
            }
          >
            <GraphWrap
              irGraph={ir.graph}
              spans={spansMap}
              selected={selected}
              onSelect={setSelected}
              highlight={view === "optimized" ? acceptedNodes : undefined}
            />
          </Panel>

          <div className="stack" style={{ gap: 16 }}>
            {/* Run controls */}
            <Panel title="RUN CONTROL" className="reveal">
              <div className="stack" style={{ gap: 12 }}>
                <div className="toggle full">
                  <button className={mode === "baseline" ? "on" : ""} onClick={() => setMode("baseline")}>Baseline</button>
                  <button className={mode === "optimized" ? "on" : ""} onClick={() => setMode("optimized")}>Optimized</button>
                </div>
                {mode === "optimized" && (
                  <label className="spread" style={{ fontSize: 12 }}>
                    <span className="mono muted">concurrency</span>
                    <input
                      type="number" min={1} max={8} value={concurrency}
                      onChange={(e) => setConcurrency(Math.max(1, Math.min(8, +e.target.value)))}
                      className="select" style={{ width: 70 }}
                    />
                  </label>
                )}
                <button className="btn primary" onClick={startRun} disabled={running}>
                  {running ? "● Executing…" : "▶ Execute Run"}
                </button>
                {run && (
                  <div className="spread" style={{ fontSize: 12 }}>
                    <Badge tone={statusDot(run.status).split(" ")[0]} pulse={run.status === "running"}>
                      {run.status}
                    </Badge>
                    <span className="mono" style={{ color: "var(--text-0)" }}>{ms(run.totalMs)}</span>
                  </div>
                )}
              </div>
            </Panel>

            {/* Selected node */}
            <Panel title="NODE DETAIL" className="reveal">
              {!selNode ? (
                <div className="muted" style={{ fontSize: 13 }}>Select a node in the graph.</div>
              ) : (
                <div className="stack" style={{ gap: 7 }}>
                  <div className="spread">
                    <span style={{ fontWeight: 600 }}>{selNode.label}</span>
                    <span className="mono" style={{ color: OP_META[selNode.op].color, fontSize: 11 }}>
                      {OP_META[selNode.op].label}
                    </span>
                  </div>
                  <Row k="id" v={selNode.id} />
                  <Row k="adapter" v={selNode.adapter} />
                  {selNode.model && <Row k="model" v={selNode.model} />}
                  <Row k="deterministic" v={String(selNode.deterministic)} />
                  <Row k="side-effect-safe" v={String(selNode.sideEffectSafe)} />
                  <Row k="depends on" v={ir.dependencies[selNode.id].join(", ") || "—"} />
                  {selSpan && (
                    <>
                      <hr className="sep" />
                      <Row k="status" v={selSpan.status} />
                      <Row k="exec" v={ms(selSpan.execMs)} />
                      <Row k="queue" v={ms(selSpan.queueMs)} />
                      <Row k="attempts" v={String(selSpan.attempts)} />
                      {selSpan.usage.calls > 0 && (
                        <Row k="tokens" v={`${selSpan.usage.inputTokens + selSpan.usage.outputTokens}`} label="simulated" />
                      )}
                    </>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* Optimization plan */}
      {plan && (
        <Panel title="OPTIMIZATION PLAN" className="reveal" style={{ marginTop: 16 }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{plan.summary}</p>
          <div className="stack" style={{ gap: 12 }}>
            {plan.decisions.map((d) => (
              <DecisionRow key={d.id} d={d} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function GraphWrap({ irGraph, spans, selected, onSelect, highlight }: any) {
  // When a highlight set is given, dim non-highlighted nodes via spans trick:
  // we simply pass spans through; the graph colors highlighted parallel nodes
  // by their accent. Highlighting is conveyed through edge activity + legend.
  void highlight;
  return <WorkflowGraph graph={irGraph} spans={spans} selected={selected} onSelect={onSelect} />;
}

function Row({ k, v, label }: { k: string; v: string; label?: string }) {
  return (
    <div className="spread kv">
      <span className="k">{k}</span>
      <span className="v row" style={{ gap: 6 }}>
        {v} {label && <Label kind={label} />}
      </span>
    </div>
  );
}

function DecisionRow({ d }: { d: any }) {
  const tone = d.status === "accepted" ? "ok" : d.status === "noop" ? "idle" : "warn";
  return (
    <div style={{ borderLeft: `2px solid var(--${tone === "ok" ? "ok" : tone === "warn" ? "warn" : "idle"})`, paddingLeft: 12 }}>
      <div className="spread">
        <span style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</span>
        <Badge tone={tone}>{d.status} · {(d.confidence * 100).toFixed(0)}%</Badge>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{d.rationale}</div>
      <div className="mono faint" style={{ fontSize: 11, marginTop: 4 }}>{d.reason}</div>
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {d.preconditions.map((p: any, i: number) => (
          <span key={i} className="badge">
            <span className={`dot ${p.met ? "ok" : "danger"}`} />
            {p.description}
          </span>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { RunRecord, RunSummary } from "../lib/types";
import { Panel, Badge, Loading, ErrorBlock, Empty, Label } from "../components/primitives";
import { ms, int, usd, relTime, statusDot, OP_META } from "../lib/format";

export function RunDetails() {
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const focus = params.get("focus") ?? "";

  const loadList = () => api.runs().then(setRuns).catch((e) => setError(e.message));
  useEffect(() => { loadList(); }, []);
  useEffect(() => {
    if (focus) api.run(focus).then(setRun).catch((e) => setError(e.message));
    else setRun(null);
  }, [focus]);

  async function del(id: string) {
    await api.deleteRun(id);
    if (focus === id) setParams({});
    loadList();
  }

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (error) return <div className="content"><ErrorBlock message={error} /></div>;
  if (!runs) return <div className="content"><Loading /></div>;

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 className="h-title">Run Details</h1>
        <p className="h-sub">Trace-like node timeline and safe metadata for each run.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "300px 1fr", alignItems: "start" }}>
        <Panel title={`RUNS · ${runs.length}`} right={<button className="btn ghost sm" onClick={loadList}>↻</button>}>
          {runs.length === 0 ? (
            <Empty title="No runs" hint="Run the demo from Overview." />
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {runs.map((r) => (
                <div key={r.id} className={`run-row ${focus === r.id ? "sel" : ""}`} style={{ cursor: "pointer" }}>
                  <button
                    onClick={() => setParams({ focus: r.id })}
                    style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, background: "none", border: "none", color: "inherit", cursor: "pointer", textAlign: "left" }}
                  >
                    <span className={`dot ${statusDot(r.status)}`} />
                    <span className="stack" style={{ gap: 2 }}>
                      <span className="mono" style={{ fontSize: 12, color: "var(--text-0)" }}>{r.mode} · {ms(r.totalMs)}</span>
                      <span className="faint" style={{ fontSize: 10.5 }}>{r.workflowId} · {relTime(r.createdAt)}</span>
                    </span>
                  </button>
                  <button className="icon-btn" title="Delete run" onClick={() => del(r.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {!run ? (
          <Panel title="TRACE"><Empty title="Select a run" hint="Choose a run on the left to inspect its node spans." /></Panel>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            <Panel
              title={`RUN ${run.id}`}
              right={
                <div className="row" style={{ gap: 8 }}>
                  {run.execution && (
                    <Badge tone={run.execution.liveExecution ? "ok" : "violet"}>
                      {run.execution.liveExecution ? "LIVE" : "DEMO"}
                    </Badge>
                  )}
                  <Badge tone={statusDot(run.status).split(" ")[0]} pulse={run.status === "running"}>{run.status}</Badge>
                </div>
              }
            >
              <div className="spread" style={{ flexWrap: "wrap", gap: 16 }}>
                <KV k="workflow" v={`${run.workflowId} @ ${run.workflowVersion}`} />
                <KV k="ir" v={run.irVersion} />
                <KV k="mode" v={run.mode} />
                <KV k="concurrency" v={String(run.concurrency)} />
                <KV k="total" v={ms(run.totalMs)} />
                <KV k="overhead" v={ms(run.overheadMs)} label="measured" />
                <KV k="calls" v={int(run.usage.calls)} label={run.usage.source} />
                <KV k="tokens" v={int(run.usage.inputTokens + run.usage.outputTokens)} label={run.usage.source} />
                <KV k="est.cost" v={usd(run.estimatedCostUsd)} label="estimated" />
              </div>
              {run.execution && (
                <div className="spread" style={{ flexWrap: "wrap", gap: 16, marginTop: 10 }}>
                  <KV k="adapters" v={run.execution.adapters.join(", ") || "—"} />
                  {run.execution.providers.length > 0 && <KV k="providers" v={run.execution.providers.join(", ")} />}
                  <KV k="sources" v={int(run.execution.sourceCount)} />
                  <KV k="live/demo nodes" v={`${run.execution.liveNodeCount}/${run.execution.demoNodeCount}`} />
                </div>
              )}
              {run.error && <div style={{ marginTop: 12 }}><ErrorBlock message={run.error} /></div>}
              {run.validation && (
                <div style={{ marginTop: 12 }}>
                  <div className="row">
                    <span className="section-label" style={{ margin: 0 }}>Correctness</span>
                    <Badge tone={run.validation.passed ? "ok" : "danger"}>
                      {run.validation.passed ? "all required passed" : "required check failed"}
                    </Badge>
                    <span className="mono faint" style={{ fontSize: 11 }}>
                      {run.validation.checks.filter((c) => c.passed).length}/{run.validation.checks.length} checks
                    </span>
                  </div>
                  <div className="stack" style={{ gap: 3, marginTop: 8 }}>
                    {run.validation.checks.map((c) => (
                      <div key={c.id} className="row" style={{ gap: 8, fontSize: 11.5 }}>
                        <span className={`dot ${c.passed ? "ok" : c.required ? "danger" : "amber"}`} />
                        <span className="mono" style={{ color: "var(--text-1)", width: 190 }}>{c.id}</span>
                        {c.category && <Label kind={c.category} />}
                        {!c.required && <span className="faint">optional</span>}
                        <span className="faint" style={{ flex: 1 }}>{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {run.result && (
              <Panel
                title="DELIVERED ANSWER"
                right={<Label kind={run.result.provenance} />}
              >
                {run.result.sources.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="section-label" style={{ marginTop: 0 }}>
                      Sources ({run.result.sources.length}) · cited {run.result.citations.length}
                    </div>
                    <div className="stack" style={{ gap: 4 }}>
                      {run.result.sources.map((s) => {
                        const cited = run.result!.citations.some((c) => c.sourceId === s.sourceId);
                        return (
                          <div key={s.sourceId} className="row" style={{ gap: 8, fontSize: 12, opacity: cited ? 1 : 0.55 }}>
                            <span className="mono" style={{ color: "var(--accent-cyan, var(--text-0))", width: 34 }}>[{s.sourceId}]</span>
                            <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-1)", textDecoration: "none", flex: 1 }}>
                              {s.title} <span className="faint">— {s.publisher}</span>
                            </a>
                            {cited && <span className="badge"><span className="dot cyan" />cited</span>}
                            <Label kind={s.provenance} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <pre
                  className="mono"
                  style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, color: "var(--text-1)", margin: 0, maxHeight: 420, overflow: "auto" }}
                >
                  {run.result.answer}
                </pre>
              </Panel>
            )}

            <Panel title="NODE SPANS (TRACE)">
              <div className="stack" style={{ gap: 0 }}>
                {run.spans.map((s) => {
                  const isOpen = expanded.has(s.nodeId);
                  return (
                    <div key={s.nodeId} className="trace-item">
                      <button className="trace-head" onClick={() => toggle(s.nodeId)}>
                        <span className="mono faint" style={{ width: 14 }}>{isOpen ? "▾" : "▸"}</span>
                        <span className={`dot ${statusDot(s.status)}`} />
                        <span className="mono" style={{ color: OP_META[s.op].color, width: 88, fontSize: 11 }}>
                          {OP_META[s.op].label}
                        </span>
                        <span style={{ flex: 1, color: "var(--text-1)", fontSize: 13 }}>{s.label}</span>
                        {s.memoized && <span className="badge"><span className="dot cyan" />memoized</span>}
                        <span className="mono" style={{ color: "var(--text-0)", width: 64, textAlign: "right" }}>{ms(s.execMs)}</span>
                      </button>
                      {isOpen && (
                        <div className="trace-body">
                          <KV k="id" v={s.nodeId} />
                          <KV k="adapter" v={s.adapter} />
                          {s.provenance && <KV k="provenance" v={s.provenance} />}
                          {s.model && <KV k="model" v={s.model} />}
                          {typeof s.sourceCount === "number" && s.sourceCount > 0 && <KV k="sources" v={String(s.sourceCount)} />}
                          {s.finishReason && <KV k="finish" v={s.finishReason} />}
                          <KV k="status" v={s.status} />
                          <KV k="attempts" v={String(s.attempts)} />
                          <KV k="queue" v={ms(s.queueMs)} label="measured" />
                          <KV k="exec" v={ms(s.execMs)} label="measured" />
                          <KV k="depends on" v={s.dependsOn.join(", ") || "—"} />
                          {s.usage.calls > 0 && (
                            <>
                              <KV k="calls" v={int(s.usage.calls)} label={s.usage.source} />
                              <KV k="in/out tok" v={`${s.usage.inputTokens}/${s.usage.outputTokens}`} label={s.usage.source} />
                            </>
                          )}
                          {s.error && <div className="mono" style={{ color: "var(--danger)", fontSize: 11, gridColumn: "1/-1" }}>{s.error}</div>}
                          <div className="mono faint" style={{ gridColumn: "1/-1", fontSize: 10.5 }}>
                            Prompt/output bodies are redacted by default (privacy).
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ k, v, label }: { k: string; v: string; label?: string }) {
  return (
    <div className="kv" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {label && label !== "none" && <Label kind={label} />}
    </div>
  );
}

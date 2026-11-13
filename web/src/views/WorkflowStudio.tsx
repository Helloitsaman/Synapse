import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { CompileResult, WorkflowSummary } from "../lib/types";
import { Panel, Badge, Loading, ErrorBlock, Empty, SpotlightCard, MagneticButton } from "../components/primitives";
import { useReveal } from "../lib/useReveal";

/** A valid starter workflow: two independent branches the optimizer can parallelize. */
const STARTER_TEMPLATE = {
  schemaVersion: "1.0.0",
  id: "my-workflow",
  name: "My Workflow",
  description: "Edit this template, validate it, then import it into SYNAPSE.",
  version: "1.0.0",
  nodes: [
    {
      id: "fetch_a",
      op: "retrieval",
      label: "Fetch — Source A",
      dependsOn: [],
      inputs: ["query"],
      outputs: ["docs_a"],
      timeoutMs: 8000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 2, backoffMs: 50 },
      config: { sourceId: "SRC-A" },
    },
    {
      id: "fetch_b",
      op: "retrieval",
      label: "Fetch — Source B",
      dependsOn: [],
      inputs: ["query"],
      outputs: ["docs_b"],
      timeoutMs: 8000,
      provider: { adapter: "demo" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 2, backoffMs: 50 },
      config: { sourceId: "SRC-B" },
    },
    {
      id: "synthesize",
      op: "llm",
      label: "Synthesize",
      dependsOn: ["fetch_a", "fetch_b"],
      inputs: ["docs_a", "docs_b"],
      outputs: ["answer"],
      timeoutMs: 15000,
      provider: { adapter: "demo", model: "synapse-sim-mini" },
      deterministic: true,
      sideEffectSafe: true,
      idempotent: true,
      retry: { maxAttempts: 1, backoffMs: 0 },
      config: { section: "answer" },
    },
  ],
};

const pretty = (o: unknown) => JSON.stringify(o, null, 2);

export function WorkflowStudio() {
  const navigate = useNavigate();
  const scope = useReveal([]);
  const [text, setText] = useState<string>(() => pretty(STARTER_TEMPLATE));
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cloneId, setCloneId] = useState<string>("");

  const loadList = () =>
    api.workflows().then(setWorkflows).catch((e) => setError(e.message));
  useEffect(() => { loadList(); }, []);

  // Parse the current editor text locally so we can label JSON vs. schema errors.
  const parsed = useMemo<{ ok: boolean; value?: any; error?: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [text]);

  const imported = workflows.filter((w) => !w.builtin);

  function resetTo(obj: unknown) {
    setText(pretty(obj));
    setResult(null);
    setError(null);
    setNotice(null);
  }

  async function clone(id: string) {
    if (!id) return;
    setError(null);
    try {
      const wf = await api.workflow(id);
      // Give the clone a fresh id/name so it doesn't collide with the original.
      const copy = { ...wf, id: `${wf.id}-copy`, name: `${wf.name} (copy)` };
      resetTo(copy);
      setNotice(`Loaded "${wf.name}" as an editable copy. Change the id before importing.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function validate(): Promise<boolean> {
    setError(null);
    setNotice(null);
    if (!parsed.ok) {
      setResult(null);
      setError(`Invalid JSON: ${parsed.error}`);
      return false;
    }
    setBusy(true);
    try {
      const r = await api.compileRaw(parsed.value);
      setResult(r);
      return r.ok;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function importAndOpen() {
    const ok = await validate();
    if (!ok || !parsed.ok) return;
    setBusy(true);
    try {
      await api.importWorkflow(parsed.value);
      await loadList();
      navigate(`/lab?wf=${encodeURIComponent(parsed.value.id)}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteWorkflow(id);
      setNotice(`Deleted workflow "${id}".`);
      await loadList();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="content" ref={scope}>
      <div className="spread" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="h-title">Workflow Studio</h1>
          <p className="h-sub">Author, validate and import a workflow — no code, no restart.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            value={cloneId}
            onChange={(e) => { setCloneId(e.target.value); clone(e.target.value); }}
          >
            <option value="">Clone existing…</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button className="btn ghost" onClick={() => resetTo(STARTER_TEMPLATE)}>↺ Starter template</button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 14 }}><ErrorBlock message={error} /></div>}
      {notice && (
        <div className="reveal" style={{ marginBottom: 14, fontSize: 12.5 }}>
          <Badge tone="cyan">{notice}</Badge>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 360px", alignItems: "start" }}>
        <Panel
          title="WORKFLOW JSON"
          className="reveal"
          right={
            parsed.ok
              ? <Badge tone="idle">{text.length.toLocaleString()} chars</Badge>
              : <Badge tone="danger">JSON parse error</Badge>
          }
        >
          <textarea
            className="code-editor"
            spellCheck={false}
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null); }}
            aria-label="Workflow JSON editor"
          />
          <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <MagneticButton className="ghost" onClick={validate} disabled={busy}>
              {busy ? "● Working…" : "✓ Validate"}
            </MagneticButton>
            <MagneticButton
              className="primary"
              onClick={importAndOpen}
              disabled={busy || !parsed.ok}
              title="Validate, save and open in the Workflow Lab"
            >
              ⤓ Import &amp; Open
            </MagneticButton>
          </div>
          <p className="mono faint" style={{ fontSize: 11, marginTop: 10 }}>
            Imports are validated server-side against the versioned schema. Config is treated as
            data — never executed. Secrets stay server-side.
          </p>
        </Panel>

        <div className="stack" style={{ gap: 16 }}>
          <SpotlightCard className="reveal">
            <div className="panel-body" style={{ padding: 0 }}>
              <div className="section-label" style={{ marginBottom: 10 }}>Validation</div>
              {busy && !result ? (
                <Loading label="Compiling…" />
              ) : !result ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  Edit the JSON, then <strong>Validate</strong> to compile it to an IR.
                </div>
              ) : result.ok ? (
                <div className="stack" style={{ gap: 8 }}>
                  <Badge tone="ok">valid · ir {result.ir?.irVersion}</Badge>
                  <div className="kv spread"><span className="k">nodes</span><span className="v">{result.ir?.order.length}</span></div>
                  <div className="kv spread"><span className="k">levels</span><span className="v">{result.ir?.graph.levels.length}</span></div>
                  <div className="kv spread"><span className="k">schema</span><span className="v">{result.ir?.schemaVersion}</span></div>
                  <div className="kv spread"><span className="k">workflow id</span><span className="v mono">{result.ir?.workflowId}</span></div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Import to see the full optimization plan and run it.
                  </p>
                </div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  <Badge tone="danger">{result.errors.length} error(s)</Badge>
                  {result.errors.map((er, i) => (
                    <div key={i} className="mono" style={{ fontSize: 11.5, color: "var(--danger)" }}>
                      [{er.code}] {er.message}
                      {er.nodeId && <span className="faint"> @{er.nodeId}</span>}
                      {er.path && <span className="faint"> ({er.path})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SpotlightCard>

          <Panel title={`IMPORTED · ${imported.length}`} className="reveal" right={<button className="btn ghost sm" onClick={loadList}>↻</button>}>
            {imported.length === 0 ? (
              <Empty title="No imported workflows" hint="Built-in samples aren't listed here." />
            ) : (
              <div className="stack" style={{ gap: 0 }}>
                {imported.map((w) => (
                  <div key={w.id} className="run-row">
                    <button
                      className="row"
                      onClick={() => navigate(`/lab?wf=${encodeURIComponent(w.id)}`)}
                      style={{ gap: 8, flex: 1, background: "none", border: "none", color: "inherit", cursor: "pointer", textAlign: "left" }}
                    >
                      <span className="dot violet" />
                      <span className="stack" style={{ gap: 2 }}>
                        <span style={{ fontSize: 13, color: "var(--text-0)" }}>{w.name}</span>
                        <span className="mono faint" style={{ fontSize: 11 }}>{w.id} · {w.nodeCount} nodes · v{w.version}</span>
                      </span>
                    </button>
                    <button className="btn ghost sm" title="Delete workflow" onClick={() => remove(w.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

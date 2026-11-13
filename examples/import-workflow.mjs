// Example: import/instrument an external agent-framework workflow into SYNAPSE.
//
// This demonstrates the WORKFLOW ADAPTER path: you map your framework's graph
// onto the SYNAPSE node schema (stable ids, op type, dependsOn, safety flags,
// timeouts, retry) and POST it. SYNAPSE validates + compiles it, then you can
// compile/optimize/run it like any built-in workflow.
//
// Usage:  node examples/import-workflow.mjs [baseUrl]
//   baseUrl defaults to http://localhost:4000
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4000";
const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const wf = JSON.parse(await readFile(join(here, "custom-workflow.json"), "utf8"));

  // 1. (Optional) validate without saving.
  const compiled = await post(`${BASE}/api/compile`, wf);
  if (!compiled.ok) {
    console.error("Validation failed:", compiled.errors);
    process.exit(1);
  }
  console.log(`✓ Compiled: ir ${compiled.ir.irVersion}, ${compiled.ir.order.length} nodes`);

  // 2. Import/save the workflow.
  const saved = await post(`${BASE}/api/workflows`, wf);
  console.log(`✓ Imported workflow "${wf.id}" (saved=${saved.ok})`);

  // 3. Preview the optimization plan.
  const { plan } = await post(`${BASE}/api/workflows/${wf.id}/optimize/preview`);
  console.log(`✓ Plan: ${plan.summary}`);
  for (const d of plan.decisions) console.log(`    - ${d.title}: ${d.status}`);

  // 4. Run baseline + optimized and compare.
  const b = await post(`${BASE}/api/runs`, { workflowId: wf.id, mode: "baseline" });
  await waitRun(b.id);
  const o = await post(`${BASE}/api/runs`, { workflowId: wf.id, mode: "optimized" });
  await waitRun(o.id);
  const cmp = await get(`${BASE}/api/compare?baseline=${b.id}&optimized=${o.id}`);
  console.log(
    `✓ Baseline ${cmp.metrics.baselineTotalMs.value}ms vs Optimized ` +
      `${cmp.metrics.optimizedTotalMs.value}ms (${cmp.metrics.speedup.value}x, measured)`,
  );
  console.log(`  Open the UI → Run Comparison to inspect: ${BASE}/compare?baseline=${b.id}&optimized=${o.id}`);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
async function get(url) {
  return (await fetch(url)).json();
}
async function waitRun(id) {
  for (let i = 0; i < 120; i++) {
    const r = await get(`${BASE}/api/runs/${id}`);
    if (["succeeded", "failed", "cancelled"].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error("run timed out");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

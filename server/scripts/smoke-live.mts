/**
 * OPT-IN real-provider smoke test (costs real money / quota — run deliberately).
 *
 *   npm run smoke:live
 *
 * It runs the LIVE research workflow ONCE against whatever real providers your
 * environment is configured for (search + model), then prints a REDACTED report:
 * which provider/model combination was actually exercised, provider-reported
 * usage, estimated cost (labelled), correctness outcomes, and a short answer
 * excerpt. It never prints API keys. If no provider is configured it explains
 * what to set and exits 0 (so CI stays green — routine CI uses the fake-provider
 * tests instead).
 *
 * Load env from server/.env too (shell vars win). See src/env.ts.
 */
import "../src/env.js";
import { compileWorkflow } from "../src/compiler/compile.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { runCorrectness } from "../src/correctness/checks.js";
import { extractResult } from "../src/runtime/result.js";
import { estimateCost } from "../src/runtime/cost.js";
import { defaultRegistry } from "../src/adapters/registry.js";
import { makeResearchBriefLive } from "../src/workflows/samples.js";

function available(id: string) {
  return defaultRegistry.get(id)?.isAvailable().available ?? false;
}

async function main() {
  const topic = process.argv.slice(2).join(" ") || "the economic impact of grid-scale battery storage";
  const modelAdapter = process.env.SYNAPSE_LIVE_MODEL_ADAPTER ?? "anthropic";
  const searchOk = available("search");
  const modelOk = available(modelAdapter);

  console.log("SYNAPSE live smoke test");
  console.log("─".repeat(60));
  console.log(`search adapter:   ${searchOk ? "configured" : "NOT configured"} (SEARCH_PROVIDER=${process.env.SEARCH_PROVIDER ?? "unset"})`);
  console.log(`model adapter:    ${modelAdapter} ${modelOk ? "configured" : "NOT configured"}`);

  if (!searchOk || !modelOk) {
    console.log("\nNothing to smoke-test — a LIVE run needs BOTH a search provider and a model provider.");
    console.log("Set, for example:");
    console.log("  SEARCH_PROVIDER=tavily TAVILY_API_KEY=...  (or brave/serpapi)");
    console.log("  SYNAPSE_LIVE_MODEL_ADAPTER=anthropic ANTHROPIC_API_KEY=...  (or openai/gemini)");
    console.log("Then re-run: npm run smoke:live");
    return;
  }

  const wf = makeResearchBriefLive({ modelAdapter });
  const compiled = compileWorkflow(wf);
  if (!compiled.ok || !compiled.ir) {
    console.error("Workflow failed to compile:", compiled.errors);
    process.exitCode = 1;
    return;
  }

  console.log(`\nRunning "${wf.name}" on topic: "${topic}" …\n`);
  const started = Date.now();
  const { record, outputs } = await executeRun(wf, compiled.ir, `smoke_${started}`, {
    mode: "optimized",
    concurrency: 2,
    memoize: false,
    registry: defaultRegistry,
    workflowInputs: { topic },
  });

  if (record.status !== "succeeded") {
    console.error(`Run ${record.status}: ${record.error ?? "(no detail)"}`);
    process.exitCode = 1;
    return;
  }

  const validation = runCorrectness({ workflowId: wf.id, outputs, ir: compiled.ir });
  const result = extractResult(compiled.ir, outputs);
  const cost = estimateCost(record.usage);

  console.log("RESULT (redacted)");
  console.log("─".repeat(60));
  console.log(`provenance:     ${record.execution?.provenanceMode}`);
  console.log(`adapters:       ${record.execution?.adapters.join(", ")}`);
  console.log(`providers:      ${record.execution?.providers.join(", ") || "(none reported)"}`);
  console.log(`sources:        ${record.execution?.sourceCount}`);
  console.log(`usage:          ${record.usage.calls} call(s), ${record.usage.inputTokens}+${record.usage.outputTokens} tokens (${record.usage.source})`);
  console.log(`est. cost:      ${cost.usd == null ? "unknown (not $0)" : `$${cost.usd}`} [${cost.label}, ${cost.pricingSource}]`);
  console.log(`latency:        ${record.totalMs}ms total, ${record.overheadMs}ms overhead (measured)`);
  console.log(`correctness:    ${validation.passed ? "all required passed" : "REQUIRED CHECK FAILED"}`);
  for (const c of validation.checks) {
    console.log(`  [${c.passed ? "✓" : "✗"}] ${c.id} (${c.category}${c.required ? ", required" : ""})`);
  }
  console.log(`citations:      ${(result?.citations ?? []).map((c) => c.sourceId).join(", ") || "none"}`);
  console.log("\nanswer excerpt:");
  console.log((result?.answer ?? "").slice(0, 600));
  console.log("\n✔ Smoke test complete. (Record which provider/model + API version you used.)");
}

main().catch((err) => {
  console.error("Smoke test error:", (err as Error).message);
  process.exitCode = 1;
});

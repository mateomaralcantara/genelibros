import { spawnSync } from "node:child_process";
import process from "node:process";

const patchers = [
  "scripts/patch-research-gap-source-cap.mjs",
  "scripts/patch-research-document-ingestion.mjs",
  "scripts/patch-research-evidence-semantics.mjs",
  "scripts/patch-research-credit-guard.mjs",
  "scripts/patch-deep-work-v58.mjs",
  "scripts/patch-deep-work-credit-guard.mjs",
  "scripts/patch-deep-work-model-compat.mjs",
  "scripts/patch-deep-work-json-sanitizer.mjs",
  "scripts/patch-deep-work-longform-text.mjs",
  "scripts/patch-deep-work-research-override.mjs",
];

console.log("\n================================================");
console.log(" GENELIBROS — PRODUCTION RUNTIME PREPARE");
console.log(" Deterministic patchers only — 0 LLM / 0 provider calls");
console.log("================================================");

for (const script of patchers) {
  console.log(`\n[Genelibros] production prepare > ${script}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    console.error(`[Genelibros] PRODUCTION PREPARE FAIL — ${script}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n✅ GENELIBROS PRODUCTION RUNTIME READY");
console.log({ patchers: patchers.length, llmCalls: 0, providerCalls: 0 });

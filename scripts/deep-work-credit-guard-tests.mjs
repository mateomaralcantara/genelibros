import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimePath = path.resolve(root, "src/server/deep-work-runtime.ts");
const workerPath = path.resolve(root, "src/server/vercel-handlers/deep-work-worker.ts");
const packagePath = path.resolve(root, "package.json");
const preflightPath = path.resolve(root, "scripts/deep-work-chapter-preflight.mjs");
const modelCompatPath = path.resolve(root, "scripts/patch-deep-work-model-compat.mjs");
const launcherPath = path.resolve(root, "scripts/run-vercel-dev-with-local-env.mjs");
const productionRunnerPath = path.resolve(root, "scripts/run-deep-production-v1.mjs");

const runtime = fs.readFileSync(runtimePath, "utf8");
const worker = fs.readFileSync(workerPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const preflight = fs.existsSync(preflightPath) ? fs.readFileSync(preflightPath, "utf8") : "";
const modelCompat = fs.existsSync(modelCompatPath) ? fs.readFileSync(modelCompatPath, "utf8") : "";
const launcher = fs.existsSync(launcherPath) ? fs.readFileSync(launcherPath, "utf8") : "";
const productionRunner = fs.existsSync(productionRunnerPath) ? fs.readFileSync(productionRunnerPath, "utf8") : "";

const checks = [
  ["runtime credit routing", runtime.includes("budgetStage") && runtime.includes("DEEP_BUDGET_MODEL")],
  ["legacy gemini 2.5 flash removed", !/gemini-2\.5-flash/i.test(runtime)],
  ["gemini 3.6 flash available for budget stages", runtime.includes("gemini-3.6-flash")],
  ["model compat patch exists", modelCompat.includes("gemini-3.6-flash") && modelCompat.includes("gemini-2\\.5-flash")],
  ["launcher normalizes legacy env model", launcher.includes("isLegacyFlash") && launcher.includes('merged.DEEP_BUDGET_MODEL = "gemini-3.6-flash"')],
  ["SUPREME threshold intact", runtime.includes("threshold: 9.3")],
  ["SUPREME two drafts under guard", runtime.includes("draftCount: 2, maxRepairAttempts: 1, threshold: 9.3")],
  ["single JSON attempt default", runtime.includes("DEEP_GENERATE_MAX_ATTEMPTS || 1")],
  ["V5.8 deterministic second prune", runtime.includes("CREDIT_GUARD_V2_DETERMINISTIC_SECOND_PRUNE")],
  ["worker hard call cap", worker.includes("CREDIT_BUDGET_EXHAUSTED") && worker.includes("DEEP_MAX_LLM_CALLS")],
  ["worker honors per-job cap", worker.includes("job.policy?.maxLlmCalls")],
  ["budget quality snapshot typed", worker.includes("const priorQuality: AnyRow")],
  ["blind repair blocked", worker.includes("CREDIT_GUARD: el juez no produjo requiredRepairs")],
  ["worker carries context to repair", worker.includes("context: result.context") && worker.includes("researchContext: result.researchContext")],
  ["preflight defaults to 7-call first pass", preflight.includes('argValue("--max-calls", "7")') && preflight.includes("firstPassOnly")],
  ["preflight blocks missing research", preflight.includes("BLOCKED: no existe Research certificado ready_for_writing")],
  ["dev installs guard and model compat before server", String(pkg.scripts?.["deep:11c:dev"] || "").includes("patch-deep-work-credit-guard.mjs") && String(pkg.scripts?.["deep:11c:dev"] || "").includes("patch-deep-work-model-compat.mjs")],
  ["worker installs guard and model compat", String(pkg.scripts?.["deep:11c:worker"] || "").includes("patch-deep-work-credit-guard.mjs") && String(pkg.scripts?.["deep:11c:worker"] || "").includes("patch-deep-work-model-compat.mjs")],
  ["Production V1 installs guard and model compat", productionRunner.includes('runNode("scripts/patch-deep-work-credit-guard.mjs")') && productionRunner.includes('runNode("scripts/patch-deep-work-model-compat.mjs")')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

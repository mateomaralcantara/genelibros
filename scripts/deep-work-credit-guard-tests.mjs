import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimePath = path.resolve(root, "src/server/deep-work-runtime.ts");
const workerPath = path.resolve(root, "src/server/vercel-handlers/deep-work-worker.ts");
const packagePath = path.resolve(root, "package.json");
const preflightPath = path.resolve(root, "scripts/deep-work-chapter-preflight.mjs");

const runtime = fs.readFileSync(runtimePath, "utf8");
const worker = fs.readFileSync(workerPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const preflight = fs.existsSync(preflightPath) ? fs.readFileSync(preflightPath, "utf8") : "";

const checks = [
  ["runtime credit routing", runtime.includes("budgetStage") && runtime.includes("DEEP_BUDGET_MODEL")],
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
  ["dev installs guard before server", String(pkg.scripts?.["deep:11c:dev"] || "").includes("patch-deep-work-credit-guard.mjs")],
  ["worker installs guard", String(pkg.scripts?.["deep:11c:worker"] || "").includes("patch-deep-work-credit-guard.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

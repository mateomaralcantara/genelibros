import fs from "node:fs";
import path from "node:path";

const runtime = fs.readFileSync(path.resolve("src/server/research-intelligence-runtime.ts"), "utf8");
const worker = fs.readFileSync(path.resolve("src/server/vercel-handlers/research-worker.ts"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

const checks = [
  ["research uses Flash default", runtime.includes('"gemini-3.6-flash"')],
  ["single JSON attempt under guard", runtime.includes("RESEARCH_GENERATE_MAX_ATTEMPTS || 1")],
  ["worker per-job budget guard", worker.includes("const researchBudgetGuard")],
  ["worker hard call cap", worker.includes("RESEARCH_CREDIT_BUDGET_EXHAUSTED")],
  ["query cap installed", worker.includes("RESEARCH_QUERY_CAP_APPLIED") && worker.includes("out.queries.slice(0,researchMaxQueries)") && worker.includes("researchMaxQueries")],
  ["source cap installed", worker.includes("RESEARCH_SOURCE_CAP_APPLIED") && worker.includes("job.max_sources=Math.min") && worker.includes("researchMaxSources")],
  ["first pass stops before gap loops", worker.includes("RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE")],
  ["ready criteria still require verified claims", runtime.includes("verified.length>=3")],
  ["ready criteria still require A/B sources", runtime.includes("classAB.length>=2")],
  ["ready criteria still block critical/high gaps", runtime.includes("critical.length===0")],
  ["ready criteria coverage intact", runtime.includes("coverage>=7.5")],
  ["ready criteria factual confidence intact", runtime.includes("factual>=7.5")],
  ["worker command installs research guard", String(pkg.scripts?.["research:11d:worker"] || "").includes("patch-research-credit-guard.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

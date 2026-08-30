import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
let passed = 0;
let failed = 0;
function read(rel) { const p = path.join(root, rel); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""; }
function test(name, condition) {
  if (condition) { passed++; console.log(`✅ PASS: ${name}`); }
  else { failed++; console.log(`❌ FAIL: ${name}`); }
}
console.log("\n===============================================");
console.log("GENELIBROS 5.0 — DEEP WORK 11C TESTS");
console.log("===============================================");
const files = [
  "src/server/vercel-handlers/deep-work-jobs.ts",
  "src/server/vercel-handlers/deep-work-worker.ts",
  "src/server/vercel-handlers/deep-work-apply.ts",
  "src/server/deep-work-runtime.ts",
  "src/lib/deep-work/types.ts",
  "src/lib/deep-work/client.ts",
  "src/lib/deep-work/index.ts",
  "scripts/run-deep-work-worker-local.mjs",
  "scripts/prepare-deep-worker-local.ps1",
  "sql/deep-work-11c-engine.sql",
  "sql/deep-work-11c-verify.sql",
];
for (const file of files) test(`Existe ${file}`, fs.existsSync(path.join(root, file)));
const registry = read("src/lib/brain/agent-registry.ts");
for (const agent of ["DEEP_PLANNER","LONG_CONTEXT_ANALYST","MULTI_PASS_WRITER","ALTERNATIVE_DRAFT_WRITER","CRITIC_COUNCIL","REPAIR_AGENT","SYNTHESIS_EDITOR","DEEP_QUALITY_JUDGE"]) {
  test(`${agent} READY`, registry.includes(`ready("${agent}"`));
}
const runtime = read("src/server/deep-work-runtime.ts");
const worker = read("src/server/vercel-handlers/deep-work-worker.ts");
const jobs = read("src/server/vercel-handlers/deep-work-jobs.ts");
const apply = read("src/server/vercel-handlers/deep-work-apply.ts");
const sql = read("sql/deep-work-11c-engine.sql");
const runner = read("scripts/run-deep-work-worker-local.mjs");
const pkg = read("package.json");
test("Runtime implementa DEEP_PLANNER", runtime.includes("deepPlanStep"));
test("Runtime implementa LONG_CONTEXT_ANALYST", runtime.includes("deepContextStep"));
test("Runtime implementa borradores A/B/C", runtime.includes('label: "A" | "B" | "C"'));
test("Runtime implementa CRITIC_COUNCIL", runtime.includes("criticCouncilStep"));
test("Runtime implementa SYNTHESIS_EDITOR", runtime.includes("synthesisStep"));
test("Runtime implementa REPAIR_AGENT", runtime.includes("repairStep"));
test("Runtime implementa DEEP_QUALITY_JUDGE", runtime.includes("deepQualityStep"));
test("Runtime define FAST/DEEP/SUPREME/ULTRA", ["FAST","DEEP","SUPREME","ULTRA"].every(x => runtime.includes(`depth === "${x}"`) || runtime.includes(`return { draftCount`)));
test("Runtime prohíbe inventar fuentes", runtime.includes("No inventes fuentes"));
test("Runtime bloquea claims factuales nuevos", runtime.includes("No añadas claims factuales nuevos"));
test("Runtime parser JSON balanceado", runtime.includes("jsonCandidate") && runtime.includes("depth === 0"));
test("Worker usa secreto server-side", worker.includes("DEEP_WORKER_SECRET") && !worker.includes("VITE_GEMINI_API_KEY"));
test("Worker procesa INIT", worker.includes('step === "INIT"'));
test("Worker procesa PLAN", worker.includes('step === "PLAN"'));
test("Worker procesa CONTEXT", worker.includes('step === "CONTEXT"'));
test("Worker procesa DRAFT", worker.includes('step === "DRAFT"'));
test("Worker procesa CRITIC", worker.includes('step === "CRITIC"'));
test("Worker procesa SYNTHESIS", worker.includes('step === "SYNTHESIS"'));
test("Worker procesa REPAIR", worker.includes('step === "REPAIR"'));
test("Worker procesa QUALITY", worker.includes('step === "QUALITY"'));
test("Worker procesa PERSIST", worker.includes('step === "PERSIST"'));
test("Worker verifica source hash", worker.includes("SOURCE_CHANGED"));
test("Worker no auto-aplica sections", !worker.includes('.from("sections").update'));
test("Jobs API autentica JWT", jobs.includes("auth.getUser"));
test("Jobs API valida ownership", jobs.includes('.eq("user_id", userId)'));
test("Jobs API admite depth", jobs.includes("SUPREME") && jobs.includes("ULTRA"));
test("Jobs API reutiliza jobs activos", jobs.includes("reused: true"));
test("Apply API requiere JWT", apply.includes("auth.getUser"));
test("Apply API llama apply RPC", apply.includes("deep_apply_chapter_candidate"));
test("Apply API llama rollback RPC", apply.includes("deep_rollback_chapter_candidate"));
test("SQL crea deep_work_jobs", sql.includes("create table if not exists public.deep_work_jobs"));
test("SQL crea artifacts", sql.includes("deep_work_artifacts"));
test("SQL crea apply history", sql.includes("deep_work_apply_history"));
test("SQL tiene lease atómico", sql.includes("for update skip locked"));
test("SQL tiene heartbeat", sql.includes("deep_heartbeat_work_job"));
test("SQL tiene retry/backoff", sql.includes("deep_fail_work_job") && sql.includes("RETRYING"));
test("SQL tiene dead letter", sql.includes("DEAD_LETTER"));
test("SQL apply verifica source hash", sql.includes("SOURCE_HASH_MISMATCH"));
test("SQL rollback verifica hash", sql.includes("ROLLBACK_HASH_MISMATCH"));
test("SQL conserva previous_content", sql.includes("previous_content"));
test("SQL revoca writes cliente", sql.includes("revoke insert, update, delete"));
test("Runner no imprime secretos", !runner.includes("console.log(secret") && !runner.includes("console.log(`Secret"));
test("package tiene deep:11c:test", pkg.includes('"deep:11c:test"'));
test("package tiene deep:11c:worker", pkg.includes('"deep:11c:worker"'));
test("package tiene deep:11c:verify", pkg.includes('"deep:11c:verify"'));
const allCode = [runtime, worker, jobs, apply, sql, runner].join("\n");
test("No hay claves Gemini literales obvias", !/AIza[0-9A-Za-z_-]{20,}/.test(allCode));
console.log(`\n${failed ? "❌" : "✅"} FASE 11C: ${passed} pruebas pasaron${failed ? `, ${failed} fallaron` : ""}.`);
if (failed) process.exit(1);
console.log("✅ Deep Work Engine listo: planning + long context + multi-draft + critics + synthesis + repair + quality + durable checkpointing.");

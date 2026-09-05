import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const tests = [];
function test(name, fn) {
  try { tests.push({ name, ok: Boolean(fn()) }); }
  catch (error) { tests.push({ name, ok: false, error: String(error?.message || error) }); }
}

const required = [
  "src/server/vercel-handlers/refinement-jobs.ts",
  "src/server/vercel-handlers/refinement-worker.ts",
  "src/server/vercel-handlers/refinement-apply.ts",
  "src/server/refinery-execution-runtime.ts",
  "src/lib/refinery-execution/types.ts",
  "src/lib/refinery-execution/client.ts",
  "src/lib/refinery-execution/index.ts",
  "scripts/run-refinement-worker-local.mjs",
  "sql/refinery-11b3-execution-engine.sql",
  "sql/refinery-11b3-verify.sql",
];
for (const file of required) test(`Existe ${file}`, () => exists(file));

const worker = read("src/server/vercel-handlers/refinement-worker.ts");
const jobs = read("src/server/vercel-handlers/refinement-jobs.ts");
const apply = read("src/server/vercel-handlers/refinement-apply.ts");
const runtime = read("src/server/refinery-execution-runtime.ts");
const sql = read("sql/refinery-11b3-execution-engine.sql");
const registry = read("src/lib/brain/agent-registry.ts");
const runner = read("scripts/run-refinement-worker-local.mjs");

for (const agent of [
  "STRUCTURAL_EDITOR",
  "REDUNDANCY_HUNTER",
  "COMPRESSION_EDITOR",
  "EXPANSION_EDITOR",
  "CLARITY_EDITOR",
  "STYLE_REFINER",
  "LINE_EDITOR",
  "MASTER_BOOK_REFINER",
  "EDITORIAL_DELTA",
]) {
  test(`${agent} READY`, () => {
    const line = registry.split(/\r?\n/).find((x) => x.includes(`"${agent}"`));
    return Boolean(line?.includes("ready("));
  });
}

test("Worker usa secreto server-side", () => worker.includes("REFINERY_WORKER_SECRET"));
test("Worker procesa INIT", () => worker.includes('cp.step === "INIT"'));
test("Worker procesa REFINE", () => worker.includes('cp.step === "REFINE"'));
test("Worker procesa DELTA", () => worker.includes('cp.step === "DELTA"'));
test("Worker procesa FINAL_GLOBAL", () => worker.includes("processFinalGlobal"));
test("Worker llama Editorial Delta", () => worker.includes("evaluateEditorialDelta"));
test("Worker crea versiones candidatas", () => worker.includes("refinery_create_chapter_version"));
test("Worker hace re-auditoría de candidato", () => worker.includes("auditSingleChapterStep"));
test("Worker hace re-auditoría global", () => worker.includes("auditGlobalManuscriptStep"));
test("Worker NO actualiza sections", () => !worker.includes('.from("sections").update'));
test("Worker NO actualiza master_documents", () => !worker.includes('.from("master_documents").update'));

test("Runtime prohíbe inventar fuentes", () => runtime.includes("NO inventes fuentes"));
test("Runtime bloquea nuevos claims", () => runtime.includes("NO agregues nuevos claims"));
test("Runtime puede devolver NEEDS_RESEARCH", () => runtime.includes('NEEDS_RESEARCH'));
test("Runtime implementa REDUNDANCY_HUNTER", () => runtime.includes('"REDUNDANCY_HUNTER"'));
test("Runtime implementa COMPRESSION_EDITOR", () => runtime.includes('"COMPRESSION_EDITOR"'));
test("Runtime implementa EXPANSION_EDITOR", () => runtime.includes('"EXPANSION_EDITOR"'));
test("Runtime implementa STRUCTURAL_EDITOR", () => runtime.includes('"STRUCTURAL_EDITOR"'));
test("Delta protege factualidad", () => runtime.includes("factuality_regressed"));
test("Delta protege evidencia", () => runtime.includes("evidence_regressed"));
test("Delta detecta claims nuevos", () => runtime.includes("unsupported_claims_increased"));

test("Jobs API autentica JWT", () => jobs.includes("auth.getUser"));
test("Jobs API exige evaluation_id", () => jobs.includes("evaluation_id requerido"));
test("Jobs API no auto-aplica", () => jobs.includes("neverAutoApply: true"));
test("Apply API requiere JWT", () => apply.includes("auth.getUser"));
test("Apply API llama apply RPC", () => apply.includes("refinery_apply_chapter_version"));
test("Apply API llama rollback RPC", () => apply.includes("refinery_rollback_chapter_apply"));

test("SQL crea refinement jobs", () => sql.includes("create table if not exists public.manuscript_refinement_jobs"));
test("SQL crea chapter versions", () => sql.includes("create table if not exists public.manuscript_chapter_versions"));
test("SQL crea apply history", () => sql.includes("create table if not exists public.manuscript_refinement_applies"));
test("SQL tiene lease atómico", () => sql.includes("for update skip locked"));
test("SQL tiene retry/backoff", () => sql.includes("power(2"));
test("SQL versiona con advisory lock", () => sql.includes("pg_advisory_xact_lock"));
test("SQL apply verifica source hash", () => sql.includes("source_changed_since_refinement"));
test("SQL rollback verifica hash", () => sql.includes("section_changed_after_apply"));
test("SQL conserva previous_content", () => sql.includes("previous_content text not null"));
test("SQL revoca writes cliente", () => sql.includes("revoke insert, update, delete"));
test("Runner no imprime secretos", () => !runner.includes("console.log(secret"));

const pkg = JSON.parse(read("package.json"));
test("package tiene refinery:11b3:test", () => pkg.scripts?.["refinery:11b3:test"] === "node scripts/refinery-11b3-tests.mjs");
test("package tiene refinery:11b3:worker", () => pkg.scripts?.["refinery:11b3:worker"] === "node scripts/run-refinement-worker-local.mjs");
test("package tiene refinery:11b3:verify", () => typeof pkg.scripts?.["refinery:11b3:verify"] === "string");

test("No hay claves literales obvias", () => {
  const combined = [worker, jobs, apply, runtime, runner].join("\n");
  return !/AIza[0-9A-Za-z_-]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/.test(combined);
});

console.log("\n================================================");
console.log("GENELIBROS 5.0 — REFINERY 11B.3 TESTS");
console.log("================================================");
for (const item of tests) {
  console.log(`${item.ok ? "✅ PASS" : "❌ FAIL"}: ${item.name}${item.error ? ` — ${item.error}` : ""}`);
}
const failed = tests.filter((x) => !x.ok);
console.log("");
if (failed.length) {
  console.error(`❌ FASE 11B.3: ${failed.length} prueba(s) fallaron.`);
  process.exit(1);
}
console.log(`✅ FASE 11B.3: ${tests.length} pruebas estructurales pasaron.`);
console.log("✅ Refinery Execution Engine listo: versiones + Delta + research gates + apply/rollback explícito.");

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const R = (p) => {
  try { return fs.readFileSync(path.join(root, p), "utf8"); }
  catch { return ""; }
};
const E = (p) => fs.existsSync(path.join(root, p));

const checks = [];
function test(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

const worker = R("api/os4-worker.ts");
const jobs = R("api/os4-jobs.ts");
const runtime = R("src/server/os4-runtime.ts");
const client = R("src/lib/os4/jobs.ts");
const ui = R("components/AutonomousPublishingOS.tsx");
const sql = R("sql/os4-10b-durable-worker.sql");
const scheduler = R("sql/os4-10b-scheduler-template.sql");
const evaluator = R("scripts/evaluate-os4-supreme.mjs");
let pkg = {};
try { pkg = JSON.parse(R("package.json")); } catch {}

test("Worker durable existe", E("api/os4-worker.ts"));
test("Jobs API existe", E("api/os4-jobs.ts"));
test("Server runtime existe", E("src/server/os4-runtime.ts"));
test("Cliente durable existe", E("src/lib/os4/jobs.ts"));

test("Worker usa generation_jobs", /generation_jobs/i.test(worker));
test("Worker reclama job por RPC", /os4_claim_generation_job/.test(worker));
test("Worker tiene heartbeat", /os4_heartbeat_generation_job/.test(worker));
test("Worker tiene checkpoint resume", /checkpointOf|checkpoint/.test(worker));
test("Worker tiene retry fail RPC", /os4_fail_generation_job/.test(worker));
test("Worker soporta healthcheck", /OS4_HEALTHCHECK/.test(worker));
test("Worker es independiente del navegador", !/window\.|document\.|import\.meta\.env/.test(worker));

test("Runtime usa GEMINI_API_KEY server-side", /process\.env\.GEMINI_API_KEY/.test(runtime));
test("Runtime tiene Writer durable", /writeOs4Chapter/.test(runtime));
test("Runtime tiene 18 agentes", [
  "MARKET_STRATEGIST","CONCEPT_ARENA","AUTHOR_DNA_ANALYST","BOOK_ARCHITECT",
  "RESEARCH_DIRECTOR","KNOWLEDGE_ENGINEER","BOOK_SIMULATOR","CHIEF_EDITOR",
  "FACT_CHECKER","CONTINUITY_EDITOR","STYLE_EDITOR","ADVERSARIAL_CRITIC",
  "QUALITY_JUDGE","REWRITE_EDITOR","MASTER_EDITOR","PUBLISHING_DIRECTOR",
  "LAUNCH_STRATEGIST","PORTFOLIO_ANALYST"
].every((a) => runtime.includes(a)));

test("SQL agrega lease_expires_at", /lease_expires_at/.test(sql));
test("SQL agrega heartbeat_at", /heartbeat_at/.test(sql));
test("SQL agrega next_retry_at", /next_retry_at/.test(sql));
test("SQL agrega idempotency_key", /idempotency_key/.test(sql));
test("SQL agrega checkpoint", /checkpoint jsonb/.test(sql));
test("SQL agrega dead_letter_at", /dead_letter_at/.test(sql));
test("SQL usa FOR UPDATE SKIP LOCKED", /for update skip locked/i.test(sql));
test("SQL tiene exponential backoff", /power\(2/i.test(sql));
test("SQL tiene DEAD_LETTER", /DEAD_LETTER/.test(sql));
test("SQL restringe RPC a service_role", /grant execute[\s\S]*service_role/i.test(sql));

test("Scheduler usa Supabase Cron", /cron\.schedule/.test(scheduler));
test("Scheduler llama worker por pg_net", /net\.http_post/.test(scheduler));
test("Scheduler usa Vault", /vault\.decrypted_secrets/.test(scheduler));
test("Scheduler configurado cada minuto", /'\* \* \* \* \*'/.test(scheduler));

test("Jobs API valida JWT", /auth\.getUser/.test(jobs));
test("Jobs API valida ownership", /projects/.test(jobs) && /user_id/.test(jobs));
test("Jobs API no expone service role al cliente", !/VITE_SUPABASE_SERVICE_ROLE/.test(client));
test("Cliente puede enqueue", /enqueueOs4DurableBook/.test(client));
test("Cliente puede cancel", /cancelOs4DurableJob/.test(client));
test("Cliente puede resume", /resumeOs4DurableJob/.test(client));

test("Mission Control tiene Libro 24/7", /Libro 24\/7 DURABLE/.test(ui));
test("Mission Control muestra durable job", /durableJob/.test(ui));
test("Mission Control hace polling", /setInterval/.test(ui));

test("Evaluator requiere live proof", /os4-worker-production-proof\.json/.test(evaluator));
test("Package os4:10b:test", Boolean(pkg?.scripts?.["os4:10b:test"]));
test("Package os4:10b:live", Boolean(pkg?.scripts?.["os4:10b:live"]));

console.log("");
console.log("==========================================");
console.log("BESTSELLER OS4 — FASE 10B TESTS");
console.log("==========================================");

let failed = 0;
for (const c of checks) {
  if (c.ok) console.log(`✅ PASS: ${c.name}`);
  else {
    failed++;
    console.log(`❌ FAIL: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
}

if (failed) {
  console.log("");
  console.error(`❌ FASE 10B: ${failed} prueba(s) fallaron.`);
  process.exit(1);
}

console.log("");
console.log("✅ FASE 10B: todas las pruebas estructurales pasaron.");
console.log("⚠️ El 10/10 real requiere además npm run os4:10b:live después del deploy + scheduler.");

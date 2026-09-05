import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const tests = [];
function test(name, fn) {
  try {
    tests.push({ name, ok: Boolean(fn()) });
  } catch (error) {
    tests.push({
      name,
      ok: false,
      error: String(error?.message || error),
    });
  }
}

const required = [
  "src/server/vercel-handlers/manuscript-audit-jobs.ts",
  "src/server/vercel-handlers/refinery-worker.ts",
  "scripts/run-refinery-worker-local.mjs",
  "scripts/prepare-refinery-worker-local.ps1",
  "sql/refinery-11b2-durable-worker.sql",
  "sql/refinery-11b2-verify.sql",
  "src/server/refinery-runtime.ts",
];

for (const file of required) {
  test(`Existe ${file}`, () => exists(file));
}

const jobs = read("src/server/vercel-handlers/manuscript-audit-jobs.ts");
const worker = read("src/server/vercel-handlers/refinery-worker.ts");
const runner = read("scripts/run-refinery-worker-local.mjs");
const sql = read("sql/refinery-11b2-durable-worker.sql");
const runtime = read("src/server/refinery-runtime.ts");
const pkg = JSON.parse(read("package.json"));

test("Jobs API autentica JWT", () =>
  jobs.includes("auth.getUser(token)") &&
  jobs.includes("authorization")
);

test("Jobs API valida ownership", () =>
  jobs.includes("assertOwnership") &&
  jobs.includes(".eq(\"user_id\", userId)")
);

test("Jobs API reutiliza auditoría activa", () =>
  jobs.includes("reused: true") &&
  jobs.includes('"QUEUED", "RUNNING", "RETRYING"')
);

test("Worker usa secreto server-side", () =>
  worker.includes("OS4_WORKER_SECRET") &&
  !worker.includes("VITE_OS4_WORKER_SECRET")
);

test("Worker procesa INIT", () =>
  worker.includes('step: "INIT"') &&
  worker.includes("processInit")
);

test("Worker procesa un capítulo por tick", () =>
  worker.includes("processChapter") &&
  worker.includes("chapter_index") &&
  worker.includes("auditSingleChapterStep")
);

test("Worker procesa auditoría global separada", () =>
  worker.includes("processGlobal") &&
  worker.includes("auditGlobalManuscriptStep")
);

test("Worker persist final idempotente", () =>
  worker.includes('.eq("job_id", job.id)') &&
  worker.includes("persistEvaluation")
);

test("Worker no modifica sections", () =>
  !worker.includes('.from("sections")\n    .update') &&
  !worker.includes('.from("sections")\n    .delete')
);

test("Worker no modifica master_documents", () =>
  !worker.includes('.from("master_documents")\n    .update') &&
  !worker.includes('.from("master_documents")\n    .delete')
);

test("Runtime exporta auditSingleChapterStep", () =>
  runtime.includes("export async function auditSingleChapterStep")
);

test("Runtime exporta auditGlobalManuscriptStep", () =>
  runtime.includes("export async function auditGlobalManuscriptStep")
);

test("SQL crea cola durable independiente", () =>
  sql.includes("create table if not exists public.manuscript_audit_jobs")
);

test("SQL tiene lease atómico", () =>
  sql.includes("for update skip locked") &&
  sql.includes("refinery_claim_audit_job")
);

test("SQL tiene heartbeat", () =>
  sql.includes("refinery_heartbeat_audit_job")
);

test("SQL tiene release/checkpoint", () =>
  sql.includes("refinery_release_audit_job") &&
  sql.includes("p_checkpoint")
);

test("SQL tiene retry/backoff", () =>
  sql.includes("refinery_fail_audit_job") &&
  sql.includes("power(2")
);

test("SQL tiene dead letter", () =>
  sql.includes("DEAD_LETTER") &&
  sql.includes("dead_letter_at")
);

test("SQL añade job_id idempotente a evaluations", () =>
  sql.includes("add column if not exists job_id uuid") &&
  sql.includes("idx_manuscript_evaluations_job_id")
);

test("SQL RLS select propio", () =>
  sql.includes("enable row level security") &&
  sql.includes("user_id = auth.uid()")
);

test("SQL revoca writes de cliente", () =>
  sql.includes("revoke insert, update, delete")
);

test("Runner no imprime secretos", () =>
  !runner.includes("console.log(secret)") &&
  !runner.includes("console.log(serviceKey)")
);

test("Runner usa worker secreto", () =>
  runner.includes('"x-os4-worker-secret": secret')
);

test("package tiene refinery:11b2:test", () =>
  pkg.scripts?.["refinery:11b2:test"] ===
  "node scripts/refinery-11b2-tests.mjs"
);

test("package tiene refinery:11b2:worker", () =>
  pkg.scripts?.["refinery:11b2:worker"] ===
  "node scripts/run-refinery-worker-local.mjs"
);

test("package tiene refinery:11b2:verify", () =>
  typeof pkg.scripts?.["refinery:11b2:verify"] === "string"
);

test("No hay claves literales obvias", () =>
  !/AIza[0-9A-Za-z\-_]{30,}/.test(
    [jobs, worker, runner].join("\n"),
  ) &&
  !/sk-[A-Za-z0-9_\-]{32,}/.test(
    [jobs, worker, runner].join("\n"),
  )
);

console.log("");
console.log("==============================================");
console.log("GENELIBROS 5.0 — REFINERY 11B.2 TESTS");
console.log("==============================================");

for (const item of tests) {
  console.log(
    `${item.ok ? "✅ PASS" : "❌ FAIL"}: ${item.name}` +
      (item.error ? ` — ${item.error}` : ""),
  );
}

const failed = tests.filter((x) => !x.ok);

console.log("");

if (failed.length) {
  console.error(
    `❌ FASE 11B.2: ${failed.length} prueba(s) fallaron.`,
  );
  process.exit(1);
}

console.log(
  `✅ FASE 11B.2: ${tests.length} pruebas estructurales pasaron.`,
);
console.log(
  "✅ Auditor durable preparado: 1 capítulo por tick + checkpoint + retry.",
);

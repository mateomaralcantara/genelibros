#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

function loadEnvFile(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

for (const f of [".env.local", ".env", ".env.production.local", ".env.production"]) {
  loadEnvFile(f);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!url || !service) {
  console.error("❌ Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const supabase = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const probeToken = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const started = Date.now();

console.log("");
console.log("============================================================");
console.log(" BESTSELLER OS4 10B — LIVE DURABLE VERIFICATION");
console.log("============================================================");
console.log("Esta prueba NO llama manualmente al worker.");
console.log("Encola un healthcheck y espera a que Supabase Cron lo procese.");
console.log("");

const { data: job, error: insertError } = await supabase
  .from("generation_jobs")
  .insert({
    user_id: null,
    project_id: null,
    job_type: "OS4_HEALTHCHECK",
    status: "QUEUED",
    priority: 0,
    payload: { probe_token: probeToken, created_by: "os4-10b-live-verify" },
    result: {},
    attempts: 0,
    max_attempts: 3,
    idempotency_key: `OS4_HEALTHCHECK:${probeToken}`,
    checkpoint: {
      version: "10B",
      step: "HEALTHCHECK",
      chapter_number: 1,
      repair_iteration: 0,
      research_index: 0,
    },
    workflow_version: "os4-10b-durable-1.0.0",
    next_retry_at: new Date().toISOString(),
  })
  .select("*")
  .single();

if (insertError) {
  console.error("❌ No pude insertar healthcheck:");
  console.error(insertError);
  process.exit(1);
}

console.log(`✅ Healthcheck encolado: ${job.id}`);
console.log("Esperando scheduler/worker...");

const timeoutMs = Math.max(
  90000,
  Number(process.env.OS4_LIVE_VERIFY_TIMEOUT_MS || 210000) || 210000
);
const pollMs = 5000;

let finalJob = job;
while (Date.now() - started < timeoutMs) {
  await new Promise((resolve) => setTimeout(resolve, pollMs));

  const { data, error } = await supabase
    .from("generation_jobs")
    .select("*")
    .eq("id", job.id)
    .single();

  if (error) {
    console.error("❌ Error consultando healthcheck:", error);
    process.exit(1);
  }

  finalJob = data;
  const step = data?.checkpoint?.step || "—";
  process.stdout.write(
    `\rstatus=${String(data.status).padEnd(14)} step=${String(step).padEnd(18)} attempts=${data.attempts}/${data.max_attempts}   `
  );

  if (["COMPLETED", "DEAD_LETTER", "FAILED", "CANCELLED"].includes(data.status)) {
    break;
  }
}

console.log("");

const result = finalJob?.result || {};
const verified =
  finalJob?.status === "COMPLETED" &&
  result?.healthcheck === true &&
  result?.scheduler_verified === true &&
  result?.lease_claimed === true &&
  result?.probe_token === probeToken &&
  String(result?.worker_version || "").includes("os4-10b");

const proof = {
  verified,
  scheduler_verified: result?.scheduler_verified === true,
  lease_verified: result?.lease_claimed === true,
  completed_status: finalJob?.status || null,
  worker_version: result?.worker_version || null,
  job_id: job.id,
  probe_token: probeToken,
  attempts: finalJob?.attempts ?? null,
  execution_count: finalJob?.execution_count ?? null,
  started_at: new Date(started).toISOString(),
  verified_at: new Date().toISOString(),
  elapsed_ms: Date.now() - started,
  note:
    "Prueba externa: el script solo insertó generation_jobs; el completion fue realizado por scheduler + worker.",
};

fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "reports", "os4-worker-production-proof.json"),
  JSON.stringify(proof, null, 2) + "\n",
  "utf8"
);

if (!verified) {
  console.error("❌ LIVE VERIFY NO COMPLETADO.");
  console.error(`Estado final: ${finalJob?.status}`);
  console.error(`Error: ${finalJob?.last_error || finalJob?.error || "sin detalle"}`);
  console.error("");
  console.error("Revisa:");
  console.error("1. sql/os4-10b-durable-worker.sql ejecutado.");
  console.error("2. /api/os4-worker desplegado.");
  console.error("3. OS4_WORKER_SECRET coincide entre Vercel y Supabase Vault.");
  console.error("4. Cron bestseller-os4-durable-worker activo.");
  console.error("5. pg_net / Cron History en Supabase.");
  process.exit(1);
}

console.log("✅ SCHEDULER VERIFICADO");
console.log("✅ LEASE VERIFICADO");
console.log("✅ WORKER INDEPENDIENTE VERIFICADO");
console.log("✅ COMPLETION DURABLE VERIFICADO");
console.log("");
console.log("Prueba guardada:");
console.log(path.join(ROOT, "reports", "os4-worker-production-proof.json"));

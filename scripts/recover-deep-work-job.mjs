import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv(path.resolve(".env.local"));

const jobId = String(process.argv[2] || "").trim();
if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
  console.error("Uso: npm run deep:11c:recover -- <job_uuid>");
  process.exit(2);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("Faltan SUPABASE_URL/VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY.");
  process.exit(3);
}

const s = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: job, error: readError } = await s
  .from("deep_work_jobs")
  .select("id,status,attempts,max_attempts,checkpoint,result,progress,dead_letter_at,last_error")
  .eq("id", jobId)
  .single();

if (readError || !job) {
  console.error("No pude leer el Deep Work job:", readError?.message || "no encontrado");
  process.exit(4);
}

const step = String(job.checkpoint?.step || "");
const repairAttempts = Number(job.result?.repairAttempts || 0);
const qualityScore = Number(job.result?.quality?.overallScore || 0);
const qualityVerdict = String(job.result?.quality?.verdict || "");

console.log("Deep Work job encontrado:");
console.log({
  id: job.id,
  status: job.status,
  attempts: job.attempts,
  max_attempts: job.max_attempts,
  checkpoint: step,
  progress: job.progress,
  repairAttempts,
  qualityScore,
  qualityVerdict,
});

if (job.status !== "DEAD_LETTER") {
  console.error(`Recovery cancelado: status=${job.status}; solo se recupera DEAD_LETTER.`);
  process.exit(5);
}

if (step !== "REPAIR" && step !== "QUALITY" && step !== "PERSIST") {
  console.error(`Recovery cancelado: checkpoint=${step}; no se reinician etapas costosas.`);
  process.exit(6);
}

const { data: recovered, error: updateError } = await s
  .from("deep_work_jobs")
  .update({
    status: "QUEUED",
    attempts: 0,
    next_retry_at: new Date().toISOString(),
    dead_letter_at: null,
    locked_by: null,
    locked_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    last_error: null,
    error: null,
    updated_at: new Date().toISOString(),
  })
  .eq("id", jobId)
  .eq("status", "DEAD_LETTER")
  .select("id,status,attempts,checkpoint,progress")
  .single();

if (updateError || !recovered) {
  console.error("No pude recuperar el job:", updateError?.message || "update sin resultado");
  process.exit(7);
}

console.log("Job recuperado sin borrar checkpoint, result ni artifacts:");
console.log(recovered);

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv(path.resolve(".env.local"));

const jobId = String(process.argv[2] || "").trim();
if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
  console.error("Uso: npm run deep:11c:retry-repair -- <job_uuid>");
  process.exit(2);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("Faltan credenciales server-side de Supabase en .env.local.");
  process.exit(3);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: job, error: jobError } = await s
  .from("deep_work_jobs")
  .select("id,status,checkpoint,result,progress,attempts,max_attempts,completed_at")
  .eq("id", jobId)
  .single();
if (jobError || !job) {
  console.error("Job no encontrado:", jobError?.message || "sin resultado");
  process.exit(4);
}

if (job.status !== "COMPLETED" || String(job.result?.quality?.verdict || "") !== "REJECTED") {
  console.error(`Retry cancelado: se esperaba COMPLETED/REJECTED y llegó ${job.status}/${job.result?.quality?.verdict || "NONE"}.`);
  process.exit(5);
}

const { data: synthesis, error: synthesisError } = await s
  .from("deep_work_artifacts")
  .select("id,content,payload,model,created_at")
  .eq("job_id", jobId)
  .eq("artifact_type", "SYNTHESIS")
  .order("created_at", { ascending: true })
  .limit(1)
  .single();
if (synthesisError || !synthesis?.content) {
  console.error("No se encontró SYNTHESIS persistido:", synthesisError?.message || "contenido vacío");
  process.exit(6);
}

const { data: initialQuality, error: qualityError } = await s
  .from("deep_work_artifacts")
  .select("id,payload,model,created_at")
  .eq("job_id", jobId)
  .eq("artifact_type", "QUALITY")
  .order("created_at", { ascending: true })
  .limit(1)
  .single();
if (qualityError || !initialQuality?.payload) {
  console.error("No se encontró QUALITY inicial:", qualityError?.message || "payload vacío");
  process.exit(7);
}

const result = { ...(job.result || {}) };
result.finalCandidate = {
  label: "SYNTHESIS",
  content: synthesis.content,
  rationale: "Restaurado desde artifact SYNTHESIS para retry V5.6 sin repetir etapas costosas.",
  strengths: [],
  risks: [],
};
result.quality = initialQuality.payload;
result.repairAttempts = 0;
result.applyAllowed = false;
delete result.completedAt;

const { data: updated, error: updateError } = await s
  .from("deep_work_jobs")
  .update({
    status: "QUEUED",
    checkpoint: { version: "11C", step: "REPAIR" },
    result,
    progress: 78,
    attempts: 0,
    next_retry_at: new Date().toISOString(),
    locked_by: null,
    locked_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    last_error: null,
    error: null,
    dead_letter_at: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  })
  .eq("id", jobId)
  .eq("status", "COMPLETED")
  .select("id,status,checkpoint,progress,attempts,result")
  .single();

if (updateError || !updated) {
  console.error("No se pudo reactivar el job:", updateError?.message || "sin resultado");
  process.exit(8);
}

const words = String(synthesis.content).trim().split(/\s+/).filter(Boolean).length;
console.log("Retry de REPAIR preparado desde SYNTHESIS persistido:");
console.log({
  id: updated.id,
  status: updated.status,
  checkpoint: updated.checkpoint,
  progress: updated.progress,
  repairAttempts: updated.result?.repairAttempts,
  restoredWords: words,
  restoredQuality: updated.result?.quality?.overallScore,
  restoredVerdict: updated.result?.quality?.verdict,
  synthesisArtifact: synthesis.id,
  qualityArtifact: initialQuality.id,
});

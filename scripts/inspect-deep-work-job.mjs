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

function countWords(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

loadEnv(path.resolve(".env.local"));

const jobId = String(process.argv[2] || "").trim();
if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
  console.error("Uso: npm run deep:11c:inspect -- <job_uuid>");
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

const { data: job, error: jobError } = await s
  .from("deep_work_jobs")
  .select("id,status,progress,checkpoint,result,attempts,max_attempts,last_error,completed_at,target_words,chapter_number")
  .eq("id", jobId)
  .single();

if (jobError || !job) {
  console.error("No pude leer el Deep Work job:", jobError?.message || "no encontrado");
  process.exit(4);
}

const { data: artifacts, error: artifactError } = await s
  .from("deep_work_artifacts")
  .select("id,artifact_type,label,content,payload,model,created_at")
  .eq("job_id", jobId)
  .order("created_at", { ascending: true });

if (artifactError) {
  console.error("No pude leer artifacts:", artifactError.message);
  process.exit(5);
}

const result = job.result || {};
const quality = result.quality || {};
const candidate = result.finalCandidate || {};

console.log("\n=== DEEP WORK JOB ===");
console.dir({
  id: job.id,
  status: job.status,
  chapter_number: job.chapter_number,
  target_words: job.target_words,
  progress: job.progress,
  checkpoint: job.checkpoint,
  attempts: job.attempts,
  max_attempts: job.max_attempts,
  completed_at: job.completed_at,
  repairAttempts: Number(result.repairAttempts || 0),
  candidateWords: countWords(candidate.content),
  applyAllowed: Boolean(result.applyAllowed),
}, { depth: 8 });

console.log("\n=== FINAL QUALITY ===");
console.dir({
  overallScore: quality.overallScore,
  verdict: quality.verdict,
  scores: quality.scores,
  strengths: quality.strengths,
  weaknesses: quality.weaknesses,
  requiredRepairs: quality.requiredRepairs,
  unsupportedNewClaims: quality.unsupportedNewClaims,
}, { depth: 12, maxArrayLength: 100 });

console.log("\n=== MODELS ===");
console.dir(result.models || {}, { depth: 8 });

console.log("\n=== ARTIFACT TIMELINE ===");
for (const a of artifacts || []) {
  const words = countWords(a.content);
  const payload = a.payload || {};
  const q = a.artifact_type === "QUALITY" ? payload : null;
  console.log({
    created_at: a.created_at,
    type: a.artifact_type,
    label: a.label,
    words,
    model: a.model,
    quality: q ? {
      overallScore: q.overallScore,
      verdict: q.verdict,
      weaknesses: q.weaknesses,
      requiredRepairs: q.requiredRepairs,
      unsupportedNewClaims: q.unsupportedNewClaims,
    } : undefined,
  });
}

console.log("\nInspector completado. Solo lectura; no se modificó el job.");

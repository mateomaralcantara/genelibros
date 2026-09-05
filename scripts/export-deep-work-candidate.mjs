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
  console.error("Uso: npm run deep:11c:export -- <job_uuid>");
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
  .select("id,status,chapter_number,target_words,result,checkpoint,completed_at")
  .eq("id", jobId)
  .single();

if (jobError || !job) {
  console.error("Job no encontrado:", jobError?.message || "sin resultado");
  process.exit(4);
}

const { data: repairs, error: artifactError } = await s
  .from("deep_work_artifacts")
  .select("id,label,content,model,created_at")
  .eq("job_id", jobId)
  .eq("artifact_type", "REPAIR")
  .order("created_at", { ascending: false })
  .limit(1);

if (artifactError) {
  console.error("No se pudieron leer artifacts REPAIR:", artifactError.message);
  process.exit(5);
}

const latestRepair = Array.isArray(repairs) && repairs.length ? repairs[0] : null;
const resultCandidate = job.result?.finalCandidate?.content ? String(job.result.finalCandidate.content) : "";
const content = String(latestRepair?.content || resultCandidate || "").trim();

if (!content) {
  console.error("El job no contiene finalCandidate ni artifact REPAIR exportable.");
  process.exit(6);
}

const words = content.split(/\s+/).filter(Boolean).length;
const outDir = path.resolve("exports");
fs.mkdirSync(outDir, { recursive: true });
const base = `deep-work-${job.chapter_number || "chapter"}-${jobId}`;
const textPath = path.join(outDir, `${base}.txt`);
const metaPath = path.join(outDir, `${base}.json`);

fs.writeFileSync(textPath, content + "\n", "utf8");
fs.writeFileSync(metaPath, JSON.stringify({
  jobId,
  status: job.status,
  checkpoint: job.checkpoint,
  chapterNumber: job.chapter_number,
  targetWords: job.target_words,
  candidateWords: words,
  quality: job.result?.quality || null,
  repairAttempts: Number(job.result?.repairAttempts || 0),
  applyAllowed: Boolean(job.result?.applyAllowed),
  sourceArtifact: latestRepair ? {
    id: latestRepair.id,
    label: latestRepair.label,
    model: latestRepair.model,
    createdAt: latestRepair.created_at,
  } : null,
  exportedAt: new Date().toISOString(),
  llmCallsMadeByExporter: 0,
}, null, 2) + "\n", "utf8");

console.log("Exportación Deep Work completada — 0 llamadas LLM / 0 créditos Gemini.");
console.log({
  jobId,
  status: job.status,
  words,
  textPath,
  metaPath,
  source: latestRepair?.label || "result.finalCandidate",
});
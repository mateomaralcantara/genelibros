import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function words(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

loadEnv(path.resolve(".env.local"));

const DEFAULT_JOB = "c47273e7-a397-4677-8892-763b7a900296";
const DEFAULT_FILE = path.resolve("manual-finals/chapter-2-c47273e7-a397-4677-8892-763b7a900296.txt");
const DEFAULT_MANIFEST = path.resolve("manual-finals/chapter-2-c47273e7-a397-4677-8892-763b7a900296.validation.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((x) => x !== "--apply");
const jobId = String(positional[0] || DEFAULT_JOB).trim();
const filePath = path.resolve(positional[1] || DEFAULT_FILE);
const manifestPath = path.resolve(positional[2] || DEFAULT_MANIFEST);

if (!apply) {
  console.error("Este comando escribe el capítulo. Repite con --apply para confirmar la aplicación local.");
  console.error(`Uso: npm run deep:11c:apply-local-final -- ${jobId} \"${filePath}\" \"${manifestPath}\" --apply`);
  process.exit(2);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("Faltan credenciales server-side de Supabase en .env.local.");
  process.exit(3);
}
if (!fs.existsSync(filePath)) {
  console.error(`No existe el archivo final: ${filePath}`);
  process.exit(4);
}
if (!fs.existsSync(manifestPath)) {
  console.error(`No existe el manifiesto: ${manifestPath}`);
  process.exit(5);
}

const text = fs.readFileSync(filePath, "utf8").trim();
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const newHash = sha256(text);
const newWords = words(text);

if (String(manifest.jobId || "") !== jobId) {
  throw new Error(`MANIFEST_JOB_MISMATCH: ${manifest.jobId} != ${jobId}`);
}
if (manifest.sha256 && String(manifest.sha256) !== newHash) {
  throw new Error(`MANIFEST_HASH_MISMATCH: esperado=${manifest.sha256} actual=${newHash}`);
}
const minWords = Number(manifest.minWords || 2300);
const maxWords = Number(manifest.maxWords || 2700);
if (newWords < minWords || newWords > maxWords) {
  throw new Error(`WORD_COUNT_INVALID: ${newWords}; requerido ${minWords}-${maxWords}`);
}
const missingAnchors = (Array.isArray(manifest.anchors) ? manifest.anchors : []).filter((anchor) => !norm(text).includes(norm(anchor)));
if (missingAnchors.length) {
  throw new Error(`ANCHORS_MISSING: ${JSON.stringify(missingAnchors)}`);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: job, error: jobError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,section_id,chapter_number,status,operation,target_words,result")
  .eq("id", jobId)
  .single();
if (jobError || !job) throw jobError || new Error("Job no encontrado.");
if (job.status !== "COMPLETED") throw new Error(`JOB_NOT_COMPLETED: ${job.status}`);
if (!job.section_id) throw new Error("JOB_HAS_NO_SECTION: no se puede aplicar directamente.");
if (Number(job.chapter_number) !== Number(manifest.chapterNumber)) throw new Error("CHAPTER_MISMATCH");

const { data: section, error: sectionError } = await s
  .from("sections")
  .select("id,project_id,chapter_number,title,content")
  .eq("id", job.section_id)
  .eq("project_id", job.project_id)
  .single();
if (sectionError || !section) throw sectionError || new Error("Sección no encontrada.");

const currentContent = String(section.content || "");
const currentHash = sha256(currentContent);
const sourceHash = String(job.result?.sourceHash || "");
if (sourceHash && currentHash !== sourceHash) {
  throw new Error(`SOURCE_CHANGED: actual=${currentHash}; esperado=${sourceHash}. No se aplica para no pisar cambios posteriores.`);
}
if (currentHash === newHash) {
  console.log("[Genelibros] El capítulo ya contiene exactamente este texto. No se hicieron cambios.");
  process.exit(0);
}

const backupDir = path.resolve("exports/backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupBase = `chapter-${job.chapter_number}-before-local-final-${stamp}`;
const backupTxt = path.join(backupDir, `${backupBase}.txt`);
const backupJson = path.join(backupDir, `${backupBase}.json`);
fs.writeFileSync(backupTxt, currentContent, "utf8");
fs.writeFileSync(backupJson, JSON.stringify({
  jobId,
  projectId: job.project_id,
  sectionId: job.section_id,
  chapterNumber: job.chapter_number,
  previousHash: currentHash,
  newHash,
  newWords,
  createdAt: new Date().toISOString(),
}, null, 2), "utf8");

const { data: artifactId, error: artifactError } = await s.rpc("deep_create_artifact", {
  p_user_id: job.user_id,
  p_project_id: job.project_id,
  p_job_id: job.id,
  p_section_id: job.section_id,
  p_chapter_number: job.chapter_number,
  p_artifact_type: "REPAIR",
  p_label: "MANUAL_FINAL_LOCAL_NO_LLM",
  p_content: text,
  p_payload: {
    manual: true,
    llm_calls: 0,
    source: path.basename(filePath),
    previous_hash: currentHash,
    final_hash: newHash,
    words: newWords,
    manifest: path.basename(manifestPath),
  },
  p_content_hash: newHash,
  p_model: null,
});
if (artifactError) throw artifactError;

const { error: updateSectionError } = await s
  .from("sections")
  .update({ content: text })
  .eq("id", job.section_id)
  .eq("project_id", job.project_id);
if (updateSectionError) throw updateSectionError;

const { data: verifySection, error: verifyError } = await s
  .from("sections")
  .select("content")
  .eq("id", job.section_id)
  .eq("project_id", job.project_id)
  .single();
if (verifyError || !verifySection || sha256(String(verifySection.content || "")) !== newHash) {
  await s.from("sections").update({ content: currentContent }).eq("id", job.section_id).eq("project_id", job.project_id);
  throw verifyError || new Error("VERIFY_FAILED: se restauró automáticamente el capítulo anterior.");
}

const result = { ...(job.result || {}) };
result.manualFinal = {
  artifactId: String(artifactId || ""),
  label: "MANUAL_FINAL_LOCAL_NO_LLM",
  contentHash: newHash,
  wordCount: newWords,
  appliedAt: new Date().toISOString(),
  llmCalls: 0,
  validation: "DETERMINISTIC_LOCAL_MANIFEST",
};
result.manualApplied = true;
result.manualAppliedAt = result.manualFinal.appliedAt;
result.manualAppliedHash = newHash;
result.manualPreviousHash = currentHash;
result.applyAllowed = false;

const { error: updateJobError } = await s
  .from("deep_work_jobs")
  .update({ result })
  .eq("id", job.id);
if (updateJobError) {
  await s.from("sections").update({ content: currentContent }).eq("id", job.section_id).eq("project_id", job.project_id);
  throw new Error(`JOB_METADATA_UPDATE_FAILED: ${updateJobError.message}. Se restauró el capítulo anterior.`);
}

console.log("\n==============================================");
console.log(" GENELIBROS — MANUAL FINAL APLICADO");
console.log("==============================================");
console.log({
  jobId: job.id,
  projectId: job.project_id,
  sectionId: job.section_id,
  chapterNumber: job.chapter_number,
  words: newWords,
  hash: newHash,
  artifactId: String(artifactId || ""),
  backupTxt,
  backupJson,
  llmCalls: 0,
  externalCredits: 0,
});

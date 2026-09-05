import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  DEEP_PRODUCTION_VERSION,
  QUALITY_THRESHOLD,
  clean,
  countWords,
  wordRange,
} from "./deep-production-v1-contract.mjs";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}
function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? clean(args[index + 1]) : fallback;
}
function hash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] Production V1 APPLY bloqueado: faltan credenciales Supabase.");
  process.exit(2);
}

const requestedJobId = argValue("--job", "");
const projectId = argValue("--project", "");
const chapterNumber = Math.max(1, Number(argValue("--chapter", "0")) || 0);
if (!requestedJobId && (!projectId || !chapterNumber)) {
  console.error("Uso: node scripts/deep-production-apply.mjs --job <uuid> | --project <uuid> --chapter <n>");
  process.exit(3);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let job = null;
if (requestedJobId) {
  const { data, error } = await s
    .from("deep_work_jobs")
    .select("id,user_id,project_id,section_id,chapter_number,status,objective,target_words,operation,result,updated_at")
    .eq("id", requestedJobId)
    .maybeSingle();
  if (error) throw error;
  job = data || null;
} else {
  const { data, error } = await s
    .from("deep_work_jobs")
    .select("id,user_id,project_id,section_id,chapter_number,status,objective,target_words,operation,result,updated_at")
    .eq("project_id", projectId)
    .eq("chapter_number", chapterNumber)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  job = (data || []).find((row) => clean(row.objective).includes("GENELIBROS_PRODUCTION_V1|")) || null;
}

if (!job) {
  console.error("[Genelibros] Production V1 APPLY: no se encontró job Production V1.");
  process.exit(4);
}
if (!clean(job.objective).includes("GENELIBROS_PRODUCTION_V1|")) {
  console.error("[Genelibros] Production V1 APPLY: el job no pertenece al pipeline Production V1.");
  process.exit(5);
}
if (clean(job.status).toUpperCase() !== "COMPLETED") {
  console.error(`[Genelibros] Production V1 APPLY bloqueado: job ${job.id} está ${job.status}, no COMPLETED.`);
  process.exit(6);
}

const result = job.result && typeof job.result === "object" ? job.result : {};
const quality = result.quality && typeof result.quality === "object" ? result.quality : {};
const score = Number(quality.overallScore || 0);
const verdict = clean(quality.verdict).toUpperCase();
const content = clean(result.finalCandidate?.content);

if (verdict !== "APPROVED" || score < QUALITY_THRESHOLD || result.applyAllowed !== true) {
  console.error("[Genelibros] Production V1 NO APLICADO: QUALITY no autorizó publicación.");
  console.error({
    jobId: job.id,
    score,
    verdict,
    applyAllowed: result.applyAllowed ?? false,
    calls: result.usage?.calls ?? null,
    repairAttempts: result.repairAttempts ?? null,
  });
  process.exit(7);
}
if (!content) {
  console.error("[Genelibros] Production V1 APPLY bloqueado: finalCandidate vacío.");
  process.exit(8);
}
if (!job.section_id) {
  console.error("[Genelibros] Production V1 APPLY bloqueado: job sin section_id.");
  process.exit(9);
}

const range = wordRange(job.target_words || result.targetWords || 2500);
const wc = countWords(content);
if (wc < range.min || wc > range.max) {
  console.error(`[Genelibros] Production V1 APPLY bloqueado por longitud: ${wc} palabras; rango ${range.min}-${range.max}.`);
  process.exit(10);
}

const { data: section, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,project_id")
  .eq("id", job.section_id)
  .eq("project_id", job.project_id)
  .single();
if (sectionError || !section) throw sectionError || new Error("Section del capítulo no encontrada.");

const finalHash = hash(content);
const currentHash = hash(section.content || "");
if (currentHash === finalHash) {
  console.log("[Genelibros] Production V1 APPLY idempotente: el contenido aprobado ya está aplicado.");
  console.log({ jobId: job.id, sectionId: section.id, words: wc, qualityScore: score, verdict, contentHash: finalHash });
  process.exit(0);
}
if (result.sourceHash && currentHash !== result.sourceHash) {
  console.error("[Genelibros] Production V1 APPLY bloqueado: SOURCE_CHANGED; la section cambió desde el inicio del job.");
  process.exit(11);
}

const backupDir = path.resolve("exports", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupBase = path.join(backupDir, `production-v1-chapter-${job.chapter_number}-before-approved-${stamp}`);
fs.writeFileSync(`${backupBase}.txt`, String(section.content || ""), "utf8");
fs.writeFileSync(`${backupBase}.json`, JSON.stringify({
  productionVersion: DEEP_PRODUCTION_VERSION,
  jobId: job.id,
  projectId: job.project_id,
  chapterNumber: job.chapter_number,
  sectionId: section.id,
  previousTitle: section.title,
  previousHash: currentHash,
  newHash: finalHash,
  targetWords: range.target,
  finalWords: wc,
  qualityScore: score,
  verdict,
  backedUpAt: new Date().toISOString(),
}, null, 2), "utf8");

const finalTitle = clean(result.preferredTitle) || clean(result.title) || clean(section.title) || `Capítulo ${job.chapter_number}`;
const { data: updated, error: updateError } = await s
  .from("sections")
  .update({ title: finalTitle, content })
  .eq("id", section.id)
  .eq("project_id", job.project_id)
  .select("id,title,chapter_number,content")
  .single();
if (updateError || !updated) throw updateError || new Error("No se pudo aplicar el capítulo Production V1.");

console.log("\n================================================");
console.log(" ✅ GENELIBROS PRODUCTION V1 — CAPÍTULO APLICADO");
console.log("================================================");
console.log({
  productionVersion: DEEP_PRODUCTION_VERSION,
  jobId: job.id,
  projectId: job.project_id,
  sectionId: updated.id,
  chapterNumber: updated.chapter_number,
  title: updated.title,
  words: countWords(updated.content),
  targetWords: range.target,
  qualityScore: score,
  verdict,
  calls: Number(result.usage?.calls || 0),
  repairAttempts: Number(result.repairAttempts || 0),
  contentHash: hash(updated.content),
  backup: backupBase,
});

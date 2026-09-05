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
function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? String(args[at + 1]).trim() : fallback;
}
function hasFlag(name) { return process.argv.slice(2).includes(name); }
function words(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).length; }
function clean(value) { return String(value ?? "").trim(); }
function preview(value, max = 700) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return clean(s).replace(/\s+/g, " ").slice(0, max);
}
function isGenericChapterTitle(value, chapterNumber) {
  const normalized = clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return !normalized || normalized === `capitulo ${chapterNumber}` || /^capitulo\s+\d+$/.test(normalized);
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("Faltan credenciales server-side de Supabase en .env.local.");
  process.exit(2);
}

const sourceJobId = argValue("--from-job", process.env.DEEP_SOURCE_JOB_ID || "");
const chapterNumber = Math.max(1, Number(argValue("--chapter", "3")) || 3);
const explicitTopic = argValue("--topic", "");
const explicitObjective = argValue("--objective", "");
const maxQueries = Math.max(1, Math.min(8, Number(argValue("--max-queries", "5")) || 5));
const maxSources = Math.max(3, Math.min(12, Number(argValue("--max-sources", "6")) || 6));
const minimumBaseCalls = maxQueries + maxSources + 7;
const maxCalls = Math.max(8, Number(argValue("--max-calls", String(minimumBaseCalls))) || minimumBaseCalls);
const enqueue = hasFlag("--enqueue");

if (!sourceJobId) {
  console.error("Falta --from-job <deep_work_job_id> para identificar el proyecto de forma segura.");
  process.exit(3);
}

const researchGuard = !["0", "false", "off"].includes(String(process.env.RESEARCH_CREDIT_GUARD || "1").trim().toLowerCase());
if (!researchGuard) {
  console.error("BLOCKED: RESEARCH_CREDIT_GUARD está desactivado.");
  process.exit(4);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: sourceJob, error: sourceError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,chapter_number,status")
  .eq("id", sourceJobId)
  .single();
if (sourceError || !sourceJob) throw sourceError || new Error("Deep Work source job no encontrado.");

const { data: project, error: projectError } = await s
  .from("projects")
  .select("*")
  .eq("id", sourceJob.project_id)
  .eq("user_id", sourceJob.user_id)
  .single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

const { data: chapters, error: chaptersError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,order_index,type")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .order("chapter_number", { ascending: true });
if (chaptersError) throw chaptersError;

const chapter = (chapters || []).find((row) => Number(row.chapter_number) === chapterNumber) || null;
const previous = (chapters || []).find((row) => Number(row.chapter_number) === chapterNumber - 1) || null;
const next = (chapters || []).find((row) => Number(row.chapter_number) === chapterNumber + 1) || null;

const usefulProjectHints = {};
for (const [k, v] of Object.entries(project || {})) {
  if (!/outline|description|brief|synopsis|objective|premise|structure|chapter|topic|genre|audience|theme/i.test(k)) continue;
  if (v == null || v === "") continue;
  usefulProjectHints[k] = preview(v, 1400);
}

const { data: readyDossier, error: dossierError } = await s
  .from("research_dossiers")
  .select("id,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,completed_at")
  .eq("project_id", project.id)
  .eq("chapter_number", chapterNumber)
  .eq("ready_for_writing", true)
  .order("completed_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (dossierError) throw dossierError;

const { data: activeJobs, error: activeError } = await s
  .from("research_jobs")
  .select("id,status,topic,progress,checkpoint,created_at")
  .eq("project_id", project.id)
  .eq("user_id", sourceJob.user_id)
  .eq("chapter_number", chapterNumber)
  .in("status", ["QUEUED", "RUNNING", "RETRYING"])
  .order("created_at", { ascending: false })
  .limit(5);
if (activeError) throw activeError;

const titleTopic = chapter && !isGenericChapterTitle(chapter.title, chapterNumber) ? clean(chapter.title) : "";
const topic = explicitTopic || titleTopic;

console.log("\n================================================");
console.log(` GENELIBROS — RESEARCH CHAPTER ${chapterNumber} PREFLIGHT`);
console.log("================================================");
console.log({
  project: project.title,
  chapterNumber,
  chapter: chapter ? {
    id: chapter.id,
    title: chapter.title,
    words: words(chapter.content || ""),
    preview: preview(chapter.content || "", 500),
  } : null,
  previousChapter: previous ? {
    number: previous.chapter_number,
    title: previous.title,
    words: words(previous.content || ""),
    endingPreview: preview(String(previous.content || "").slice(-1200), 650),
  } : null,
  nextChapter: next ? {
    number: next.chapter_number,
    title: next.title,
    words: words(next.content || ""),
    openingPreview: preview(String(next.content || "").slice(0,1200), 650),
  } : null,
  projectHints: usefulProjectHints,
  resolvedTopic: topic || null,
  readyDossier: readyDossier || null,
  activeJobs: activeJobs || [],
  researchCreditGuard: true,
  model: process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash",
  firstPassOnly: true,
  maxQueries,
  maxSources,
  maxCalls,
  deterministicBaseCallCeiling: minimumBaseCalls,
  llmCallsMadeByPreflight: 0,
});

if (readyDossier) {
  console.log("\nREADY: ya existe Research certificado ready_for_writing. No se crea otro job.");
  process.exit(0);
}
if ((activeJobs || []).length) {
  console.error("\nBLOCKED: ya existe un Research job activo para este capítulo.");
  process.exit(10);
}
if (!chapter) {
  console.error(`\nBLOCKED: no existe la sección del Capítulo ${chapterNumber}.`);
  process.exit(11);
}
if (!topic) {
  console.error("\nBLOCKED: el tema del capítulo no está definido. El título es genérico y el contenido no aporta un tema investigable.");
  console.error(`Vuelve a ejecutar con --topic \"<tema real del Capítulo ${chapterNumber}>\" cuando el tema esté identificado.`);
  process.exit(12);
}
if (maxCalls < minimumBaseCalls) {
  console.error(`\nBLOCKED: maxCalls=${maxCalls} no alcanza para la pasada base determinística (${minimumBaseCalls}).`);
  process.exit(13);
}
if (!enqueue) {
  console.log("\nPREFLIGHT OK. No se encoló nada. Añade --enqueue para crear el Research job; todavía serán 0 llamadas LLM.");
  process.exit(0);
}

const objective = explicitObjective || [
  `Construir un dossier factual y verificable para el Capítulo ${chapterNumber}: ${topic}.`,
  "Priorizar fuentes oficiales, primarias, estadísticas, informes institucionales y corroboración independiente.",
  "Identificar cifras, fechas, instituciones, causalidades y contradicciones necesarias para escritura segura.",
  "No inventar hechos, referencias ni completar lagunas desde memoria.",
].join(" ");

const idempotencyKey = crypto
  .createHash("sha256")
  .update(JSON.stringify({ user: sourceJob.user_id, project: project.id, chapter: chapterNumber, topic, objective, depth: "SUPREME", firstPassOnly: true }))
  .digest("hex");

const checkpoint = {
  step: "INIT",
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  warnings: [],
  budgetGuard: {
    enabled: true,
    firstPassOnly: true,
    maxCalls,
    maxQueries,
    maxSources,
    model: process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash",
  },
};

const { data: job, error: insertError } = await s
  .from("research_jobs")
  .insert({
    user_id: sourceJob.user_id,
    project_id: project.id,
    chapter_number: chapterNumber,
    topic,
    objective,
    depth: "SUPREME",
    max_sources: maxSources,
    manual_urls: [],
    idempotency_key: idempotencyKey,
    status: "QUEUED",
    progress: 0,
    checkpoint,
  })
  .select("id,status,chapter_number,topic,depth,max_sources,progress,checkpoint")
  .single();
if (insertError || !job) throw insertError || new Error("No se pudo crear Research job.");

console.log("\n================================================");
console.log(" RESEARCH JOB ENCOLADO — TODAVÍA 0 LLM CALLS");
console.log("================================================");
console.log(job);
console.log("\nNo ejecutes research:11d:worker hasta revisar este preflight/job.");

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
function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function projectState(project) {
  return parseJsonObject(project?.state);
}
function parseOutline(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.chapters)) return value.chapters;
    return [];
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.items)) return parsed.items;
      if (Array.isArray(parsed.chapters)) return parsed.chapters;
    }
  } catch {}
  return [];
}
function outlineEntryFor(project, chapterNumber) {
  const state = projectState(project);
  const candidates = [
    [project?.outline_12, "project.outline_12"],
    [state?.outline_12, "project.state.outline_12"],
    [state?.outline12, "project.state.outline12"],
  ];
  const expectedId = `outline_${String(chapterNumber).padStart(2, "0")}`.toLowerCase();
  for (const [raw, location] of candidates) {
    const outline = parseOutline(raw);
    if (!outline.length) continue;
    const entry = outline.find((item) => clean(item?.id).toLowerCase() === expectedId)
      || outline.find((item) => Number(item?.chapter_number ?? item?.chapterNumber ?? item?.number) === chapterNumber)
      || outline[chapterNumber - 1]
      || null;
    if (entry) return { entry, location };
  }
  return { entry: null, location: null };
}
function stateChapterEntryFor(project, chapterNumber) {
  const state = projectState(project);
  const chapters = Array.isArray(state?.chapters) ? state.chapters : [];
  if (!chapters.length) return null;
  return chapters.find((item) => Number(item?.chapter_number ?? item?.chapterNumber ?? item?.number) === chapterNumber)
    || chapters[chapterNumber - 1]
    || null;
}
function firstText(candidates) {
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value) return value;
  }
  return "";
}
function resolveOutlineTopic(entry, location = "outline") {
  if (!entry) return { topic: "", source: null };
  const named = [
    [entry?.title, `${location}.title`],
    [entry?.chapter_title, `${location}.chapter_title`],
    [entry?.topic, `${location}.topic`],
    [entry?.heading, `${location}.heading`],
    [entry?.name, `${location}.name`],
    [entry?.os4?.chapter_title, `${location}.os4.chapter_title`],
    [entry?.os4?.title, `${location}.os4.title`],
    [entry?.os4?.topic, `${location}.os4.topic`],
    [entry?.objective, `${location}.objective`],
    [entry?.os4?.objective, `${location}.os4.objective`],
    [entry?.chapter_thesis, `${location}.chapter_thesis`],
    [entry?.os4?.chapter_thesis, `${location}.os4.chapter_thesis`],
  ];
  for (const [value, source] of named) {
    if (clean(value)) return { topic: clean(value), source };
  }
  return { topic: "", source: null };
}
function resolveStateChapterTopic(entry, chapterNumber) {
  if (!entry) return { topic: "", source: null };
  const candidates = [entry?.title, entry?.chapter_title, entry?.topic, entry?.heading, entry?.name];
  for (const value of candidates) {
    if (clean(value) && !isGenericChapterTitle(value, chapterNumber)) {
      return { topic: clean(value), source: "project.state.chapters.title" };
    }
  }
  return { topic: "", source: null };
}
function compactOutlineEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id ?? null,
    title: firstText([entry.title, entry.chapter_title, entry.topic, entry.heading, entry.name, entry?.os4?.chapter_title, entry?.os4?.title, entry?.os4?.topic]) || null,
    objective: firstText([entry.objective, entry?.os4?.objective]) || null,
    chapterThesis: firstText([entry.chapter_thesis, entry?.os4?.chapter_thesis]) || null,
    requiredFacts: Array.isArray(entry.required_facts) ? entry.required_facts : Array.isArray(entry?.os4?.required_facts) ? entry.os4.required_facts : [],
    sourceNeeds: Array.isArray(entry.source_needs) ? entry.source_needs : Array.isArray(entry?.os4?.source_needs) ? entry.os4.source_needs : [],
    contradictionChecks: Array.isArray(entry.contradiction_checks) ? entry.contradiction_checks : Array.isArray(entry?.os4?.contradiction_checks) ? entry.os4.contradiction_checks : [],
    status: entry.status ?? null,
  };
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
  .select("id,title,content,chapter_number,type")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .order("chapter_number", { ascending: true });
if (chaptersError) throw chaptersError;

const chapter = (chapters || []).find((row) => Number(row.chapter_number) === chapterNumber) || null;
const previous = (chapters || []).find((row) => Number(row.chapter_number) === chapterNumber - 1) || null;
const next = (chapters || []).find((row) => Number(row.chapter_number) === chapterNumber + 1) || null;
const outlineResolution = outlineEntryFor(project, chapterNumber);
const outlineEntry = outlineResolution.entry;
const outlineTopicResolution = resolveOutlineTopic(outlineEntry, outlineResolution.location || "outline");
const stateChapterEntry = stateChapterEntryFor(project, chapterNumber);
const stateChapterTopicResolution = resolveStateChapterTopic(stateChapterEntry, chapterNumber);
const state = projectState(project);

const usefulProjectHints = {};
for (const [k, v] of Object.entries(project || {})) {
  if (!/outline|description|brief|synopsis|objective|premise|structure|chapter|topic|genre|audience|theme/i.test(k)) continue;
  if (v == null || v === "") continue;
  if (["outline_12", "state"].includes(k)) continue;
  usefulProjectHints[k] = preview(v, 1400);
}
for (const [k, v] of Object.entries({
  book_topic: state?.book_topic,
  audience: state?.audience,
  tone_style: state?.tone_style,
  dossier_one_liner: state?.dossier?.one_liner,
  dossier_promise: state?.dossier?.promise,
  dossier_positioning: state?.dossier?.positioning,
})) {
  if (v == null || v === "") continue;
  usefulProjectHints[`state.${k}`] = preview(v, 1400);
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
const topic = explicitTopic || titleTopic || outlineTopicResolution.topic || stateChapterTopicResolution.topic;
const topicSource = explicitTopic
  ? "cli.--topic"
  : titleTopic
    ? "sections.title"
    : outlineTopicResolution.topic
      ? outlineTopicResolution.source
      : stateChapterTopicResolution.source;

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
  outlineLocation: outlineResolution.location,
  outlineChapterHint: compactOutlineEntry(outlineEntry),
  stateChapterHint: compactOutlineEntry(stateChapterEntry),
  projectHints: usefulProjectHints,
  resolvedTopic: topic || null,
  resolvedTopicSource: topicSource || null,
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
  console.error("\nBLOCKED: no se pudo resolver el tema desde sections.title, project.outline_12, project.state.outline_12, project.state.chapters ni --topic.");
  process.exit(12);
}
if (maxCalls < minimumBaseCalls) {
  console.error(`\nBLOCKED: maxCalls=${maxCalls} no alcanza para la pasada base determinística (${minimumBaseCalls}).`);
  process.exit(13);
}
if (!enqueue) {
  console.log("\nPREFLIGHT OK. Tema resuelto desde datos existentes. No se encoló nada.");
  console.log("Añade --enqueue para crear el Research job; todavía serán 0 llamadas LLM.");
  process.exit(0);
}

const objective = explicitObjective || [
  `Construir un dossier factual y verificable para el Capítulo ${chapterNumber}: ${topic}.`,
  outlineEntry?.objective ? `Objetivo editorial del outline: ${clean(outlineEntry.objective)}` : "",
  outlineEntry?.os4?.chapter_thesis ? `Tesis del outline: ${clean(outlineEntry.os4.chapter_thesis)}` : "",
  stateChapterEntry?.objective ? `Objetivo editorial persistido: ${clean(stateChapterEntry.objective)}` : "",
  "Priorizar fuentes oficiales, primarias, estadísticas, informes institucionales y corroboración independiente.",
  "Identificar cifras, fechas, instituciones, causalidades y contradicciones necesarias para escritura segura.",
  "No inventar hechos, referencias ni completar lagunas desde memoria.",
].filter(Boolean).join(" ");

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
  outlineContext: compactOutlineEntry(outlineEntry || stateChapterEntry),
  topicSource,
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
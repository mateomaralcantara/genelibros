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

function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? String(args[at + 1]).trim() : fallback;
}
function hasFlag(name) { return process.argv.slice(2).includes(name); }
function words(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).length; }

loadEnv(path.resolve(".env.local"));

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("Faltan credenciales server-side de Supabase en .env.local.");
  process.exit(2);
}

const sourceJobId = argValue("--from-job", process.env.DEEP_SOURCE_JOB_ID || "");
const chapterNumber = Math.max(1, Number(argValue("--chapter", "3")) || 3);
const targetWords = Math.max(500, Math.min(12000, Number(argValue("--target", "2500")) || 2500));
const enqueue = hasFlag("--enqueue");
const allowNoResearch = hasFlag("--allow-no-research");
const operation = String(argValue("--operation", "IMPROVE")).toUpperCase();
const depth = String(argValue("--depth", "SUPREME")).toUpperCase();

if (!sourceJobId) {
  console.error("Falta --from-job <job_id> para identificar de forma segura el mismo proyecto/usuario.");
  process.exit(3);
}
if (!["IMPROVE", "REWRITE", "GENERATE"].includes(operation)) {
  console.error(`Operación inválida: ${operation}`);
  process.exit(4);
}
if (depth !== "SUPREME") {
  console.error(`Este preflight controlado está diseñado para SUPREME; recibido=${depth}`);
  process.exit(5);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: sourceJob, error: sourceError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,chapter_number,status")
  .eq("id", sourceJobId)
  .single();
if (sourceError || !sourceJob) throw sourceError || new Error("Source job no encontrado.");

const { data: project, error: projectError } = await s
  .from("projects")
  .select("id,title,user_id")
  .eq("id", sourceJob.project_id)
  .eq("user_id", sourceJob.user_id)
  .single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

const { data: section, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,type")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .eq("chapter_number", chapterNumber)
  .maybeSingle();
if (sectionError) throw sectionError;
if (!section && operation !== "GENERATE") {
  throw new Error(`Capítulo ${chapterNumber} no existe; IMPROVE/REWRITE no puede continuar.`);
}

const { data: activeJobs, error: activeError } = await s
  .from("deep_work_jobs")
  .select("id,status,checkpoint,progress,created_at")
  .eq("user_id", sourceJob.user_id)
  .eq("project_id", project.id)
  .eq("chapter_number", chapterNumber)
  .in("status", ["QUEUED", "RUNNING", "RETRYING"])
  .order("created_at", { ascending: false })
  .limit(3);
if (activeError) throw activeError;

const { data: research, error: researchError } = await s
  .from("research_dossiers")
  .select("id,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,completed_at")
  .eq("project_id", project.id)
  .eq("chapter_number", chapterNumber)
  .eq("ready_for_writing", true)
  .order("completed_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (researchError) throw researchError;

const creditGuard = !["0", "false", "off"].includes(String(process.env.DEEP_CREDIT_GUARD || "1").trim().toLowerCase());
const maxCalls = Math.max(1, Number(process.env.DEEP_MAX_LLM_CALLS || 9));
const currentWords = words(section?.content || "");

console.log("\n==============================================");
console.log(` GENELIBROS — CHAPTER ${chapterNumber} PREFLIGHT`);
console.log("==============================================");
console.log({
  project: project.title,
  chapterNumber,
  sectionId: section?.id || null,
  title: section?.title || null,
  currentWords,
  operation,
  targetWords,
  depth,
  researchReady: Boolean(research),
  research: research ? {
    dossierId: research.id,
    topic: research.topic,
    coverageScore: Number(research.coverage_score || 0),
    evidenceScore: Number(research.evidence_score || 0),
    factualConfidenceScore: Number(research.factual_confidence_score || 0),
  } : null,
  activeJobs: activeJobs || [],
  creditGuard,
  threshold: 9.3,
  drafts: creditGuard ? 2 : 3,
  maxRepairAttempts: creditGuard ? 1 : 2,
  hardLlmCallCap: maxCalls,
  llmCallsMadeByPreflight: 0,
});

if (!creditGuard) {
  console.error("\nBLOCKED: DEEP_CREDIT_GUARD está desactivado. No se encola un SUPREME controlado.");
  process.exit(10);
}
if ((activeJobs || []).length) {
  console.error("\nBLOCKED: ya existe un job activo para este capítulo. No se crea otro.");
  process.exit(11);
}
if (!research && !allowNoResearch) {
  console.error("\nBLOCKED: no existe Research certificado ready_for_writing para este capítulo.");
  console.error("Si deliberadamente deseas continuar sin Research, repite con --allow-no-research; no es recomendado.");
  process.exit(12);
}
if (!enqueue) {
  console.log("\nPREFLIGHT OK. No se encoló nada. Para crear el job sin ejecutar LLM, repite añadiendo --enqueue.");
  process.exit(0);
}

const objective = [
  "Mejorar profundamente este capítulo sin inventar información.",
  "Priorizar profundidad analítica, originalidad editorial, continuidad y claridad.",
  "Preservar toda evidencia certificada, atribuciones, cifras, leyes, unidades y relaciones causales verificadas.",
  "Evitar relleno, redundancia y reparaciones ciegas.",
].join(" ");

const policy = {
  maxRepairAttempts: 1,
  threshold: 9.3,
  draftCount: 2,
  maxLlmCalls: maxCalls,
  creditGuard: true,
};

const { data: job, error: insertError } = await s
  .from("deep_work_jobs")
  .insert({
    user_id: sourceJob.user_id,
    project_id: project.id,
    target_type: "CHAPTER",
    operation,
    depth: "SUPREME",
    chapter_number: chapterNumber,
    section_id: section?.id || null,
    objective,
    target_words: targetWords,
    status: "QUEUED",
    progress: 0,
    checkpoint: { version: "11C", step: "INIT", draft_index: 0 },
    result: {
      version: "deep-work-11c-1.0.0",
      projectId: project.id,
      projectTitle: project.title,
      targetType: "CHAPTER",
      operation,
      chapterNumber,
      sectionId: section?.id || null,
      depth: "SUPREME",
      objective,
      targetWords,
      drafts: [],
      repairAttempts: 0,
      artifactIds: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
      budgetGuard: {
        enabled: true,
        maxCalls,
        maxRepairAttempts: 1,
        draftCount: 2,
        threshold: 9.3,
      },
    },
    policy,
    attempts: 0,
    max_attempts: 6,
    next_retry_at: new Date().toISOString(),
    workflow_version: "deep-work-11c-1.0.0",
  })
  .select("id,status,chapter_number,depth,operation,target_words,policy,checkpoint,progress")
  .single();
if (insertError || !job) throw insertError || new Error("No se pudo crear job.");

console.log("\n==============================================");
console.log(" JOB ENCOLADO — TODAVÍA 0 LLAMADAS LLM");
console.log("==============================================");
console.log(job);
console.log("\nNo se ejecutará ninguna llamada hasta que inicies deep:11c:worker.");

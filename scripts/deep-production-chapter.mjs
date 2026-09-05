import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  DEEP_PRODUCTION_VERSION,
  DEEP_WORKFLOW_VERSION,
  FIRST_PASS_MAX_LLM_CALLS,
  QUALITY_THRESHOLD,
  DRAFT_COUNT,
  MAX_REPAIR_ATTEMPTS,
  clean,
  clampTargetWords,
  countWords,
  productionMarker,
  productionPolicy,
  researchMetrics,
  researchMeetsMinimum,
} from "./deep-production-v1-contract.mjs";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}
function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? clean(args[index + 1]) : fallback;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

loadEnv(path.resolve(".env.local"));

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] Production V1 bloqueado: faltan credenciales Supabase. 0 llamadas LLM.");
  process.exit(2);
}

const projectId = argValue("--project", process.env.DEEP_PROJECT_ID || "");
const chapterNumber = Math.max(1, Number(argValue("--chapter", "0")) || 0);
const requestedDossierId = argValue("--dossier", "");
const requestedTitle = argValue("--title", "");
const requestedObjective = argValue("--objective", "");
const targetWords = clampTargetWords(argValue("--target", "2500"));
const operation = clean(argValue("--operation", "IMPROVE")).toUpperCase();
const enqueue = hasFlag("--enqueue");
const allowEditorialOverride = hasFlag("--allow-editorial-override");
const allowNoResearch = hasFlag("--allow-no-research");

if (!projectId) {
  console.error("[Genelibros] Production V1: falta --project <uuid>.");
  process.exit(3);
}
if (!chapterNumber) {
  console.error("[Genelibros] Production V1: falta --chapter <n>.");
  process.exit(4);
}
if (!["IMPROVE", "REWRITE"].includes(operation)) {
  console.error(`[Genelibros] Production V1: operation=${operation} no está permitida. V1 trabaja sobre una sección de capítulo existente con IMPROVE o REWRITE.`);
  process.exit(5);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: project, error: projectError } = await s
  .from("projects")
  .select("id,title,user_id")
  .eq("id", projectId)
  .single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

const { data: section, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,type,project_id")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .eq("chapter_number", chapterNumber)
  .maybeSingle();
if (sectionError) throw sectionError;
if (!section) {
  console.error(`[Genelibros] Production V1 bloqueado: el Capítulo ${chapterNumber} todavía no existe como section. Crea primero la estructura/section del capítulo; Production V1 no inventa estructura de libro.`);
  process.exit(6);
}

let dossier = null;
if (requestedDossierId) {
  const { data, error } = await s
    .from("research_dossiers")
    .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")
    .eq("id", requestedDossierId)
    .eq("project_id", project.id)
    .eq("chapter_number", chapterNumber)
    .maybeSingle();
  if (error) throw error;
  dossier = data || null;
  if (!dossier) {
    console.error("[Genelibros] Production V1 bloqueado: el dossier explícito no pertenece a este proyecto/capítulo o no existe.");
    process.exit(7);
  }
} else {
  const { data, error } = await s
    .from("research_dossiers")
    .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")
    .eq("project_id", project.id)
    .eq("chapter_number", chapterNumber)
    .eq("ready_for_writing", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  dossier = data || null;
}

if (!dossier && !allowNoResearch) {
  console.error("[Genelibros] Production V1 bloqueado: no existe Research ready_for_writing y no se indicó --allow-no-research.");
  process.exit(8);
}

let metrics = null;
let editorialOverride = false;
if (dossier) {
  metrics = researchMetrics(dossier);
  if (!researchMeetsMinimum(metrics)) {
    console.error("[Genelibros] Production V1 bloqueado: el dossier no alcanza la base factual mínima del contrato V1.");
    console.error(metrics);
    process.exit(9);
  }
  editorialOverride = dossier.ready_for_writing !== true;
  if (editorialOverride && !allowEditorialOverride) {
    console.error("[Genelibros] Production V1 bloqueado: el dossier explícito no está ready_for_writing. Para usarlo sin falsificar su estado exige --allow-editorial-override.");
    console.error(metrics);
    process.exit(10);
  }
}

const title = requestedTitle || clean(section.title) || `Capítulo ${chapterNumber}`;
const dossierId = clean(dossier?.id);
const marker = productionMarker({
  projectId: project.id,
  chapterNumber,
  sectionId: section.id,
  dossierId,
});

const { data: priorJobs, error: priorError } = await s
  .from("deep_work_jobs")
  .select("id,status,objective,progress,result,checkpoint,policy,created_at,updated_at")
  .eq("user_id", project.user_id)
  .eq("project_id", project.id)
  .eq("chapter_number", chapterNumber)
  .order("created_at", { ascending: false })
  .limit(30);
if (priorError) throw priorError;

const existing = (priorJobs || []).find((job) => clean(job.objective).includes(marker));
const activeOther = (priorJobs || []).filter((job) =>
  ["QUEUED", "RUNNING", "RETRYING"].includes(clean(job.status).toUpperCase()) &&
  !clean(job.objective).includes(marker)
);

console.log("\n================================================");
console.log(" GENELIBROS — PRODUCTION V1 PREFLIGHT");
console.log("================================================");
console.log({
  productionVersion: DEEP_PRODUCTION_VERSION,
  projectId: project.id,
  project: project.title,
  chapterNumber,
  sectionId: section.id,
  title,
  currentWords: countWords(section.content),
  targetWords,
  operation,
  dossierId: dossierId || null,
  dossierReadyForWriting: dossier ? Boolean(dossier.ready_for_writing) : null,
  editorialOverride,
  allowNoResearch,
  researchMetrics: metrics,
  threshold: QUALITY_THRESHOLD,
  drafts: DRAFT_COUNT,
  firstPassMaxLlmCalls: FIRST_PASS_MAX_LLM_CALLS,
  automaticRepairCalls: 0,
  maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
  marker,
  existingJob: existing ? {
    id: existing.id,
    status: existing.status,
    progress: existing.progress,
    step: existing.checkpoint?.step || null,
    calls: Number(existing.result?.usage?.calls || 0),
    quality: existing.result?.quality?.overallScore ?? null,
    verdict: existing.result?.quality?.verdict ?? null,
  } : null,
  activeOtherJobs: activeOther.map((job) => ({ id: job.id, status: job.status, progress: job.progress })),
  llmCallsMadeByPreflight: 0,
});

if (activeOther.length) {
  console.error("[Genelibros] Production V1 bloqueado: existe otro Deep Work activo para este capítulo.");
  process.exit(11);
}

if (existing) {
  const status = clean(existing.status).toUpperCase();
  const resumable = ["RETRYING", "FAILED", "DEAD_LETTER"].includes(status);
  if (resumable && enqueue) {
    const now = new Date().toISOString();
    const { data: resumed, error: resumeError } = await s
      .from("deep_work_jobs")
      .update({
        status: "QUEUED",
        attempts: 0,
        error: null,
        last_error: null,
        dead_letter_at: null,
        next_retry_at: now,
        locked_by: null,
        locked_at: null,
        heartbeat_at: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("id,status,progress,checkpoint,result,policy")
      .single();
    if (resumeError || !resumed) throw resumeError || new Error("No se pudo reactivar el job Production V1 existente.");
    console.log("\n[Genelibros] Production V1: job técnico existente reactivado; no se duplicó.");
    console.log({
      jobId: resumed.id,
      status: resumed.status,
      resumeFromStep: resumed.checkpoint?.step || null,
      callsAlreadyRecorded: Number(resumed.result?.usage?.calls || 0),
      hardCap: Number(resumed.policy?.maxLlmCalls || FIRST_PASS_MAX_LLM_CALLS),
    });
    process.exit(0);
  }

  console.log("\n[Genelibros] Production V1: este capítulo/configuración ya tiene job idempotente; no se crea otro.");
  console.log({
    jobId: existing.id,
    status: existing.status,
    progress: existing.progress,
    step: existing.checkpoint?.step || null,
    calls: Number(existing.result?.usage?.calls || 0),
    quality: existing.result?.quality?.overallScore ?? null,
    verdict: existing.result?.quality?.verdict ?? null,
    applyAllowed: existing.result?.applyAllowed ?? false,
    nextAction: status === "COMPLETED" && clean(existing.result?.quality?.verdict).toUpperCase() === "REJECTED"
      ? "Usar deep:prod:repair con este job; no regenerar el capítulo."
      : "Reutilizar este job.",
  });
  process.exit(0);
}

if (!enqueue) {
  console.log("\n[Genelibros] PREFLIGHT OK — 0 llamadas LLM. Añade --execute al runner Production V1 para encolar y ejecutar.");
  process.exit(0);
}

const objective = [
  marker,
  `TÍTULO EDITORIAL: ${title}.`,
  requestedObjective
    ? `OBJETIVO EDITORIAL: ${requestedObjective}`
    : "OBJETIVO EDITORIAL: producir un capítulo terminado, profundo, claro, no redundante y coherente con el libro.",
  dossier
    ? "DISCIPLINA FACTUAL: usar exclusivamente claims VERIFIED + citationReady del dossier seleccionado para cifras, fechas, costos, porcentajes, instituciones y causalidades. Los gaps abiertos son límites editoriales y no deben completarse por inferencia."
    : "MODO SIN RESEARCH EXPLÍCITO: no introducir hechos específicos, cifras, fechas, costos, porcentajes, instituciones o causalidades que no estén contenidos en el material de origen/contexto.",
  "Distinguir HECHO, EVIDENCIA, INTERPRETACIÓN, ESTIMACIÓN, PROYECCIÓN, PROPUESTA y CONTROVERSIA cuando corresponda.",
  "Evitar relleno, redundancia, retórica gratuita y afirmaciones no sustentadas.",
  "Conservar continuidad con los capítulos vecinos y mantener voz editorial consistente.",
].join(" ");

const policy = productionPolicy({ dossierId, editorialOverride });
const result = {
  version: DEEP_WORKFLOW_VERSION,
  productionVersion: DEEP_PRODUCTION_VERSION,
  productionMarker: marker,
  projectId: project.id,
  projectTitle: project.title,
  targetType: "CHAPTER",
  operation,
  chapterNumber,
  sectionId: section.id,
  depth: "SUPREME",
  objective,
  targetWords,
  title,
  preferredTitle: title,
  drafts: [],
  repairAttempts: 0,
  artifactIds: [],
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
  researchDossierId: dossierId || null,
  researchEditorialOverride: editorialOverride,
  researchMetrics: metrics,
  budgetGuard: {
    enabled: true,
    maxCalls: FIRST_PASS_MAX_LLM_CALLS,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    draftCount: DRAFT_COUNT,
    threshold: QUALITY_THRESHOLD,
    firstPassOnly: true,
    automaticRepairCalls: 0,
  },
};

const { data: job, error: insertError } = await s
  .from("deep_work_jobs")
  .insert({
    user_id: project.user_id,
    project_id: project.id,
    target_type: "CHAPTER",
    operation,
    depth: "SUPREME",
    chapter_number: chapterNumber,
    section_id: section.id,
    objective,
    target_words: targetWords,
    status: "QUEUED",
    progress: 0,
    checkpoint: { version: "11C", step: "INIT", draft_index: 0 },
    result,
    policy,
    attempts: 0,
    max_attempts: 6,
    next_retry_at: new Date().toISOString(),
    workflow_version: DEEP_WORKFLOW_VERSION,
  })
  .select("id,status,chapter_number,operation,depth,target_words,policy,progress,checkpoint")
  .single();
if (insertError || !job) throw insertError || new Error("No se pudo crear el job Production V1.");

console.log("\n================================================");
console.log(" GENELIBROS — PRODUCTION V1 JOB ENCOLADO");
console.log("================================================");
console.log({
  jobId: job.id,
  status: job.status,
  chapterNumber: job.chapter_number,
  title,
  targetWords: job.target_words,
  dossierId: dossierId || null,
  editorialOverride,
  threshold: QUALITY_THRESHOLD,
  hardCap: FIRST_PASS_MAX_LLM_CALLS,
  automaticRepairCalls: 0,
  llmCallsMadeByEnqueue: 0,
});

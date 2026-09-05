import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  DEEP_PRODUCTION_VERSION,
  FIRST_PASS_MAX_LLM_CALLS,
  QUALITY_THRESHOLD,
  clean,
  clampTargetWords,
  productionMarker,
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
function hash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
function runNode(script, args = []) {
  console.log(`\n[Genelibros] > node ${script} ${args.join(" ")}`.trim());
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return Number(result.status ?? 1);
}
function latestByChapter(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const chapter = Number(row.chapter_number || 0);
    if (!chapter || map.has(chapter)) continue;
    map.set(chapter, row);
  }
  return map;
}
function approvedAndApplied(job, section) {
  if (!job || clean(job.status).toUpperCase() !== "COMPLETED") return false;
  const result = job.result && typeof job.result === "object" ? job.result : {};
  const quality = result.quality && typeof result.quality === "object" ? result.quality : {};
  if (clean(quality.verdict).toUpperCase() !== "APPROVED") return false;
  if (Number(quality.overallScore || 0) < QUALITY_THRESHOLD) return false;
  const content = clean(result.finalCandidate?.content);
  return Boolean(content) && hash(content) === hash(section.content || "");
}
function writeManifest(projectId, payload) {
  const dir = path.resolve("exports", "production-v1");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `book-${projectId}-last-run.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

loadEnv(path.resolve(".env.local"));

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] BOOK V1 bloqueado: faltan credenciales Supabase. 0 llamadas LLM.");
  process.exit(2);
}

const projectId = argValue("--project", process.env.DEEP_PROJECT_ID || "");
const fromChapter = Math.max(1, Number(argValue("--from", "1")) || 1);
const requestedTo = Math.max(0, Number(argValue("--to", "0")) || 0);
const targetWords = clampTargetWords(argValue("--target", "2500"));
const operation = clean(argValue("--operation", "IMPROVE")).toUpperCase();
const execute = hasFlag("--execute");
const refreshResearch = hasFlag("--refresh-research");
const bookMaxCalls = Math.max(0, Number(argValue("--book-max-calls", "0")) || 0);

if (!projectId) {
  console.error("Uso: npm run deep:prod:book -- --project <uuid> [--from N] [--to N] [--target 2500] [--execute --book-max-calls N]");
  process.exit(3);
}
if (!["IMPROVE", "REWRITE"].includes(operation)) {
  console.error(`[Genelibros] BOOK V1: operation=${operation} no permitida.`);
  process.exit(4);
}
if (execute && bookMaxCalls < FIRST_PASS_MAX_LLM_CALLS) {
  console.error(`[Genelibros] BOOK V1 EXECUTE bloqueado: exige --book-max-calls >= ${FIRST_PASS_MAX_LLM_CALLS}. 0 llamadas LLM.`);
  process.exit(5);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: project, error: projectError } = await s
  .from("projects")
  .select("id,title,user_id")
  .eq("id", projectId)
  .single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

const { data: allSections, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,type,project_id")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .order("chapter_number", { ascending: true });
if (sectionError) throw sectionError;

const lastChapter = requestedTo || Math.max(0, ...(allSections || []).map((row) => Number(row.chapter_number || 0)));
const sections = (allSections || [])
  .filter((row) => Number(row.chapter_number || 0) >= fromChapter && Number(row.chapter_number || 0) <= lastChapter)
  .sort((a, b) => Number(a.chapter_number || 0) - Number(b.chapter_number || 0));
if (!sections.length) {
  console.error(`[Genelibros] BOOK V1: no hay sections CHAPTER en el rango ${fromChapter}-${lastChapter}.`);
  process.exit(6);
}

const { data: readyResearch, error: researchError } = await s
  .from("research_dossiers")
  .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")
  .eq("project_id", project.id)
  .eq("ready_for_writing", true)
  .order("completed_at", { ascending: false });
if (researchError) throw researchError;
const researchByChapter = latestByChapter(readyResearch || []);

const { data: jobs, error: jobsError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,section_id,chapter_number,status,objective,target_words,operation,result,policy,checkpoint,progress,created_at,updated_at")
  .eq("user_id", project.user_id)
  .eq("project_id", project.id)
  .order("created_at", { ascending: false })
  .limit(500);
if (jobsError) throw jobsError;

// El worker Deep reclama jobs globalmente. Para una corrida de libro segura no
// permitimos que exista otro job activo del usuario antes de empezar.
const { data: globalActive, error: globalActiveError } = await s
  .from("deep_work_jobs")
  .select("id,project_id,chapter_number,status,progress,created_at")
  .eq("user_id", project.user_id)
  .in("status", ["QUEUED", "RUNNING", "RETRYING"])
  .order("created_at", { ascending: false })
  .limit(50);
if (globalActiveError) throw globalActiveError;

const plan = sections.map((section) => {
  const chapterNumber = Number(section.chapter_number || 0);
  const dossier = researchByChapter.get(chapterNumber) || null;
  const exactMarker = dossier
    ? productionMarker({ projectId: project.id, chapterNumber, sectionId: section.id, dossierId: dossier.id })
    : "";
  const chapterJobs = (jobs || []).filter((job) => Number(job.chapter_number || 0) === chapterNumber);
  const exactJob = exactMarker
    ? chapterJobs.find((job) => clean(job.objective).includes(exactMarker)) || null
    : null;
  const anyAppliedJob = chapterJobs.find((job) => approvedAndApplied(job, section)) || null;

  if (anyAppliedJob && !refreshResearch) {
    return { chapterNumber, section, dossier, exactMarker, job: anyAppliedJob, state: "APPLIED", reason: "Contenido actual coincide con un job APPROVED." };
  }
  if (!dossier) {
    return { chapterNumber, section, dossier: null, exactMarker: "", job: null, state: "BLOCK_RESEARCH", reason: "No existe dossier ready_for_writing." };
  }
  if (!exactJob) {
    return { chapterNumber, section, dossier, exactMarker, job: null, state: "READY", reason: refreshResearch ? "Research actual seleccionado para regeneración explícita." : "Listo para primera pasada Production V1." };
  }

  const status = clean(exactJob.status).toUpperCase();
  const result = exactJob.result && typeof exactJob.result === "object" ? exactJob.result : {};
  const quality = result.quality && typeof result.quality === "object" ? result.quality : {};
  const verdict = clean(quality.verdict).toUpperCase();
  const score = Number(quality.overallScore || 0);

  if (["QUEUED", "RUNNING"].includes(status)) {
    return { chapterNumber, section, dossier, exactMarker, job: exactJob, state: "BLOCK_ACTIVE", reason: `Job ${status} ya activo.` };
  }
  if (["RETRYING", "FAILED", "DEAD_LETTER"].includes(status)) {
    return { chapterNumber, section, dossier, exactMarker, job: exactJob, state: "BLOCK_TECHNICAL", reason: `Fallo técnico ${status}; requiere acción explícita, nunca retry automático.` };
  }
  if (status === "COMPLETED" && verdict === "REJECTED") {
    return { chapterNumber, section, dossier, exactMarker, job: exactJob, state: "NEEDS_REPAIR", reason: `QUALITY ${score || 0} REJECTED; reparación explícita requerida.` };
  }
  if (status === "COMPLETED" && verdict === "APPROVED" && score >= QUALITY_THRESHOLD) {
    return approvedAndApplied(exactJob, section)
      ? { chapterNumber, section, dossier, exactMarker, job: exactJob, state: "APPLIED", reason: `QUALITY ${score} APPROVED y aplicado.` }
      : { chapterNumber, section, dossier, exactMarker, job: exactJob, state: "APPROVED_PENDING_APPLY", reason: `QUALITY ${score} APPROVED; falta APPLY idempotente.` };
  }
  return { chapterNumber, section, dossier, exactMarker, job: exactJob, state: "BLOCK_UNKNOWN", reason: `Estado no reconocible ${status}/${verdict || "NONE"}.` };
});

const blockingStates = new Set(["BLOCK_RESEARCH", "BLOCK_ACTIVE", "BLOCK_TECHNICAL", "NEEDS_REPAIR", "BLOCK_UNKNOWN"]);
const blockers = plan.filter((item) => blockingStates.has(item.state));
const ready = plan.filter((item) => item.state === "READY");
const applyOnly = plan.filter((item) => item.state === "APPROVED_PENDING_APPLY");
const applied = plan.filter((item) => item.state === "APPLIED");
const estimatedFirstPassCalls = ready.length * FIRST_PASS_MAX_LLM_CALLS;

console.log("\n================================================");
console.log(" GENELIBROS — BOOK PRODUCTION V1 PREFLIGHT");
console.log("================================================");
console.log({
  productionVersion: DEEP_PRODUCTION_VERSION,
  projectId: project.id,
  project: project.title,
  range: `${fromChapter}-${lastChapter}`,
  chaptersSelected: plan.length,
  targetWordsPerPendingChapter: targetWords,
  operation,
  refreshResearch,
  execute,
  bookMaxCalls: execute ? bookMaxCalls : null,
  firstPassHardCapPerChapter: FIRST_PASS_MAX_LLM_CALLS,
  estimatedMaxFirstPassCalls: estimatedFirstPassCalls,
  repairsAutomatic: 0,
  ready: ready.length,
  approvedPendingApply: applyOnly.length,
  alreadyApplied: applied.length,
  blockers: blockers.length,
  globalActiveJobs: globalActive || [],
  llmCallsMadeByPreflight: 0,
});

for (const item of plan) {
  console.log({
    chapter: item.chapterNumber,
    title: clean(item.section.title) || `Capítulo ${item.chapterNumber}`,
    state: item.state,
    dossierId: item.dossier?.id || null,
    jobId: item.job?.id || null,
    calls: Number(item.job?.result?.usage?.calls || 0),
    quality: item.job?.result?.quality?.overallScore ?? null,
    verdict: item.job?.result?.quality?.verdict ?? null,
    reason: item.reason,
  });
}

const manifestBase = {
  productionVersion: DEEP_PRODUCTION_VERSION,
  generatedAt: new Date().toISOString(),
  projectId: project.id,
  projectTitle: project.title,
  range: { from: fromChapter, to: lastChapter },
  targetWords,
  operation,
  refreshResearch,
  execute,
  bookMaxCalls: execute ? bookMaxCalls : null,
  estimatedMaxFirstPassCalls: estimatedFirstPassCalls,
  recordedCallsThisRun: 0,
  status: "PREFLIGHT",
  chapters: plan.map((item) => ({
    chapterNumber: item.chapterNumber,
    sectionId: item.section.id,
    title: clean(item.section.title),
    dossierId: item.dossier?.id || null,
    state: item.state,
    jobId: item.job?.id || null,
    reason: item.reason,
  })),
};
const manifestFile = writeManifest(project.id, manifestBase);
console.log(`[Genelibros] Manifest: ${manifestFile}`);

if (!execute) {
  console.log("\n[Genelibros] BOOK V1 PREFLIGHT terminado. 0 llamadas LLM. Para ejecutar exige --execute --book-max-calls N.");
  process.exit(blockers.length || (globalActive || []).length ? 20 : 0);
}
if ((globalActive || []).length) {
  console.error("[Genelibros] BOOK V1 EXECUTE bloqueado: hay Deep Work jobs activos del usuario. No se arranca un libro hasta dejar la cola limpia.");
  process.exit(21);
}
if (blockers.length) {
  console.error("[Genelibros] BOOK V1 EXECUTE bloqueado antes de gastar: resuelve todos los capítulos BLOCK_* / NEEDS_REPAIR y vuelve a ejecutar.");
  process.exit(22);
}

let recordedCallsThisRun = 0;
const execution = [];

for (const item of plan) {
  if (item.state === "APPLIED") {
    execution.push({ chapterNumber: item.chapterNumber, state: "SKIPPED_APPLIED", jobId: item.job?.id || null, callsAdded: 0 });
    continue;
  }

  if (item.state === "APPROVED_PENDING_APPLY") {
    const code = runNode("scripts/deep-production-apply.mjs", ["--job", item.job.id]);
    if (code !== 0) {
      execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_APPLY_ERROR", jobId: item.job.id, exitCode: code, callsAdded: 0 });
      writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_APPLY_ERROR", recordedCallsThisRun, execution });
      process.exit(code);
    }
    execution.push({ chapterNumber: item.chapterNumber, state: "APPLIED_EXISTING_APPROVAL", jobId: item.job.id, callsAdded: 0 });
    continue;
  }

  const remainingBookBudget = bookMaxCalls - recordedCallsThisRun;
  if (remainingBookBudget < FIRST_PASS_MAX_LLM_CALLS) {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_BOOK_BUDGET", remainingBookBudget, callsAdded: 0 });
    const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_BOOK_BUDGET", recordedCallsThisRun, execution });
    console.log(`\n[Genelibros] BOOK V1 pausado por presupuesto antes del Capítulo ${item.chapterNumber}. Remaining=${remainingBookBudget}; se reservan ${FIRST_PASS_MAX_LLM_CALLS} por capítulo.`);
    console.log(`[Genelibros] Progreso preservado. Manifest: ${file}`);
    process.exit(0);
  }

  const enqueueArgs = [
    "--project", project.id,
    "--chapter", String(item.chapterNumber),
    "--dossier", String(item.dossier.id),
    "--target", String(targetWords),
    "--operation", operation,
    "--enqueue",
  ];
  let code = runNode("scripts/deep-production-chapter.mjs", enqueueArgs);
  if (code !== 0) {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_ENQUEUE_ERROR", exitCode: code, callsAdded: 0 });
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_ENQUEUE_ERROR", recordedCallsThisRun, execution });
    process.exit(code);
  }

  code = runNode("scripts/run-deep-final-local-stack.mjs");
  if (code !== 0) {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_WORKER_ERROR", exitCode: code, callsAdded: 0 });
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_WORKER_ERROR", recordedCallsThisRun, execution });
    process.exit(code);
  }

  const { data: postJobs, error: postError } = await s
    .from("deep_work_jobs")
    .select("id,status,objective,result,checkpoint,progress,updated_at")
    .eq("user_id", project.user_id)
    .eq("project_id", project.id)
    .eq("chapter_number", item.chapterNumber)
    .order("created_at", { ascending: false })
    .limit(30);
  if (postError) throw postError;
  const completedJob = (postJobs || []).find((job) => clean(job.objective).includes(item.exactMarker)) || null;
  if (!completedJob) {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_JOB_MISSING", callsAdded: 0 });
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_JOB_MISSING", recordedCallsThisRun, execution });
    process.exit(23);
  }

  const callsAdded = Number(completedJob.result?.usage?.calls || 0);
  recordedCallsThisRun += callsAdded;
  const status = clean(completedJob.status).toUpperCase();
  const verdict = clean(completedJob.result?.quality?.verdict).toUpperCase();
  const score = Number(completedJob.result?.quality?.overallScore || 0);

  if (status !== "COMPLETED") {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_TECHNICAL", jobId: completedJob.id, jobStatus: status, callsAdded, score, verdict });
    const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_TECHNICAL", recordedCallsThisRun, execution });
    console.error(`[Genelibros] BOOK V1 pausado: Capítulo ${item.chapterNumber} quedó ${status}. No hay retry automático.`);
    console.error(`[Genelibros] Manifest: ${file}`);
    process.exit(24);
  }

  if (verdict !== "APPROVED" || score < QUALITY_THRESHOLD) {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_REPAIR_REQUIRED", jobId: completedJob.id, callsAdded, score, verdict });
    const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_REPAIR_REQUIRED", recordedCallsThisRun, execution });
    console.log(`\n[Genelibros] BOOK V1 pausado en Capítulo ${item.chapterNumber}: QUALITY ${score} ${verdict || "NONE"}.`);
    console.log("[Genelibros] No se repara automáticamente. Ejecuta explícitamente:");
    console.log(`npm run deep:prod:repair -- --job ${completedJob.id} --execute`);
    console.log("[Genelibros] Después vuelve a ejecutar deep:prod:book; los capítulos ya aplicados se saltarán.");
    console.log(`[Genelibros] Manifest: ${file}`);
    process.exit(0);
  }

  code = runNode("scripts/deep-production-apply.mjs", ["--job", completedJob.id]);
  if (code !== 0) {
    execution.push({ chapterNumber: item.chapterNumber, state: "PAUSED_APPLY_ERROR", jobId: completedJob.id, exitCode: code, callsAdded, score, verdict });
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_APPLY_ERROR", recordedCallsThisRun, execution });
    process.exit(code);
  }

  execution.push({ chapterNumber: item.chapterNumber, state: "COMPLETED_APPLIED", jobId: completedJob.id, callsAdded, score, verdict });
  writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "RUNNING", recordedCallsThisRun, execution });
  console.log(`[Genelibros] BOOK V1: Capítulo ${item.chapterNumber} aplicado. Recorded calls this run=${recordedCallsThisRun}/${bookMaxCalls}.`);
}

const finalManifest = writeManifest(project.id, {
  ...manifestBase,
  generatedAt: new Date().toISOString(),
  status: "COMPLETED",
  recordedCallsThisRun,
  execution,
});
console.log("\n================================================");
console.log(" ✅ GENELIBROS — BOOK PRODUCTION V1 COMPLETED");
console.log("================================================");
console.log({
  projectId: project.id,
  project: project.title,
  chaptersSelected: plan.length,
  recordedCallsThisRun,
  bookMaxCalls,
  automaticRepairs: 0,
  manifest: finalManifest,
});

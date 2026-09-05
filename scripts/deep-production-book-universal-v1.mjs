import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  FIRST_PASS_MAX_LLM_CALLS,
  QUALITY_THRESHOLD,
  MIN_RESEARCH_COVERAGE,
  MIN_RESEARCH_EVIDENCE,
  MIN_RESEARCH_FACTUAL,
  MIN_VERIFIED_CLAIMS,
  MIN_CLASS_AB_SOURCES,
  clean,
  clampTargetWords,
} from "./deep-production-v1-contract.mjs";

const UNIVERSAL_BOOK_VERSION = "1.0.0";

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
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? clean(args[i + 1]) : fallback;
}
function hasFlag(name) { return process.argv.slice(2).includes(name); }
function hash(value) { return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function runNode(script, args = []) {
  console.log(`\n[Genelibros] > node ${script} ${args.join(" ")}`.trim());
  const r = spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (r.error) throw r.error;
  return Number(r.status ?? 1);
}
function latestBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}
function researchMetrics(dossier) {
  const result = dossier?.result && typeof dossier.result === "object" ? dossier.result : {};
  const claims = Array.isArray(result.claims) ? result.claims : [];
  const sources = Array.isArray(result.sources) ? result.sources : [];
  return {
    coverage: Number(dossier?.coverage_score || 0),
    evidence: Number(dossier?.evidence_score || 0),
    factual: Number(dossier?.factual_confidence_score || 0),
    verifiedClaims: claims.filter((c) => clean(c?.status).toUpperCase() === "VERIFIED" && Boolean(c?.citationReady)).length,
    classABSources: sources.filter((s) => ["A", "B"].includes(clean(s?.sourceClass).toUpperCase())).length,
    gaps: Array.isArray(result.gaps) ? result.gaps.length : 0,
    criticalHighGaps: Array.isArray(result.gaps)
      ? result.gaps.filter((g) => ["CRITICAL", "HIGH"].includes(clean(g?.severity).toUpperCase())).length
      : 0,
  };
}
function researchEligible(dossier) {
  const m = researchMetrics(dossier);
  return m.coverage >= MIN_RESEARCH_COVERAGE &&
    m.evidence >= MIN_RESEARCH_EVIDENCE &&
    m.factual >= MIN_RESEARCH_FACTUAL &&
    m.verifiedClaims >= MIN_VERIFIED_CLAIMS &&
    m.classABSources >= MIN_CLASS_AB_SOURCES;
}
function chooseDossier(rows) {
  const eligible = (rows || []).filter(researchEligible);
  return eligible.find((d) => d.ready_for_writing === true) || eligible[0] || null;
}
function approvedAndApplied(job, section) {
  if (!job || clean(job.status).toUpperCase() !== "COMPLETED") return false;
  const result = job.result && typeof job.result === "object" ? job.result : {};
  const q = result.quality && typeof result.quality === "object" ? result.quality : {};
  if (clean(q.verdict).toUpperCase() !== "APPROVED" || Number(q.overallScore || 0) < QUALITY_THRESHOLD) return false;
  const content = clean(result.finalCandidate?.content);
  return Boolean(content) && hash(content) === hash(section.content || "");
}
function writeManifest(projectId, payload) {
  const dir = path.resolve("exports", "production-v1");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `universal-book-${projectId}-last-run.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

loadEnv(path.resolve(".env.local"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!supabaseUrl || !supabaseKey) {
  console.error("[Genelibros] UNIVERSAL BOOK bloqueado: faltan credenciales Supabase. 0 LLM.");
  process.exit(2);
}

const projectId = argValue("--project", "");
const fromChapter = Math.max(1, Number(argValue("--from", "1")) || 1);
const requestedTo = Math.max(0, Number(argValue("--to", "0")) || 0);
const targetWords = clampTargetWords(argValue("--target", "2500"));
const execute = hasFlag("--execute");
const refreshResearch = hasFlag("--refresh-research");
const researchMaxQueries = Math.max(1, Math.min(8, Number(argValue("--research-max-queries", "3")) || 3));
const researchMaxSources = Math.max(3, Math.min(12, Number(argValue("--research-max-sources", "4")) || 4));
const researchMinimumCalls = researchMaxQueries + researchMaxSources + 7;
const researchMaxCallsPerChapter = Math.max(researchMinimumCalls, Number(argValue("--research-max-calls-per-chapter", String(researchMinimumCalls))) || researchMinimumCalls);
const researchBookMaxCalls = Math.max(0, Number(argValue("--research-book-max-calls", "0")) || 0);
const productionBookMaxCalls = Math.max(0, Number(argValue("--production-book-max-calls", "0")) || 0);

if (!projectId) {
  console.error("Uso: npm run deep:prod:book:universal -- --project <uuid> [--from N --to N] [--target 2500] [--execute --research-book-max-calls N --production-book-max-calls N]");
  process.exit(3);
}
if (execute && researchBookMaxCalls < researchMaxCallsPerChapter && productionBookMaxCalls < FIRST_PASS_MAX_LLM_CALLS) {
  console.error("[Genelibros] UNIVERSAL BOOK EXECUTE bloqueado: no hay presupuesto mínimo ni para Research ni para Production. 0 LLM.");
  process.exit(4);
}

const s = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: project, error: projectError } = await s.from("projects").select("id,title,user_id").eq("id", projectId).single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

const { data: sectionsRaw, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,type,project_id")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .order("chapter_number", { ascending: true });
if (sectionError) throw sectionError;
const lastChapter = requestedTo || Math.max(0, ...(sectionsRaw || []).map((x) => Number(x.chapter_number || 0)));
const sections = (sectionsRaw || []).filter((x) => Number(x.chapter_number || 0) >= fromChapter && Number(x.chapter_number || 0) <= lastChapter);
if (!sections.length) {
  console.error(`[Genelibros] UNIVERSAL BOOK: no hay capítulos en ${fromChapter}-${lastChapter}.`);
  process.exit(5);
}

const { data: deepJobs, error: deepError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,section_id,chapter_number,status,objective,result,policy,checkpoint,progress,created_at,updated_at")
  .eq("user_id", project.user_id)
  .eq("project_id", project.id)
  .order("created_at", { ascending: false })
  .limit(500);
if (deepError) throw deepError;
const anchorDeepJob = (deepJobs || [])[0] || null;
if (!anchorDeepJob) {
  console.error("[Genelibros] UNIVERSAL BOOK bloqueado: no existe ningún Deep Work job del proyecto que pueda servir como ancla segura de usuario/proyecto para Research.");
  process.exit(6);
}

const { data: dossiersRaw, error: dossierError } = await s
  .from("research_dossiers")
  .select("id,job_id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,model,usage,completed_at,created_at")
  .eq("project_id", project.id)
  .order("completed_at", { ascending: false, nullsFirst: false })
  .limit(500);
if (dossierError) throw dossierError;

const { data: researchJobs, error: researchJobError } = await s
  .from("research_jobs")
  .select("id,project_id,chapter_number,status,topic,progress,result,checkpoint,created_at,completed_at")
  .eq("project_id", project.id)
  .eq("user_id", project.user_id)
  .order("created_at", { ascending: false })
  .limit(500);
if (researchJobError) throw researchJobError;

const globalDeepActive = (deepJobs || []).filter((j) => ["QUEUED", "RUNNING", "RETRYING"].includes(clean(j.status).toUpperCase()));
const globalResearchActive = (researchJobs || []).filter((j) => ["QUEUED", "RUNNING", "RETRYING"].includes(clean(j.status).toUpperCase()));

function rowsForChapter(rows, chapter) { return (rows || []).filter((x) => Number(x.chapter_number || 0) === chapter); }
function planNow() {
  return sections.map((section) => {
    const chapter = Number(section.chapter_number || 0);
    const chapterDeep = rowsForChapter(deepJobs, chapter);
    const chapterDossiers = rowsForChapter(dossiersRaw, chapter);
    const chapterResearch = rowsForChapter(researchJobs, chapter);
    const appliedJob = chapterDeep.find((j) => approvedAndApplied(j, section)) || null;
    if (appliedJob) return { chapter, section, state: "APPLIED", dossier: null, job: appliedJob, reason: "Contenido actual coincide con Production APPROVED." };
    const rejected = chapterDeep.find((j) => clean(j.status).toUpperCase() === "COMPLETED" && clean(j.result?.quality?.verdict).toUpperCase() === "REJECTED" && Number(j.result?.repairAttempts || 0) === 0) || null;
    if (rejected) return { chapter, section, state: "NEEDS_REPAIR", dossier: null, job: rejected, reason: `Production REJECTED ${Number(rejected.result?.quality?.overallScore || 0)}; reparación explícita requerida.` };
    const eligible = chooseDossier(chapterDossiers);
    if (eligible) return { chapter, section, state: "PRODUCTION_READY", dossier: eligible, job: null, reason: eligible.ready_for_writing ? "Research ready_for_writing." : "Research cumple mínimos Production mediante override editorial explícito." };
    const activeResearch = chapterResearch.find((j) => ["QUEUED", "RUNNING", "RETRYING"].includes(clean(j.status).toUpperCase())) || null;
    if (activeResearch) return { chapter, section, state: "BLOCK_ACTIVE_RESEARCH", dossier: null, job: activeResearch, reason: `Research ${activeResearch.status} ya activo.` };
    const completedDossiers = chapterDossiers.length;
    if (completedDossiers && !refreshResearch) return { chapter, section, state: "BLOCK_RESEARCH_INELIGIBLE", dossier: chapterDossiers[0], job: null, reason: "Existe Research completado pero no alcanza Production; no se gasta otra ronda sin --refresh-research." };
    return { chapter, section, state: "RESEARCH_READY", dossier: null, job: null, reason: completedDossiers ? "Refresh Research explícito autorizado." : "No existe Research; listo para primera pasada única." };
  });
}

const initialPlan = planNow();
const researchNeeded = initialPlan.filter((x) => x.state === "RESEARCH_READY").length;
const productionNeeded = initialPlan.filter((x) => x.state === "PRODUCTION_READY" || x.state === "RESEARCH_READY").length;
const staticBlockers = initialPlan.filter((x) => ["NEEDS_REPAIR", "BLOCK_ACTIVE_RESEARCH", "BLOCK_RESEARCH_INELIGIBLE"].includes(x.state));

console.log("\n================================================");
console.log(" GENELIBROS — UNIVERSAL BOOK V1 / RESEARCH → PRODUCTION → APPLY");
console.log("================================================");
console.log({
  universalBookVersion: UNIVERSAL_BOOK_VERSION,
  projectId: project.id,
  project: project.title,
  range: `${fromChapter}-${lastChapter}`,
  chaptersSelected: initialPlan.length,
  execute,
  refreshResearch,
  targetWords,
  researchPolicy: {
    maxQueries: researchMaxQueries,
    maxSources: researchMaxSources,
    maxCallsPerChapter: researchMaxCallsPerChapter,
    firstPassOnly: true,
    automaticSecondResearch: false,
    bookMaxCalls: execute ? researchBookMaxCalls : null,
  },
  productionPolicy: {
    firstPassMaxCallsPerChapter: FIRST_PASS_MAX_LLM_CALLS,
    threshold: QUALITY_THRESHOLD,
    automaticRepair: false,
    bookMaxCalls: execute ? productionBookMaxCalls : null,
  },
  estimatedMaximum: {
    researchCalls: researchNeeded * researchMaxCallsPerChapter,
    productionFirstPassCalls: productionNeeded * FIRST_PASS_MAX_LLM_CALLS,
    repairs: 0,
  },
  globalActiveDeepJobs: globalDeepActive,
  globalActiveResearchJobs: globalResearchActive,
  llmCallsMadeByPreflight: 0,
});
for (const item of initialPlan) {
  console.log({
    chapter: item.chapter,
    title: clean(item.section.title) || `Capítulo ${item.chapter}`,
    state: item.state,
    dossierId: item.dossier?.id || null,
    jobId: item.job?.id || null,
    researchMetrics: item.dossier ? researchMetrics(item.dossier) : null,
    reason: item.reason,
  });
}

const manifestBase = {
  universalBookVersion: UNIVERSAL_BOOK_VERSION,
  generatedAt: new Date().toISOString(),
  projectId: project.id,
  projectTitle: project.title,
  range: { from: fromChapter, to: lastChapter },
  targetWords,
  refreshResearch,
  researchPolicy: { maxQueries: researchMaxQueries, maxSources: researchMaxSources, maxCallsPerChapter: researchMaxCallsPerChapter, bookMaxCalls: researchBookMaxCalls },
  productionPolicy: { firstPassMaxCallsPerChapter: FIRST_PASS_MAX_LLM_CALLS, bookMaxCalls: productionBookMaxCalls, automaticRepair: false },
  status: "PREFLIGHT",
  recordedResearchCalls: 0,
  recordedProductionCalls: 0,
  chapters: initialPlan.map((x) => ({ chapter: x.chapter, sectionId: x.section.id, state: x.state, dossierId: x.dossier?.id || null, jobId: x.job?.id || null, reason: x.reason })),
};
const manifestFile = writeManifest(project.id, manifestBase);
console.log(`[Genelibros] Manifest: ${manifestFile}`);

if (!execute) {
  console.log("\n[Genelibros] UNIVERSAL BOOK PREFLIGHT terminado. 0 LLM. Para ejecutar exige --execute y presupuestos globales explícitos.");
  process.exit(staticBlockers.length || globalDeepActive.length || globalResearchActive.length ? 20 : 0);
}
if (globalDeepActive.length || globalResearchActive.length) {
  console.error("[Genelibros] UNIVERSAL BOOK EXECUTE bloqueado: hay jobs activos. 0 nuevas llamadas desde este runner.");
  process.exit(21);
}
if (staticBlockers.length) {
  console.error("[Genelibros] UNIVERSAL BOOK EXECUTE bloqueado antes de gastar: resuelve NEEDS_REPAIR/BLOCK_RESEARCH_INELIGIBLE o usa --refresh-research explícitamente.");
  process.exit(22);
}

let recordedResearchCalls = 0;
let recordedProductionCalls = 0;
const execution = [];

async function freshChapterState(section) {
  const chapter = Number(section.chapter_number || 0);
  const [{ data: freshDossiers, error: de }, { data: freshDeep, error: je }, { data: freshResearch, error: re }] = await Promise.all([
    s.from("research_dossiers").select("id,job_id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,model,usage,completed_at,created_at").eq("project_id", project.id).eq("chapter_number", chapter).order("completed_at", { ascending: false, nullsFirst: false }).limit(50),
    s.from("deep_work_jobs").select("id,project_id,section_id,chapter_number,status,objective,result,policy,checkpoint,progress,created_at,updated_at").eq("project_id", project.id).eq("chapter_number", chapter).order("created_at", { ascending: false }).limit(50),
    s.from("research_jobs").select("id,project_id,chapter_number,status,topic,progress,result,checkpoint,created_at,completed_at").eq("project_id", project.id).eq("chapter_number", chapter).order("created_at", { ascending: false }).limit(50),
  ]);
  if (de) throw de; if (je) throw je; if (re) throw re;
  const applied = (freshDeep || []).find((j) => approvedAndApplied(j, section)) || null;
  const rejected = (freshDeep || []).find((j) => clean(j.status).toUpperCase() === "COMPLETED" && clean(j.result?.quality?.verdict).toUpperCase() === "REJECTED") || null;
  return { chapter, dossiers: freshDossiers || [], deepJobs: freshDeep || [], researchJobs: freshResearch || [], applied, rejected, eligible: chooseDossier(freshDossiers || []) };
}

for (const section of sections) {
  const chapter = Number(section.chapter_number || 0);
  let state = await freshChapterState(section);
  if (state.applied) {
    execution.push({ chapter, state: "SKIPPED_APPLIED", jobId: state.applied.id, researchCallsAdded: 0, productionCallsAdded: 0 });
    continue;
  }
  if (state.rejected && Number(state.rejected.result?.repairAttempts || 0) === 0) {
    const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_REPAIR_REQUIRED", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_REPAIR_REQUIRED", jobId: state.rejected.id }] });
    console.log(`[Genelibros] Capítulo ${chapter} requiere reparación explícita: npm run deep:prod:repair -- --job ${state.rejected.id} --execute`);
    console.log(`[Genelibros] Manifest: ${file}`);
    process.exit(0);
  }

  if (!state.eligible) {
    const completedResearchExists = state.dossiers.length > 0;
    if (completedResearchExists && !refreshResearch) {
      const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_RESEARCH_INELIGIBLE", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_RESEARCH_INELIGIBLE", dossierId: state.dossiers[0]?.id || null }] });
      console.log(`[Genelibros] Capítulo ${chapter}: Research existente no alcanza Production. No se lanza otra ronda automáticamente.`);
      console.log(`[Genelibros] Manifest: ${file}`);
      process.exit(0);
    }
    const remainingResearch = researchBookMaxCalls - recordedResearchCalls;
    if (remainingResearch < researchMaxCallsPerChapter) {
      const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_RESEARCH_BUDGET", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_RESEARCH_BUDGET", remainingResearch }] });
      console.log(`[Genelibros] Pausa antes del Capítulo ${chapter}: Research remaining=${remainingResearch}, reserva requerida=${researchMaxCallsPerChapter}.`);
      console.log(`[Genelibros] Manifest: ${file}`);
      process.exit(0);
    }

    const preflightArgs = [
      "--from-job", anchorDeepJob.id,
      "--chapter", String(chapter),
      "--max-queries", String(researchMaxQueries),
      "--max-sources", String(researchMaxSources),
      "--max-calls", String(researchMaxCallsPerChapter),
      "--enqueue",
    ];
    let code = runNode("scripts/research-chapter-preflight.mjs", preflightArgs);
    if (code !== 0) {
      writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_RESEARCH_ENQUEUE_ERROR", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_RESEARCH_ENQUEUE_ERROR", exitCode: code }] });
      process.exit(code);
    }
    code = runNode("scripts/run-research-local-stack.mjs");
    if (code !== 0) {
      writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_RESEARCH_WORKER_ERROR", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_RESEARCH_WORKER_ERROR", exitCode: code }] });
      process.exit(code);
    }
    state = await freshChapterState(section);
    const newestResearch = state.researchJobs[0] || null;
    const researchCallsAdded = Number(newestResearch?.result?.usage?.calls || newestResearch?.checkpoint?.usage?.calls || 0);
    recordedResearchCalls += researchCallsAdded;
    execution.push({ chapter, state: state.eligible ? "RESEARCH_ELIGIBLE" : "RESEARCH_INELIGIBLE", researchJobId: newestResearch?.id || null, dossierId: state.dossiers[0]?.id || null, researchCallsAdded, researchMetrics: state.dossiers[0] ? researchMetrics(state.dossiers[0]) : null });
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: state.eligible ? "RUNNING" : "PAUSED_RESEARCH_INELIGIBLE", recordedResearchCalls, recordedProductionCalls, execution });
    if (!state.eligible) {
      console.log(`\n[Genelibros] UNIVERSAL BOOK pausado en Capítulo ${chapter}: la primera pasada Research no alcanzó el contrato Production.`);
      console.log("[Genelibros] No existe segunda ronda automática. Usa diagnóstico/curación/official-docs de forma explícita y luego reanuda.");
      process.exit(0);
    }
  }

  const remainingProduction = productionBookMaxCalls - recordedProductionCalls;
  if (remainingProduction < FIRST_PASS_MAX_LLM_CALLS) {
    const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_PRODUCTION_BUDGET", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_PRODUCTION_BUDGET", remainingProduction }] });
    console.log(`[Genelibros] Pausa antes de Production Capítulo ${chapter}: remaining=${remainingProduction}, reserva requerida=${FIRST_PASS_MAX_LLM_CALLS}.`);
    console.log(`[Genelibros] Manifest: ${file}`);
    process.exit(0);
  }

  const code = runNode("scripts/run-deep-production-editorial-v1.mjs", ["--project", project.id, "--chapter", String(chapter), "--target", String(targetWords), "--execute"]);
  if (code !== 0) {
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_PRODUCTION_ERROR", recordedResearchCalls, recordedProductionCalls, execution: [...execution, { chapter, state: "PAUSED_PRODUCTION_ERROR", exitCode: code }] });
    process.exit(code);
  }
  state = await freshChapterState(section);
  const latestProduction = state.deepJobs.find((j) => clean(j.objective).includes("GENELIBROS_PRODUCTION_V1|")) || state.deepJobs[0] || null;
  const productionCallsAdded = Number(latestProduction?.result?.usage?.calls || 0);
  recordedProductionCalls += productionCallsAdded;

  if (state.applied) {
    execution.push({ chapter, state: "COMPLETED_APPLIED", jobId: state.applied.id, productionCallsAdded, quality: state.applied.result?.quality?.overallScore ?? null });
    writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "RUNNING", recordedResearchCalls, recordedProductionCalls, execution });
    console.log(`[Genelibros] UNIVERSAL BOOK: Capítulo ${chapter} aplicado. Research=${recordedResearchCalls}/${researchBookMaxCalls}; Production=${recordedProductionCalls}/${productionBookMaxCalls}.`);
    continue;
  }

  if (latestProduction && clean(latestProduction.status).toUpperCase() === "COMPLETED" && clean(latestProduction.result?.quality?.verdict).toUpperCase() === "REJECTED") {
    execution.push({ chapter, state: "PAUSED_REPAIR_REQUIRED", jobId: latestProduction.id, productionCallsAdded, quality: latestProduction.result?.quality?.overallScore ?? null });
    const file = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_REPAIR_REQUIRED", recordedResearchCalls, recordedProductionCalls, execution });
    console.log(`\n[Genelibros] UNIVERSAL BOOK pausado en Capítulo ${chapter}: QUALITY REJECTED.`);
    console.log(`[Genelibros] Reparación explícita: npm run deep:prod:repair -- --job ${latestProduction.id} --execute`);
    console.log("[Genelibros] Luego vuelve a ejecutar este mismo comando; lo ya aplicado se saltará.");
    console.log(`[Genelibros] Manifest: ${file}`);
    process.exit(0);
  }

  execution.push({ chapter, state: "PAUSED_PRODUCTION_UNKNOWN", jobId: latestProduction?.id || null, productionCallsAdded });
  writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "PAUSED_PRODUCTION_UNKNOWN", recordedResearchCalls, recordedProductionCalls, execution });
  process.exit(23);
}

const finalManifest = writeManifest(project.id, { ...manifestBase, generatedAt: new Date().toISOString(), status: "COMPLETED", recordedResearchCalls, recordedProductionCalls, execution });
console.log("\n================================================");
console.log(" ✅ GENELIBROS — UNIVERSAL BOOK V1 COMPLETED");
console.log("================================================");
console.log({ projectId: project.id, project: project.title, recordedResearchCalls, researchBookMaxCalls, recordedProductionCalls, productionBookMaxCalls, automaticResearchRetries: 0, automaticRepairs: 0, manifest: finalManifest });

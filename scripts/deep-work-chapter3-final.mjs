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
function clean(v) { return String(v ?? "").trim(); }

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] Faltan credenciales Supabase. 0 llamadas LLM.");
  process.exit(2);
}

const SOURCE_DEEP_JOB = "c47273e7-a397-4677-8892-763b7a900296";
const DOSSIER_ID = "9ba3ef8e-f4ea-46c4-913d-42173b5ebcb2";
const CHAPTER = 3;
const TARGET_WORDS = 2500;
const MAX_CALLS = 7;
const FINAL_TITLE = "Qué funciona, qué no y qué podría funcionar";
const FINAL_MARKER = `FINAL_CH3_DOSSIER:${DOSSIER_ID}`;

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: sourceJob, error: sourceError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,status")
  .eq("id", SOURCE_DEEP_JOB)
  .single();
if (sourceError || !sourceJob) throw sourceError || new Error("Deep source job no encontrado.");

const { data: section, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,type")
  .eq("project_id", sourceJob.project_id)
  .eq("type", "CHAPTER")
  .eq("chapter_number", CHAPTER)
  .single();
if (sectionError || !section) throw sectionError || new Error("Capítulo 3 no encontrado.");

const { data: dossier, error: dossierError } = await s
  .from("research_dossiers")
  .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")
  .eq("id", DOSSIER_ID)
  .eq("project_id", sourceJob.project_id)
  .eq("chapter_number", CHAPTER)
  .single();
if (dossierError || !dossier) throw dossierError || new Error("Dossier final del Capítulo 3 no encontrado.");

const payload = dossier.result && typeof dossier.result === "object" ? dossier.result : {};
const claims = Array.isArray(payload.claims) ? payload.claims : [];
const sources = Array.isArray(payload.sources) ? payload.sources : [];
const gaps = Array.isArray(payload.gaps) ? payload.gaps : [];
const verified = claims.filter((c) => clean(c?.status) === "VERIFIED" && Boolean(c?.citationReady));
const classAB = sources.filter((src) => ["A", "B"].includes(clean(src?.sourceClass)));

const metrics = {
  coverage: Number(dossier.coverage_score || 0),
  evidence: Number(dossier.evidence_score || 0),
  factual: Number(dossier.factual_confidence_score || 0),
  verifiedClaims: verified.length,
  classABSources: classAB.length,
  gaps: gaps.length,
  critical: gaps.filter((g) => clean(g?.severity) === "CRITICAL").length,
  high: gaps.filter((g) => clean(g?.severity) === "HIGH").length,
};

if (metrics.coverage < 7.5 || metrics.evidence < 7.5 || metrics.factual < 7.5 || metrics.verifiedClaims < 3 || metrics.classABSources < 2) {
  console.error("[Genelibros] BLOCKED: el dossier no alcanza la base factual mínima para override editorial.");
  console.error(metrics);
  process.exit(3);
}

const { data: active, error: activeError } = await s
  .from("deep_work_jobs")
  .select("id,status,objective,progress,created_at")
  .eq("user_id", sourceJob.user_id)
  .eq("project_id", sourceJob.project_id)
  .eq("chapter_number", CHAPTER)
  .in("status", ["QUEUED", "RUNNING", "RETRYING"])
  .order("created_at", { ascending: false })
  .limit(5);
if (activeError) throw activeError;
if ((active || []).length) {
  console.error("[Genelibros] BLOCKED: ya existe un Deep Work activo para Capítulo 3.");
  console.error(active);
  process.exit(4);
}

const { data: prior, error: priorError } = await s
  .from("deep_work_jobs")
  .select("id,status,objective,progress,result,created_at")
  .eq("user_id", sourceJob.user_id)
  .eq("project_id", sourceJob.project_id)
  .eq("chapter_number", CHAPTER)
  .order("created_at", { ascending: false })
  .limit(10);
if (priorError) throw priorError;
const existingFinal = (prior || []).find((j) => clean(j.objective).includes(FINAL_MARKER));
if (existingFinal) {
  console.log("[Genelibros] Job final del Capítulo 3 ya existe; no se duplica:");
  console.log({
    id: existingFinal.id,
    status: existingFinal.status,
    progress: existingFinal.progress,
    quality: existingFinal.result?.quality?.overallScore ?? null,
    verdict: existingFinal.result?.quality?.verdict ?? null,
    applyAllowed: existingFinal.result?.applyAllowed ?? false,
  });
  process.exit(0);
}

const objective = [
  FINAL_MARKER,
  `TÍTULO EDITORIAL: ${FINAL_TITLE}.`,
  "Generar el Capítulo 3 completo, documental, analítico y accesible, objetivo aproximado 2500 palabras.",
  "Usar EXCLUSIVAMENTE claims VERIFIED + citationReady del dossier explícito para cifras, fechas, costos, porcentajes, instituciones y causalidades.",
  "Los gaps CRITICAL/HIGH/MEDIUM del dossier son límites editoriales: no inventarlos, no completarlos por inferencia y no presentarlos como hechos resueltos.",
  "Evaluar soluciones técnicas, regulatorias y financieras: medición inteligente, gobernanza de distribuidoras, pérdidas, renovables, almacenamiento, transmisión, subsidios y comparables internacionales solo donde el ledger lo soporte.",
  "Distinguir con claridad HECHO, EVIDENCIA, INTERPRETACIÓN, ESTIMACIÓN, PROYECCIÓN, PROPUESTA y CONTROVERSIA cuando corresponda.",
  "Evitar retórica partidista, relleno y redundancia. Mantener continuidad conceptual con el Capítulo 2.",
].join(" ");

const policy = {
  maxRepairAttempts: 1,
  threshold: 9.3,
  draftCount: 2,
  maxLlmCalls: MAX_CALLS,
  creditGuard: true,
  firstPassOnly: true,
  researchDossierId: DOSSIER_ID,
  researchEditorialOverride: true,
};

const result = {
  version: "deep-work-11c-1.0.0",
  projectId: sourceJob.project_id,
  projectTitle: "La Factura Invisible",
  targetType: "CHAPTER",
  operation: "IMPROVE",
  chapterNumber: CHAPTER,
  sectionId: section.id,
  depth: "SUPREME",
  objective,
  targetWords: TARGET_WORDS,
  title: FINAL_TITLE,
  preferredTitle: FINAL_TITLE,
  drafts: [],
  repairAttempts: 0,
  artifactIds: [],
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
  researchDossierId: DOSSIER_ID,
  researchEditorialOverride: true,
  researchMetrics: metrics,
  budgetGuard: {
    enabled: true,
    maxCalls: MAX_CALLS,
    maxRepairAttempts: 1,
    draftCount: 2,
    threshold: 9.3,
    firstPassOnly: true,
  },
};

const { data: job, error: insertError } = await s
  .from("deep_work_jobs")
  .insert({
    user_id: sourceJob.user_id,
    project_id: sourceJob.project_id,
    target_type: "CHAPTER",
    operation: "IMPROVE",
    depth: "SUPREME",
    chapter_number: CHAPTER,
    section_id: section.id,
    objective,
    target_words: TARGET_WORDS,
    status: "QUEUED",
    progress: 0,
    checkpoint: { version: "11C", step: "INIT", draft_index: 0 },
    result,
    policy,
    attempts: 0,
    max_attempts: 6,
    next_retry_at: new Date().toISOString(),
    workflow_version: "deep-work-11c-1.0.0",
  })
  .select("id,status,chapter_number,operation,depth,target_words,policy,progress")
  .single();
if (insertError || !job) throw insertError || new Error("No se pudo crear Deep Work final del Capítulo 3.");

console.log("\n================================================");
console.log(" GENELIBROS — CAPÍTULO 3 FINAL ENCOLADO");
console.log("================================================");
console.log({
  jobId: job.id,
  status: job.status,
  chapter: job.chapter_number,
  operation: job.operation,
  targetWords: job.target_words,
  dossierId: DOSSIER_ID,
  dossierReadyHistorical: Boolean(dossier.ready_for_writing),
  editorialOverride: true,
  researchMetrics: metrics,
  maxLlmCalls: MAX_CALLS,
  llmCallsMadeByEnqueue: 0,
});

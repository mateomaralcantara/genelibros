import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import {
  DEEP_PRODUCTION_VERSION,
  FINAL_MAX_LLM_CALLS,
  FIRST_PASS_MAX_LLM_CALLS,
  MAX_REPAIR_ATTEMPTS,
  QUALITY_THRESHOLD,
  DIRECT_REPAIR_THINKING_LEVEL,
  clean,
  countWords,
  directRepairMaxOutputTokens,
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
function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}
function hash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
function addUsage(base, next) {
  const a = base || {};
  const b = next || {};
  return {
    inputTokens: Number(a.inputTokens || 0) + Number(b.inputTokens || 0),
    outputTokens: Number(a.outputTokens || 0) + Number(b.outputTokens || 0),
    totalTokens: Number(a.totalTokens || 0) + Number(b.totalTokens || 0),
    calls: Number(a.calls || 0) + Number(b.calls || 0),
  };
}
function usageOf(response) {
  const usage = response?.usageMetadata || response?.usage || {};
  const inputTokens = Number(usage.promptTokenCount || usage.inputTokens || 0) || 0;
  const outputTokens = Number(usage.candidatesTokenCount || usage.outputTokens || 0) || 0;
  const totalTokens = Number(usage.totalTokenCount || usage.totalTokens || inputTokens + outputTokens) || 0;
  return { inputTokens, outputTokens, totalTokens, calls: 1 };
}
function normalizeRepairModel(value) {
  const raw = clean(value) || "gemini-3.6-flash";
  if (/^(?:models\/)?gemini-2\.5-flash$/i.test(raw)) return "gemini-3.6-flash";
  return raw.replace(/^models\//i, "");
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] Production V1 REPAIR bloqueado: faltan credenciales Supabase. 0 llamadas LLM.");
  process.exit(2);
}

const requestedJobId = argValue("--job", "");
const projectId = argValue("--project", "");
const chapterNumber = Math.max(1, Number(argValue("--chapter", "0")) || 0);
const execute = hasFlag("--execute");
if (!requestedJobId && (!projectId || !chapterNumber)) {
  console.error("Uso: node scripts/deep-production-repair.mjs --job <uuid> [--execute] | --project <uuid> --chapter <n> [--execute]");
  process.exit(3);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let job = null;
if (requestedJobId) {
  const { data, error } = await s
    .from("deep_work_jobs")
    .select("id,user_id,project_id,section_id,chapter_number,status,objective,target_words,operation,result,policy,progress,completed_at")
    .eq("id", requestedJobId)
    .maybeSingle();
  if (error) throw error;
  job = data || null;
} else {
  const { data, error } = await s
    .from("deep_work_jobs")
    .select("id,user_id,project_id,section_id,chapter_number,status,objective,target_words,operation,result,policy,progress,completed_at")
    .eq("project_id", projectId)
    .eq("chapter_number", chapterNumber)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  job = (data || []).find((row) => clean(row.objective).includes("GENELIBROS_PRODUCTION_V1|")) || null;
}

if (!job) {
  console.error("[Genelibros] Production V1 REPAIR: no se encontró job Production V1.");
  process.exit(4);
}
if (!clean(job.objective).includes("GENELIBROS_PRODUCTION_V1|")) {
  console.error("[Genelibros] Production V1 REPAIR bloqueado: el job no pertenece a Production V1.");
  process.exit(5);
}

let result = job.result && typeof job.result === "object" ? { ...job.result } : {};
const quality = result.quality && typeof result.quality === "object" ? result.quality : {};
const verdict = clean(quality.verdict).toUpperCase();
const calls = Number(result.usage?.calls || 0);
const repairAttempts = Number(result.repairAttempts || 0);
const budget = result.budgetGuard && typeof result.budgetGuard === "object" ? result.budgetGuard : {};
const stoppedBefore = clean(budget.stoppedBefore).toUpperCase();
const directRepairInvocations = Number(budget.directRepairInvocations || 0);
const actionable =
  (Array.isArray(quality.requiredRepairs) && quality.requiredRepairs.length > 0) ||
  (Array.isArray(quality.unsupportedNewClaims) && quality.unsupportedNewClaims.length > 0);

if (clean(job.status).toUpperCase() === "COMPLETED" && verdict === "APPROVED") {
  console.log("[Genelibros] Production V1 REPAIR no necesario: el job ya está APPROVED.");
  process.exit(0);
}
if (clean(job.status).toUpperCase() !== "COMPLETED" || verdict !== "REJECTED") {
  console.error(`[Genelibros] Production V1 REPAIR bloqueado: estado=${job.status}, verdict=${verdict || "NONE"}. Se exige COMPLETED/REJECTED.`);
  process.exit(6);
}
if (calls !== FIRST_PASS_MAX_LLM_CALLS) {
  console.error(`[Genelibros] Production V1 REPAIR bloqueado: calls=${calls}; se esperaban exactamente ${FIRST_PASS_MAX_LLM_CALLS}.`);
  process.exit(7);
}
if (repairAttempts !== 0) {
  console.error(`[Genelibros] Production V1 REPAIR bloqueado: repairAttempts=${repairAttempts}; Production V1 permite una sola reparación explícita.`);
  process.exit(8);
}
if (directRepairInvocations !== 0) {
  console.error(`[Genelibros] Production V1 REPAIR bloqueado: directRepairInvocations=${directRepairInvocations}. Ya se intentó la única reparación externa; no se vuelve a cobrar automáticamente.`);
  process.exit(9);
}
if (!(budget.hit === true && stoppedBefore === "REPAIR")) {
  console.error("[Genelibros] Production V1 REPAIR bloqueado: el Credit Guard no demuestra que la primera pasada se detuvo antes de REPAIR.");
  console.error({ budgetGuard: budget });
  process.exit(10);
}
if (!actionable) {
  console.error("[Genelibros] Production V1 REPAIR bloqueado: QUALITY no contiene reparaciones accionables.");
  process.exit(11);
}

const { data: synthesis, error: synthesisError } = await s
  .from("deep_work_artifacts")
  .select("id,content,payload,model,created_at")
  .eq("job_id", job.id)
  .eq("artifact_type", "SYNTHESIS")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (synthesisError || !synthesis?.content) throw synthesisError || new Error("SYNTHESIS persistido no encontrado.");

const { data: qualityArtifact, error: qualityError } = await s
  .from("deep_work_artifacts")
  .select("id,payload,model,created_at")
  .eq("job_id", job.id)
  .eq("artifact_type", "QUALITY")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (qualityError || !qualityArtifact?.payload) throw qualityError || new Error("QUALITY persistido no encontrado.");

const restoredQuality = qualityArtifact.payload;
const restoredActionable =
  (Array.isArray(restoredQuality.requiredRepairs) && restoredQuality.requiredRepairs.length > 0) ||
  (Array.isArray(restoredQuality.unsupportedNewClaims) && restoredQuality.unsupportedNewClaims.length > 0);
if (!restoredActionable) {
  console.error("[Genelibros] Production V1 REPAIR bloqueado: el artifact QUALITY no contiene reparaciones accionables.");
  process.exit(12);
}

const range = wordRange(job.target_words || result.targetWords || 2500);
const title = clean(result.preferredTitle) || clean(result.title) || `Capítulo ${job.chapter_number}`;
const model = normalizeRepairModel(
  process.env.DEEP_REPAIR_MODEL ||
  process.env.DEEP_BUDGET_MODEL ||
  process.env.DEEP_FAST_MODEL ||
  "gemini-3.6-flash",
);
const maxOutputTokens = directRepairMaxOutputTokens(process.env.DEEP_DIRECT_REPAIR_MAX_OUTPUT_TOKENS);

console.log("\n================================================");
console.log(" GENELIBROS — PRODUCTION V1 REPAIR PREFLIGHT");
console.log("================================================");
console.log({
  productionVersion: DEEP_PRODUCTION_VERSION,
  jobId: job.id,
  projectId: job.project_id,
  chapterNumber: job.chapter_number,
  title,
  callsBefore: calls,
  repairAttemptsBefore: repairAttempts,
  directRepairInvocations,
  synthesisWords: countWords(synthesis.content),
  qualityBefore: Number(restoredQuality.overallScore || 0),
  verdictBefore: clean(restoredQuality.verdict),
  requiredRepairs: Array.isArray(restoredQuality.requiredRepairs) ? restoredQuality.requiredRepairs : [],
  unsupportedNewClaims: Array.isArray(restoredQuality.unsupportedNewClaims) ? restoredQuality.unsupportedNewClaims : [],
  repairModel: model,
  thinkingLevel: DIRECT_REPAIR_THINKING_LEVEL,
  maxOutputTokens,
  maxAdditionalLlmCalls: 2,
  directRepairCallsNow: 1,
  qualityCallsLater: 1,
  hardCapAfterSuccess: FINAL_MAX_LLM_CALLS,
  execute,
});

if (!execute) {
  console.log("\n[Genelibros] REPAIR PREFLIGHT OK — 0 llamadas LLM. Repite mediante deep:prod:repair añadiendo --execute para consumir la única reparación explícita.");
  process.exit(0);
}
if (!geminiKey) {
  console.error("[Genelibros] Production V1 REPAIR bloqueado: falta GEMINI_API_KEY. 0 llamadas LLM.");
  process.exit(13);
}

// Reservamos la única invocación ANTES de llamar al proveedor. Si el proveedor
// corta, cobra o falla de forma ambigua, Production V1 no volverá a intentar a ciegas.
result.budgetGuard = {
  ...budget,
  directRepairInvocations: 1,
  directRepairStartedAt: new Date().toISOString(),
  directRepairModel: model,
  directRepairThinkingLevel: DIRECT_REPAIR_THINKING_LEVEL,
  directRepairMaxOutputTokens: maxOutputTokens,
};
const { error: reserveError } = await s
  .from("deep_work_jobs")
  .update({ result, updated_at: new Date().toISOString() })
  .eq("id", job.id);
if (reserveError) throw reserveError;

const ai = new GoogleGenAI({ apiKey: geminiKey });
let response;
try {
  response = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [{
        text: `
CAPÍTULO: ${title}

OBJETIVO:
Repara EXCLUSIVAMENTE los defectos señalados por QUALITY sin reescribir innecesariamente el capítulo.

QUALITY REPORT:
${JSON.stringify(restoredQuality)}

RESEARCH CONTEXT / LÍMITES FACTUALES:
${JSON.stringify(result.researchContext || {}).slice(0, 24000)}

CAPÍTULO SINTETIZADO COMPLETO:
<<<BEGIN_SYNTHESIS>>>
${String(synthesis.content).slice(0, 90000)}
<<<END_SYNTHESIS>>>

LONGITUD:
- original actual: ${countWords(synthesis.content)} palabras
- objetivo: ${range.target} palabras
- rango obligatorio: ${range.min}-${range.max}
- rango preferido: ${range.preferredMin}-${range.preferredMax}

REGLAS OBLIGATORIAS:
- Devuelve el CAPÍTULO COMPLETO reparado, no un resumen ni una lista de cambios.
- Corrige solamente requiredRepairs y unsupportedNewClaims del QUALITY REPORT.
- Ajusta longitud solo si QUALITY lo exige; prioriza ${range.preferredMin}-${range.preferredMax} y nunca salgas de ${range.min}-${range.max}.
- Elimina redundancia, reiteración, transiciones prescindibles y explicaciones duplicadas antes de eliminar evidencia sustantiva.
- Conserva toda atribución, procedencia, reserva y cautela factual.
- No conviertas afirmaciones atribuidas en hechos directos.
- No inventes cifras, fuentes, instituciones, fechas, costos ni causalidades.
- No completes gaps del Research por inferencia.
- No añadas relleno.
- Mantén título, continuidad y voz editorial.
- Devuelve exclusivamente texto plano del capítulo.
- NO JSON. NO fences. NO comentarios antes o después.
`,
      }],
    }],
    config: {
      systemInstruction:
        "Eres FINAL_REPAIR_EDITOR de Genelibros Production V1. Haces una única reparación quirúrgica sobre un capítulo ya sintetizado. Tu salida es siempre el capítulo completo en texto plano, con disciplina factual estricta.",
      thinkingConfig: {
        thinkingLevel: DIRECT_REPAIR_THINKING_LEVEL,
        includeThoughts: false,
      },
      maxOutputTokens,
    },
  });
} catch (error) {
  result.budgetGuard = {
    ...result.budgetGuard,
    directRepairFailedAt: new Date().toISOString(),
    directRepairFailure: clean(error?.message || error).slice(0, 1000),
  };
  await s.from("deep_work_jobs").update({ result, updated_at: new Date().toISOString() }).eq("id", job.id);
  console.error("[Genelibros] Production V1 DIRECT REPAIR falló. La invocación quedó consumida/bloqueada para evitar retries ciegos.");
  throw error;
}

const repairedText = typeof response?.text === "function" ? clean(response.text()) : clean(response?.text);
const repairUsage = usageOf(response);
const finishReason = clean(response?.candidates?.[0]?.finishReason).toUpperCase();
if (!repairedText || finishReason.includes("MAX_TOKENS")) {
  result.budgetGuard = {
    ...result.budgetGuard,
    directRepairFailedAt: new Date().toISOString(),
    directRepairFailure: !repairedText ? "EMPTY_RESPONSE" : "MAX_TOKENS",
    directRepairFinishReason: finishReason,
    directRepairProviderUsage: repairUsage,
    directRepairPartialWords: countWords(repairedText),
  };
  await s.from("deep_work_jobs").update({ result, updated_at: new Date().toISOString() }).eq("id", job.id);
  console.error("[Genelibros] Production V1 DIRECT REPAIR no produjo un resultado final utilizable. No se reintenta automáticamente.");
  console.error({ finishReason, repairUsage, partialWords: countWords(repairedText), thinkingLevel: DIRECT_REPAIR_THINKING_LEVEL, maxOutputTokens });
  process.exit(14);
}

const repairWords = countWords(repairedText);
const repairArtifactPayload = {
  productionVersion: DEEP_PRODUCTION_VERSION,
  rationale: "PRODUCTION_V1_DIRECT_REPAIR_ONCE_FROM_SYNTHESIS",
  sourceSynthesisArtifact: synthesis.id,
  sourceQualityArtifact: qualityArtifact.id,
  qualityBefore: Number(restoredQuality.overallScore || 0),
  verdictBefore: clean(restoredQuality.verdict),
  requiredRepairs: Array.isArray(restoredQuality.requiredRepairs) ? restoredQuality.requiredRepairs : [],
  unsupportedNewClaims: Array.isArray(restoredQuality.unsupportedNewClaims) ? restoredQuality.unsupportedNewClaims : [],
  words: repairWords,
  withinRequiredWordRange: repairWords >= range.min && repairWords <= range.max,
  thinkingLevel: DIRECT_REPAIR_THINKING_LEVEL,
  maxOutputTokens,
  finishReason,
};

const { data: repairArtifactId, error: artifactError } = await s.rpc("deep_create_artifact", {
  p_user_id: job.user_id,
  p_project_id: job.project_id,
  p_job_id: job.id,
  p_section_id: job.section_id || null,
  p_chapter_number: job.chapter_number,
  p_artifact_type: "REPAIR",
  p_label: "PRODUCTION_V1_REPAIR_1",
  p_content: repairedText,
  p_payload: repairArtifactPayload,
  p_content_hash: hash(repairedText),
  p_model: model,
});
if (artifactError) throw artifactError;

result.finalCandidate = {
  label: "REPAIR",
  content: repairedText,
  rationale: "Production V1: única reparación explícita desde SYNTHESIS; siguiente y último paso pagado = QUALITY.",
  strengths: [],
  risks: [],
};
result.quality = restoredQuality;
result.repairAttempts = 1;
result.applyAllowed = false;
delete result.completedAt;
result.usage = addUsage(result.usage, repairUsage);
result.models = { ...(result.models || {}), repair_1: model };
result.artifactIds = Array.isArray(result.artifactIds) ? [...result.artifactIds] : [];
if (repairArtifactId) result.artifactIds.push(String(repairArtifactId));
result.budgetGuard = {
  ...result.budgetGuard,
  enabled: true,
  hit: false,
  callsUsed: Number(result.usage?.calls || 0),
  maxCalls: FINAL_MAX_LLM_CALLS,
  stoppedBefore: null,
  extensionReason: "PRODUCTION_V1_ONE_DIRECT_REPAIR_PLUS_ONE_QUALITY",
  maxAdditionalCalls: 2,
  directRepairComplete: true,
  directRepairCompletedAt: new Date().toISOString(),
};

if (Number(result.usage?.calls || 0) !== FIRST_PASS_MAX_LLM_CALLS + 1) {
  console.error(`[Genelibros] Production V1 guard: usage.calls=${result.usage?.calls}; se esperaba ${FIRST_PASS_MAX_LLM_CALLS + 1} tras una sola reparación. QUALITY no se reactiva.`);
  process.exit(15);
}

const policy = {
  ...(job.policy && typeof job.policy === "object" ? job.policy : {}),
  creditGuard: true,
  threshold: QUALITY_THRESHOLD,
  maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
  maxLlmCalls: FINAL_MAX_LLM_CALLS,
  firstPassOnly: true,
  productionVersion: DEEP_PRODUCTION_VERSION,
};

const now = new Date().toISOString();
const { data: updated, error: updateError } = await s
  .from("deep_work_jobs")
  .update({
    status: "QUEUED",
    checkpoint: { version: "11C", step: "QUALITY" },
    result,
    policy,
    progress: 82,
    attempts: 0,
    next_retry_at: now,
    locked_by: null,
    locked_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    last_error: null,
    error: null,
    dead_letter_at: null,
    completed_at: null,
    updated_at: now,
  })
  .eq("id", job.id)
  .select("id,status,checkpoint,progress,result,policy")
  .single();
if (updateError || !updated) throw updateError || new Error("No se pudo preparar QUALITY final Production V1.");

console.log("\n================================================");
console.log(" GENELIBROS — PRODUCTION V1 REPAIR COMPLETADO");
console.log("================================================");
console.log({
  jobId: updated.id,
  status: updated.status,
  resumeFromStep: updated.checkpoint?.step,
  repairWords,
  withinRequiredWordRange: repairWords >= range.min && repairWords <= range.max,
  finishReason,
  repairModel: model,
  thinkingLevel: DIRECT_REPAIR_THINKING_LEVEL,
  maxOutputTokens,
  repairArtifactId: repairArtifactId || null,
  callsAfterRepair: Number(updated.result?.usage?.calls || 0),
  repairAttempts: Number(updated.result?.repairAttempts || 0),
  hardCapNow: FINAL_MAX_LLM_CALLS,
  remainingLlmCalls: 1,
  automaticSecondRepair: false,
});

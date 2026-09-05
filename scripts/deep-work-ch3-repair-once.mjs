import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

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
function countWords(v) { return clean(v).split(/\s+/).filter(Boolean).length; }
function hash(v) { return crypto.createHash("sha256").update(String(v || ""), "utf8").digest("hex"); }
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
function usageOf(resp) {
  const u = resp?.usageMetadata || resp?.usage || {};
  const inputTokens = Number(u.promptTokenCount || u.inputTokens || 0) || 0;
  const outputTokens = Number(u.candidatesTokenCount || u.outputTokens || 0) || 0;
  const totalTokens = Number(u.totalTokenCount || u.totalTokens || inputTokens + outputTokens) || 0;
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
if (!url || !key || !geminiKey) {
  console.error("[Genelibros] FINAL REPAIR bloqueado: faltan credenciales Supabase/Gemini. 0 llamadas LLM.");
  process.exit(2);
}

const JOB_ID = "b0d55161-ec60-491e-b6f4-fb4142029408";
const EXPECTED_CALLS = 7;
const FINAL_MAX_CALLS = 9;
const FINAL_TITLE = "Qué funciona, qué no y qué podría funcionar";
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: job, error: jobError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,section_id,status,checkpoint,result,policy,progress,attempts,max_attempts,completed_at,chapter_number,target_words")
  .eq("id", JOB_ID)
  .single();
if (jobError || !job) throw jobError || new Error("Job final del Capítulo 3 no encontrado.");

const result = job.result && typeof job.result === "object" ? { ...job.result } : {};
const quality = result.quality && typeof result.quality === "object" ? result.quality : {};
const verdict = clean(quality.verdict).toUpperCase();
const calls = Number(result.usage?.calls || 0);
const repairAttempts = Number(result.repairAttempts || 0);
const budget = result.budgetGuard && typeof result.budgetGuard === "object" ? result.budgetGuard : {};
const stoppedBefore = clean(budget.stoppedBefore).toUpperCase();
const actionable =
  (Array.isArray(quality.requiredRepairs) && quality.requiredRepairs.length > 0) ||
  (Array.isArray(quality.unsupportedNewClaims) && quality.unsupportedNewClaims.length > 0);

if (job.status === "COMPLETED" && verdict === "APPROVED") {
  console.log("[Genelibros] FINAL REPAIR no necesario: el job ya está APPROVED.");
  process.exit(0);
}
if (job.status !== "COMPLETED" || verdict !== "REJECTED") {
  console.error(`[Genelibros] FINAL REPAIR bloqueado: estado ${job.status}/${verdict || "NONE"}; se exige COMPLETED/REJECTED.`);
  process.exit(3);
}
if (calls !== EXPECTED_CALLS) {
  console.error(`[Genelibros] FINAL REPAIR bloqueado: calls=${calls}; se esperaban exactamente ${EXPECTED_CALLS}. No se amplía presupuesto a ciegas.`);
  process.exit(4);
}
if (repairAttempts !== 0) {
  console.error(`[Genelibros] FINAL REPAIR bloqueado: repairAttempts=${repairAttempts}; la reparación ya fue ejecutada.`);
  process.exit(5);
}
if (!(budget.hit === true && stoppedBefore === "REPAIR")) {
  console.error("[Genelibros] FINAL REPAIR bloqueado: el budget guard no demuestra que se detuvo antes de REPAIR.");
  console.error({ budgetGuard: budget });
  process.exit(6);
}
if (!actionable) {
  console.error("[Genelibros] FINAL REPAIR bloqueado: QUALITY no contiene repairs accionables; no se compra una reparación ciega.");
  process.exit(7);
}

const { data: synthesis, error: synthesisError } = await s
  .from("deep_work_artifacts")
  .select("id,content,payload,model,created_at")
  .eq("job_id", JOB_ID)
  .eq("artifact_type", "SYNTHESIS")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
if (synthesisError || !synthesis?.content) throw synthesisError || new Error("SYNTHESIS persistido no encontrado.");

const { data: qualityArtifact, error: qualityError } = await s
  .from("deep_work_artifacts")
  .select("id,payload,model,created_at")
  .eq("job_id", JOB_ID)
  .eq("artifact_type", "QUALITY")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
if (qualityError || !qualityArtifact?.payload) throw qualityError || new Error("QUALITY persistido no encontrado.");

const restoredQuality = qualityArtifact.payload;
const restoredActionable =
  (Array.isArray(restoredQuality.requiredRepairs) && restoredQuality.requiredRepairs.length > 0) ||
  (Array.isArray(restoredQuality.unsupportedNewClaims) && restoredQuality.unsupportedNewClaims.length > 0);
if (!restoredActionable) {
  console.error("[Genelibros] FINAL REPAIR bloqueado: artifact QUALITY no contiene repairs accionables.");
  process.exit(8);
}

const targetWords = Math.max(300, Number(job.target_words || 2500));
const minWords = Math.floor(targetWords * 0.92);
const maxWords = Math.ceil(targetWords * 1.08);
const preferredMin = Math.round(targetWords * 0.98);
const preferredMax = Math.round(targetWords * 1.02);
const model = normalizeRepairModel(
  process.env.DEEP_REPAIR_MODEL ||
  process.env.DEEP_BUDGET_MODEL ||
  process.env.DEEP_FAST_MODEL ||
  "gemini-3.6-flash"
);

console.log("\n================================================");
console.log(" GENELIBROS — DIRECT REPAIR ONCE / PRECHECK PASS");
console.log("================================================");
console.log({
  jobId: JOB_ID,
  callsBefore: calls,
  repairAttemptsBefore: repairAttempts,
  synthesisWords: countWords(synthesis.content),
  qualityBefore: Number(restoredQuality.overallScore || 0),
  verdictBefore: clean(restoredQuality.verdict),
  requiredRepairs: Array.isArray(restoredQuality.requiredRepairs) ? restoredQuality.requiredRepairs : [],
  unsupportedNewClaims: Array.isArray(restoredQuality.unsupportedNewClaims) ? restoredQuality.unsupportedNewClaims : [],
  repairModel: model,
  maxAdditionalLlmCalls: 2,
  directRepairCallsNow: 1,
  qualityCallsLater: 1,
});

const ai = new GoogleGenAI({ apiKey: geminiKey });
const response = await ai.models.generateContent({
  model,
  contents: [{
    role: "user",
    parts: [{
      text: `
CAPÍTULO: ${FINAL_TITLE}

OBJETIVO:
Repara EXCLUSIVAMENTE los defectos señalados por QUALITY sin reescribir innecesariamente el capítulo.

QUALITY REPORT:
${JSON.stringify(restoredQuality)}

CAPÍTULO SINTETIZADO COMPLETO:
<<<BEGIN_SYNTHESIS>>>
${String(synthesis.content).slice(0, 90000)}
<<<END_SYNTHESIS>>>

LONGITUD:
- objetivo: ${targetWords} palabras
- rango obligatorio: ${minWords}-${maxWords}
- rango preferido: ${preferredMin}-${preferredMax}

REGLAS OBLIGATORIAS:
- Devuelve el CAPÍTULO COMPLETO reparado, no un resumen ni una lista de cambios.
- Corrige solamente requiredRepairs y unsupportedNewClaims del QUALITY REPORT.
- Conserva toda atribución, procedencia, reserva y cautela factual.
- No conviertas afirmaciones atribuidas en hechos directos.
- No inventes cifras, fuentes, instituciones, fechas, costos ni causalidades.
- No completes gaps del Research por inferencia.
- No añadas relleno para alcanzar longitud.
- Mantén el título y continuidad editorial.
- Devuelve exclusivamente texto plano del capítulo.
- NO JSON. NO fences. NO comentarios antes o después.
`,
    }],
  }],
  config: {
    systemInstruction:
      "Eres FINAL_REPAIR_EDITOR de Genelibros. Haces una única reparación quirúrgica sobre un capítulo ya sintetizado. Tu salida es siempre el capítulo completo como texto plano, conservando disciplina factual y atribuciones.",
    temperature: 0.1,
    maxOutputTokens: 18000,
  },
});

const repairedText = typeof response?.text === "function"
  ? clean(response.text())
  : clean(response?.text);
const repairUsage = usageOf(response);
const finishReason = clean(response?.candidates?.[0]?.finishReason).toUpperCase();
if (!repairedText) {
  console.error("[Genelibros] DIRECT REPAIR falló: Gemini devolvió texto vacío. La llamada pudo ser facturada; el job no se modifica.");
  process.exit(9);
}
if (finishReason.includes("MAX_TOKENS")) {
  console.error("[Genelibros] DIRECT REPAIR falló por MAX_TOKENS. La llamada pudo ser facturada; el job no se modifica ni se reintenta.");
  process.exit(10);
}

const repairWords = countWords(repairedText);
const repairArtifactPayload = {
  rationale: "DIRECT_REPAIR_ONCE_FROM_SYNTHESIS",
  sourceSynthesisArtifact: synthesis.id,
  sourceQualityArtifact: qualityArtifact.id,
  qualityBefore: Number(restoredQuality.overallScore || 0),
  verdictBefore: clean(restoredQuality.verdict),
  requiredRepairs: Array.isArray(restoredQuality.requiredRepairs) ? restoredQuality.requiredRepairs : [],
  unsupportedNewClaims: Array.isArray(restoredQuality.unsupportedNewClaims) ? restoredQuality.unsupportedNewClaims : [],
  words: repairWords,
  withinRequiredWordRange: repairWords >= minWords && repairWords <= maxWords,
  finishReason,
};

const { data: repairArtifactId, error: artifactError } = await s.rpc("deep_create_artifact", {
  p_user_id: job.user_id,
  p_project_id: job.project_id,
  p_job_id: job.id,
  p_section_id: job.section_id || null,
  p_chapter_number: job.chapter_number,
  p_artifact_type: "REPAIR",
  p_label: "REPAIR_1_DIRECT",
  p_content: repairedText,
  p_payload: repairArtifactPayload,
  p_content_hash: hash(repairedText),
  p_model: model,
});
if (artifactError) throw artifactError;

result.finalCandidate = {
  label: "REPAIR",
  content: repairedText,
  rationale: "Única reparación directa desde SYNTHESIS persistido; siguiente paso QUALITY.",
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
  ...budget,
  enabled: true,
  hit: false,
  callsUsed: Number(result.usage?.calls || 0),
  maxCalls: FINAL_MAX_CALLS,
  stoppedBefore: null,
  extensionReason: "ONE_DIRECT_REPAIR_PLUS_ONE_QUALITY",
  maxAdditionalCalls: 2,
  directRepairComplete: true,
  extendedAt: new Date().toISOString(),
};

if (Number(result.usage?.calls || 0) !== 8) {
  console.error(`[Genelibros] DIRECT REPAIR guard: usage.calls=${result.usage?.calls}; se esperaba 8 tras una sola reparación. No se reactiva QUALITY.`);
  process.exit(11);
}

const policy = {
  ...(job.policy && typeof job.policy === "object" ? job.policy : {}),
  creditGuard: true,
  threshold: 9.3,
  draftCount: 2,
  maxRepairAttempts: 1,
  maxLlmCalls: FINAL_MAX_CALLS,
  firstPassOnly: true,
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
  .eq("id", JOB_ID)
  .select("id,status,checkpoint,progress,result,policy")
  .single();
if (updateError || !updated) throw updateError || new Error("No se pudo preparar QUALITY final.");

console.log("\n================================================");
console.log(" GENELIBROS — DIRECT REPAIR ONCE COMPLETADO");
console.log("================================================");
console.log({
  jobId: updated.id,
  status: updated.status,
  resumeFromStep: updated.checkpoint?.step,
  repairWords,
  withinRequiredWordRange: repairWords >= minWords && repairWords <= maxWords,
  finishReason,
  repairModel: model,
  repairArtifactId: repairArtifactId || null,
  callsAfterRepair: Number(updated.result?.usage?.calls || 0),
  repairAttempts: Number(updated.result?.repairAttempts || 0),
  hardCapNow: FINAL_MAX_CALLS,
  remainingLlmCalls: 1,
  automaticSecondRepair: false,
});

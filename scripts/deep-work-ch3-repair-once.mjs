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
function countWords(v) { return clean(v).split(/\s+/).filter(Boolean).length; }

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] FINAL REPAIR bloqueado: faltan credenciales Supabase. 0 llamadas LLM.");
  process.exit(2);
}

const JOB_ID = "b0d55161-ec60-491e-b6f4-fb4142029408";
const EXPECTED_CALLS = 7;
const FINAL_MAX_CALLS = 9;
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: job, error: jobError } = await s
  .from("deep_work_jobs")
  .select("id,status,checkpoint,result,policy,progress,attempts,max_attempts,completed_at,chapter_number,target_words")
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

result.finalCandidate = {
  label: "SYNTHESIS",
  content: synthesis.content,
  rationale: "Restaurado desde SYNTHESIS persistido para una única reparación final controlada.",
  strengths: [],
  risks: [],
};
result.quality = restoredQuality;
result.repairAttempts = 0;
result.applyAllowed = false;
delete result.completedAt;
result.budgetGuard = {
  ...budget,
  enabled: true,
  hit: false,
  callsUsed: calls,
  maxCalls: FINAL_MAX_CALLS,
  stoppedBefore: null,
  extensionReason: "ONE_FINAL_REPAIR_PLUS_QUALITY",
  maxAdditionalCalls: 2,
  extendedAt: new Date().toISOString(),
};

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
    checkpoint: { version: "11C", step: "REPAIR" },
    result,
    policy,
    progress: 78,
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
if (updateError || !updated) throw updateError || new Error("No se pudo preparar la reparación final.");

console.log("\n================================================");
console.log(" GENELIBROS — FINAL REPAIR ONCE PREPARADO");
console.log("================================================");
console.log({
  jobId: updated.id,
  status: updated.status,
  resumeFromStep: updated.checkpoint?.step,
  synthesisWords: countWords(synthesis.content),
  qualityBefore: Number(restoredQuality.overallScore || 0),
  verdictBefore: clean(restoredQuality.verdict),
  requiredRepairs: Array.isArray(restoredQuality.requiredRepairs) ? restoredQuality.requiredRepairs : [],
  unsupportedNewClaims: Array.isArray(restoredQuality.unsupportedNewClaims) ? restoredQuality.unsupportedNewClaims : [],
  callsBefore: calls,
  hardCapNow: FINAL_MAX_CALLS,
  maxAdditionalLlmCalls: 2,
  repairInternalMaxAttempts: 1,
  automaticSecondRepair: false,
});

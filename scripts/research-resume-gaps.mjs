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
function normalize(value) { return String(value || "").trim().replace(/\s+/g, " "); }
function gapText(gap) {
  return normalize(gap?.gap || gap?.question || gap?.description || gap?.text || "");
}
function gapRecommendedQueries(gap) {
  if (Array.isArray(gap?.recommendedQueries)) return gap.recommendedQueries.map(normalize).filter(Boolean);
  if (Array.isArray(gap?.suggestedQueries)) return gap.suggestedQueries.map(normalize).filter(Boolean);
  const single = normalize(gap?.suggestedQuery || gap?.recommendedQuery || "");
  return single ? [single] : [];
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] Faltan credenciales server-side de Supabase. 0 llamadas LLM.");
  process.exit(2);
}

const sourceJobId = argValue("--from-job", process.env.RESEARCH_RESUME_FROM_JOB || "b69bdfeb-e024-4c1e-99ab-918a3e0e6f6b");
const explicitQuery = normalize(argValue("--query", ""));
const maxQueries = Math.max(1, Math.min(3, Number(argValue("--max-queries", "3")) || 3));
const maxSources = Math.max(1, Math.min(3, Number(argValue("--max-sources", "3")) || 3));
const maxCalls = Math.max(1, Math.min(11, Number(argValue("--max-calls", "11")) || 11));
const enqueue = hasFlag("--enqueue");
const model = process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash";

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: sourceJob, error: sourceError } = await s
  .from("research_jobs")
  .select("id,user_id,project_id,chapter_number,topic,objective,depth,max_sources,status,checkpoint,result,created_at")
  .eq("id", sourceJobId)
  .single();
if (sourceError || !sourceJob) throw sourceError || new Error("Research source job no encontrado.");
if (sourceJob.status !== "COMPLETED") {
  console.error(`[Genelibros] BLOCKED: source job ${sourceJob.id} está ${sourceJob.status}, no COMPLETED.`);
  process.exit(3);
}

const sourceCheckpoint = sourceJob.checkpoint || {};
const dossier = sourceCheckpoint.dossier || null;
if (!dossier) {
  console.error("[Genelibros] BLOCKED: el job completado no conserva dossier en checkpoint.");
  process.exit(4);
}
if (dossier.readyForWriting === true || sourceJob.result?.readyForWriting === true) {
  console.log("[Genelibros] El Research fuente ya está ready_for_writing. No se crea follow-up.");
  process.exit(0);
}

const allGaps = Array.isArray(dossier.gaps) ? dossier.gaps : Array.isArray(sourceCheckpoint.gaps) ? sourceCheckpoint.gaps : [];
const critical = allGaps.filter((g) => g?.severity === "CRITICAL");
const high = allGaps.filter((g) => g?.severity === "HIGH");
const medium = allGaps.filter((g) => g?.severity === "MEDIUM");
const eligible = critical.length ? critical : high.length ? high : medium;
if (!eligible.length) {
  console.error("[Genelibros] BLOCKED: ready=false pero no hay gaps CRITICAL/HIGH/MEDIUM accionables.");
  process.exit(5);
}

const chosenGaps = eligible.slice(0, maxQueries);
const gapQuestions = chosenGaps.map((gap, index) => ({
  id: `RGQ_${index + 1}`,
  question: gapText(gap),
  importance: String(gap?.severity || "HIGH"),
  evidenceNeeded: [
    "Primary or official evidence whenever available",
    "Exact figures, dates, periods and entity scope",
    "Evidence directly resolving this blocker",
    "Independent corroboration when the claim is material"
  ]
}));

if (gapQuestions.some((q) => !q.question)) {
  console.error("[Genelibros] BLOCKED: un gap seleccionado no tiene texto compatible (gap/question/description/text). 0 llamadas LLM.");
  process.exit(6);
}

const used = new Set();
const gapQueries = [];
function addQuery(gap, gapIndex, raw) {
  if (gapQueries.length >= maxQueries) return;
  const query = normalize(raw);
  const fingerprint = query.toLowerCase();
  if (!query || used.has(fingerprint)) return;
  used.add(fingerprint);
  gapQueries.push({
    id: `RGAP_${gapQueries.length + 1}`,
    query,
    purpose: `Targeted resume: ${gapText(gap).slice(0, 500)}`,
    questionIds: [gapQuestions[gapIndex]?.id].filter(Boolean)
  });
}

if (explicitQuery) {
  addQuery(chosenGaps[0], 0, explicitQuery);
}

// Una query por gap primero, para no gastar tres búsquedas en un solo blocker.
for (let i = 0; i < chosenGaps.length && gapQueries.length < maxQueries; i += 1) {
  const recommended = gapRecommendedQueries(chosenGaps[i]);
  addQuery(chosenGaps[i], i, recommended[0] || `${sourceJob.topic} ${gapText(chosenGaps[i])} República Dominicana fuente oficial datos`);
}
// Si quedan huecos, usar siguientes recomendaciones sin duplicar.
for (let round = 1; gapQueries.length < maxQueries && round < 5; round += 1) {
  for (let i = 0; i < chosenGaps.length && gapQueries.length < maxQueries; i += 1) {
    const recommended = gapRecommendedQueries(chosenGaps[i]);
    if (recommended[round]) addQuery(chosenGaps[i], i, recommended[round]);
  }
}
if (!gapQueries.length) {
  console.error("[Genelibros] BLOCKED: no fue posible construir queries determinísticas para los gaps.");
  process.exit(7);
}

const verifiedClaims = (dossier.claims || []).filter((c) => c?.status === "VERIFIED" && Boolean(c?.citationReady)).length;
const classABSources = (dossier.sources || []).filter((src) => src?.sourceClass === "A" || src?.sourceClass === "B").length;
const baseline = {
  coverage: Number(dossier.coverageScore || 0),
  evidence: (dossier.evidence || []).length,
  evidenceScore: Number(dossier.evidenceScore || 0),
  claims: (dossier.claims || []).length,
  verifiedClaims,
  classABSources,
  criticalGaps: critical.length,
  highGaps: high.length,
  factual: Number(dossier.factualConfidenceScore || 0)
};

const idempotencyKey = crypto.createHash("sha256").update(JSON.stringify({
  mode: "TARGETED_GAP_MICRO_ROUND_V1",
  sourceJobId,
  maxQueries,
  maxSources,
  maxCalls,
  explicitQuery: explicitQuery || null,
  gaps: chosenGaps.map((g) => ({ id: g?.id || null, severity: g?.severity || null, text: gapText(g) })),
  queries: gapQueries.map((q) => q.query)
})).digest("hex");

const { data: existing, error: existingError } = await s
  .from("research_jobs")
  .select("id,status,chapter_number,topic,progress,checkpoint,result,created_at")
  .eq("idempotency_key", idempotencyKey)
  .limit(1)
  .maybeSingle();
if (existingError) throw existingError;

console.log("\n================================================");
console.log(" GENELIBROS — TARGETED GAP RESUME");
console.log("================================================");
console.log({
  sourceJobId,
  sourceDossierId: sourceJob.result?.dossier_id || null,
  chapterNumber: sourceJob.chapter_number,
  topic: sourceJob.topic,
  previousMetrics: baseline,
  totalGaps: allGaps.length,
  priority: critical.length ? "CRITICAL" : high.length ? "HIGH" : "MEDIUM",
  eligibleGaps: eligible.length,
  selectedGaps: chosenGaps.map((g) => ({ id: g?.id || null, severity: g?.severity || null, gap: gapText(g) })),
  explicitQuery: explicitQuery || null,
  queries: gapQueries.map((q) => q.query),
  budget: { model, maxQueries, maxSources, maxCalls, firstPassOnly: true },
  llmCallsMadeByResumePreflight: 0
});

if (existing) {
  console.log("\n[Genelibros] Follow-up idempotente ya existe; no se duplica:");
  console.log({ id: existing.id, status: existing.status, progress: existing.progress, readyForWriting: existing.result?.readyForWriting ?? null });
  process.exit(0);
}
if (!enqueue) {
  console.log("\nPREFLIGHT OK. Añade --enqueue para crear la micro-ronda; todavía serán 0 llamadas LLM.");
  process.exit(0);
}

const resumeCheckpoint = {
  ...sourceCheckpoint,
  step: "GAP_DISCOVER",
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  budgetGuard: { enabled: true, firstPassOnly: true, maxCalls, maxQueries, maxSources, model },
  resume: {
    mode: "TARGETED_GAP_MICRO_ROUND_V1",
    sourceJobId,
    sourceDossierId: sourceJob.result?.dossier_id || null,
    sourceUsage: sourceCheckpoint.usage || sourceJob.result?.usage || null,
    createdAt: new Date().toISOString()
  },
  gapClosurePass: Number(sourceCheckpoint.gapClosurePass || 0) + 1,
  gapClosureStopReason: null,
  gapBaseline: baseline,
  gapQueries,
  gapQuestions,
  nextGapQueryIndex: 0,
  gapSources: [],
  gapRankedSources: [],
  nextGapExtractIndex: 0,
  nextGapEvidenceIndex: 0,
  gapEvidenceAdded: 0,
  criticalResolverActive: false,
  criticalResolverFollowupActive: false
};

const { data: job, error: insertError } = await s
  .from("research_jobs")
  .insert({
    user_id: sourceJob.user_id,
    project_id: sourceJob.project_id,
    chapter_number: sourceJob.chapter_number,
    topic: sourceJob.topic,
    objective: sourceJob.objective,
    depth: sourceJob.depth || "SUPREME",
    max_sources: maxSources,
    manual_urls: [],
    idempotency_key: idempotencyKey,
    status: "QUEUED",
    progress: 94,
    checkpoint: resumeCheckpoint
  })
  .select("id,status,chapter_number,topic,depth,max_sources,progress,checkpoint")
  .single();
if (insertError || !job) throw insertError || new Error("No se pudo crear Research targeted resume job.");

console.log("\n================================================");
console.log(" TARGETED GAP JOB ENCOLADO — 0 LLM CALLS HASTA AHORA");
console.log("================================================");
console.log({
  id: job.id,
  status: job.status,
  chapter_number: job.chapter_number,
  progress: job.progress,
  max_sources: job.max_sources,
  budgetGuard: job.checkpoint?.budgetGuard,
  gapQueries: job.checkpoint?.gapQueries?.length || 0,
  reusedSources: job.checkpoint?.rankedSources?.length || 0,
  reusedEvidence: job.checkpoint?.evidence?.length || 0,
  reusedClaims: job.checkpoint?.claims?.length || 0
});

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
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? String(args[i + 1]).trim() : fallback;
}
function argValues(name) {
  const args = process.argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1]) out.push(String(args[i + 1]).trim());
  }
  return out.filter(Boolean);
}
function hasFlag(name) { return process.argv.slice(2).includes(name); }
function clean(value) { return String(value ?? "").trim(); }
function gapText(gap) { return clean(gap?.gap || gap?.question || gap?.description || gap?.text || "").replace(/\s+/g, " "); }
function canonicalUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  return u.toString();
}
function sourceId(url) {
  return `src_${crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

const OFFICIAL_HOSTS = [
  "digepres.gob.do",
  "hacienda.gob.do",
  "mem.gob.do",
  "sie.gob.do",
  "cne.gob.do",
  "presidencia.gob.do",
  "ces.gob.do",
  "bancentral.gov.do",
  "one.gob.do",
  "oc.org.do",
  "apps.oc.org.do",
  "www.oc.org.do",
  "edesur.com.do",
  "edenorte.com.do",
  "edeeste.com.do",
];
function officialHost(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return h.endsWith(".gob.do") || h.endsWith(".gov.do") || OFFICIAL_HOSTS.some((x) => h === x.replace(/^www\./, ""));
}
function manualOfficialSource(rawUrl) {
  const url = canonicalUrl(rawUrl);
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`URL no soportada: ${url}`);
  if (!officialHost(parsed.hostname)) throw new Error(`Fuente bloqueada: host no reconocido como oficial/primario: ${parsed.hostname}`);
  return {
    id: sourceId(url),
    url,
    title: parsed.hostname,
    publisher: parsed.hostname,
    author: null,
    publishedAt: null,
    retrievedAt: new Date().toISOString(),
    sourceClass: "A",
    credibilityScore: 9.5,
    queryIds: ["OFFICIAL_DOC_DIRECT"],
    grounded: false,
    extractionStatus: "PENDING",
    extractionError: null,
  };
}

loadEnv(path.resolve(".env.local"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!supabaseUrl || !supabaseKey) throw new Error("Faltan credenciales server-side Supabase.");

const sourceJobId = argValue("--from-job", "");
if (!sourceJobId) throw new Error("Uso: --from-job <research_job_uuid> --url <official-url> [--url ...] [--enqueue]");
const rawUrls = argValues("--url");
if (!rawUrls.length) throw new Error("Debe indicar al menos un --url oficial.");
if (rawUrls.length > 6) throw new Error("Máximo 6 documentos oficiales por micro-ronda.");
const enqueue = hasFlag("--enqueue");

const directSources = Array.from(new Map(rawUrls.map((u) => {
  const src = manualOfficialSource(u);
  return [src.url, src];
})).values());
const minimumCalls = directSources.length + 5; // evidence por fuente + claims + contradictions + verify + gaps + dossier
const requestedCalls = Number(argValue("--max-calls", String(minimumCalls))) || minimumCalls;
const maxCalls = Math.max(minimumCalls, Math.min(16, requestedCalls));
const model = process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash";

const s = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: sourceJob, error: sourceError } = await s
  .from("research_jobs")
  .select("id,user_id,project_id,chapter_number,topic,objective,depth,max_sources,status,checkpoint,result")
  .eq("id", sourceJobId)
  .single();
if (sourceError || !sourceJob) throw sourceError || new Error("Research source job no encontrado.");
if (sourceJob.status !== "COMPLETED") throw new Error(`Research source job debe estar COMPLETED; está ${sourceJob.status}.`);

const sourceCheckpoint = sourceJob.checkpoint || {};
const dossier = sourceCheckpoint.dossier || null;
if (!dossier) throw new Error("El job fuente no conserva dossier en checkpoint.");
if (dossier.readyForWriting === true || sourceJob.result?.readyForWriting === true) {
  console.log("[Genelibros] El dossier fuente ya está ready_for_writing; no se crea follow-up.");
  process.exit(0);
}

const gaps = Array.isArray(dossier.gaps) ? dossier.gaps : [];
const blockers = gaps.filter((g) => ["CRITICAL", "HIGH"].includes(clean(g?.severity).toUpperCase()));
if (!blockers.length) throw new Error("No hay gaps CRITICAL/HIGH que cerrar.");
const gapQuestions = blockers.slice(0, 6).map((gap, index) => ({
  id: `ROQ_${index + 1}`,
  question: gapText(gap),
  importance: clean(gap?.severity).toUpperCase() || "HIGH",
  evidenceNeeded: [
    "Official or primary evidence",
    "Exact figures, dates, periods, units and entity scope",
    "Direct evidence that resolves the blocker",
    "Do not infer missing values",
  ],
}));

const existingSources = Array.isArray(sourceCheckpoint.rankedSources)
  ? sourceCheckpoint.rankedSources
  : Array.isArray(dossier.sources) ? dossier.sources : [];
const existingByUrl = new Set(existingSources.map((src) => {
  try { return canonicalUrl(src?.url || ""); } catch { return clean(src?.url); }
}).filter(Boolean));
const newSources = directSources.filter((src) => !existingByUrl.has(src.url));
if (!newSources.length) throw new Error("Todos los URLs oficiales ya existen en el dossier; no hay fuente nueva que procesar.");

const combinedSources = [...existingSources, ...newSources];
const idempotencyKey = crypto.createHash("sha256").update(JSON.stringify({
  mode: "OFFICIAL_DOC_DIRECT_RESUME_V1",
  sourceJobId,
  urls: newSources.map((x) => x.url).sort(),
  blockers: blockers.map((g) => ({ severity: g?.severity, text: gapText(g) })),
  maxCalls,
})).digest("hex");

const { data: existingJob, error: existingError } = await s
  .from("research_jobs")
  .select("id,status,progress,result,created_at")
  .eq("idempotency_key", idempotencyKey)
  .limit(1)
  .maybeSingle();
if (existingError) throw existingError;

console.log("\n================================================");
console.log(" GENELIBROS — OFFICIAL DOCUMENT RESUME / PREFLIGHT");
console.log("================================================");
console.log({
  sourceJobId,
  sourceDossierId: sourceJob.result?.dossier_id || null,
  chapterNumber: sourceJob.chapter_number,
  topic: sourceJob.topic,
  blockers: blockers.map((g) => ({ severity: g?.severity, gap: gapText(g) })),
  newOfficialSources: newSources.map((src) => ({ host: new URL(src.url).hostname, url: src.url, class: src.sourceClass })),
  pipelineStart: "GAP_EXTRACT",
  discoveryCalls: 0,
  extractionLlmCalls: 0,
  minimumExpectedLlmCalls: minimumCalls,
  hardCap: maxCalls,
  model,
  llmCallsMadeByPreflight: 0,
});

if (existingJob) {
  console.log("\n[Genelibros] Job oficial idempotente ya existe; no se duplica:");
  console.log(existingJob);
  process.exit(0);
}
if (!enqueue) {
  console.log("\nPREFLIGHT OK. Añade --enqueue para crear el job. Enqueue todavía consume 0 LLM.");
  process.exit(0);
}

const checkpoint = {
  ...sourceCheckpoint,
  step: "GAP_EXTRACT",
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  model,
  budgetGuard: {
    enabled: true,
    firstPassOnly: true,
    maxCalls,
    maxQueries: 1,
    maxSources: newSources.length,
    model,
  },
  resume: {
    mode: "OFFICIAL_DOC_DIRECT_RESUME_V1",
    sourceJobId,
    sourceDossierId: sourceJob.result?.dossier_id || null,
    createdAt: new Date().toISOString(),
  },
  gapClosurePass: Number(sourceCheckpoint.gapClosurePass || 0) + 1,
  gapClosureStopReason: null,
  gapQueries: [],
  gapQuestions,
  gapSources: newSources,
  gapRankedSources: newSources,
  rankedSources: combinedSources,
  nextGapQueryIndex: 0,
  nextGapExtractIndex: 0,
  nextGapEvidenceIndex: 0,
  gapEvidenceAdded: 0,
  criticalResolverActive: false,
  criticalResolverFollowupActive: false,
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
    max_sources: newSources.length,
    manual_urls: newSources.map((x) => x.url),
    idempotency_key: idempotencyKey,
    status: "QUEUED",
    progress: 94,
    checkpoint,
  })
  .select("id,status,chapter_number,topic,progress,checkpoint")
  .single();
if (insertError || !job) throw insertError || new Error("No se pudo crear official-doc Research job.");

console.log("\n================================================");
console.log(" OFFICIAL-DOC JOB ENCOLADO — 0 LLM CALLS HASTA AHORA");
console.log("================================================");
console.log({
  id: job.id,
  status: job.status,
  chapter: job.chapter_number,
  progress: job.progress,
  officialSources: newSources.length,
  blockers: gapQuestions.length,
  hardCap: job.checkpoint?.budgetGuard?.maxCalls,
  step: job.checkpoint?.step,
});

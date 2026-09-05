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
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? String(args[i + 1]).trim() : fallback;
}
function clean(v) { return String(v ?? "").trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function pick(o, keys, fallback = null) {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return fallback;
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] RESEARCH INSPECT bloqueado: faltan credenciales Supabase. 0 LLM.");
  process.exit(2);
}

const requestedDossierId = argValue("--dossier", "");
const requestedJobId = argValue("--job", "");
if (!requestedDossierId && !requestedJobId) {
  console.error("Uso: node scripts/inspect-research-dossier.mjs --dossier <uuid> | --job <uuid>");
  process.exit(3);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let job = null;
let dossierId = requestedDossierId;

if (requestedJobId) {
  const { data, error } = await s
    .from("research_jobs")
    .select("id,project_id,user_id,chapter_number,topic,status,progress,checkpoint,created_at,updated_at")
    .eq("id", requestedJobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Research job no encontrado.");
  job = data;

  if (!dossierId) {
    const { data: dossiers, error: dossierLookupError } = await s
      .from("research_dossiers")
      .select("id,created_at")
      .eq("project_id", data.project_id)
      .eq("chapter_number", data.chapter_number)
      .order("created_at", { ascending: false })
      .limit(5);
    if (dossierLookupError) throw dossierLookupError;
    dossierId = clean(dossiers?.[0]?.id);
  }
}

if (!dossierId) throw new Error("No se pudo resolver dossierId.");

const { data: dossier, error: dossierError } = await s
  .from("research_dossiers")
  .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at,created_at")
  .eq("id", dossierId)
  .maybeSingle();
if (dossierError) throw dossierError;
if (!dossier) throw new Error("Research dossier no encontrado.");

const result = dossier.result && typeof dossier.result === "object" ? dossier.result : {};
const sources = arr(result.sources);
const claims = arr(result.claims);
const gaps = arr(result.gaps);
const contradictions = arr(result.contradictions);

const sourceSummary = sources.map((src, index) => ({
  n: index + 1,
  id: pick(src, ["id", "sourceId", "source_id"]),
  class: clean(pick(src, ["sourceClass", "source_class", "class"], "?")),
  title: clean(pick(src, ["title", "name"], "")),
  publisher: clean(pick(src, ["publisher", "organization", "institution", "domain"], "")),
  url: clean(pick(src, ["url", "canonicalUrl", "canonical_url"], "")),
  verified: Boolean(pick(src, ["verified", "isVerified", "is_verified"], false)),
}));

const claimSummary = claims.map((claim, index) => ({
  n: index + 1,
  id: pick(claim, ["id", "claimId", "claim_id"]),
  status: clean(pick(claim, ["status", "verificationStatus", "verification_status"], "UNKNOWN")),
  citationReady: Boolean(pick(claim, ["citationReady", "citation_ready"], false)),
  confidence: pick(claim, ["confidence", "confidenceScore", "confidence_score"], null),
  text: clean(pick(claim, ["claim", "text", "statement"], "")),
  sourceIds: arr(pick(claim, ["sourceIds", "source_ids", "sources"], [])),
}));

const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const gapSummary = gaps.map((gap, index) => ({
  n: index + 1,
  id: pick(gap, ["id", "gapId", "gap_id"]),
  severity: clean(pick(gap, ["severity", "priority"], "UNKNOWN")).toUpperCase(),
  type: clean(pick(gap, ["type", "category", "kind"], "")),
  question: clean(pick(gap, ["question", "gap", "description", "text"], "")),
  whyItMatters: clean(pick(gap, ["whyItMatters", "why_it_matters", "reason"], "")),
  suggestedQuery: clean(pick(gap, ["suggestedQuery", "suggested_query", "query"], "")),
})).sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

const verifiedCitationReady = claimSummary.filter((c) => c.status === "VERIFIED" && c.citationReady).length;
const classAB = sourceSummary.filter((s) => ["A", "B"].includes(s.class.toUpperCase())).length;
const gapCounts = gapSummary.reduce((acc, g) => {
  acc[g.severity] = (acc[g.severity] || 0) + 1;
  return acc;
}, {});

console.log("\n================================================");
console.log(" GENELIBROS — RESEARCH DOSSIER INSPECT / READ ONLY");
console.log("================================================");
console.log({
  llmCalls: 0,
  mutations: 0,
  job: job ? {
    id: job.id,
    status: job.status,
    progress: job.progress,
    chapterNumber: job.chapter_number,
    topic: job.topic,
    usage: job.checkpoint?.usage || null,
    budgetGuard: job.checkpoint?.budgetGuard || null,
  } : null,
  dossier: {
    id: dossier.id,
    projectId: dossier.project_id,
    chapterNumber: dossier.chapter_number,
    topic: dossier.topic,
    readyForWriting: Boolean(dossier.ready_for_writing),
    coverage: Number(dossier.coverage_score || 0),
    evidence: Number(dossier.evidence_score || 0),
    factual: Number(dossier.factual_confidence_score || 0),
    completedAt: dossier.completed_at || null,
    sources: sourceSummary.length,
    classABSources: classAB,
    claims: claimSummary.length,
    verifiedCitationReady,
    gaps: gapSummary.length,
    gapCounts,
    contradictions: contradictions.length,
  },
});

console.log("\n--- SOURCES ---");
console.log(JSON.stringify(sourceSummary, null, 2));
console.log("\n--- CLAIMS ---");
console.log(JSON.stringify(claimSummary, null, 2));
console.log("\n--- GAPS ---");
console.log(JSON.stringify(gapSummary, null, 2));
if (contradictions.length) {
  console.log("\n--- CONTRADICTIONS ---");
  console.log(JSON.stringify(contradictions, null, 2));
}

console.log("\n[Genelibros] INSPECT terminado. 0 llamadas LLM | 0 mutaciones.");

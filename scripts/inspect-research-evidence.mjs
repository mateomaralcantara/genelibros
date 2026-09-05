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
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] RESEARCH EVIDENCE INSPECT bloqueado: faltan credenciales Supabase. 0 LLM.");
  process.exit(2);
}

const dossierId = argValue("--dossier", "");
if (!dossierId) {
  console.error("Uso: node scripts/inspect-research-evidence.mjs --dossier <uuid>");
  process.exit(3);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: dossier, error } = await s
  .from("research_dossiers")
  .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")
  .eq("id", dossierId)
  .maybeSingle();
if (error) throw error;
if (!dossier) throw new Error("Research dossier no encontrado.");

const result = dossier.result && typeof dossier.result === "object" ? dossier.result : {};
const sources = arr(result.sources);
const evidence = arr(result.evidence);
const sourceMap = new Map(sources.map((src) => [clean(src?.id), src]));
const confidence = evidence.map((item) => num(item?.confidenceScore));
const relevance = evidence.map((item) => num(item?.relevanceScore));
const questionIds = new Set(evidence.flatMap((item) => arr(item?.questionIds).map(clean).filter(Boolean)));
const sourceIds = new Set(evidence.map((item) => clean(item?.sourceId)).filter(Boolean));

const evidenceRows = evidence
  .map((item, index) => {
    const source = sourceMap.get(clean(item?.sourceId)) || {};
    return {
      n: index + 1,
      id: clean(item?.id),
      confidence: num(item?.confidenceScore),
      relevance: num(item?.relevanceScore),
      sourceId: clean(item?.sourceId),
      sourceClass: clean(source?.sourceClass || source?.source_class || "?"),
      sourceTitle: clean(source?.title || source?.name || ""),
      questionIds: arr(item?.questionIds),
      evidence: clean(item?.evidence),
      supports: arr(item?.supports),
      limitations: arr(item?.limitations),
    };
  })
  .sort((a, b) => b.confidence - a.confidence || b.relevance - a.relevance);

const bySource = [];
for (const sourceId of sourceIds) {
  const rows = evidenceRows.filter((row) => row.sourceId === sourceId);
  const source = sourceMap.get(sourceId) || {};
  const scores = rows.map((row) => row.confidence);
  bySource.push({
    sourceId,
    sourceClass: clean(source?.sourceClass || source?.source_class || "?"),
    title: clean(source?.title || source?.name || ""),
    url: clean(source?.url || ""),
    evidenceItems: rows.length,
    avgConfidence: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0,
    maxConfidence: scores.length ? Math.max(...scores) : 0,
    highConfidenceItems: rows.filter((row) => row.confidence >= 7.5).length,
  });
}
bySource.sort((a, b) => b.avgConfidence - a.avgConfidence);

const avg = confidence.length ? confidence.reduce((a, b) => a + b, 0) / confidence.length : 0;
const avgRel = relevance.length ? relevance.reduce((a, b) => a + b, 0) / relevance.length : 0;

console.log("\n================================================");
console.log(" GENELIBROS — RESEARCH EVIDENCE DISTRIBUTION / READ ONLY");
console.log("================================================");
console.log({
  llmCalls: 0,
  mutations: 0,
  dossierId: dossier.id,
  chapterNumber: dossier.chapter_number,
  topic: dossier.topic,
  readyForWriting: Boolean(dossier.ready_for_writing),
  storedMetrics: {
    coverage: Number(dossier.coverage_score || 0),
    evidence: Number(dossier.evidence_score || 0),
    factual: Number(dossier.factual_confidence_score || 0),
  },
  evidenceDistribution: {
    items: evidenceRows.length,
    sourcesUsed: sourceIds.size,
    questionsCovered: questionIds.size,
    averageConfidence: Number(avg.toFixed(2)),
    medianConfidence: Number(median(confidence).toFixed(2)),
    minConfidence: confidence.length ? Math.min(...confidence) : 0,
    maxConfidence: confidence.length ? Math.max(...confidence) : 0,
    averageRelevance: Number(avgRel.toFixed(2)),
    confidenceAtLeast75: evidenceRows.filter((row) => row.confidence >= 7.5).length,
    confidenceAtLeast5: evidenceRows.filter((row) => row.confidence >= 5).length,
    confidenceBelow5: evidenceRows.filter((row) => row.confidence < 5).length,
  },
});

console.log("\n--- BY SOURCE ---");
console.log(JSON.stringify(bySource, null, 2));
console.log("\n--- EVIDENCE ITEMS (HIGH → LOW CONFIDENCE) ---");
console.log(JSON.stringify(evidenceRows, null, 2));
console.log("\n[Genelibros] EVIDENCE INSPECT terminado. 0 llamadas LLM | 0 mutaciones.");

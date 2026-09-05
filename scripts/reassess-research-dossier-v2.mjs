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
function supportive(item) {
  const type = clean(item?.evidenceType).toUpperCase();
  const supports = arr(item?.supports).map(clean).filter(Boolean);
  const relevance = Math.max(0, Math.min(10, Number(item?.relevanceScore || 0)));
  const confidence = Math.max(0, Math.min(10, Number(item?.confidenceScore || 0)));
  if (type === "LIMITATION") return false;
  if (type === "SUPPORT") return supports.length > 0 && relevance >= 2 && confidence >= 2;
  return supports.length > 0 && relevance >= 3 && confidence >= 3;
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) throw new Error("Faltan credenciales server-side Supabase.");

const dossierId = argValue("--dossier", "");
if (!dossierId) throw new Error("Uso: node scripts/reassess-research-dossier-v2.mjs --dossier <uuid>");

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: dossier, error } = await s
  .from("research_dossiers")
  .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")
  .eq("id", dossierId)
  .maybeSingle();
if (error) throw error;
if (!dossier) throw new Error("Research dossier no encontrado.");

const result = dossier.result && typeof dossier.result === "object" ? dossier.result : {};
const questions = arr(result.questions);
const evidence = arr(result.evidence);
const claims = arr(result.claims);
const sources = arr(result.sources);
const gaps = arr(result.gaps);
const support = evidence.filter(supportive);
const limitation = evidence.filter((x) => !supportive(x));
const validQuestionIds = new Set(questions.map((q) => clean(q?.id)).filter(Boolean));
const covered = new Set(support.flatMap((e) => arr(e?.questionIds).map(clean).filter((id) => validQuestionIds.has(id))));
const coverage = questions.length ? Math.min(10, (covered.size / questions.length) * 10) : 0;
const evidenceScore = support.length ? support.reduce((sum, e) => sum + Number(e?.confidenceScore || 0), 0) / support.length : 0;
const factual = claims.length ? claims.reduce((sum, c) => sum + Number(c?.confidenceScore || 0), 0) / claims.length : 0;
const verified = claims.filter((c) => clean(c?.status).toUpperCase() === "VERIFIED" && Boolean(c?.citationReady));
const classAB = sources.filter((src) => ["A", "B"].includes(clean(src?.sourceClass).toUpperCase()));
const criticalHigh = gaps.filter((g) => ["CRITICAL", "HIGH"].includes(clean(g?.severity).toUpperCase()));
const productionMinimum = coverage >= 7.5 && evidenceScore >= 7.5 && factual >= 7.5 && verified.length >= 3 && classAB.length >= 2;
const researchReady = productionMinimum && criticalHigh.length === 0;

console.log("\n================================================");
console.log(" GENELIBROS — RESEARCH DOSSIER V2 REASSESS / READ ONLY");
console.log("================================================");
console.log({
  llmCalls: 0,
  mutations: 0,
  dossierId: dossier.id,
  chapterNumber: dossier.chapter_number,
  topic: dossier.topic,
  stored: {
    coverage: Number(dossier.coverage_score || 0),
    evidence: Number(dossier.evidence_score || 0),
    factual: Number(dossier.factual_confidence_score || 0),
    readyForWriting: Boolean(dossier.ready_for_writing),
  },
  v2: {
    questions: questions.length,
    supportiveEvidence: support.length,
    limitationEvidence: limitation.length,
    coverage: Number(coverage.toFixed(2)),
    evidence: Number(evidenceScore.toFixed(2)),
    factual: Number(factual.toFixed(2)),
    verifiedCitationReady: verified.length,
    classABSources: classAB.length,
    criticalHighGaps: criticalHigh.length,
    productionMinimum,
    researchReady,
  },
});

console.log("\n--- SUPPORTIVE EVIDENCE ---");
console.log(JSON.stringify(support.map((e) => ({
  id: e?.id,
  sourceId: e?.sourceId,
  confidence: Number(e?.confidenceScore || 0),
  relevance: Number(e?.relevanceScore || 0),
  questionIds: arr(e?.questionIds),
  evidence: clean(e?.evidence),
})), null, 2));

console.log("\n--- LIMITATION / ABSENCE EVIDENCE ---");
console.log(JSON.stringify(limitation.map((e) => ({
  id: e?.id,
  sourceId: e?.sourceId,
  confidence: Number(e?.confidenceScore || 0),
  relevance: Number(e?.relevanceScore || 0),
  questionIds: arr(e?.questionIds),
  evidence: clean(e?.evidence),
})), null, 2));

console.log("\n[Genelibros] REASSESS terminado. 0 llamadas LLM | 0 mutaciones.");

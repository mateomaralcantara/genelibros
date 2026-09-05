import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const BLUEPRINT_RECOVERY_VERSION = "1.0.0";
const MAX_PROVIDER_CALLS = 1;

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
function hasFlag(name) { return process.argv.slice(2).includes(name); }
function clean(value) { return String(value ?? "").trim(); }
function words(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function sha(value) { return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function safeObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
function arrayOfStrings(value, max = 12) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, max) : [];
}
function normalizeChapterTitle(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^capitulo\s+\d+\s*[:\-–—.]?\s*/i, "")
    .trim();
}
function isGenericTitle(value, chapter) {
  const raw = clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const n = normalizeChapterTitle(value);
  if (!n) return true;
  if (raw === `capitulo ${chapter}` || /^capitulo\s+\d+$/.test(raw)) return true;
  return /^(panorama general|historia y evolucion|conceptos clave|actores y dinamicas|mecanismos y procesos|casos y ejemplos|impactos y consecuencias|estrategias y herramientas|errores comunes y mitos|etica y riesgos|futuro y escenarios|plan de accion y cierre)(\b|\s|—|-)/i.test(n);
}
function outlineEntry(outline, chapter) {
  return (outline || []).find((x) => Number(x?.chapter_number ?? x?.chapterNumber ?? x?.number) === chapter) || (outline || [])[chapter - 1] || null;
}
function hasProductionBlueprint(project, chapterCount) {
  const outline = Array.isArray(project?.outline_12) ? project.outline_12 : [];
  if (outline.length < chapterCount) return false;
  for (let n = 1; n <= chapterCount; n++) {
    const item = outlineEntry(outline, n);
    const title = clean(item?.chapter_title || item?.title || item?.topic);
    if (!item || isGenericTitle(title, n)) return false;
  }
  return true;
}
function chapterExcerpt(content, max = 5500) {
  const text = clean(content);
  if (!text) return "";
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n[…]\n${text.slice(-half)}`;
}
function parseModelJson(raw) {
  const text = clean(raw).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error("Blueprint Recovery: respuesta JSON inválida.");
}
function validateBlueprint(payload, chapterCount, defaultTargetWords) {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.outline_12) ? payload.outline_12 : [];
  if (raw.length !== chapterCount) throw new Error(`Blueprint inválido: se esperaban ${chapterCount} capítulos y llegaron ${raw.length}.`);
  const byNumber = new Map();
  for (const item of raw) {
    const n = Number(item?.chapter_number ?? item?.chapterNumber ?? item?.number);
    if (!Number.isInteger(n) || n < 1 || n > chapterCount || byNumber.has(n)) throw new Error(`Blueprint inválido: chapter_number ${n}.`);
    const chapterTitle = clean(item?.chapter_title || item?.title || item?.topic).replace(/^cap[ií]tulo\s+\d+\s*[:\-–—.]?\s*/i, "");
    if (chapterTitle.length < 4 || chapterTitle.length > 120 || isGenericTitle(chapterTitle, n)) throw new Error(`Blueprint inválido: título genérico o inválido en capítulo ${n}.`);
    const chapterThesis = clean(item?.chapter_thesis || item?.thesis);
    const objective = clean(item?.objective);
    const keyPoints = arrayOfStrings(item?.key_points, 10);
    const subheads = arrayOfStrings(item?.subheads_h2, 10);
    const requiredFacts = arrayOfStrings(item?.required_facts, 12);
    const sourceNeeds = arrayOfStrings(item?.source_needs, 10);
    const contradictionChecks = arrayOfStrings(item?.contradiction_checks, 8);
    if (!chapterThesis || !objective || keyPoints.length < 3 || subheads.length < 5 || requiredFacts.length < 3 || sourceNeeds.length < 2) {
      throw new Error(`Blueprint inválido: profundidad insuficiente en capítulo ${n}.`);
    }
    byNumber.set(n, {
      id: `outline_${String(n).padStart(2, "0")}`,
      chapter_number: n,
      chapter_title: chapterTitle,
      chapter_thesis: chapterThesis,
      objective,
      key_points: keyPoints,
      subheads_h2: subheads,
      required_facts: requiredFacts,
      source_needs: sourceNeeds,
      contradiction_checks: contradictionChecks,
      tools_frameworks: arrayOfStrings(item?.tools_frameworks, 8),
      exercises: arrayOfStrings(item?.exercises, 6),
      deliverable: clean(item?.deliverable),
      transition_to_next: clean(item?.transition_to_next),
      status: "PENDING",
      target_words: Math.max(800, Number(item?.target_words || defaultTargetWords) || defaultTargetWords),
    });
  }
  return Array.from({ length: chapterCount }, (_, i) => byNumber.get(i + 1));
}

loadEnv(path.resolve(".env.local"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!supabaseUrl || !supabaseKey) {
  console.error("[Genelibros] Blueprint Recovery bloqueado: faltan credenciales server-side Supabase.");
  process.exit(2);
}

const projectId = argValue("--project", "");
const execute = hasFlag("--execute");
const retryTechnical = hasFlag("--retry-technical");
const requestedMaxCalls = Math.max(0, Number(argValue("--max-calls", "0")) || 0);
const defaultTargetWords = Math.max(800, Number(argValue("--target", "2500")) || 2500);
if (!projectId) {
  console.error("Uso: node scripts/blueprint-recovery-v1.mjs --project <uuid> [--target 2500] [--execute --max-calls 1]");
  process.exit(3);
}

const s = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: project, error: projectError } = await s
  .from("projects")
  .select("id,user_id,title,topic,audience,tone_style,outline_12,continuity_pack,chapter_count")
  .eq("id", projectId)
  .single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

const { data: sections, error: sectionsError } = await s
  .from("sections")
  .select("id,chapter_number,title,content,status,type")
  .eq("project_id", project.id)
  .eq("type", "CHAPTER")
  .order("chapter_number", { ascending: true });
if (sectionsError) throw sectionsError;

const maxSectionChapter = Math.max(0, ...(sections || []).map((x) => Number(x.chapter_number || 0)));
const existingOutline = Array.isArray(project.outline_12) ? project.outline_12 : [];
const chapterCount = Math.max(1, Number(project.chapter_count || 0) || maxSectionChapter || existingOutline.length || 12);
const blueprintReady = hasProductionBlueprint(project, chapterCount);

const { data: dossiers, error: dossierError } = await s
  .from("research_dossiers")
  .select("chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,completed_at")
  .eq("project_id", project.id)
  .order("completed_at", { ascending: false, nullsFirst: false })
  .limit(200);
if (dossierError) throw dossierError;
const latestDossier = new Map();
for (const d of dossiers || []) if (!latestDossier.has(Number(d.chapter_number || 0))) latestDossier.set(Number(d.chapter_number || 0), d);

const chaptersContext = (sections || []).map((section) => {
  const n = Number(section.chapter_number || 0);
  const dossier = latestDossier.get(n) || null;
  return {
    chapter_number: n,
    current_title: section.title,
    words: words(section.content),
    content_excerpt: chapterExcerpt(section.content),
    latest_research_topic: dossier?.topic || null,
    research_metrics: dossier ? {
      coverage: dossier.coverage_score,
      evidence: dossier.evidence_score,
      factual: dossier.factual_confidence_score,
      ready: dossier.ready_for_writing,
    } : null,
  };
});

const fingerprint = sha(JSON.stringify({
  project: { id: project.id, title: project.title, topic: project.topic, audience: project.audience, tone: project.tone_style, chapterCount },
  chapters: chaptersContext.map((x) => ({ n: x.chapter_number, title: x.current_title, words: x.words, contentHash: sha(x.content_excerpt), researchTopic: x.latest_research_topic })),
}));
const continuity = safeObject(project.continuity_pack);
const priorRecovery = safeObject(continuity.blueprintRecovery);

console.log("\n================================================");
console.log(" GENELIBROS — BLUEPRINT RECOVERY V1");
console.log("================================================");
console.log({
  version: BLUEPRINT_RECOVERY_VERSION,
  projectId: project.id,
  project: project.title,
  chapterCount,
  existingOutlineCount: existingOutline.length,
  blueprintReady,
  execute,
  maxProviderCalls: blueprintReady ? 0 : MAX_PROVIDER_CALLS,
  requestedMaxCalls: execute ? requestedMaxCalls : null,
  llmCallsMadeByPreflight: 0,
  mutationBeforeExecute: 0,
  priorRecovery: priorRecovery?.fingerprint === fingerprint ? priorRecovery : null,
});

if (blueprintReady) {
  console.log("\nBLUEPRINT READY — no se consume LLM ni se modifica el proyecto.");
  process.exit(0);
}
if (!execute) {
  console.log("\nBLUEPRINT REQUIRED — PREFLIGHT OK, 0 LLM / 0 mutaciones.");
  console.log("Ejecuta con --execute --max-calls 1 para una única reconstrucción editorial.");
  process.exit(0);
}
if (requestedMaxCalls < MAX_PROVIDER_CALLS) {
  console.error("\nBLOCKED: Blueprint Recovery requiere presupuesto explícito --max-calls 1. 0 LLM.");
  process.exit(4);
}
if (priorRecovery?.fingerprint === fingerprint && Number(priorRecovery?.providerInvocations || 0) >= 1 && clean(priorRecovery?.status).toUpperCase() !== "COMPLETED" && !retryTechnical) {
  console.error("\nBLOCKED: ya hubo una invocación Blueprint para este fingerprint. Usa --retry-technical solo tras diagnosticar un fallo técnico.");
  process.exit(5);
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
if (!apiKey) {
  console.error("\nBLOCKED: falta GEMINI_API_KEY/GOOGLE_API_KEY/VITE_GEMINI_API_KEY. 0 LLM.");
  process.exit(6);
}
const model = process.env.BLUEPRINT_MODEL || process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash";

const reservedAt = new Date().toISOString();
const reservedRecovery = {
  version: BLUEPRINT_RECOVERY_VERSION,
  fingerprint,
  status: "INVOKING",
  providerInvocations: Number(priorRecovery?.fingerprint === fingerprint ? priorRecovery?.providerInvocations || 0 : 0) + 1,
  maxProviderCalls: MAX_PROVIDER_CALLS,
  model,
  reservedAt,
  completedAt: null,
  error: null,
};
const { error: reserveError } = await s.from("projects").update({
  continuity_pack: { ...continuity, blueprintRecovery: reservedRecovery },
  updated_at: reservedAt,
}).eq("id", project.id).eq("user_id", project.user_id);
if (reserveError) throw reserveError;

const prompt = `
Eres el arquitecto editorial de GENELIBROS BLUEPRINT RECOVERY V1.

OBJETIVO
Reconstruye el blueprint completo de un libro de ${chapterCount} capítulos cuya base de datos perdió el outline editorial. No escribas los capítulos. No inventes hechos. Solo organiza la arquitectura editorial.

REGLAS CRÍTICAS
1. Devuelve SOLO JSON válido con la forma {"outline_12":[...]}.
2. Deben existir exactamente ${chapterCount} capítulos, numerados 1..${chapterCount} sin duplicados.
3. No uses títulos genéricos como "Panorama general", "Conceptos clave", "Actores y dinámicas", "Casos y ejemplos", "Futuro y escenarios" ni equivalentes vacíos.
4. Los capítulos que YA TIENEN CONTENIDO son anclas cerradas: infiere un título editorial fiel a ese contenido, pero NO propongas reescribirlo ni cambies su alcance factual.
5. Usa los topics de Research existentes como anclas adicionales cuando aparezcan.
6. Los capítulos vacíos deben cubrir el resto de la promesa del libro sin duplicar capítulos ya escritos.
7. Para cada capítulo incluye: chapter_number, chapter_title, chapter_thesis, objective, key_points (3-8), subheads_h2 (5-10), required_facts (3-10), source_needs (2-8), contradiction_checks (0-6), tools_frameworks, exercises, deliverable, transition_to_next, target_words.
8. required_facts y source_needs describen QUÉ verificar; no afirmes que esos hechos ya están comprobados.
9. Mantén neutralidad política y separación entre HECHO, EVIDENCIA, INTERPRETACIÓN, ESTIMACIÓN, PROYECCIÓN, PROPUESTA y CONTROVERSIA cuando el brief lo exija.
10. Prioriza continuidad: cada capítulo debe justificar por qué existe y cómo evita redundancia con los anteriores.

PROYECTO
${JSON.stringify({
  title: project.title,
  topic: clean(project.topic).slice(0, 18000),
  audience: project.audience,
  tone_style: project.tone_style,
  chapter_count: chapterCount,
}, null, 2)}

CAPÍTULOS ACTUALES / ANCLAS
${JSON.stringify(chaptersContext, null, 2)}
`.trim();

try {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
    },
  });
  const parsed = parseModelJson(response.text || "");
  const outline = validateBlueprint(parsed, chapterCount, defaultTargetWords);
  const completedAt = new Date().toISOString();
  const usage = response?.usageMetadata || null;
  const completeRecovery = {
    ...reservedRecovery,
    status: "COMPLETED",
    completedAt,
    usage,
    outlineHash: sha(JSON.stringify(outline)),
  };
  const { error: saveError } = await s.from("projects").update({
    outline_12: outline,
    continuity_pack: { ...continuity, blueprintRecovery: completeRecovery },
    updated_at: completedAt,
  }).eq("id", project.id).eq("user_id", project.user_id);
  if (saveError) throw saveError;

  console.log("\n================================================");
  console.log(" BLUEPRINT RECOVERY COMPLETED");
  console.log("================================================");
  console.log({
    projectId: project.id,
    chapters: outline.length,
    providerCalls: 1,
    model,
    usage,
    outlineHash: completeRecovery.outlineHash,
  });
  console.log("\nOUTLINE TITLES");
  for (const item of outline) console.log(`${item.chapter_number}. ${item.chapter_title}`);
} catch (error) {
  const failedAt = new Date().toISOString();
  const message = clean(error?.message || error).slice(0, 1200);
  await s.from("projects").update({
    continuity_pack: {
      ...continuity,
      blueprintRecovery: { ...reservedRecovery, status: "FAILED", failedAt, error: message },
    },
    updated_at: failedAt,
  }).eq("id", project.id).eq("user_id", project.user_id);
  console.error(`\nBLUEPRINT RECOVERY FAILED after exactly 1 provider invocation: ${message}`);
  process.exit(7);
}

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
function clean(v) { return String(v ?? "").trim(); }
function hash(v) { return crypto.createHash("sha256").update(String(v || ""), "utf8").digest("hex"); }
function words(v) { return clean(v).split(/\s+/).filter(Boolean).length; }

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] APPLY bloqueado: faltan credenciales Supabase.");
  process.exit(2);
}

const DOSSIER_ID = "9ba3ef8e-f4ea-46c4-913d-42173b5ebcb2";
const FINAL_MARKER = `FINAL_CH3_DOSSIER:${DOSSIER_ID}`;
const FINAL_TITLE = "Qué funciona, qué no y qué podría funcionar";
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: jobs, error: jobsError } = await s
  .from("deep_work_jobs")
  .select("id,user_id,project_id,section_id,chapter_number,status,objective,result,updated_at")
  .eq("chapter_number", 3)
  .order("created_at", { ascending: false })
  .limit(20);
if (jobsError) throw jobsError;
const job = (jobs || []).find((row) => clean(row.objective).includes(FINAL_MARKER));
if (!job) {
  console.error("[Genelibros] APPLY bloqueado: no existe job final del Capítulo 3.");
  process.exit(3);
}
if (job.status !== "COMPLETED") {
  console.error(`[Genelibros] APPLY bloqueado: job ${job.id} está ${job.status}, no COMPLETED.`);
  process.exit(4);
}

const result = job.result && typeof job.result === "object" ? job.result : {};
const quality = result.quality && typeof result.quality === "object" ? result.quality : {};
const score = Number(quality.overallScore || 0);
const verdict = clean(quality.verdict);
const content = clean(result.finalCandidate?.content);
if (verdict !== "APPROVED" || score < 9.3 || result.applyAllowed !== true) {
  console.error("[Genelibros] NO APLICADO: QUALITY no autorizó publicación.");
  console.error({ jobId: job.id, score, verdict, applyAllowed: result.applyAllowed ?? false, calls: result.usage?.calls ?? null });
  process.exit(5);
}
if (!content) {
  console.error("[Genelibros] APPLY bloqueado: finalCandidate vacío.");
  process.exit(6);
}
const wc = words(content);
if (wc < 2300 || wc > 2700) {
  console.error(`[Genelibros] APPLY bloqueado por longitud: ${wc} palabras; rango 2300-2700.`);
  process.exit(7);
}
if (!job.section_id) {
  console.error("[Genelibros] APPLY bloqueado: job sin section_id.");
  process.exit(8);
}

const { data: section, error: sectionError } = await s
  .from("sections")
  .select("id,title,content,chapter_number,project_id")
  .eq("id", job.section_id)
  .eq("project_id", job.project_id)
  .single();
if (sectionError || !section) throw sectionError || new Error("Sección del Capítulo 3 no encontrada.");

if (result.sourceHash && hash(section.content || "") !== result.sourceHash) {
  console.error("[Genelibros] APPLY bloqueado: SOURCE_CHANGED; el Capítulo 3 cambió desde el inicio del job.");
  process.exit(9);
}

const backupDir = path.resolve("exports", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupBase = path.join(backupDir, `chapter-3-before-approved-final-${stamp}`);
fs.writeFileSync(`${backupBase}.txt`, String(section.content || ""), "utf8");
fs.writeFileSync(`${backupBase}.json`, JSON.stringify({
  jobId: job.id,
  dossierId: DOSSIER_ID,
  previousTitle: section.title,
  previousHash: hash(section.content || ""),
  newHash: hash(content),
  qualityScore: score,
  verdict,
  words: wc,
  backedUpAt: new Date().toISOString(),
}, null, 2), "utf8");

const { data: updated, error: updateError } = await s
  .from("sections")
  .update({ title: FINAL_TITLE, content })
  .eq("id", section.id)
  .eq("project_id", job.project_id)
  .select("id,title,chapter_number,content")
  .single();
if (updateError || !updated) throw updateError || new Error("No se pudo aplicar el Capítulo 3.");

console.log("\n================================================");
console.log(" ✅ CAPÍTULO 3 APLICADO AL LIBRO");
console.log("================================================");
console.log({
  jobId: job.id,
  dossierId: DOSSIER_ID,
  sectionId: updated.id,
  title: updated.title,
  words: words(updated.content),
  qualityScore: score,
  verdict,
  contentHash: hash(updated.content),
  backup: backupBase,
});

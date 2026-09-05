import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
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
function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? clean(args[i + 1]) : fallback;
}
function hasFlag(name) { return process.argv.slice(2).includes(name); }
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
  if (!n || raw === `capitulo ${chapter}` || /^capitulo\s+\d+$/.test(raw)) return true;
  return /^(panorama general|historia y evolucion|conceptos clave|actores y dinamicas|mecanismos y procesos|casos y ejemplos|impactos y consecuencias|estrategias y herramientas|errores comunes y mitos|etica y riesgos|futuro y escenarios|plan de accion y cierre)(\b|\s|—|-)/i.test(n);
}
function needsBlueprint(project, chapterCount) {
  const outline = Array.isArray(project?.outline_12) ? project.outline_12 : [];
  if (outline.length < chapterCount) return true;
  for (let n = 1; n <= chapterCount; n++) {
    const item = outline.find((x) => Number(x?.chapter_number ?? x?.chapterNumber ?? x?.number) === n) || outline[n - 1];
    const title = clean(item?.chapter_title || item?.title || item?.topic);
    if (!item || isGenericTitle(title, n)) return true;
  }
  return false;
}
function runNode(script, args = []) {
  console.log(`\n[Genelibros] > node ${script} ${args.join(" ")}`.trim());
  const r = spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}
function forwardedUniversalArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--blueprint-max-calls") { i += 1; continue; }
    if (args[i] === "--blueprint-retry-technical") continue;
    out.push(args[i]);
  }
  return out;
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) {
  console.error("[Genelibros] Final Book bloqueado: faltan credenciales server-side Supabase.");
  process.exit(2);
}

const args = process.argv.slice(2);
const projectId = argValue("--project", "");
const execute = hasFlag("--execute");
const blueprintMaxCalls = Math.max(0, Number(argValue("--blueprint-max-calls", "0")) || 0);
const blueprintRetryTechnical = hasFlag("--blueprint-retry-technical");
const target = Math.max(800, Number(argValue("--target", "2500")) || 2500);
if (!projectId) {
  console.error("Uso: node scripts/run-genelibros-book-final-v1.mjs --project <uuid> --from N --to N --target 2500 [--execute --blueprint-max-calls 1 ...budgets Universal Book]");
  process.exit(3);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: project, error: projectError } = await s.from("projects").select("id,title,outline_12,chapter_count").eq("id", projectId).single();
if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");
const { data: sections, error: sectionError } = await s.from("sections").select("chapter_number,type").eq("project_id", project.id).eq("type", "CHAPTER");
if (sectionError) throw sectionError;
const chapterCount = Math.max(1, Number(project.chapter_count || 0) || Math.max(0, ...(sections || []).map((x) => Number(x.chapter_number || 0))) || 12);
const blueprintRequired = needsBlueprint(project, chapterCount);

console.log("\n================================================");
console.log(" GENELIBROS — FINAL BOOK RUNNER V1");
console.log(" Blueprint → Research → Production → Quality → Apply");
console.log("================================================");
console.log({
  projectId: project.id,
  project: project.title,
  execute,
  chapterCount,
  blueprintRequired,
  blueprintPolicy: {
    maxCalls: blueprintRequired ? 1 : 0,
    requestedBudget: execute ? blueprintMaxCalls : null,
    automaticRetry: false,
  },
  llmCallsMadeByPreflight: 0,
});

if (blueprintRequired) {
  runNode("scripts/blueprint-recovery-v1.mjs", ["--project", project.id, "--target", String(target)]);
  if (!execute) {
    console.log("\nBLUEPRINT_REQUIRED — preflight detenido antes de Research. 0 LLM.");
    console.log("Para ejecutar el libro completo, añade --execute --blueprint-max-calls 1 junto a los presupuestos Research/Production.");
    process.exit(0);
  }
  if (blueprintMaxCalls < 1) {
    console.error("\nBLOCKED: falta presupuesto explícito --blueprint-max-calls 1. Research y Production no iniciaron.");
    process.exit(4);
  }
  const blueprintArgs = ["--project", project.id, "--target", String(target), "--max-calls", "1", "--execute"];
  if (blueprintRetryTechnical) blueprintArgs.push("--retry-technical");
  runNode("scripts/blueprint-recovery-v1.mjs", blueprintArgs);
}

console.log("\n[Genelibros] Blueprint listo. Delegando al Universal Book V1 existente.");
runNode("scripts/run-deep-production-book-universal-v1.mjs", forwardedUniversalArgs(args));

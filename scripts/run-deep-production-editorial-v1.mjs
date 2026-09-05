import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  MIN_RESEARCH_COVERAGE,
  MIN_RESEARCH_EVIDENCE,
  MIN_RESEARCH_FACTUAL,
  MIN_VERIFIED_CLAIMS,
  MIN_CLASS_AB_SOURCES,
  clean,
} from "./deep-production-v1-contract.mjs";

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
function metrics(dossier) {
  const payload = dossier?.result && typeof dossier.result === "object" ? dossier.result : {};
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const verifiedClaims = claims.filter((c) => clean(c?.status).toUpperCase() === "VERIFIED" && Boolean(c?.citationReady)).length;
  const classABSources = sources.filter((s) => ["A", "B"].includes(clean(s?.sourceClass).toUpperCase())).length;
  return {
    coverage: Number(dossier?.coverage_score || 0),
    evidence: Number(dossier?.evidence_score || 0),
    factual: Number(dossier?.factual_confidence_score || 0),
    verifiedClaims,
    classABSources,
    gaps: Array.isArray(payload.gaps) ? payload.gaps.length : 0,
    criticalHighGaps: Array.isArray(payload.gaps)
      ? payload.gaps.filter((g) => ["CRITICAL", "HIGH"].includes(clean(g?.severity).toUpperCase())).length
      : 0,
  };
}
function meetsMinimum(m) {
  return m.coverage >= MIN_RESEARCH_COVERAGE &&
    m.evidence >= MIN_RESEARCH_EVIDENCE &&
    m.factual >= MIN_RESEARCH_FACTUAL &&
    m.verifiedClaims >= MIN_VERIFIED_CLAIMS &&
    m.classABSources >= MIN_CLASS_AB_SOURCES;
}

loadEnv(path.resolve(".env.local"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
if (!url || !key) throw new Error("Faltan credenciales server-side Supabase.");

const projectId = argValue("--project", "");
const chapter = Math.max(1, Number(argValue("--chapter", "0")) || 0);
const target = Math.max(500, Math.min(12000, Number(argValue("--target", "2500")) || 2500));
const execute = hasFlag("--execute");
if (!projectId || !chapter) throw new Error("Uso: --project <uuid> --chapter <n> [--target 2500] [--execute]");

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: dossiers, error } = await s
  .from("research_dossiers")
  .select("id,project_id,chapter_number,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,model,completed_at,created_at")
  .eq("project_id", projectId)
  .eq("chapter_number", chapter)
  .order("completed_at", { ascending: false, nullsFirst: false })
  .limit(30);
if (error) throw error;

const evaluated = (dossiers || []).map((d) => ({ dossier: d, metrics: metrics(d) }));
const eligible = evaluated.filter((x) => meetsMinimum(x.metrics));
const selected = eligible.find((x) => x.dossier.ready_for_writing === true) || eligible[0] || null;

console.log("\n================================================");
console.log(" GENELIBROS — PRODUCTION V1 DOSSIER SELECTOR");
console.log("================================================");
console.log({
  projectId,
  chapter,
  target,
  execute,
  dossiersInspected: evaluated.length,
  eligibleDossiers: eligible.length,
  minimums: {
    coverage: MIN_RESEARCH_COVERAGE,
    evidence: MIN_RESEARCH_EVIDENCE,
    factual: MIN_RESEARCH_FACTUAL,
    verifiedClaims: MIN_VERIFIED_CLAIMS,
    classABSources: MIN_CLASS_AB_SOURCES,
  },
  selected: selected ? {
    dossierId: selected.dossier.id,
    topic: selected.dossier.topic,
    readyForWriting: Boolean(selected.dossier.ready_for_writing),
    editorialOverride: selected.dossier.ready_for_writing !== true,
    model: selected.dossier.model,
    completedAt: selected.dossier.completed_at,
    metrics: selected.metrics,
  } : null,
  llmCallsMadeBySelector: 0,
});

if (!selected) {
  console.error("[Genelibros] BLOCKED: ningún dossier alcanza el contrato mínimo Production V1.");
  process.exit(3);
}
if (!execute) {
  console.log("\nPREFLIGHT OK — 0 LLM. Añade --execute para ejecutar Production V1 con el dossier seleccionado.");
  process.exit(0);
}

const args = [
  "scripts/run-deep-production-v1.mjs",
  "--project", projectId,
  "--chapter", String(chapter),
  "--target", String(target),
  "--dossier", selected.dossier.id,
  "--execute",
];
if (selected.dossier.ready_for_writing !== true) args.push("--allow-editorial-override");

console.log(`\n[Genelibros] Ejecutando Production V1 con dossier ${selected.dossier.id}${selected.dossier.ready_for_writing !== true ? " + editorial override" : ""}.`);
const run = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env, cwd: process.cwd() });
process.exit(run.status ?? 1);

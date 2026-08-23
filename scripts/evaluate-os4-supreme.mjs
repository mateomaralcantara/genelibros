#!/usr/bin/env node
/**
 * BestSeller OS4 Supreme Evaluator v2
 * PRESENTE -> INTEGRADO -> PROBADO -> PRODUCCIÓN
 *
 * Uso:
 *   node scripts/evaluate-os4-supreme.mjs
 *   node scripts/evaluate-os4-supreme.mjs --full
 *   node scripts/evaluate-os4-supreme.mjs --full --strict
 *
 * Salida:
 *   reports/os4-supreme-evaluation.txt
 *   reports/os4-supreme-evaluation.json
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const FULL = args.has("--full");
const STRICT = args.has("--strict");
const JSON_ONLY = args.has("--json");

const R = (p) => {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
  catch { return ""; }
};
const E = (p) => fs.existsSync(path.join(ROOT, p));
const H = (p, needle) => needle instanceof RegExp ? needle.test(R(p)) : R(p).includes(String(needle));
const A = (p, list) => list.every((x) => H(p, x));
const N = (x, d = 0) => Number.isFinite(Number(x)) ? Number(x) : d;
const C = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
const F = (x) => Math.round(x * 10) / 10;

function run(command, timeout = 240000) {
  const t = Date.now();
  try {
    const stdout = execSync(command, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      env: process.env,
    });
    return { ok: true, command, ms: Date.now() - t, stdout: String(stdout || "").slice(-8000), stderr: "" };
  } catch (e) {
    return {
      ok: false,
      command,
      ms: Date.now() - t,
      stdout: String(e?.stdout || "").slice(-8000),
      stderr: String(e?.stderr || e?.message || e).slice(-8000),
    };
  }
}

let pkg = {};
try { pkg = JSON.parse(R("package.json")); } catch {}

const app = R("App.tsx");
const api = R("api/os4.ts");
const ui = R("components/AutonomousPublishingOS.tsx");
const orch = R("src/lib/os4/orchestrator.ts");
const repo = R("src/lib/os4/repo.ts");
const quality = R("src/lib/os4/quality.ts");
const config = R("src/lib/os4/config.ts");
const types = R("src/lib/os4/types.ts");
const research = R("api/research.ts");
const composer = R("api/composer.ts");
const gemini = R("src/lib/gemini.ts");
const sql = R("sql/bestseller-os4-schema.sql");
const baseRepo = R("src/data/repo.ts");
let workerProof = {};
try { workerProof = JSON.parse(R("reports/os4-worker-production-proof.json") || "{}"); } catch {}
const workerLiveVerified =
  workerProof?.verified === true &&
  workerProof?.scheduler_verified === true &&
  workerProof?.lease_verified === true &&
  workerProof?.completed_status === "COMPLETED";

const runtime = {
  typecheck: null,
  build: null,
  os4test: null,
  test: null,
  audit: null,
};

if (FULL) {
  runtime.typecheck = run("npm run typecheck");
  runtime.build = run("npm run build", 300000);
  runtime.os4test = pkg?.scripts?.["os4:test"] ? run("npm run os4:test") : { ok:false, command:"npm run os4:test", ms:0, stdout:"", stderr:"No existe os4:test" };
  runtime.test = pkg?.scripts?.test ? run("npm test") : null;
  runtime.audit = run("npm audit --audit-level=high");
}

const pass = {
  typecheck: !!runtime.typecheck?.ok,
  build: !!runtime.build?.ok,
  os4test: !!runtime.os4test?.ok,
  test: !!runtime.test?.ok,
  audit: !!runtime.audit?.ok,
};

const LEVEL = { ABSENT:0, PRESENT:1, INTEGRATED:2, TESTED:3, PRODUCTION:4 };
const LABEL = ["AUSENTE","PRESENTE","INTEGRADO","PROBADO","PRODUCCIÓN"];

function check(o) {
  let level = 0;
  if (o.present) level = 1;
  if (o.present && o.integrated) level = 2;
  if (o.present && o.integrated && o.tested) level = 3;
  if (o.present && o.integrated && o.tested && o.production) level = 4;
  return {
    ...o,
    level,
    level_label: LABEL[level],
    score: F((level / 4) * 10),
    ratio: level / 4,
  };
}

function category(name, weight, checks, recommendation) {
  const w = checks.reduce((s,c) => s + c.weight, 0) || 1;
  let score = 10 * checks.reduce((s,c) => s + c.ratio * c.weight, 0) / w;

  const critical = checks.filter((c) => c.critical);
  if (critical.length) {
    const min = Math.min(...critical.map((c) => c.level));
    if (min === 0) score = Math.min(score, 5.5);
    if (min === 1) score = Math.min(score, 7.0);
    if (min === 2) score = Math.min(score, 8.8);
    if (min === 3) score = Math.min(score, 9.6);
  }

  return { name, weight, score:F(C(score)), checks, recommendation };
}

const agents = [
  "MARKET_STRATEGIST","CONCEPT_ARENA","AUTHOR_DNA_ANALYST","BOOK_ARCHITECT",
  "RESEARCH_DIRECTOR","KNOWLEDGE_ENGINEER","BOOK_SIMULATOR","CHIEF_EDITOR",
  "FACT_CHECKER","CONTINUITY_EDITOR","STYLE_EDITOR","ADVERSARIAL_CRITIC",
  "QUALITY_JUDGE","REWRITE_EDITOR","MASTER_EDITOR","PUBLISHING_DIRECTOR",
  "LAUNCH_STRATEGIST","PORTFOLIO_ANALYST"
];
const presentAgents = agents.filter((a) => api.includes(a));
const calledAgents = agents.filter((a) => orch.includes(`agent: "${a}"`) || orch.includes(`agent:'${a}'`) || orch.includes(`agent: '${a}'`));

const cats = [];

cats.push(category("Integración viva y Mission Control", 9, [
  check({
    label:"AutonomousPublishingOS importado y renderizado",
    weight:3, critical:true,
    present:E("components/AutonomousPublishingOS.tsx"),
    integrated:/import\s+AutonomousPublishingOS/.test(app) && app.includes("<AutonomousPublishingOS"),
    tested:pass.build, production:pass.build && pass.typecheck,
  }),
  check({
    label:"Pestaña SUPREME OS conectada a viewMode",
    weight:2, critical:true,
    present:ui.includes("SUPREME CONTROL CENTER"),
    integrated:app.includes('"plan" | "book" | "os4"') && app.includes('viewMode === "os4"') && app.includes('setViewMode("os4")'),
    tested:pass.build, production:pass.build && pass.typecheck,
  }),
  check({
    label:"Telemetría, scores y pipeline visibles",
    weight:1,
    present:A("components/AutonomousPublishingOS.tsx",["Telemetría editorial","Pipeline Autónomo"]),
    integrated:ui.includes("getOs4Profile") && ui.includes("listOs4QualityReports"),
    tested:pass.os4test || pass.build, production:pass.os4test && pass.build,
  }),
], "Mantener SUPREME OS como centro único de operación editorial autónoma."));

cats.push(category("Preproducción autónoma", 10, [
  check({
    label:"Market Intelligence",
    weight:1, critical:true,
    present:api.includes("MARKET_STRATEGIST"),
    integrated:orch.includes('action: "ANALYZE_MARKET"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Concept Battle Arena",
    weight:1,
    present:api.includes("CONCEPT_ARENA"),
    integrated:orch.includes('action: "BATTLE_CONCEPTS"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Author DNA",
    weight:1,
    present:api.includes("AUTHOR_DNA_ANALYST"),
    integrated:orch.includes('action: "ANALYZE_AUTHOR_DNA"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Blueprint Maestro con score mínimo",
    weight:2, critical:true,
    present:types.includes("Os4Blueprint") && api.includes("BOOK_ARCHITECT"),
    integrated:orch.includes('action: "BUILD_SUPREME_BLUEPRINT"') && orch.includes("blueprintApproval"),
    tested:pass.os4test, production:pass.os4test && pass.build && pass.typecheck,
  }),
  check({
    label:"Book Simulator + Chief Editor",
    weight:2, critical:true,
    present:api.includes("BOOK_SIMULATOR") && api.includes("CHIEF_EDITOR"),
    integrated:orch.includes('action: "SIMULATE_BOOK"') && orch.includes('action: "APPROVE_PREPRODUCTION"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "No iniciar escritura si Blueprint/Chief Gate no alcanzan el estándar definido."));

cats.push(category("Research, fuentes y grounding", 10, [
  check({
    label:"/api/research hace fetch/extracción real",
    weight:2, critical:true,
    present:E("api/research.ts"),
    integrated:research.includes("fetch(") && /extractHtml|stripHtml/.test(research),
    tested:pass.test || pass.os4test, production:pass.build && pass.typecheck,
  }),
  check({
    label:"Research Director crea plan por capítulo",
    weight:2, critical:true,
    present:api.includes("RESEARCH_DIRECTOR"),
    integrated:orch.includes('action: "BUILD_RESEARCH_PLAN"') && orch.includes("collectResearch("),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Research context llega al writer",
    weight:2, critical:true,
    present:gemini.includes("research_context") || composer.includes("research_context"),
    integrated:orch.includes("stateForComposer.research_context") && orch.includes("callComposer"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Confiabilidad/cobertura de fuentes",
    weight:1,
    present:research.includes("reliability_score"),
    integrated:orch.includes("coverage_score"),
    tested:pass.os4test || pass.test, production:pass.build,
  }),
], "En producción, conectar un search provider real y conservar URLs manuales como fallback."));

cats.push(category("Knowledge Graph, claims y contradicciones", 8, [
  check({
    label:"Knowledge Graph generado",
    weight:2, critical:true,
    present:types.includes("Os4KnowledgeGraph") && api.includes("KNOWLEDGE_ENGINEER"),
    integrated:orch.includes('action: "BUILD_KNOWLEDGE_GRAPH"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Contradiction Engine",
    weight:1,
    present:types.includes("contradictions"),
    integrated:orch.includes("knowledgeGraph.contradictions") || orch.includes("knowledge_graph"),
    tested:pass.os4test, production:pass.build,
  }),
  check({
    label:"Ledger de claims persistido",
    weight:2, critical:true,
    present:sql.includes("public.os4_claims"),
    integrated:repo.includes("replaceOs4Claims") && orch.includes("replaceOs4Claims("),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "Bloquear publicación cuando existan claims de alto riesgo REJECTED/UNVERIFIED."));

cats.push(category("Consejo editorial multiagente", 10, [
  check({
    label:`Agentes definidos/invocados (${presentAgents.length}/${calledAgents.length})`,
    weight:2, critical:true,
    present:presentAgents.length >= 15,
    integrated:calledAgents.length >= 12,
    tested:pass.os4test, production:pass.os4test && pass.build,
    note:`Esperados ${agents.length}. Definidos ${presentAgents.length}. Invocados ${calledAgents.length}.`,
  }),
  check({
    label:"Fact + Continuity + Style + Adversarial en paralelo",
    weight:2, critical:true,
    present:["FACT_CHECKER","CONTINUITY_EDITOR","STYLE_EDITOR","ADVERSARIAL_CRITIC"].every((x) => api.includes(x)),
    integrated:orch.includes("Promise.all([") && orch.includes('"FACT_CHECKER"') && orch.includes('"ADVERSARIAL_CRITIC"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Quality Judge independiente",
    weight:1, critical:true,
    present:api.includes("QUALITY_JUDGE"),
    integrated:orch.includes('action: "JUDGE_COUNCIL"'),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "Evitar que el mismo agente redacte y se autoapruebe."));

cats.push(category("Quality Gate y repair loop", 10, [
  check({
    label:"Quality 11D + señales deterministas",
    weight:2,
    present:types.includes("Os4QualityDimensions") && quality.includes("deterministicChapterSignals"),
    integrated:quality.includes("buildQualityReport"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Umbrales duros factuality/continuity/global",
    weight:2, critical:true,
    present:config.includes("chapterApproval") && config.includes("factualityMinimum") && config.includes("continuityMinimum"),
    integrated:quality.includes("OS4_THRESHOLDS.chapterApproval"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Repair loop automático con REWRITE_EDITOR",
    weight:2, critical:true,
    present:api.includes("REWRITE_EDITOR"),
    integrated:orch.includes('action: "REWRITE_CHAPTER"') && orch.includes("maxRepairIterations") && /for\s*\(\s*let iteration/.test(orch),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "No aprobar por promedio cuando factuality o continuity estén debajo del mínimo."));

cats.push(category("Persistencia, versionado y reanudación", 8, [
  check({
    label:"os4_profiles persiste estado del pipeline",
    weight:2, critical:true,
    present:sql.includes("os4_profiles"),
    integrated:repo.includes("patchOs4Profile") && orch.includes("patchOs4Profile"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Versionado de capítulos y master",
    weight:2, critical:true,
    present:baseRepo.includes("insertSectionVersion") && baseRepo.includes("insertMasterSnapshot"),
    integrated:orch.includes("insertSectionVersion") && orch.includes("insertMasterSnapshot"),
    tested:pass.build, production:pass.build && pass.typecheck,
  }),
  check({
    label:"Resume sin regenerar capítulos aprobados",
    weight:2,
    present:repo.includes("listOs4QualityReports") && orch.includes("approvedChapters"),
    integrated:orch.includes('row?.status === "APPROVED"') && orch.includes("approvedChapters.has(n)"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "Mantener idempotencia y recuperación antes de mover el sistema a worker 24/7."));

cats.push(category("Seguridad, RLS y aislamiento", 9, [
  check({
    label:"JWT Supabase validado server-side",
    weight:2, critical:true,
    present:api.includes("getBearer") && api.includes("getUser(token)"),
    integrated:api.includes("authenticate(req)") && api.includes("authorization"),
    tested:pass.os4test, production:pass.build && pass.typecheck,
  }),
  check({
    label:"GEMINI_API_KEY solo server-side",
    weight:2, critical:true,
    present:api.includes("process.env.GEMINI_API_KEY"),
    integrated:!R("src/lib/os4/client.ts").includes("GEMINI_API_KEY"),
    tested:pass.build, production:pass.build && pass.typecheck,
  }),
  check({
    label:"RLS OS4 con auth.uid() + ownership projects",
    weight:2, critical:true,
    present:(sql.match(/enable row level security/gi) || []).length >= 5,
    integrated:sql.includes("auth.uid()") && sql.includes("projects p"),
    tested:pass.os4test, production:pass.build && pass.typecheck,
  }),
  check({
    label:"npm audit high",
    weight:1,
    present:!!pkg?.scripts?.["audit:high"],
    integrated:!!pkg?.scripts?.["audit:high"],
    tested:pass.audit, production:pass.audit,
  }),
], "Agregar presupuesto/rate limit específico para /api/os4 si aún no está centralizado."));

cats.push(category("Model routing y costos", 6, [
  check({
    label:"Routing FAST/DEEP por agente",
    weight:2, critical:true,
    present:api.includes("DEEP_MODEL") && api.includes("FAST_MODEL"),
    integrated:api.includes("DEEP_AGENTS") && api.includes("pickModel("),
    tested:pass.os4test, production:pass.build,
  }),
  check({
    label:"Tokens + latencia por agent run",
    weight:2,
    present:sql.includes("input_tokens") && sql.includes("output_tokens") && sql.includes("latency_ms"),
    integrated:repo.includes("input_tokens") && api.includes("usageMetadata"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Costo estimado calculado, no solo columna",
    weight:1,
    present:sql.includes("estimated_cost_usd"),
    integrated:/estimated_cost_usd\s*[:=]/.test(repo) || /estimated_cost_usd\s*[:=]/.test(composer),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "Calcular costo real por modelo/token y aplicar presupuesto máximo por libro."));

cats.push(category("Master, publicación y lanzamiento", 7, [
  check({
    label:"Master Editor operativo",
    weight:2, critical:true,
    present:api.includes("MASTER_EDITOR"),
    integrated:orch.includes('action: "AUDIT_MASTER"') && ui.includes("AUDITAR MASTER"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Publishing Director conectado",
    weight:1,
    present:api.includes("PUBLISHING_DIRECTOR"),
    integrated:orch.includes("PUBLISHING_DIRECTOR"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Launch System operativo",
    weight:2, critical:true,
    present:api.includes("LAUNCH_STRATEGIST"),
    integrated:orch.includes('action: "BUILD_LAUNCH_SYSTEM"') && ui.includes("CREAR LAUNCH SYSTEM"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Export PDF/DOCX/EPUB",
    weight:1,
    present:E("api/export.ts"),
    integrated:["pdf","docx","epub"].every((x) => R("api/export.ts").includes(x)),
    tested:pass.test || pass.os4test, production:pass.build,
  }),
], "Conectar Publishing Director a exportadores binarios finales y presets de publicación."));

cats.push(category("Gobernanza humana", 5, [
  check({
    label:"Approval audit trail",
    weight:1,
    present:sql.includes("os4_approvals"),
    integrated:repo.includes("saveOs4Approval") && ui.includes("saveOs4Approval"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Gate humano Approve/Reject visible",
    weight:2, critical:true,
    present:ui.includes("APROBAR GATE") && ui.includes("RECHAZAR"),
    integrated:ui.includes('profile?.status === "WAITING_APPROVAL"') && ui.includes("patchOs4Profile"),
    tested:pass.build || pass.os4test, production:pass.build && pass.typecheck,
  }),
], "Usar EDITORIAL para libros sensibles o documentalmente exigentes."));

cats.push(category("Observabilidad y audit trail", 5, [
  check({
    label:"Agent runs con trace_id",
    weight:2, critical:true,
    present:sql.includes("os4_agent_runs") && sql.includes("trace_id"),
    integrated:repo.includes("insertOs4AgentRun") && orch.includes("trackedAgent"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Pipeline events persistidos",
    weight:1,
    present:sql.includes("os4_events"),
    integrated:repo.includes("insertOs4Event") && orch.includes("emit("),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
  check({
    label:"Healthcheck",
    weight:1,
    present:E("api/health.ts"),
    integrated:/healthy|healthcheck/i.test(R("api/health.ts")),
    tested:pass.build, production:pass.build && pass.typecheck,
  }),
], "Añadir alertas externas para fallos, latencia y anomalías de costo."));

cats.push(category("Pruebas y producción técnica", 9, [
  check({
    label:"Suite OS4 específica",
    weight:2, critical:true,
    present:E("scripts/os4-tests.mjs") && !!pkg?.scripts?.["os4:test"],
    integrated:!!pkg?.scripts?.["os4:verify"],
    tested:pass.os4test, production:pass.os4test && pass.build && pass.typecheck,
  }),
  check({
    label:"TypeScript",
    weight:2, critical:true,
    present:!!pkg?.scripts?.typecheck,
    integrated:!!pkg?.scripts?.typecheck,
    tested:pass.typecheck, production:pass.typecheck,
  }),
  check({
    label:"Build producción",
    weight:2, critical:true,
    present:!!pkg?.scripts?.build,
    integrated:!!pkg?.scripts?.build,
    tested:pass.build, production:pass.build,
  }),
  check({
    label:"Tests heredados",
    weight:1,
    present:E("scripts/elite-smoke-tests.mjs") || E("scripts/elite-production-tests.mjs"),
    integrated:!!pkg?.scripts?.test,
    tested:pass.test, production:pass.test && pass.build,
  }),
], "Añadir E2E de navegador + API preview + fixtures de Supabase para cerrar la brecha de producción."));

const workerExists =
  E("api/worker.ts") || E("api/os4-worker.ts") || E("scripts/os4-worker.mjs");
const workerIntegrated =
  workerExists && (/claim.*job|process.*job|dequeue|lease|generation_jobs/i.test(
    [R("api/worker.ts"),R("api/os4-worker.ts"),R("scripts/os4-worker.mjs"),orch].join("\n")
  ));

cats.push(category("Autonomía durable 24/7", 9, [
  check({
    label:"generation_jobs existe",
    weight:1,
    present:H("sql/elite-market-10-schema.sql","generation_jobs") || H("sql/elite-research-schema.sql","generation_jobs"),
    integrated:composer.includes("generation_jobs") || orch.includes("generation_jobs"),
    tested:pass.test, production:pass.test && pass.build,
  }),
  check({
    label:"Worker durable independiente del navegador",
    weight:4, critical:true,
    present:workerExists || /worker|background/i.test(orch),
    integrated:workerIntegrated,
    tested:workerIntegrated && pass.os4test,
    production:workerLiveVerified,
    note:workerLiveVerified
      ? "Worker + scheduler verificados mediante healthcheck durable externo."
      : "PRODUCCIÓN requiere reports/os4-worker-production-proof.json generado por os4:10b:live.",
  }),
  check({
    label:"Reanudación persistente",
    weight:1,
    present:sql.includes("os4_profiles"),
    integrated:repo.includes("getOs4Profile") && orch.includes("approvedChapters"),
    tested:pass.os4test, production:pass.os4test && pass.build,
  }),
], "Para 10/10 real: worker durable + scheduler + leasing + retries idempotentes + dead-letter queue."));

const weightSum = cats.reduce((s,c) => s + c.weight, 0);
let score = 10 * cats.reduce((s,c) => s + (c.score/10)*c.weight, 0) / weightSum;

const caps = [];
const cap = (condition, max, reason) => { if (condition) caps.push({max,reason}); };

cap(!app.includes("<AutonomousPublishingOS"), 7.5, "SUPREME OS no está integrado en App.tsx.");
cap(!orch.includes('action: "REWRITE_CHAPTER"'), 9.1, "Repair loop no está conectado.");
cap(!orch.includes("replaceOs4Claims("), 9.2, "Claims de fact-check no se persisten.");
cap(FULL && !pass.typecheck, 8.5, "TypeScript falló.");
cap(FULL && !pass.build, 8.5, "Build falló.");
cap(FULL && !pass.os4test, 9.0, "Suite OS4 falló.");
cap(FULL && !pass.audit, 9.3, "npm audit high falló.");
cap(!workerIntegrated || !workerLiveVerified, 9.8, "No hay worker durable 24/7 + scheduler verificados.");

for (const x of caps) score = Math.min(score, x.max);
score = F(C(score));

function verdict(s) {
  if (s >= 9.9) return "LÍDER DE MERCADO / PRODUCCIÓN AUTÓNOMA VERIFICADA";
  if (s >= 9.5) return "CLASE MUNDIAL / SUPREME";
  if (s >= 9.0) return "EXCELENTE / LISTA PARA COMPETIR FUERTE";
  if (s >= 8.0) return "MUY BUENA / PREMIUM EN FORMACIÓN";
  if (s >= 7.0) return "BUENA / BASE COMERCIAL SERIA";
  return "NECESITA PROFUNDIZACIÓN";
}

const weakest = [...cats].sort((a,b) => a.score-b.score).slice(0,5);
const report = {
  evaluator:"BestSeller OS4 Supreme Evaluator",
  version:"2.0",
  timestamp:new Date().toISOString(),
  root:ROOT,
  mode:FULL ? "FULL" : "STATIC",
  score,
  readiness_percent:Math.round(score*10),
  verdict:verdict(score),
  hard_caps:caps,
  agents:{
    expected:agents.length,
    present:presentAgents.length,
    invoked_by_orchestrator:calledAgents.length,
    missing:agents.filter((a) => !presentAgents.includes(a)),
    not_invoked:agents.filter((a) => !calledAgents.includes(a)),
  },
  runtime,
  categories:cats,
  weakest_categories:weakest.map((x) => ({
    name:x.name,
    score:x.score,
    recommendation:x.recommendation,
  })),
};

function textReport(r) {
  const out = [];
  out.push("============================================================");
  out.push("BESTSELLER OS4 SUPREME — EVALUACIÓN DE ARQUITECTURA REAL");
  out.push("============================================================");
  out.push("");
  out.push(`PUNTUACIÓN GENERAL: ${r.score}/10`);
  out.push(r.verdict);
  out.push(`Preparación estimada: ${r.readiness_percent}%`);
  out.push(`Modo: ${r.mode}`);
  out.push("");
  if (r.hard_caps.length) {
    out.push("LIMITADORES DEL SCORE REAL");
    for (const x of r.hard_caps) out.push(`- Máximo ${x.max}/10: ${x.reason}`);
    out.push("");
  }
  out.push(`AGENTES: ${r.agents.present}/${r.agents.expected} definidos · ${r.agents.invoked_by_orchestrator} invocados`);
  if (r.agents.not_invoked.length) out.push(`Definidos pero no invocados: ${r.agents.not_invoked.join(", ")}`);
  out.push("");
  out.push("PUNTUACIÓN POR ÁREA");
  out.push("");

  for (const cat of r.categories) {
    out.push(`${cat.name}: ${cat.score}/10`);
    for (const c of cat.checks) {
      const icon = c.level===4?"✅":c.level===3?"🧪":c.level===2?"🔗":c.level===1?"📦":"❌";
      out.push(`  ${icon} ${c.label} — ${c.level_label} (${c.score}/10)${c.critical?" [CRÍTICO]":""}`);
      if (c.note) out.push(`     ↳ ${c.note}`);
    }
    out.push(`  Próximo paso: ${cat.recommendation}`);
    out.push("");
  }

  if (FULL) {
    out.push("PRUEBAS EJECUTADAS");
    for (const [k,v] of Object.entries(r.runtime)) {
      if (!v) continue;
      out.push(`- ${k}: ${v.ok?"PASS":"FAIL"} — ${v.command} (${v.ms} ms)`);
      if (!v.ok && v.stderr) out.push(`  ${v.stderr.slice(0,900).replace(/\n/g,"\n  ")}`);
    }
    out.push("");
  }

  out.push("5 ÁREAS MÁS DÉBILES");
  for (const x of r.weakest_categories) {
    out.push(`- ${x.name}: ${x.score}/10`);
    out.push(`  ${x.recommendation}`);
  }
  out.push("");
  out.push("ESCALA DEL EVALUADOR");
  out.push("- PRESENTE: existe el código/tabla.");
  out.push("- INTEGRADO: participa en el flujo real.");
  out.push("- PROBADO: una prueba automática lo ejecutó/validó.");
  out.push("- PRODUCCIÓN: además superó build/typecheck/tests pertinentes.");
  out.push("");
  out.push("Este evaluador NO da 10/10 por encontrar palabras o archivos.");
  out.push("El 10/10 real exige worker durable 24/7 verificado.");
  return out.join("\n");
}

fs.mkdirSync(path.join(ROOT,"reports"), {recursive:true});
const txt = textReport(report);
fs.writeFileSync(path.join(ROOT,"reports","os4-supreme-evaluation.txt"), txt+"\n","utf8");
fs.writeFileSync(path.join(ROOT,"reports","os4-supreme-evaluation.json"), JSON.stringify(report,null,2)+"\n","utf8");

if (JSON_ONLY) console.log(JSON.stringify(report,null,2));
else {
  console.log(txt);
  console.log("");
  console.log("Reportes guardados:");
  console.log(path.join(ROOT,"reports","os4-supreme-evaluation.txt"));
  console.log(path.join(ROOT,"reports","os4-supreme-evaluation.json"));
}

if (STRICT) {
  const fail = score < 9.0 || (FULL && (!pass.typecheck || !pass.build || !pass.os4test || !pass.audit));
  if (fail) process.exit(1);
}

import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/research-worker.ts");

let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
let worker = fs.readFileSync(workerFile, "utf8").replace(/\r\n?/g, "\n");
let runtimeChanged = false;
let workerChanged = false;

// RESEARCH_CREDIT_GUARD_V1.2
// Fail-closed installer: nunca declara el guard activo si falta una pieza.
// Primera pasada controlada:
// - Gemini 3.6 Flash por defecto;
// - 1 intento por llamada JSON;
// - máximo 5 queries de discovery;
// - máximo 6 fuentes analizadas;
// - máximo 18 llamadas LLM en la pasada base;
// - NO hace gap-closure automático después del primer dossier;
// - no modifica criterios readyForWriting.

function insertBefore(source, marker, block, alreadyMarker) {
  if (source.includes(alreadyMarker)) return { source, changed: false };
  const at = source.indexOf(marker);
  if (at < 0) return { source, changed: false };
  return {
    source: source.slice(0, at) + block + (block.endsWith("\n") ? "" : "\n") + source.slice(at),
    changed: true,
  };
}

function insertAfterLineContaining(source, marker, block, alreadyMarker) {
  if (source.includes(alreadyMarker)) return { source, changed: false };
  const at = source.indexOf(marker);
  if (at < 0) return { source, changed: false };
  const eol = source.indexOf("\n", at);
  const pos = eol >= 0 ? eol + 1 : source.length;
  return {
    source: source.slice(0, pos) + block + (block.endsWith("\n") ? "" : "\n") + source.slice(pos),
    changed: true,
  };
}

// 1) JSON retries: 1 por defecto bajo guard.
const oldLoop = "  for (let attempt = 1; attempt <= 3; attempt += 1) {";
if (!runtime.includes("RESEARCH_GENERATE_MAX_ATTEMPTS") && runtime.includes(oldLoop)) {
  const replacement = `  const researchCreditGuardEnabled = !["0", "false", "off"].includes(\n    clean(process.env.RESEARCH_CREDIT_GUARD || "1").toLowerCase()\n  );\n  const researchGenerateMaxAttempts = researchCreditGuardEnabled\n    ? Math.max(1, Number(process.env.RESEARCH_GENERATE_MAX_ATTEMPTS || 1))\n    : 3;\n\n  for (let attempt = 1; attempt <= researchGenerateMaxAttempts; attempt += 1) {`;
  runtime = runtime.replace(oldLoop, replacement);
  runtime = runtime.replace(
    "      if (!truncated || attempt >= 3 || maxOutputTokens >= 32768) throw error;",
    "      if (!truncated || attempt >= researchGenerateMaxAttempts || maxOutputTokens >= 32768) throw error;"
  );
  runtimeChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: JSON retries = 1 por defecto.");
}

// 2) Variables de presupuesto por job.
// Insertamos ANTES de release(), que está inmediatamente después de checkpoint,
// evitando depender del formato exacto de la declaración de checkpoint.
{
  const block = `    const researchBudgetGuard = checkpoint.budgetGuard && typeof checkpoint.budgetGuard === "object" ? checkpoint.budgetGuard : {};\n    const researchCreditGuardEnabled = !["0", "false", "off"].includes(String(process.env.RESEARCH_CREDIT_GUARD || "1").trim().toLowerCase());\n    const researchMaxQueries = Math.max(1, Math.min(18, Number(researchBudgetGuard.maxQueries || process.env.RESEARCH_MAX_QUERIES || 5)));\n    const researchMaxSources = Math.max(3, Math.min(30, Number(researchBudgetGuard.maxSources || process.env.RESEARCH_MAX_SOURCES || 6)));\n    const researchMaxCalls = Math.max(8, Number(researchBudgetGuard.maxCalls || process.env.RESEARCH_MAX_LLM_CALLS || 18));\n    const researchFirstPassOnly = researchCreditGuardEnabled && researchBudgetGuard.firstPassOnly !== false;\n    const researchLlmSteps = new Set(["STRATEGY","QUERIES","DISCOVER","EVIDENCE","CLAIMS","CONTRADICTIONS","VERIFY","GAPS","DOSSIER","CRITICAL_RESOLVE"]);\n`;
  let out = insertBefore(worker, "    const release=async", block, "const researchBudgetGuard");
  if (!out.changed && !worker.includes("const researchBudgetGuard")) {
    out = insertBefore(worker, "const release=async", block, "const researchBudgetGuard");
  }
  worker = out.source;
  if (out.changed) {
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: límites por job instalados.");
  }
}

// 3) Hard cap: se evalúa antes de cada etapa LLM.
{
  const block = `    if (researchCreditGuardEnabled && researchLlmSteps.has(checkpoint.step) && Number(checkpoint.usage?.calls || 0) >= researchMaxCalls) {\n      const budgetResult = {\n        readyForWriting: false,\n        budgetExhausted: true,\n        gapClosureStopReason: "RESEARCH_CREDIT_BUDGET_EXHAUSTED",\n        usage: checkpoint.usage,\n        budgetGuard: {\n          enabled: true,\n          maxCalls: researchMaxCalls,\n          callsUsed: Number(checkpoint.usage?.calls || 0),\n          stoppedBefore: checkpoint.step,\n          maxQueries: researchMaxQueries,\n          maxSources: researchMaxSources,\n          firstPassOnly: researchFirstPassOnly\n        }\n      };\n      const {error:budgetCompleteError}=await admin.rpc("research_complete_job",{\n        p_job_id:job.id,\n        p_worker_id:workerId,\n        p_result:budgetResult,\n        p_checkpoint:{...checkpoint,step:"COMPLETED",budgetGuardHit:budgetResult.budgetGuard}\n      });\n      if(budgetCompleteError)throw budgetCompleteError;\n      return json(res,200,{ok:true,job_id:job.id,status:"COMPLETED",progress:100,result:budgetResult,message:"RESEARCH_CREDIT_BUDGET_EXHAUSTED"});\n    }\n`;
  let out = insertAfterLineContaining(worker, "    const heartbeat=async()=>", block, "RESEARCH_CREDIT_BUDGET_EXHAUSTED");
  if (!out.changed && !worker.includes("RESEARCH_CREDIT_BUDGET_EXHAUSTED")) {
    out = insertAfterLineContaining(worker, "const heartbeat=async()=>", block, "RESEARCH_CREDIT_BUDGET_EXHAUSTED");
  }
  worker = out.source;
  if (out.changed) {
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: hard cap de llamadas instalado.");
  }
}

// 4) Limitar queries generadas, sin otra llamada LLM.
if (!worker.includes("const controlledQueries=")) {
  const queryCallRe = /(await\s+heartbeat\(\);\s*const\s+out\s*=\s*await\s+buildQueries\(\{\s*topic\s*:\s*job\.topic\s*,\s*questions\s*:\s*checkpoint\.strategy\?\.questions\s*\|\|\s*\[\]\s*\}\);)/m;
  if (queryCallRe.test(worker)) {
    worker = worker.replace(
      queryCallRe,
      `$1\n      const controlledQueries=researchCreditGuardEnabled ? out.queries.slice(0,researchMaxQueries) : out.queries;`
    );
    const releaseQueriesRe = /return\s+release\(\{\.\.\.checkpoint\s*,\s*step\s*:\s*"DISCOVER"\s*,\s*queries\s*:\s*out\.queries\s*,\s*nextQueryIndex\s*:\s*0\s*,\s*usage\s*:\s*addUsage\(checkpoint\.usage\s*,\s*out\.usage\)\s*,\s*model\s*:\s*out\.model\s*\}\s*,\s*14\s*\);/m;
    worker = worker.replace(
      releaseQueriesRe,
      'return release({...checkpoint,step:"DISCOVER",queries:controlledQueries,nextQueryIndex:0,usage:addUsage(checkpoint.usage,out.usage),model:out.model},14,{queries:controlledQueries.length,query_cap:researchCreditGuardEnabled?researchMaxQueries:null});'
    );
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: discovery queries limitadas.");
  }
}

// 5) Limitar fuentes de la primera pasada.
if (!worker.includes("const controlledSourceLimit=")) {
  const rankCallRe = /const\s+ranked\s*=\s*rankSources\(\s*checkpoint\.sources\s*\|\|\s*\[\]\s*,\s*Number\(\s*job\.max_sources\s*\|\|\s*10\s*\)\s*\)\s*;/m;
  if (rankCallRe.test(worker)) {
    worker = worker.replace(
      rankCallRe,
      'const controlledSourceLimit=researchCreditGuardEnabled?Math.min(Number(job.max_sources||10),researchMaxSources):Number(job.max_sources||10);\n      const ranked=rankSources(checkpoint.sources||[],controlledSourceLimit);'
    );
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: fuentes de primera pasada limitadas.");
  }
}

// 6) Después del primer dossier, persistir y detener antes de gap loops si aún no está ready.
const blockerComment = '      /*\n       * ======================================================\n       * 11D.5.1 — FINAL BLOCKER FOLLOW-UP';
if (!worker.includes("RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE") && worker.includes(blockerComment)) {
  const insertAt = worker.indexOf(blockerComment);
  const firstPassStop = `      if(researchFirstPassOnly){\n        return release(\n          {\n            ...checkpoint,\n            step:"PERSIST",\n            dossier:out.dossier,\n            usage:nextUsage,\n            model:out.model,\n            gapClosureHistory:history,\n            gapClosureStopReason:"RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE",\n            budgetGuard:{\n              ...researchBudgetGuard,\n              enabled:true,\n              firstPassOnly:true,\n              maxCalls:researchMaxCalls,\n              maxQueries:researchMaxQueries,\n              maxSources:researchMaxSources,\n              callsUsed:Number(nextUsage?.calls||0),\n              firstPassComplete:true\n            }\n          },\n          97,\n          {\n            ready_for_writing:false,\n            gap_closure:"RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE",\n            calls:Number(nextUsage?.calls||0),\n            max_calls:researchMaxCalls,\n            sources:out.dossier.sources.length,\n            evidence:out.dossier.evidence.length,\n            claims:out.dossier.claims.length,\n            gaps:out.dossier.gaps.length,\n            coverage_score:out.dossier.coverageScore,\n            evidence_score:out.dossier.evidenceScore,\n            factual_confidence_score:out.dossier.factualConfidenceScore\n          }\n        );\n      }\n\n`;
  worker = worker.slice(0, insertAt) + firstPassStop + worker.slice(insertAt);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: gap closure automático bloqueado tras primera pasada.");
}

// Fail closed: si falta cualquier pieza, NO escribir cambios parciales.
const required = [
  ["runtime retry guard", runtime.includes("RESEARCH_GENERATE_MAX_ATTEMPTS")],
  ["per-job budget", worker.includes("const researchBudgetGuard")],
  ["hard call cap", worker.includes("RESEARCH_CREDIT_BUDGET_EXHAUSTED")],
  ["query cap", worker.includes("const controlledQueries=")],
  ["source cap", worker.includes("const controlledSourceLimit=")],
  ["first-pass stop", worker.includes("RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE")],
];
const missing = required.filter(([, ok]) => !ok).map(([name]) => name);
if (missing.length) {
  throw new Error(`RESEARCH_CREDIT_GUARD_PATCH_INCOMPLETE: ${missing.join(", ")}`);
}

if (runtimeChanged) fs.writeFileSync(runtimeFile, runtime, "utf8");
if (workerChanged) fs.writeFileSync(workerFile, worker, "utf8");

if (!runtimeChanged && !workerChanged) {
  console.log("[Genelibros] RESEARCH CREDIT GUARD ya estaba instalado.");
}
console.log("[Genelibros] RESEARCH CREDIT GUARD V1.2 COMPLETO: Flash, queries<=5, sources<=6, base<=18 llamadas, sin gap-loop automático.");
console.log("[Genelibros] Overrides por job: checkpoint.budgetGuard.maxCalls/maxQueries/maxSources/firstPassOnly.");

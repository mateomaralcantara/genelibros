import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/research-worker.ts");

let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
let worker = fs.readFileSync(workerFile, "utf8").replace(/\r\n?/g, "\n");
let runtimeChanged = false;
let workerChanged = false;

// RESEARCH_CREDIT_GUARD_V1.3
// Fail-closed + self-healing installer.
// - Gemini Flash por defecto.
// - 1 intento por JSON bajo guard.
// - max 5 discovery queries.
// - max 6 fuentes en primera pasada.
// - max 18 llamadas LLM en pasada base.
// - sin gap-loop automático después del primer dossier.
// - criterios readyForWriting intactos.

function insertBefore(source, marker, block, alreadyMarker) {
  if (source.includes(alreadyMarker)) return { source, changed: false };
  const at = source.indexOf(marker);
  if (at < 0) return { source, changed: false };
  return { source: source.slice(0, at) + block + (block.endsWith("\n") ? "" : "\n") + source.slice(at), changed: true };
}

function insertAfterLineContaining(source, marker, block, alreadyMarker) {
  if (source.includes(alreadyMarker)) return { source, changed: false };
  const at = source.indexOf(marker);
  if (at < 0) return { source, changed: false };
  const eol = source.indexOf("\n", at);
  const pos = eol >= 0 ? eol + 1 : source.length;
  return { source: source.slice(0, pos) + block + (block.endsWith("\n") ? "" : "\n") + source.slice(pos), changed: true };
}

// 1) JSON retries: una sola llamada por defecto.
if (!runtime.includes("RESEARCH_GENERATE_MAX_ATTEMPTS")) {
  const oldLoop = "  for (let attempt = 1; attempt <= 3; attempt += 1) {";
  if (runtime.includes(oldLoop)) {
    runtime = runtime.replace(
      oldLoop,
      `  const researchCreditGuardEnabled = !["0", "false", "off"].includes(\n    clean(process.env.RESEARCH_CREDIT_GUARD || "1").toLowerCase()\n  );\n  const researchGenerateMaxAttempts = researchCreditGuardEnabled\n    ? Math.max(1, Number(process.env.RESEARCH_GENERATE_MAX_ATTEMPTS || 1))\n    : 3;\n\n  for (let attempt = 1; attempt <= researchGenerateMaxAttempts; attempt += 1) {`
    );
    runtime = runtime.replace(
      "      if (!truncated || attempt >= 3 || maxOutputTokens >= 32768) throw error;",
      "      if (!truncated || attempt >= researchGenerateMaxAttempts || maxOutputTokens >= 32768) throw error;"
    );
    runtimeChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: JSON retries = 1 por defecto.");
  }
}

// 2) Presupuesto por job. Se inserta antes de release(), no depende del formato de checkpoint.
{
  const block = `    const researchBudgetGuard = checkpoint.budgetGuard && typeof checkpoint.budgetGuard === "object" ? checkpoint.budgetGuard : {};\n    const researchCreditGuardEnabled = !["0", "false", "off"].includes(String(process.env.RESEARCH_CREDIT_GUARD || "1").trim().toLowerCase());\n    const researchMaxQueries = Math.max(1, Math.min(18, Number(researchBudgetGuard.maxQueries || process.env.RESEARCH_MAX_QUERIES || 5)));\n    const researchMaxSources = Math.max(3, Math.min(30, Number(researchBudgetGuard.maxSources || process.env.RESEARCH_MAX_SOURCES || 6)));\n    const researchMaxCalls = Math.max(8, Number(researchBudgetGuard.maxCalls || process.env.RESEARCH_MAX_LLM_CALLS || 18));\n    const researchFirstPassOnly = researchCreditGuardEnabled && researchBudgetGuard.firstPassOnly !== false;\n    const researchLlmSteps = new Set(["STRATEGY","QUERIES","DISCOVER","EVIDENCE","CLAIMS","CONTRADICTIONS","VERIFY","GAPS","DOSSIER","CRITICAL_RESOLVE"]);\n`;
  let out = insertBefore(worker, "    const release=async", block, "const researchBudgetGuard");
  if (!out.changed && !worker.includes("const researchBudgetGuard")) out = insertBefore(worker, "const release=async", block, "const researchBudgetGuard");
  worker = out.source;
  if (out.changed) {
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: límites por job instalados.");
  }
}

// 3) Hard cap antes de cualquier etapa LLM.
{
  const block = `    if (researchCreditGuardEnabled && researchLlmSteps.has(checkpoint.step) && Number(checkpoint.usage?.calls || 0) >= researchMaxCalls) {\n      const budgetResult = {\n        readyForWriting:false,\n        budgetExhausted:true,\n        gapClosureStopReason:"RESEARCH_CREDIT_BUDGET_EXHAUSTED",\n        usage:checkpoint.usage,\n        budgetGuard:{\n          enabled:true,\n          maxCalls:researchMaxCalls,\n          callsUsed:Number(checkpoint.usage?.calls || 0),\n          stoppedBefore:checkpoint.step,\n          maxQueries:researchMaxQueries,\n          maxSources:researchMaxSources,\n          firstPassOnly:researchFirstPassOnly\n        }\n      };\n      const {error:budgetCompleteError}=await admin.rpc("research_complete_job",{\n        p_job_id:job.id,\n        p_worker_id:workerId,\n        p_result:budgetResult,\n        p_checkpoint:{...checkpoint,step:"COMPLETED",budgetGuardHit:budgetResult.budgetGuard}\n      });\n      if(budgetCompleteError)throw budgetCompleteError;\n      return json(res,200,{ok:true,job_id:job.id,status:"COMPLETED",progress:100,result:budgetResult,message:"RESEARCH_CREDIT_BUDGET_EXHAUSTED"});\n    }\n`;
  let out = insertAfterLineContaining(worker, "    const heartbeat=async()=>", block, "RESEARCH_CREDIT_BUDGET_EXHAUSTED");
  if (!out.changed && !worker.includes("RESEARCH_CREDIT_BUDGET_EXHAUSTED")) out = insertAfterLineContaining(worker, "const heartbeat=async()=>", block, "RESEARCH_CREDIT_BUDGET_EXHAUSTED");
  worker = out.source;
  if (out.changed) {
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: hard cap de llamadas instalado.");
  }
}

// 4) Query cap. Se recorta el array producido sin comprar otra llamada.
if (!worker.includes("const controlledQueries=")) {
  const queryCallRe = /(await\s+heartbeat\(\);\s*const\s+out\s*=\s*await\s+buildQueries\([\s\S]*?\);)/m;
  if (queryCallRe.test(worker)) {
    worker = worker.replace(queryCallRe, `$1\n      const controlledQueries=researchCreditGuardEnabled ? out.queries.slice(0,researchMaxQueries) : out.queries;`);
    worker = worker.replace(
      /queries\s*:\s*out\.queries\s*,\s*nextQueryIndex\s*:\s*0/,
      "queries:controlledQueries,nextQueryIndex:0"
    );
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: discovery queries limitadas.");
  }
}

// 5) Source cap ESTRUCTURAL.
// No tocamos rankSources(). Antes de entrar a RANK limitamos job.max_sources;
// el código existente consume ese valor ya capado.
if (!worker.includes("RESEARCH_SOURCE_CAP_APPLIED")) {
  const marker = '    if(checkpoint.step==="RANK"){';
  const block = `      // RESEARCH_SOURCE_CAP_APPLIED\n      if(researchCreditGuardEnabled){\n        job.max_sources=Math.min(Number(job.max_sources||10),researchMaxSources);\n      }\n`;
  const out = insertAfterLineContaining(worker, marker, block, "RESEARCH_SOURCE_CAP_APPLIED");
  worker = out.source;
  if (out.changed) {
    workerChanged = true;
    console.log("[Genelibros] RESEARCH CREDIT GUARD: fuentes de primera pasada limitadas.");
  }
}

// 6) Tras el primer dossier no-ready, persistir y parar antes de gap loops.
const blockerComment = '      /*\n       * ======================================================\n       * 11D.5.1 — FINAL BLOCKER FOLLOW-UP';
if (!worker.includes("RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE") && worker.includes(blockerComment)) {
  const insertAt = worker.indexOf(blockerComment);
  const firstPassStop = `      if(researchFirstPassOnly){\n        return release(\n          {\n            ...checkpoint,\n            step:"PERSIST",\n            dossier:out.dossier,\n            usage:nextUsage,\n            model:out.model,\n            gapClosureHistory:history,\n            gapClosureStopReason:"RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE",\n            budgetGuard:{\n              ...researchBudgetGuard,\n              enabled:true,firstPassOnly:true,\n              maxCalls:researchMaxCalls,maxQueries:researchMaxQueries,maxSources:researchMaxSources,\n              callsUsed:Number(nextUsage?.calls||0),firstPassComplete:true\n            }\n          },\n          97,\n          {\n            ready_for_writing:false,\n            gap_closure:"RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE",\n            calls:Number(nextUsage?.calls||0),max_calls:researchMaxCalls,\n            sources:out.dossier.sources.length,evidence:out.dossier.evidence.length,\n            claims:out.dossier.claims.length,gaps:out.dossier.gaps.length,\n            coverage_score:out.dossier.coverageScore,\n            evidence_score:out.dossier.evidenceScore,\n            factual_confidence_score:out.dossier.factualConfidenceScore\n          }\n        );\n      }\n\n`;
  worker = worker.slice(0, insertAt) + firstPassStop + worker.slice(insertAt);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: gap closure automático bloqueado tras primera pasada.");
}

// Fail closed: nada se escribe si falta una pieza.
const required = [
  ["runtime retry guard", runtime.includes("RESEARCH_GENERATE_MAX_ATTEMPTS")],
  ["per-job budget", worker.includes("const researchBudgetGuard")],
  ["hard call cap", worker.includes("RESEARCH_CREDIT_BUDGET_EXHAUSTED")],
  ["query cap", worker.includes("const controlledQueries=") && worker.includes("queries:controlledQueries")],
  ["source cap", worker.includes("RESEARCH_SOURCE_CAP_APPLIED") && worker.includes("researchMaxSources")],
  ["first-pass stop", worker.includes("RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE")],
];
const missing = required.filter(([, ok]) => !ok).map(([name]) => name);
if (missing.length) throw new Error(`RESEARCH_CREDIT_GUARD_PATCH_INCOMPLETE: ${missing.join(", ")}`);

if (runtimeChanged) fs.writeFileSync(runtimeFile, runtime, "utf8");
if (workerChanged) fs.writeFileSync(workerFile, worker, "utf8");

if (!runtimeChanged && !workerChanged) console.log("[Genelibros] RESEARCH CREDIT GUARD ya estaba instalado.");
console.log("[Genelibros] RESEARCH CREDIT GUARD V1.3 COMPLETO: Flash, queries<=5, sources<=6, base<=18 llamadas, sin gap-loop automático.");
console.log("[Genelibros] Overrides por job: checkpoint.budgetGuard.maxCalls/maxQueries/maxSources/firstPassOnly.");

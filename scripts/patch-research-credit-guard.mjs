import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/research-worker.ts");

let runtime = fs.readFileSync(runtimeFile, "utf8");
let worker = fs.readFileSync(workerFile, "utf8");
let runtimeChanged = false;
let workerChanged = false;

// RESEARCH_CREDIT_GUARD_V1
// Primera pasada controlada y verificable:
// - Gemini 3.6 Flash por defecto;
// - 1 intento por llamada JSON;
// - máximo 5 queries de discovery;
// - máximo 6 fuentes analizadas;
// - máximo 18 llamadas LLM en la pasada base;
// - NO hace gap-closure automático después del primer dossier;
// - no modifica criterios readyForWriting.

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

const checkpointNeedle = '    const checkpoint={...(job.checkpoint||{}),step:job.checkpoint?.step||"INIT",usage:job.checkpoint?.usage||{calls:0,inputTokens:0,outputTokens:0,totalTokens:0},warnings:job.checkpoint?.warnings||[]};';
if (!worker.includes("const researchBudgetGuard") && worker.includes(checkpointNeedle)) {
  const replacement = `${checkpointNeedle}\n    const researchBudgetGuard = checkpoint.budgetGuard && typeof checkpoint.budgetGuard === "object" ? checkpoint.budgetGuard : {};\n    const researchCreditGuardEnabled = !["0", "false", "off"].includes(String(process.env.RESEARCH_CREDIT_GUARD || "1").trim().toLowerCase());\n    const researchMaxQueries = Math.max(1, Math.min(18, Number(researchBudgetGuard.maxQueries || process.env.RESEARCH_MAX_QUERIES || 5)));\n    const researchMaxSources = Math.max(3, Math.min(30, Number(researchBudgetGuard.maxSources || process.env.RESEARCH_MAX_SOURCES || 6)));\n    const researchMaxCalls = Math.max(8, Number(researchBudgetGuard.maxCalls || process.env.RESEARCH_MAX_LLM_CALLS || 18));\n    const researchFirstPassOnly = researchCreditGuardEnabled && researchBudgetGuard.firstPassOnly !== false;\n    const researchLlmSteps = new Set(["STRATEGY","QUERIES","DISCOVER","EVIDENCE","CLAIMS","CONTRADICTIONS","VERIFY","GAPS","DOSSIER","CRITICAL_RESOLVE"]);`;
  worker = worker.replace(checkpointNeedle, replacement);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: límites por job instalados.");
}

const heartbeatNeedle = '    const heartbeat=async()=>{const {error}=await admin.rpc("research_heartbeat_job",{p_job_id:job.id,p_worker_id:workerId,p_lease_seconds:240});if(error)throw error;};';
if (!worker.includes("RESEARCH_CREDIT_BUDGET_EXHAUSTED") && worker.includes(heartbeatNeedle)) {
  const replacement = `${heartbeatNeedle}\n    if (researchCreditGuardEnabled && researchLlmSteps.has(checkpoint.step) && Number(checkpoint.usage?.calls || 0) >= researchMaxCalls) {\n      const budgetResult = {\n        readyForWriting: false,\n        budgetExhausted: true,\n        gapClosureStopReason: "RESEARCH_CREDIT_BUDGET_EXHAUSTED",\n        usage: checkpoint.usage,\n        budgetGuard: {\n          enabled: true,\n          maxCalls: researchMaxCalls,\n          callsUsed: Number(checkpoint.usage?.calls || 0),\n          stoppedBefore: checkpoint.step,\n          maxQueries: researchMaxQueries,\n          maxSources: researchMaxSources,\n          firstPassOnly: researchFirstPassOnly\n        }\n      };\n      const {error:budgetCompleteError}=await admin.rpc("research_complete_job",{\n        p_job_id:job.id,\n        p_worker_id:workerId,\n        p_result:budgetResult,\n        p_checkpoint:{...checkpoint,step:"COMPLETED",budgetGuardHit:budgetResult.budgetGuard}\n      });\n      if(budgetCompleteError)throw budgetCompleteError;\n      return json(res,200,{ok:true,job_id:job.id,status:"COMPLETED",progress:100,result:budgetResult,message:"RESEARCH_CREDIT_BUDGET_EXHAUSTED"});\n    }`;
  worker = worker.replace(heartbeatNeedle, replacement);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: hard cap de llamadas instalado.");
}

const queriesOld = '      await heartbeat();const out=await buildQueries({topic:job.topic,questions:checkpoint.strategy?.questions||[]});\n      return release({...checkpoint,step:"DISCOVER",queries:out.queries,nextQueryIndex:0,usage:addUsage(checkpoint.usage,out.usage),model:out.model},14);';
if (!worker.includes("researchMaxQueries) : out.queries") && worker.includes(queriesOld)) {
  const queriesNew = '      await heartbeat();const out=await buildQueries({topic:job.topic,questions:checkpoint.strategy?.questions||[]});\n      const controlledQueries=researchCreditGuardEnabled ? out.queries.slice(0,researchMaxQueries) : out.queries;\n      return release({...checkpoint,step:"DISCOVER",queries:controlledQueries,nextQueryIndex:0,usage:addUsage(checkpoint.usage,out.usage),model:out.model},14,{queries:controlledQueries.length,query_cap:researchCreditGuardEnabled?researchMaxQueries:null});';
  worker = worker.replace(queriesOld, queriesNew);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: discovery queries limitadas.");
}

const rankOld = '      const ranked=rankSources(checkpoint.sources||[],Number(job.max_sources||10));if(!ranked.length)throw new Error("Research Intelligence no obtuvo fuentes utilizables.");';
if (!worker.includes("controlledSourceLimit") && worker.includes(rankOld)) {
  const rankNew = '      const controlledSourceLimit=researchCreditGuardEnabled?Math.min(Number(job.max_sources||10),researchMaxSources):Number(job.max_sources||10);\n      const ranked=rankSources(checkpoint.sources||[],controlledSourceLimit);if(!ranked.length)throw new Error("Research Intelligence no obtuvo fuentes utilizables.");';
  worker = worker.replace(rankOld, rankNew);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: fuentes de primera pasada limitadas.");
}

const readyBlockMarker = '      if(out.dossier.readyForWriting){';
const blockerComment = '      /*\n       * ======================================================\n       * 11D.5.1 — FINAL BLOCKER FOLLOW-UP';
if (!worker.includes("RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE") && worker.includes(blockerComment)) {
  const insertAt = worker.indexOf(blockerComment);
  const firstPassStop = `      if(researchFirstPassOnly){\n        return release(\n          {\n            ...checkpoint,\n            step:"PERSIST",\n            dossier:out.dossier,\n            usage:nextUsage,\n            model:out.model,\n            gapClosureHistory:history,\n            gapClosureStopReason:"RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE",\n            budgetGuard:{\n              ...researchBudgetGuard,\n              enabled:true,\n              firstPassOnly:true,\n              maxCalls:researchMaxCalls,\n              maxQueries:researchMaxQueries,\n              maxSources:researchMaxSources,\n              callsUsed:Number(nextUsage?.calls||0),\n              firstPassComplete:true\n            }\n          },\n          97,\n          {\n            ready_for_writing:false,\n            gap_closure:"RESEARCH_CREDIT_GUARD_FIRST_PASS_COMPLETE",\n            calls:Number(nextUsage?.calls||0),\n            max_calls:researchMaxCalls,\n            sources:out.dossier.sources.length,\n            evidence:out.dossier.evidence.length,\n            claims:out.dossier.claims.length,\n            gaps:out.dossier.gaps.length,\n            coverage_score:out.dossier.coverageScore,\n            evidence_score:out.dossier.evidenceScore,\n            factual_confidence_score:out.dossier.factualConfidenceScore\n          }\n        );\n      }\n\n`;
  worker = worker.slice(0, insertAt) + firstPassStop + worker.slice(insertAt);
  workerChanged = true;
  console.log("[Genelibros] RESEARCH CREDIT GUARD: gap closure automático bloqueado tras primera pasada.");
}

if (runtimeChanged) fs.writeFileSync(runtimeFile, runtime, "utf8");
if (workerChanged) fs.writeFileSync(workerFile, worker, "utf8");

if (!runtimeChanged && !workerChanged) {
  console.log("[Genelibros] RESEARCH CREDIT GUARD ya estaba instalado.");
}
console.log("[Genelibros] RESEARCH CREDIT GUARD activo: Flash, queries<=5, sources<=6, base<=18 llamadas, sin gap-loop automático.");
console.log("[Genelibros] Overrides por job: checkpoint.budgetGuard.maxCalls/maxQueries/maxSources/firstPassOnly.");
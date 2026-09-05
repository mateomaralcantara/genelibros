import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/deep-work-worker.ts");

let runtime = fs.readFileSync(runtimeFile, "utf8");
let worker = fs.readFileSync(workerFile, "utf8");
let runtimeChanged = false;
let workerChanged = false;

// CREDIT_GUARD_V2
// Objetivos:
// 1) mantener el umbral SUPREME 9.3;
// 2) reservar Pro para Draft A + Synthesis;
// 3) usar 2 drafts bajo guard (A Pro, B Flash);
// 4) permitir como máximo 1 REPAIR automático;
// 5) bloquear repairs sin instrucciones accionables;
// 6) imponer un techo duro de llamadas LLM por job;
// 7) evitar una segunda llamada de ranking V5.8 cuando basta una poda determinística;
// 8) permitir un cap por-job (job.policy.maxLlmCalls) para pruebas controladas.

const guardExpr = `!["0", "false", "off"].includes(\n    clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()\n  )`;

const oldGenerateModel = "  const model = modelFor(input.depth);";
const newGenerateModel = `  const creditGuardEnabled = ${guardExpr};\n  const budgetStage = /DEEP_PLANNER|LONG_CONTEXT_ANALYST|ALTERNATIVE_DRAFT_WRITER|CRITIC_COUNCIL|DEEP_QUALITY_JUDGE/i.test(input.system);\n  const model = creditGuardEnabled && budgetStage\n    ? clean(process.env.DEEP_BUDGET_MODEL || process.env.DEEP_FAST_MODEL || "gemini-2.5-flash")\n    : modelFor(input.depth);`;

if (!runtime.includes("const creditGuardEnabled = ![\"0\", \"false\", \"off\"].includes(") && runtime.includes(oldGenerateModel)) {
  runtime = runtime.replace(oldGenerateModel, newGenerateModel);
  runtimeChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: routing mixto activado (Pro = Draft A + Synthesis).");
}

if (!runtime.includes("const generateMaxAttempts = creditGuardEnabled") && runtime.includes("  for (let attempt = 1; attempt <= 3; attempt += 1) {")) {
  runtime = runtime.replace(
    "  for (let attempt = 1; attempt <= 3; attempt += 1) {",
    `  const generateMaxAttempts = creditGuardEnabled\n    ? Math.max(1, Number(process.env.DEEP_GENERATE_MAX_ATTEMPTS || 1))\n    : 3;\n\n  for (let attempt = 1; attempt <= generateMaxAttempts; attempt += 1) {`
  );
  runtime = runtime.replace(
    "      if (attempt >= 3 || maxOutputTokens >= 32000) {",
    "      if (attempt >= generateMaxAttempts || maxOutputTokens >= 32000) {"
  );
  runtime = runtime.replace(
    "`[Deep Work] Respuesta truncada. Reintento ${attempt + 1}/3: ${previous} -> ${maxOutputTokens} tokens.`,",
    "`[Deep Work] Respuesta truncada. Reintento ${attempt + 1}/${generateMaxAttempts}: ${previous} -> ${maxOutputTokens} tokens.`,"
  );
  runtimeChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: reintentos internos JSON = 1 por defecto.");
}

const oldRepairModels = `  const primaryModel = clean(process.env.DEEP_REPAIR_MODEL || modelFor(input.depth));\n  const deepModel = clean(modelFor(input.depth));`;
const newRepairModels = `  const primaryModel = clean(\n    process.env.DEEP_REPAIR_MODEL ||\n    process.env.DEEP_BUDGET_MODEL ||\n    process.env.DEEP_FAST_MODEL ||\n    "gemini-2.5-flash"\n  );\n  const deepModel = clean(\n    process.env.DEEP_REPAIR_DEEP_MODEL ||\n    process.env.DEEP_REPAIR_MODEL ||\n    process.env.DEEP_BUDGET_MODEL ||\n    process.env.DEEP_FAST_MODEL ||\n    "gemini-2.5-flash"\n  );`;

if (runtime.includes(oldRepairModels)) {
  runtime = runtime.replace(oldRepairModels, newRepairModels);
  runtimeChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: REPAIR usa Flash por defecto.");
}

const secondRankStart = "    // Si seguimos por encima del rango duro, hacemos una segunda selección solo sobre";
const secondRankEnd = "    if (prunedWords < minWords || prunedWords > maxWords) {";
if (!runtime.includes("CREDIT_GUARD_V2_DETERMINISTIC_SECOND_PRUNE") && runtime.includes(secondRankStart)) {
  const start = runtime.indexOf(secondRankStart);
  const end = runtime.indexOf(secondRankEnd, start);
  if (start >= 0 && end > start) {
    const deterministicSecondPass = `    // CREDIT_GUARD_V2_DETERMINISTIC_SECOND_PRUNE\n    // Si seguimos por encima del máximo, NO compramos otra clasificación.\n    // Recorremos el mismo ranking ya validado permitiendo acercarnos hasta el rango duro.\n    if (prunedWords > maxWords) {\n      for (const id of safeRank) {\n        if (removed.has(id)) continue;\n        const unit = removableMap.get(id);\n        if (!unit) continue;\n        const after = prunedWords - unit.words;\n        if (after < minWords) continue;\n        removed.add(id);\n        pruned = compose(removed);\n        prunedWords = countWords(pruned);\n        if (prunedWords <= maxWords) break;\n      }\n    }\n\n`;
    runtime = runtime.slice(0, start) + deterministicSecondPass + runtime.slice(end);
    runtimeChanged = true;
    console.log("[Genelibros] CREDIT GUARD V2: segunda poda V5.8 convertida a 0 llamadas LLM.");
  }
}

const oldSupremePolicy = '  if (depth === "SUPREME") return { draftCount: 3, maxRepairAttempts: 2, threshold: 9.3, useContext: true, useCouncil: true };';
const newSupremePolicy = `  if (depth === "SUPREME") {\n    const creditGuardEnabled = !["0", "false", "off"].includes(\n      clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()\n    );\n    return creditGuardEnabled\n      ? { draftCount: 2, maxRepairAttempts: 1, threshold: 9.3, useContext: true, useCouncil: true }\n      : { draftCount: 3, maxRepairAttempts: 2, threshold: 9.3, useContext: true, useCouncil: true };\n  }`;
if (!runtime.includes("draftCount: 2, maxRepairAttempts: 1, threshold: 9.3") && runtime.includes(oldSupremePolicy)) {
  runtime = runtime.replace(oldSupremePolicy, newSupremePolicy);
  runtimeChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: SUPREME = 2 drafts, 1 repair, threshold 9.3 intacto.");
}

const oldCanRepair = `    if (quality.unsupportedNewClaims.length) quality = { ...quality, verdict: "REPAIR" };\n    if (quality.overallScore < policy.threshold && quality.verdict === "APPROVED") quality = { ...quality, verdict: "REPAIR" };\n    const canRepair = quality.verdict === "REPAIR" && Number(result.repairAttempts || 0) < policy.maxRepairAttempts;\n    if (!canRepair && quality.verdict === "REPAIR") quality = { ...quality, verdict: "REJECTED" };`;
const newCanRepair = `    if (quality.unsupportedNewClaims.length) quality = { ...quality, verdict: "REPAIR" };\n    if (quality.overallScore < policy.threshold && quality.verdict === "APPROVED") quality = { ...quality, verdict: "REPAIR" };\n\n    const creditGuardEnabled = !["0", "false", "off"].includes(\n      clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()\n    );\n    const actionableRepair =\n      (Array.isArray(quality.requiredRepairs) && quality.requiredRepairs.length > 0) ||\n      (Array.isArray(quality.unsupportedNewClaims) && quality.unsupportedNewClaims.length > 0);\n\n    if (creditGuardEnabled && quality.verdict === "REPAIR" && !actionableRepair) {\n      quality = {\n        ...quality,\n        verdict: "REJECTED",\n        weaknesses: [\n          ...(quality.weaknesses || []),\n          "CREDIT_GUARD: el juez no produjo requiredRepairs ni claims concretos; se detiene antes de gastar otra llamada de reparación ciega."\n        ],\n      };\n    }\n\n    const canRepair =\n      quality.verdict === "REPAIR" &&\n      (!creditGuardEnabled || actionableRepair) &&\n      Number(result.repairAttempts || 0) < policy.maxRepairAttempts;\n    if (!canRepair && quality.verdict === "REPAIR") quality = { ...quality, verdict: "REJECTED" };`;

if (!worker.includes("CREDIT_GUARD: el juez no produjo requiredRepairs") && worker.includes(oldCanRepair)) {
  worker = worker.replace(oldCanRepair, newCanRepair);
  workerChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: reparaciones ciegas bloqueadas.");
}

const policyNeedle = "  const policy = deepModePolicy(depth);";
const budgetBlock = `  const policy = deepModePolicy(depth);\n  const creditGuardEnabledForJob = !["0", "false", "off"].includes(\n    clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()\n  );\n  const maxLlmCalls = Math.max(1, Number(\n    job.policy?.maxLlmCalls ||\n    process.env.DEEP_MAX_LLM_CALLS ||\n    (depth === "SUPREME" ? 9 : depth === "DEEP" ? 7 : 4)\n  ));\n  const llmSteps = new Set(["PLAN", "CONTEXT", "DRAFT", "CRITIC", "SYNTHESIS", "REPAIR", "QUALITY"]);`;
if (!worker.includes("const creditGuardEnabledForJob") && worker.includes(policyNeedle)) {
  worker = worker.replace(policyNeedle, budgetBlock);
  workerChanged = true;
}

const oldEnvOnlyCap = `  const maxLlmCalls = Math.max(1, Number(\n    process.env.DEEP_MAX_LLM_CALLS ||\n    (depth === "SUPREME" ? 9 : depth === "DEEP" ? 7 : 4)\n  ));`;
const perJobCap = `  const maxLlmCalls = Math.max(1, Number(\n    job.policy?.maxLlmCalls ||\n    process.env.DEEP_MAX_LLM_CALLS ||\n    (depth === "SUPREME" ? 9 : depth === "DEEP" ? 7 : 4)\n  ));`;
if (worker.includes(oldEnvOnlyCap)) {
  worker = worker.replace(oldEnvOnlyCap, perJobCap);
  workerChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: hard cap ahora respeta job.policy.maxLlmCalls.");
}

const heartbeatNeedle = "  await heartbeat(s, job.id, worker);";
const budgetStopBlock = `  await heartbeat(s, job.id, worker);\n\n  if (\n    creditGuardEnabledForJob &&\n    llmSteps.has(step) &&\n    Number(result.usage?.calls || 0) >= maxLlmCalls\n  ) {\n    if (!result.finalCandidate?.content && Array.isArray(result.drafts) && result.drafts.length) {\n      result.finalCandidate = result.drafts[0];\n    }\n    const priorQuality: AnyRow = result.quality && typeof result.quality === "object"\n      ? (result.quality as AnyRow)\n      : {};\n    result.quality = {\n      overallScore: Number(priorQuality.overallScore || 0),\n      verdict: "REJECTED",\n      scores: priorQuality.scores || {\n        structure: 0, depth: 0, clarity: 0, continuity: 0, style: 0,\n        originality: 0, factualDiscipline: 0, usefulness: 0, publishability: 0\n      },\n      strengths: Array.isArray(priorQuality.strengths) ? priorQuality.strengths : [],\n      weaknesses: [\n        ...(Array.isArray(priorQuality.weaknesses) ? priorQuality.weaknesses : []),\n        "CREDIT_BUDGET_EXHAUSTED: " + Number(result.usage?.calls || 0) + "/" + maxLlmCalls + " llamadas; se detuvo antes de " + step + "."\n      ],\n      requiredRepairs: Array.isArray(priorQuality.requiredRepairs) ? priorQuality.requiredRepairs : [],\n      unsupportedNewClaims: Array.isArray(priorQuality.unsupportedNewClaims) ? priorQuality.unsupportedNewClaims : [],\n    };\n    result.budgetGuard = {\n      hit: true,\n      callsUsed: Number(result.usage?.calls || 0),\n      maxCalls: maxLlmCalls,\n      stoppedBefore: step,\n      stoppedAt: new Date().toISOString(),\n    };\n    await release(s, job, worker, { version: "11C", step: "PERSIST" }, result, 96);\n    return {\n      step, next: "PERSIST", progress: 96,\n      quality: result.quality.overallScore, verdict: result.quality.verdict,\n      budgetGuard: result.budgetGuard,\n    };\n  }`;
if (!worker.includes("CREDIT_BUDGET_EXHAUSTED") && worker.includes(heartbeatNeedle)) {
  worker = worker.replace(heartbeatNeedle, budgetStopBlock);
  workerChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: techo duro de llamadas por job instalado (SUPREME=9 por defecto).");
}

const oldPriorQuality = '    const priorQuality = result.quality && typeof result.quality === "object" ? result.quality : {};';
const typedPriorQuality = `    const priorQuality: AnyRow = result.quality && typeof result.quality === "object"\n      ? (result.quality as AnyRow)\n      : {};`;
if (worker.includes(oldPriorQuality)) {
  worker = worker.replace(oldPriorQuality, typedPriorQuality);
  workerChanged = true;
  console.log("[Genelibros] CREDIT GUARD V2: priorQuality tipado como AnyRow (TypeScript fix).");
}

if (runtimeChanged) fs.writeFileSync(runtimeFile, runtime, "utf8");
if (workerChanged) fs.writeFileSync(workerFile, worker, "utf8");

if (!runtimeChanged && !workerChanged) {
  console.log("[Genelibros] CREDIT GUARD V2 ya estaba instalado.");
}
console.log("[Genelibros] CREDIT GUARD V2 activo: SUPREME threshold=9.3, drafts=2, repairs<=1, hard cap configurable por job.");
console.log("[Genelibros] Overrides: job.policy.maxLlmCalls | DEEP_CREDIT_GUARD=0 | DEEP_MAX_LLM_CALLS=N | DEEP_GENERATE_MAX_ATTEMPTS=N | DEEP_BUDGET_MODEL=model.");

import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/deep-work-worker.ts");

let runtime = fs.readFileSync(runtimeFile, "utf8");
let worker = fs.readFileSync(workerFile, "utf8");
let runtimeChanged = false;
let workerChanged = false;

// CREDIT_GUARD_V1
// Mantiene SUPREME y su umbral, pero reserva el modelo Pro para las dos etapas
// donde aporta más valor: DRAFT A y SYNTHESIS. Plan/context/drafts alternativos/
// critic/quality usan un modelo económico salvo override explícito.
const oldGenerateModel = "  const model = modelFor(input.depth);";
const newGenerateModel = `  const creditGuardEnabled = !["0", "false", "off"].includes(\n    clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()\n  );\n  const budgetStage = /DEEP_PLANNER|LONG_CONTEXT_ANALYST|ALTERNATIVE_DRAFT_WRITER|CRITIC_COUNCIL|DEEP_QUALITY_JUDGE/i.test(input.system);\n  const model = creditGuardEnabled && budgetStage\n    ? clean(process.env.DEEP_BUDGET_MODEL || process.env.DEEP_FAST_MODEL || "gemini-2.5-flash")\n    : modelFor(input.depth);`;

if (!runtime.includes("const creditGuardEnabled = ![\"0\", \"false\", \"off\"].includes(") && runtime.includes(oldGenerateModel)) {
  runtime = runtime.replace(oldGenerateModel, newGenerateModel);
  runtimeChanged = true;
  console.log("[Genelibros] CREDIT GUARD: routing mixto activado (Pro reservado para Draft A + Synthesis).");
}

// V5.8 ranking/pruning y reparación quirúrgica no necesitan Pro por defecto.
const oldRepairModels = `  const primaryModel = clean(process.env.DEEP_REPAIR_MODEL || modelFor(input.depth));\n  const deepModel = clean(modelFor(input.depth));`;
const newRepairModels = `  const primaryModel = clean(\n    process.env.DEEP_REPAIR_MODEL ||\n    process.env.DEEP_BUDGET_MODEL ||\n    process.env.DEEP_FAST_MODEL ||\n    "gemini-2.5-flash"\n  );\n  const deepModel = clean(\n    process.env.DEEP_REPAIR_DEEP_MODEL ||\n    process.env.DEEP_REPAIR_MODEL ||\n    process.env.DEEP_BUDGET_MODEL ||\n    process.env.DEEP_FAST_MODEL ||\n    "gemini-2.5-flash"\n  );`;

if (runtime.includes(oldRepairModels)) {
  runtime = runtime.replace(oldRepairModels, newRepairModels);
  runtimeChanged = true;
  console.log("[Genelibros] CREDIT GUARD: REPAIR V5.8 usa Flash por defecto; Pro solo mediante override.");
}

// Nunca gastar una reparación automática si el propio juez no especificó qué reparar.
const oldCanRepair = `    if (quality.unsupportedNewClaims.length) quality = { ...quality, verdict: "REPAIR" };\n    if (quality.overallScore < policy.threshold && quality.verdict === "APPROVED") quality = { ...quality, verdict: "REPAIR" };\n    const canRepair = quality.verdict === "REPAIR" && Number(result.repairAttempts || 0) < policy.maxRepairAttempts;\n    if (!canRepair && quality.verdict === "REPAIR") quality = { ...quality, verdict: "REJECTED" };`;
const newCanRepair = `    if (quality.unsupportedNewClaims.length) quality = { ...quality, verdict: "REPAIR" };\n    if (quality.overallScore < policy.threshold && quality.verdict === "APPROVED") quality = { ...quality, verdict: "REPAIR" };\n\n    const creditGuardEnabled = !["0", "false", "off"].includes(\n      clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()\n    );\n    const actionableRepair =\n      (Array.isArray(quality.requiredRepairs) && quality.requiredRepairs.length > 0) ||\n      (Array.isArray(quality.unsupportedNewClaims) && quality.unsupportedNewClaims.length > 0);\n\n    if (creditGuardEnabled && quality.verdict === "REPAIR" && !actionableRepair) {\n      quality = {\n        ...quality,\n        verdict: "REJECTED",\n        weaknesses: [\n          ...(quality.weaknesses || []),\n          "CREDIT_GUARD: el juez no produjo requiredRepairs ni claims concretos; se detiene antes de gastar otra llamada de reparación ciega."\n        ],\n      };\n    }\n\n    const canRepair =\n      quality.verdict === "REPAIR" &&\n      (!creditGuardEnabled || actionableRepair) &&\n      Number(result.repairAttempts || 0) < policy.maxRepairAttempts;\n    if (!canRepair && quality.verdict === "REPAIR") quality = { ...quality, verdict: "REJECTED" };`;

if (!worker.includes("CREDIT_GUARD: el juez no produjo requiredRepairs") && worker.includes(oldCanRepair)) {
  worker = worker.replace(oldCanRepair, newCanRepair);
  workerChanged = true;
  console.log("[Genelibros] CREDIT GUARD: reparaciones ciegas bloqueadas.");
}

if (runtimeChanged) fs.writeFileSync(runtimeFile, runtime, "utf8");
if (workerChanged) fs.writeFileSync(workerFile, worker, "utf8");

if (!runtimeChanged && !workerChanged) {
  console.log("[Genelibros] CREDIT GUARD ya estaba instalado.");
}
console.log("[Genelibros] CREDIT GUARD activo por defecto. Para desactivarlo explícitamente: DEEP_CREDIT_GUARD=0.");

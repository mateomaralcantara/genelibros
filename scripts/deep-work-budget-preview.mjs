const mode = String(process.argv[2] || "SUPREME").trim().toUpperCase();
const guardEnabled = !["0", "false", "off"].includes(String(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase());
const budgetModel = process.env.DEEP_BUDGET_MODEL || process.env.DEEP_FAST_MODEL || "gemini-2.5-flash";
const supremeModel = process.env.DEEP_SUPREME_MODEL || process.env.DEEP_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.1-pro-preview";

const policies = {
  FAST: { drafts: 1, repairs: 0, threshold: 8.6, maxCalls: 4 },
  DEEP: { drafts: 2, repairs: 1, threshold: 9.0, maxCalls: 7 },
  SUPREME: guardEnabled
    ? { drafts: 2, repairs: 1, threshold: 9.3, maxCalls: 9 }
    : { drafts: 3, repairs: 2, threshold: 9.3, maxCalls: 13 },
  ULTRA: { drafts: 3, repairs: 3, threshold: 9.5, maxCalls: 15 },
};

const policy = policies[mode] || policies.SUPREME;
const hardCap = Math.max(1, Number(process.env.DEEP_MAX_LLM_CALLS || policy.maxCalls));
const generateAttempts = guardEnabled ? Math.max(1, Number(process.env.DEEP_GENERATE_MAX_ATTEMPTS || 1)) : 3;

const stages = mode === "SUPREME" && guardEnabled
  ? [
      ["PLAN", budgetModel, 1],
      ["CONTEXT", budgetModel, 1],
      ["DRAFT A", supremeModel, 1],
      ["DRAFT B", budgetModel, 1],
      ["CRITIC", budgetModel, 1],
      ["SYNTHESIS", supremeModel, 1],
      ["QUALITY", budgetModel, 1],
      ["REPAIR (solo si actionable)", budgetModel, 1],
      ["QUALITY final", budgetModel, 1],
    ]
  : [];

console.log("\n==============================================");
console.log(" GENELIBROS — DEEP WORK BUDGET PREVIEW");
console.log("==============================================");
console.log({
  mode,
  creditGuard: guardEnabled,
  threshold: policy.threshold,
  drafts: policy.drafts,
  maxAutomaticRepairs: policy.repairs,
  hardLlmCallCap: hardCap,
  generateAttemptsPerJsonStage: generateAttempts,
  budgetModel,
  supremeModel,
  networkCallsMadeByThisPreview: 0,
  llmCallsMadeByThisPreview: 0,
});

if (stages.length) {
  console.log("\nRuta SUPREME con Credit Guard:");
  for (const [stage, model, calls] of stages) {
    console.log(`- ${String(stage).padEnd(30)} ${String(model).padEnd(28)} max ${calls}`);
  }
  console.log(`\nTecho duro: ${hardCap} llamadas LLM por job. Al alcanzarlo, el job pasa a PERSIST/REJECTED para revisión; no continúa gastando.`);
}

console.log("\nEste comando es solo lectura y no llama a Gemini ni Supabase.\n");

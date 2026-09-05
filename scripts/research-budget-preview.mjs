const maxQueries = Math.max(1, Number(process.env.RESEARCH_MAX_QUERIES || 5));
const maxSources = Math.max(3, Number(process.env.RESEARCH_MAX_SOURCES || 6));
const base = [
  ["STRATEGY", 1],
  ["QUERIES", 1],
  ["DISCOVER", maxQueries],
  ["EVIDENCE", maxSources],
  ["CLAIMS", 1],
  ["CONTRADICTIONS", 1],
  ["VERIFY", 1],
  ["GAPS", 1],
  ["DOSSIER", 1],
];
const total = base.reduce((sum, [, calls]) => sum + calls, 0);
const model = process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash";

console.log("\n================================================");
console.log(" GENELIBROS — RESEARCH 11D BUDGET PREVIEW");
console.log("================================================");
console.log({
  creditGuard: true,
  model,
  firstPassOnly: true,
  maxQueries,
  maxSources,
  deterministicBaseCallCeiling: total,
  gapClosureAutomatic: false,
  networkCallsMadeByPreview: 0,
  llmCallsMadeByPreview: 0,
});
console.log("\nPrimera pasada máxima:");
for (const [stage, calls] of base) console.log(`- ${stage.padEnd(20)} ${String(calls).padStart(2)} llamada(s)`);
console.log(`\nTOTAL MÁXIMO BASE: ${total} llamadas ${model}.`);
console.log("Si el dossier no queda ready_for_writing, se persiste REJECT/NOT READY y se inspeccionan gaps antes de autorizar más búsquedas.");

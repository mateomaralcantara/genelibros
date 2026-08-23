import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(file) {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function assert(name, condition) {
  if (!condition) {
    console.error("❌ FAIL:", name);
    process.exitCode = 1;
    return;
  }

  console.log("✅ PASS:", name);
}

const app = read("App.tsx");
const gemini = read("src/lib/gemini.ts");
const composer = read("api/composer.ts");
const packageJson = read("package.json");
const plans = read("src/lib/elite/elite-plans.ts");
const usage = read("src/lib/elite/elite-usage.ts");
const queue = read("src/lib/elite/elite-generation-queue.ts");
const exportContract = read("src/lib/elite/elite-export-contract.ts");
const sql = read("sql/elite-market-10-schema.sql");

console.log("");
console.log("==========================================");
console.log("ELITE SMOKE TESTS");
console.log("==========================================");

assert("App.tsx existe", app.length > 1000);
assert("gemini.ts existe", gemini.length > 1000);
assert("composer.ts existe", composer.length > 1000);
assert("package.json existe", packageJson.length > 20);

assert("Tiene extractor de título", app.includes("extractBookTitleFromIdea"));
assert("Tiene extracción de capítulos", app.includes("extractChapterTitlesFromIdea"));
assert("Tiene outline_12", (app + gemini).includes("outline_12"));
assert("Tiene subheads_h2", (app + gemini).includes("subheads_h2"));

assert("No fuerza JSON para todo si hay composer de producción", composer.includes("isLongTextAction") || gemini.includes("LongAction"));
assert("Tiene safeJsonParse", (composer + gemini).includes("safeJsonParse"));

assert("Tiene planes SaaS", plans.includes("ELITE_PLANS"));
assert("Tiene pricing", plans.includes("pricing"));
assert("Tiene créditos", plans.includes("creditsPerMonth"));
assert("Tiene usage_limit", plans.includes("usage_limit"));

assert("Tiene usage_events SQL", sql.includes("usage_events"));
assert("Tiene generation_jobs SQL", sql.includes("generation_jobs"));
assert("Tiene pipeline_events SQL", sql.includes("pipeline_events"));
assert("Tiene subscription_plans SQL", sql.includes("subscription_plans"));

assert("Tiene rate limit contract", usage.includes("evaluateRateLimit"));
assert("Tiene cost estimation", usage.includes("estimateTokenCostUsd"));
assert("Tiene queue contract", queue.includes("EliteGenerationJob"));
assert("Tiene pipeline visible", queue.includes("Blueprint") && queue.includes("Fact-check") && queue.includes("Export"));

assert("Tiene export PDF", exportContract.includes("pdf"));
assert("Tiene export DOCX", exportContract.includes("docx"));
assert("Tiene export EPUB", exportContract.includes("epub"));

if (process.exitCode) {
  console.log("");
  console.log("❌ Smoke tests fallaron.");
  process.exit(process.exitCode);
}

console.log("");
console.log("✅ Todos los smoke tests pasaron.");


console.log("");
console.log("==========================================");
console.log("FINAL 10 LIVE TESTS");
console.log("==========================================");

const researchApi = read("api/research.ts");
const exportApi = read("api/export.ts");
const appFinal = read("App.tsx");
const composerFinal = read("api/composer.ts");
const sqlFinal = read("sql/elite-research-schema.sql");
const researchContractFinal = read("src/lib/elite/elite-research-contract.ts");

assert("/api/research existe", researchApi.includes("COLLECT_SOURCES") && researchApi.includes("EXTRACT_FACTS"));
assert("/api/research tiene fetch", researchApi.includes("fetch("));
assert("/api/research tiene extractHtml", researchApi.includes("extractHtml"));
assert("/api/export existe", exportApi.includes("pdf") && exportApi.includes("docx") && exportApi.includes("epub"));

assert("Research contract conectado a /api/research", researchContractFinal.includes("/api/research"));
assert("Research contract tiene search client", researchContractFinal.includes("eliteResearchSearchClient"));
assert("Research contract tiene extractHtml", researchContractFinal.includes("extractHtml"));

assert("SQL principal tiene subscription_plans", sqlFinal.includes("subscription_plans"));
assert("SQL principal tiene usage_events", sqlFinal.includes("usage_events"));
assert("SQL principal tiene generation_jobs", sqlFinal.includes("generation_jobs"));
assert("SQL principal tiene pipeline_events", sqlFinal.includes("pipeline_events"));
assert("SQL principal tiene pricing/billing", sqlFinal.includes("pricing") && sqlFinal.includes("billing"));

assert("App tiene pipeline visible", appFinal.includes("Blueprint") && appFinal.includes("Investigación") && appFinal.includes("Fact-check") && appFinal.includes("Export"));
assert("App tiene monetización detectada", appFinal.includes("pricing") && appFinal.includes("stripe") && appFinal.includes("credits") && appFinal.includes("subscription"));
assert("App tiene exportaciones", appFinal.includes("pdf") && appFinal.includes("docx") && appFinal.includes("epub"));
assert("App tiene quality gate conectado", appFinal.includes("scoreEliteChapterText") && appFinal.includes("FACT_CHECK_CHAPTER"));

assert("Composer tiene usage/rate/queue markers", composerFinal.includes("usage_events") && composerFinal.includes("rateLimit") && composerFinal.includes("generation_jobs"));
assert("Composer tiene fact-check markers", composerFinal.includes("FACT_CHECK_CHAPTER") && composerFinal.includes("scoreEliteChapterText"));

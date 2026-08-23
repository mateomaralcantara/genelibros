import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let failed = 0;

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function test(name, condition) {
  if (condition) {
    console.log("✅ PASS:", name);
  } else {
    failed++;
    console.error("❌ FAIL:", name);
  }
}

console.log("");
console.log("==========================================");
console.log("BESTSELLER OS4 SUPREME TESTS");
console.log("==========================================");

const app = read("App.tsx");
const api = read("api/os4.ts");
const ui = read("components/AutonomousPublishingOS.tsx");
const orchestrator = read("src/lib/os4/orchestrator.ts");
const quality = read("src/lib/os4/quality.ts");
const repo = read("src/lib/os4/repo.ts");
const types = read("src/lib/os4/types.ts");
const sql = read("sql/bestseller-os4-schema.sql");
const pkg = JSON.parse(read("package.json"));

test("OS4 API existe", api.includes("BESTSELLER AUTONOMOUS PUBLISHING OS 4.0 SUPREME"));
test("OS4 tiene Market Strategist", api.includes("MARKET_STRATEGIST"));
test("OS4 tiene Concept Arena", api.includes("CONCEPT_ARENA"));
test("OS4 tiene Author DNA", api.includes("AUTHOR_DNA_ANALYST"));
test("OS4 tiene Book Architect", api.includes("BOOK_ARCHITECT"));
test("OS4 tiene Research Director", api.includes("RESEARCH_DIRECTOR"));
test("OS4 tiene Knowledge Engineer", api.includes("KNOWLEDGE_ENGINEER"));
test("OS4 tiene Book Simulator", api.includes("BOOK_SIMULATOR"));
test("OS4 tiene Fact Checker", api.includes("FACT_CHECKER"));
test("OS4 tiene Adversarial Critic", api.includes("ADVERSARIAL_CRITIC"));
test("OS4 tiene Quality Judge", api.includes("QUALITY_JUDGE"));
test("OS4 tiene Rewrite Editor", api.includes("REWRITE_EDITOR"));
test("OS4 tiene Master Editor", api.includes("MASTER_EDITOR"));
test("OS4 tiene Launch Strategist", api.includes("LAUNCH_STRATEGIST"));

test("Orchestrator usa existing callComposer", orchestrator.includes("callComposer"));
test("Orchestrator ejecuta Council paralelo", orchestrator.includes("Promise.all"));
test("Orchestrator tiene repair loop", orchestrator.includes("maxRepairIterations"));
test("Orchestrator persiste capítulos", orchestrator.includes("upsertSection"));
test("Orchestrator persiste versiones", orchestrator.includes("insertSectionVersion"));
test("Orchestrator reconstruye master", orchestrator.includes("buildMasterServer"));
test("Orchestrator usa research existente", orchestrator.includes("runOs4Research"));
test("Quality gate combina señales deterministas", quality.includes("deterministicChapterSignals"));
test("Quality gate tiene non_repetition", quality.includes("non_repetition"));

test("Mission Control UI existe", ui.includes("SUPREME CONTROL CENTER"));
test("UI tiene libro completo Supreme", ui.includes("Libro completo Supreme"));
test("UI tiene Master Audit", ui.includes("AUDITAR MASTER"));
test("UI tiene Launch System", ui.includes("CREAR LAUNCH SYSTEM"));
test("App integrado con OS4 tab", app.includes('viewMode === "os4"'));
test("App importa AutonomousPublishingOS", app.includes("AutonomousPublishingOS"));

test("SQL os4_profiles", sql.includes("public.os4_profiles"));
test("SQL agent runs", sql.includes("public.os4_agent_runs"));
test("SQL quality reports", sql.includes("public.os4_quality_reports"));
test("SQL claims", sql.includes("public.os4_claims"));
test("SQL RLS", sql.includes("enable row level security"));
test("Repo usa Supabase", repo.includes('from("os4_profiles")'));
test("Tipos incluyen Knowledge Graph", types.includes("Os4KnowledgeGraph"));

test("package tiene os4:test", Boolean(pkg.scripts?.["os4:test"]));
test("package tiene os4:verify", Boolean(pkg.scripts?.["os4:verify"]));

if (failed) {
  console.error("");
  console.error(`❌ OS4: ${failed} pruebas fallaron.`);
  process.exit(1);
}

console.log("");
console.log("✅ BESTSELLER OS4 SUPREME: todas las pruebas estructurales pasaron.");

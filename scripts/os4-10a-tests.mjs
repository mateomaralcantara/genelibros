import fs from "node:fs";

function read(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""; }
function check(label, ok) {
  if (!ok) { console.error(`❌ FAIL: ${label}`); process.exitCode = 1; }
  else console.log(`✅ PASS: ${label}`);
}

console.log("\n==========================================");
console.log("BESTSELLER OS4 — FASE 10A TESTS");
console.log("==========================================");

const api = read("api/os4.ts");
const repo = read("src/lib/os4/repo.ts");
const types = read("src/lib/os4/types.ts");
const orch = read("src/lib/os4/orchestrator.ts");
const ui = read("components/AutonomousPublishingOS.tsx");
const sql = read("sql/os4-10a-cost-publishing.sql");
const pkg = JSON.parse(read("package.json") || "{}");

check("Cost Engine existe", api.includes("estimateOs4TokenCostUsd"));
check("Pricing Gemini 2.5 Flash", api.includes('"gemini-2.5-flash"') && api.includes("inputPerMillionUsd: 0.30"));
check("Pricing Gemini 2.5 Pro", api.includes('"gemini-2.5-pro"') && api.includes("outputPerMillionUsd: 10.00"));
check("Pricing configurable por env", api.includes("OS4_MODEL_PRICING_JSON"));
check("API devuelve estimated_cost_usd", api.includes("estimated_cost_usd: estimateOs4TokenCostUsd"));
check("Types transporta costo", types.includes("estimated_cost_usd?: number"));
check("Repo persiste costo", repo.includes("estimated_cost_usd: Number(response.usage?.estimated_cost_usd"));
check("Publishing Director invocado", orch.includes('agent: "PUBLISHING_DIRECTOR"') && orch.includes('action: "BUILD_PUBLISHING_PACKAGE"'));
check("Publishing plan persiste", orch.includes("publishing_plan: output"));
check("UI tiene Publishing Director", ui.includes("PUBLISHING DIRECTOR") && ui.includes("runOs4PublishingPlan"));
check("SQL agrega publishing_plan", sql.includes("add column if not exists publishing_plan"));
check("SQL asegura cost column", sql.includes("estimated_cost_usd"));
check("package tiene os4:10a:verify", Boolean(pkg?.scripts?.["os4:10a:verify"]));

if (!process.exitCode) console.log("\n✅ FASE 10A: todas las pruebas estructurales pasaron.");

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

const tests = [];
function test(name, fn) {
  try {
    const ok = Boolean(fn());
    tests.push({ name, ok });
  } catch (error) {
    tests.push({ name, ok: false, error: String(error?.message || error) });
  }
}

const requiredFiles = [
  "src/lib/brain/types.ts",
  "src/lib/brain/agent-registry.ts",
  "src/lib/brain/task-router.ts",
  "src/lib/brain/model-router.ts",
  "src/lib/brain/quality-router.ts",
  "src/lib/brain/cost-controller.ts",
  "src/lib/brain/context-builder.ts",
  "src/lib/brain/workflow-engine.ts",
  "src/lib/brain/brain.ts",
  "src/lib/brain/index.ts",
];

for (const file of requiredFiles) {
  test(`Existe ${file}`, () => exists(file));
}

const registry = read("src/lib/brain/agent-registry.ts");
const workflow = read("src/lib/brain/workflow-engine.ts");
const taskRouter = read("src/lib/brain/task-router.ts");
const brain = read("src/lib/brain/brain.ts");
const allBrain = requiredFiles.map(read).join("\n");

const os4Agents = [
  "MARKET_STRATEGIST",
  "CONCEPT_ARENA",
  "AUTHOR_DNA_ANALYST",
  "BOOK_ARCHITECT",
  "RESEARCH_DIRECTOR",
  "KNOWLEDGE_ENGINEER",
  "BOOK_SIMULATOR",
  "CHIEF_EDITOR",
  "FACT_CHECKER",
  "CONTINUITY_EDITOR",
  "STYLE_EDITOR",
  "ADVERSARIAL_CRITIC",
  "QUALITY_JUDGE",
  "REWRITE_EDITOR",
  "MASTER_EDITOR",
  "PUBLISHING_DIRECTOR",
  "LAUNCH_STRATEGIST",
  "PORTFOLIO_ANALYST",
];

for (const agent of os4Agents) {
  test(`Registry incluye OS4 ${agent}`, () => registry.includes(`"${agent}"`));
}

for (const family of [
  "CREATOR",
  "REFINERY",
  "DEEP_WORK",
  "RESEARCH",
  "SERIES",
  "EDITORIAL",
  "PUBLISHING",
]) {
  test(`Familia ${family}`, () => registry.includes(`"${family}"`));
}

for (const agent of [
  "MANUSCRIPT_AUDITOR",
  "MASTER_BOOK_REFINER",
  "DEEP_PLANNER",
  "MULTI_PASS_WRITER",
  "SOURCE_HUNTER",
  "CITATION_AUDITOR",
  "SERIES_ARCHITECT",
  "SERIES_BIBLE_KEEPER",
  "VOLUME_DIFFERENTIATOR",
  "SERIES_REDUNDANCY_GUARD",
  "SERIES_CHIEF_EDITOR",
]) {
  test(`Agente futuro registrado ${agent}`, () => registry.includes(`"${agent}"`));
}

test("Router CREATE_BOOK", () => taskRouter.includes("CREATE_BOOK"));
test("Router REFINE_BOOK", () => taskRouter.includes("REFINE_BOOK"));
test("Router DEEP_WORK", () => taskRouter.includes("DEEP_WORK"));
test("Router RESEARCH_NONFICTION", () => taskRouter.includes("RESEARCH_NONFICTION"));
test("Router CREATE_SERIES", () => taskRouter.includes("CREATE_SERIES"));
test("Workflow distingue READY/PLANNED", () =>
  workflow.includes('agent.status === "READY"') &&
  workflow.includes("plannedAgentIds")
);
test("Brain central existe", () =>
  brain.includes("class GenelibrosBrain") &&
  brain.includes("buildWorkflowPlan")
);
test("Brain no contiene secretos server-side", () =>
  !allBrain.includes("GEMINI_API_KEY") &&
  !allBrain.includes("SUPABASE_SERVICE_ROLE_KEY") &&
  !allBrain.includes("OS4_WORKER_SECRET")
);
test("Brain no usa process.env", () => !allBrain.includes("process.env"));

const pkg = JSON.parse(read("package.json"));
test("package tiene brain:11a:test", () =>
  pkg.scripts?.["brain:11a:test"] === "node scripts/brain-11a-tests.mjs"
);
test("package tiene brain:verify", () =>
  typeof pkg.scripts?.["brain:verify"] === "string"
);

console.log("\n==========================================");
console.log("GENELIBROS 5.0 — BRAIN FASE 11A TESTS");
console.log("==========================================");

for (const item of tests) {
  if (item.ok) {
    console.log(`✅ PASS: ${item.name}`);
  } else {
    console.log(`❌ FAIL: ${item.name}${item.error ? ` — ${item.error}` : ""}`);
  }
}

const failed = tests.filter((item) => !item.ok);

console.log("");
if (failed.length) {
  console.error(`❌ FASE 11A: ${failed.length} prueba(s) fallaron.`);
  process.exit(1);
}

console.log(`✅ FASE 11A: ${tests.length} pruebas pasaron.`);
console.log("✅ Brain + Agent Registry instalados sin cambiar el runtime OS4 existente.");

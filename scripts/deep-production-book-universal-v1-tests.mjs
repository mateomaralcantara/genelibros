import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const orchestrator = fs.readFileSync(path.resolve(root, "scripts/deep-production-book-universal-v1.mjs"), "utf8");
const runner = fs.readFileSync(path.resolve(root, "scripts/run-deep-production-book-universal-v1.mjs"), "utf8");

const checks = [
  ["universal version frozen", orchestrator.includes('UNIVERSAL_BOOK_VERSION = "1.0.0"')],
  ["orchestrator contains no direct Gemini client", !orchestrator.includes("GoogleGenAI") && !orchestrator.includes("generateContent(")],
  ["preflight explicitly zero LLM", orchestrator.includes("llmCallsMadeByPreflight: 0")],
  ["execute is explicit opt-in", orchestrator.includes('const execute = hasFlag("--execute")')],
  ["research budget separated", orchestrator.includes("--research-book-max-calls") && orchestrator.includes("recordedResearchCalls")],
  ["production budget separated", orchestrator.includes("--production-book-max-calls") && orchestrator.includes("recordedProductionCalls")],
  ["research per chapter has hard cap", orchestrator.includes("researchMaxCallsPerChapter") && orchestrator.includes("--max-calls")],
  ["research first pass only documented", orchestrator.includes("firstPassOnly: true")],
  ["no automatic second research", orchestrator.includes("automaticSecondResearch: false")],
  ["research uses existing chapter preflight", orchestrator.includes('runNode("scripts/research-chapter-preflight.mjs"')],
  ["research uses existing local stack", orchestrator.includes('runNode("scripts/run-research-local-stack.mjs")')],
  ["production uses editorial selector", orchestrator.includes('runNode("scripts/run-deep-production-editorial-v1.mjs"')],
  ["research minimum coverage imported", orchestrator.includes("MIN_RESEARCH_COVERAGE")],
  ["research minimum evidence imported", orchestrator.includes("MIN_RESEARCH_EVIDENCE")],
  ["research minimum factual imported", orchestrator.includes("MIN_RESEARCH_FACTUAL")],
  ["verified claims minimum imported", orchestrator.includes("MIN_VERIFIED_CLAIMS")],
  ["class AB minimum imported", orchestrator.includes("MIN_CLASS_AB_SOURCES")],
  ["quality threshold imported", orchestrator.includes("QUALITY_THRESHOLD")],
  ["production reserves seven calls", orchestrator.includes("FIRST_PASS_MAX_LLM_CALLS") && orchestrator.includes("remainingProduction < FIRST_PASS_MAX_LLM_CALLS")],
  ["already applied chapters skipped", orchestrator.includes("SKIPPED_APPLIED")],
  ["ineligible research pauses by default", orchestrator.includes("PAUSED_RESEARCH_INELIGIBLE")],
  ["refresh research requires explicit flag", orchestrator.includes('hasFlag("--refresh-research")')],
  ["rejected production pauses for explicit repair", orchestrator.includes("PAUSED_REPAIR_REQUIRED") && orchestrator.includes("deep:prod:repair")],
  ["automatic production repair disabled", orchestrator.includes("automaticRepair: false")],
  ["global active research/deep jobs block execute", orchestrator.includes("globalDeepActive.length || globalResearchActive.length")],
  ["manifest is resumable", orchestrator.includes("universal-book-${projectId}-last-run.json")],
  ["runner verifies universal tests", runner.includes("deep-production-book-universal-v1-tests.mjs")],
  ["runner verifies research semantics", runner.includes("research-evidence-semantics-tests.mjs")],
  ["runner verifies credit guard", runner.includes("research-credit-guard-tests.mjs")],
  ["runner verifies Production V1", runner.includes("deep-production-v1-tests.mjs")],
  ["runner typechecks before orchestration", runner.includes('runNpm(["run", "typecheck"])')],
];

let passed = 0;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`PASS — ${name}`);
    passed += 1;
  } else {
    console.error(`FAIL — ${name}`);
  }
}
console.log(`\n${passed}/${checks.length} Universal Book V1 checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (passed !== checks.length) process.exit(1);

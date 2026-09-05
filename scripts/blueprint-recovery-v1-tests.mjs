import fs from "node:fs";
import path from "node:path";

const blueprint = fs.readFileSync(path.resolve("scripts/blueprint-recovery-v1.mjs"), "utf8").replace(/\r\n?/g, "\n");
const finalRunnerPath = path.resolve("scripts/run-genelibros-book-final-v1.mjs");
const finalRunner = fs.existsSync(finalRunnerPath) ? fs.readFileSync(finalRunnerPath, "utf8").replace(/\r\n?/g, "\n") : "";

const providerCallCount = (blueprint.match(/ai\.models\.generateContent\s*\(/g) || []).length;
const reserveAt = blueprint.indexOf('status: "INVOKING"');
const providerAt = blueprint.indexOf("ai.models.generateContent");
const persistAt = blueprint.indexOf("outline_12: outline");

const checks = [
  ["blueprint version frozen", blueprint.includes('BLUEPRINT_RECOVERY_VERSION = "1.0.0"')],
  ["hard cap exactly one provider call", blueprint.includes("MAX_PROVIDER_CALLS = 1") && providerCallCount === 1],
  ["default mode is preflight", blueprint.includes("if (!execute)") && blueprint.includes("0 LLM / 0 mutaciones")],
  ["execute budget is explicit", blueprint.includes('requestedMaxCalls < MAX_PROVIDER_CALLS')],
  ["provider invocation reserved before call", reserveAt >= 0 && providerAt > reserveAt],
  ["failed invocation blocks implicit repeat", blueprint.includes("providerInvocations") && blueprint.includes("--retry-technical")],
  ["no automatic repair or retry loop", !/for\s*\([^)]*attempt/i.test(blueprint) && !blueprint.includes("withRetry")],
  ["existing production blueprint costs zero", blueprint.includes("BLUEPRINT READY — no se consume LLM")],
  ["generic chapter titles rejected", blueprint.includes("isGenericTitle") && blueprint.includes("título genérico")],
  ["prefixed legacy generic titles are normalized", blueprint.includes("function normalizeChapterTitle") && blueprint.includes("^capitulo\\s+\\d+")],
  ["final runner applies same legacy generic policy", finalRunner.includes("function normalizeChapterTitle") && finalRunner.includes("^capitulo\\s+\\d+")],
  ["blueprint requires structured editorial depth", blueprint.includes("subheads.length < 5") && blueprint.includes("requiredFacts.length < 3")],
  ["completed chapters are context anchors", blueprint.includes("content_excerpt") && blueprint.includes("latest_research_topic")],
  ["book text is never rewritten", !blueprint.includes('.from("sections").update') && !blueprint.includes("upsertSection")],
  ["outline persists only after validation", persistAt > providerAt && blueprint.includes("validateBlueprint(parsed")],
  ["recovery checkpoint stored in continuity pack", blueprint.includes("blueprintRecovery") && blueprint.includes("continuity_pack")],
  ["no hardcoded Canary project", !blueprint.includes("La Factura Invisible") && !blueprint.includes("5776b355")],
  ["final runner exists", Boolean(finalRunner)],
  ["final runner delegates to Universal Book", finalRunner.includes("run-deep-production-book-universal-v1.mjs")],
  ["final runner gives blueprint a separate budget", finalRunner.includes("--blueprint-max-calls")],
  ["final runner never hides blueprint spend", finalRunner.includes("BLUEPRINT_REQUIRED") && finalRunner.includes("blueprintMaxCalls < 1")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS — ${name}`);
  else { failed += 1; console.error(`FAIL — ${name}`); }
}
console.log(`\n${checks.length - failed}/${checks.length} Blueprint Recovery V1 checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

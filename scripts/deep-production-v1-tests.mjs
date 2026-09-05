import fs from "node:fs";
import path from "node:path";
import {
  DEEP_PRODUCTION_VERSION,
  QUALITY_THRESHOLD,
  FIRST_PASS_MAX_LLM_CALLS,
  FINAL_MAX_LLM_CALLS,
  DRAFT_COUNT,
  MAX_REPAIR_ATTEMPTS,
  DIRECT_REPAIR_THINKING_LEVEL,
  DIRECT_REPAIR_DEFAULT_MAX_OUTPUT_TOKENS,
  MIN_RESEARCH_COVERAGE,
  MIN_RESEARCH_EVIDENCE,
  MIN_RESEARCH_FACTUAL,
  MIN_VERIFIED_CLAIMS,
  MIN_CLASS_AB_SOURCES,
  wordRange,
} from "./deep-production-v1-contract.mjs";

const root = process.cwd();
const chapter = fs.readFileSync(path.resolve(root, "scripts/deep-production-chapter.mjs"), "utf8");
const repair = fs.readFileSync(path.resolve(root, "scripts/deep-production-repair.mjs"), "utf8");
const apply = fs.readFileSync(path.resolve(root, "scripts/deep-production-apply.mjs"), "utf8");
const runner = fs.readFileSync(path.resolve(root, "scripts/run-deep-production-v1.mjs"), "utf8");
const repairRunner = fs.readFileSync(path.resolve(root, "scripts/run-deep-production-repair-v1.mjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.resolve(root, "package.json"), "utf8"));
const range2500 = wordRange(2500);

const forbiddenSpecifics = [
  "b0d55161-ec60-491e-b6f4-fb4142029408",
  "9ba3ef8e-f4ea-46c4-913d-42173b5ebcb2",
  "cbf831cb-b85b-4383-86c8-6e0c86c7b2e8",
  "La Factura Invisible",
  "FINAL_CH3_DOSSIER",
];
const genericBundle = [chapter, repair, apply, runner, repairRunner].join("\n");

const checks = [
  ["Production V1 version frozen", DEEP_PRODUCTION_VERSION === "1.0.0"],
  ["quality threshold frozen at 9.3", QUALITY_THRESHOLD === 9.3],
  ["first pass hard cap frozen at seven", FIRST_PASS_MAX_LLM_CALLS === 7],
  ["final hard cap frozen at nine", FINAL_MAX_LLM_CALLS === 9],
  ["two drafts and one explicit repair", DRAFT_COUNT === 2 && MAX_REPAIR_ATTEMPTS === 1],
  ["research minimums frozen", MIN_RESEARCH_COVERAGE === 7.5 && MIN_RESEARCH_EVIDENCE === 7.5 && MIN_RESEARCH_FACTUAL === 7.5 && MIN_VERIFIED_CLAIMS === 3 && MIN_CLASS_AB_SOURCES === 2],
  ["word range frozen at 92-108 percent", range2500.min === 2300 && range2500.max === 2700],
  ["direct repair thinking minimal", DIRECT_REPAIR_THINKING_LEVEL === "MINIMAL"],
  ["direct repair output default 48k", DIRECT_REPAIR_DEFAULT_MAX_OUTPUT_TOKENS === 48000],
  ["chapter runner requires project and chapter", chapter.includes('--project <uuid>') && chapter.includes('--chapter <n>')],
  ["chapter uses generic Production V1 marker", chapter.includes("productionMarker") && chapter.includes("GENELIBROS")],
  ["chapter auto-selects ready research", chapter.includes('.eq("ready_for_writing", true)')],
  ["editorial override is explicit", chapter.includes("--allow-editorial-override") && chapter.includes("researchEditorialOverride")],
  ["no-research mode is explicit", chapter.includes("--allow-no-research")],
  ["technical retry requires explicit flag", chapter.includes("--resume-technical") && chapter.includes("retry técnico EXPLÍCITO") && chapter.includes("No puede reactivarse")],
  ["preflight is zero-LLM", !chapter.includes("GoogleGenAI") && !chapter.includes("generateContent(")],
  ["enqueue is idempotent", chapter.includes("este capítulo/configuración ya tiene job idempotente") && chapter.includes("no se crea otro")],
  ["generic scripts contain no Chapter 3 IDs", forbiddenSpecifics.every((value) => !genericBundle.includes(value))],
  ["runner requires execute to spend", runner.includes('rawArgs.includes("--execute")') && runner.includes("PREFLIGHT ONLY (0 LLM)")],
  ["runner installs longform before execution", runner.indexOf("patch-deep-work-longform-text.mjs") < runner.indexOf("deep-production-chapter.mjs")],
  ["repair requires completed rejected first pass", repair.includes('verdict !== "REJECTED"') && repair.includes("FIRST_PASS_MAX_LLM_CALLS")],
  ["repair blocks repeated provider invocation", repair.includes("directRepairInvocations !== 0") && repair.includes("directRepairInvocations: 1")],
  ["repair reserves invocation before Gemini", repair.indexOf("directRepairInvocations: 1") < repair.indexOf("ai.models.generateContent")],
  ["repair makes exactly one direct Gemini call", (repair.match(/ai\.models\.generateContent\(/g) || []).length === 1],
  ["repair resumes at QUALITY", repair.includes('checkpoint: { version: "11C", step: "QUALITY" }')],
  ["repair marks repairAttempts one", repair.includes("result.repairAttempts = 1")],
  ["repair runner is explicit execute opt-in", repairRunner.includes('rawArgs.includes("--execute")') && repairRunner.includes("PREFLIGHT ONLY (0 LLM)")],
  ["apply requires approved threshold", apply.includes('verdict !== "APPROVED"') && apply.includes("QUALITY_THRESHOLD")],
  ["apply uses dynamic target range", apply.includes("wordRange(job.target_words")],
  ["apply protects source hash", apply.includes("SOURCE_CHANGED") && apply.includes("result.sourceHash")],
  ["apply backs up before update", apply.indexOf("writeFileSync") < apply.indexOf('.update({ title: finalTitle, content })')],
  ["public chapter command installed", String(pkg.scripts?.["deep:prod:chapter"] || "").includes("run-deep-production-v1.mjs")],
  ["public repair command installed", String(pkg.scripts?.["deep:prod:repair"] || "").includes("run-deep-production-repair-v1.mjs")],
  ["public verify command installed", String(pkg.scripts?.["deep:prod:verify"] || "").includes("deep-production-v1-tests.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} Production V1 checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

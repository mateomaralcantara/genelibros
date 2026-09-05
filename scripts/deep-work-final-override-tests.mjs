import fs from "node:fs";
import path from "node:path";

const worker = fs.readFileSync(path.resolve("src/server/vercel-handlers/deep-work-worker.ts"), "utf8");
const enqueue = fs.readFileSync(path.resolve("scripts/deep-work-chapter3-final.mjs"), "utf8");
const runner = fs.readFileSync(path.resolve("scripts/run-deep-final-local-stack.mjs"), "utf8");
const apply = fs.readFileSync(path.resolve("scripts/apply-deep-work-chapter3-approved.mjs"), "utf8");

const checks = [
  ["explicit dossier override installed", worker.includes("DEEP_RESEARCH_EDITORIAL_OVERRIDE_V1_APPLIED")],
  ["explicit dossier selected by id", worker.includes('researchQuery.eq("id", dossierId)')],
  ["verified claims remain mandatory", worker.includes('clean(claim.status) === "VERIFIED"') && worker.includes("Boolean(claim.citationReady)")],
  ["open gaps remain prohibited", worker.includes("GAPS ABIERTOS — NO convertirlos en afirmaciones completas")],
  ["preferred title preserved", worker.includes("DEEP_PREFERRED_TITLE_APPLIED") && worker.includes("clean(result.preferredTitle)")],
  ["final job pins exact dossier", enqueue.includes('9ba3ef8e-f4ea-46c4-913d-42173b5ebcb2')],
  ["final job hard cap is seven", enqueue.includes("const MAX_CALLS = 7") && enqueue.includes("maxLlmCalls: MAX_CALLS")],
  ["final job is applyable improve", enqueue.includes('operation: "IMPROVE"') && !enqueue.includes('operation: "GENERATE"')],
  ["final job does not fake ready flag", enqueue.includes("dossierReadyHistorical") && enqueue.includes("researchEditorialOverride: true")],
  ["final job resumes retry instead of duplicating", enqueue.includes('["RETRYING", "FAILED", "DEAD_LETTER"]') && enqueue.includes('status: "QUEUED"') && enqueue.includes("retry after model compatibility fix")],
  ["final resume preserves checkpoint", enqueue.includes("resumeFromStep: resumed.checkpoint?.step") && !enqueue.includes('checkpoint: { version: "11C", step: "PLAN"')],
  ["one-command deep runner exists", runner.includes("deep:11c:dev") && runner.includes("deep:11c:worker") && runner.includes("/api/deep-work-worker")],
  ["auto apply requires approved 9.3", apply.includes('verdict !== "APPROVED"') && apply.includes("score < 9.3") && apply.includes("result.applyAllowed !== true")],
  ["auto apply protects source and length", apply.includes("SOURCE_CHANGED") && apply.includes("wc < 2300") && apply.includes("wc > 2700")],
  ["auto apply backs up before update", apply.includes("chapter-3-before-approved-final") && apply.includes('.update({ title: FINAL_TITLE, content })')],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

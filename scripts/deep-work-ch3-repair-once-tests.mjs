import fs from "node:fs";
import path from "node:path";

const prep = fs.readFileSync(path.resolve("scripts/deep-work-ch3-repair-once.mjs"), "utf8");
const runner = fs.readFileSync(path.resolve("scripts/run-deep-ch3-repair-once.mjs"), "utf8");

const checks = [
  ["final job id pinned", prep.includes('b0d55161-ec60-491e-b6f4-fb4142029408')],
  ["requires exactly seven existing calls", prep.includes("const EXPECTED_CALLS = 7") && prep.includes("calls !== EXPECTED_CALLS")],
  ["extends hard cap only to nine", prep.includes("const FINAL_MAX_CALLS = 9") && prep.includes("maxAdditionalLlmCalls: 2")],
  ["requires budget stopped before repair", prep.includes('stoppedBefore === "REPAIR"') && prep.includes("budget.hit === true")],
  ["requires zero prior repair attempts", prep.includes("repairAttempts !== 0")],
  ["blocks blind repair", prep.includes("QUALITY no contiene repairs accionables") && prep.includes("restoredActionable")],
  ["restores persisted synthesis", prep.includes('.eq("artifact_type", "SYNTHESIS")') && prep.includes("BEGIN_SYNTHESIS")],
  ["restores persisted quality", prep.includes('.eq("artifact_type", "QUALITY")') && prep.includes("QUALITY REPORT")],
  ["exactly one direct Gemini repair call", (prep.match(/ai\.models\.generateContent\(/g) || []).length === 1],
  ["direct repair is plain text", prep.includes("NO JSON. NO fences") && prep.includes("const repairedText")],
  ["direct repair records one call", prep.includes("calls: 1") && prep.includes("usage.calls") && prep.includes("se esperaba 8")],
  ["direct repair artifact persisted", prep.includes('p_artifact_type: "REPAIR"') && prep.includes('p_label: "REPAIR_1_DIRECT"')],
  ["resumes exactly at quality", prep.includes('checkpoint: { version: "11C", step: "QUALITY" }')],
  ["repair attempts set to one", prep.includes("result.repairAttempts = 1")],
  ["no automatic second repair", prep.includes("maxRepairAttempts: 1") && prep.includes("automaticSecondRepair: false")],
  ["runner bypasses repairStep patch", !runner.includes("patch-deep-repair-single-call.mjs")],
  ["runner performs direct repair before worker", runner.indexOf('deep-work-ch3-repair-once.mjs') < runner.indexOf('run-deep-final-local-stack.mjs')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} direct-final-repair checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

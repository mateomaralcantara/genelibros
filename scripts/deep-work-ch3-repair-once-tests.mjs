import fs from "node:fs";
import path from "node:path";

const runtime = fs.readFileSync(path.resolve("src/server/deep-work-runtime.ts"), "utf8");
const prep = fs.readFileSync(path.resolve("scripts/deep-work-ch3-repair-once.mjs"), "utf8");
const patch = fs.readFileSync(path.resolve("scripts/patch-deep-repair-single-call.mjs"), "utf8");

const checks = [
  ["repair internal attempt cap installed", runtime.includes("DEEP_REPAIR_SINGLE_CALL_V1_APPLIED") && runtime.includes("DEEP_REPAIR_INTERNAL_MAX_ATTEMPTS || 1")],
  ["final job id pinned", prep.includes('b0d55161-ec60-491e-b6f4-fb4142029408')],
  ["requires exactly seven existing calls", prep.includes("const EXPECTED_CALLS = 7") && prep.includes("calls !== EXPECTED_CALLS")],
  ["extends hard cap only to nine", prep.includes("const FINAL_MAX_CALLS = 9") && prep.includes("maxAdditionalCalls: 2")],
  ["requires budget stopped before repair", prep.includes('stoppedBefore === "REPAIR"') && prep.includes("budget.hit === true")],
  ["requires zero prior repair attempts", prep.includes("repairAttempts !== 0")],
  ["blocks blind repair", prep.includes("QUALITY no contiene repairs accionables") && prep.includes("restoredActionable")],
  ["restores persisted synthesis", prep.includes('.eq("artifact_type", "SYNTHESIS")') && prep.includes('label: "SYNTHESIS"')],
  ["restores persisted quality", prep.includes('.eq("artifact_type", "QUALITY")') && prep.includes("result.quality = restoredQuality")],
  ["resumes exactly at repair", prep.includes('checkpoint: { version: "11C", step: "REPAIR" }')],
  ["no automatic second repair", prep.includes("maxRepairAttempts: 1") && prep.includes("automaticSecondRepair: false")],
  ["patch script defaults repair internals to one", patch.includes("DEEP_REPAIR_INTERNAL_MAX_ATTEMPTS || 1")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} final-repair checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

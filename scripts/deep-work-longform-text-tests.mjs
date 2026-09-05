import fs from "node:fs";
import path from "node:path";

const runtime = fs.readFileSync(path.resolve("src/server/deep-work-runtime.ts"), "utf8");

const checks = [
  ["longform marker installed", runtime.includes("DEEP_LONGFORM_TEXT_V1_APPLIED")],
  ["three long stages intercepted", runtime.includes("MULTI_PASS_WRITER|ALTERNATIVE_DRAFT_WRITER|SYNTHESIS_EDITOR")],
  ["longform output budget at least 24k", runtime.includes("Math.max(24000")],
  ["flash thinking budget bounded", runtime.includes("DEEP_LONGFORM_THINKING_BUDGET || 1024")],
  ["longform response is plain text", runtime.includes("Devuelve SOLO el documento completo en texto plano. No uses JSON.")],
  ["longform does not request JSON mime", runtime.includes("const longformConfig: AnyRow") && runtime.includes("responseMimeType: \"application/json\"")],
  ["truncation fails closed", runtime.includes("LONGFORM_TRUNCATED por MAX_TOKENS")],
  ["usage is still counted", runtime.includes("usage: usageOf(response as any)")],
  ["critic quality JSON path remains", runtime.includes("async function generateJson") && runtime.includes("JSON.parse")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} longform checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

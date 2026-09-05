import fs from "node:fs";
import path from "node:path";

const runtime = fs.readFileSync(path.resolve("src/server/deep-work-runtime.ts"), "utf8");

function sanitize(input) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (!inString) {
      if (char === '"') inString = true;
      out += char;
      continue;
    }
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      out += char;
      inString = false;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code <= 0x1f) {
      if (code === 0x08) out += "\\b";
      else if (code === 0x09) out += "\\t";
      else if (code === 0x0a) out += "\\n";
      else if (code === 0x0c) out += "\\f";
      else if (code === 0x0d) out += "\\r";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += char;
  }
  return out;
}

const raw = '{"content":"línea 1\nlínea 2\tcolumna\rretorno' + String.fromCharCode(1) + 'fin","ok":true}';
let rawFailed = false;
try { JSON.parse(raw); } catch { rawFailed = true; }
const parsed = JSON.parse(sanitize(raw));
const valid = '{"content":"línea 1\\nlínea 2\\tcolumna","ok":true}';

const checks = [
  ["raw control sample is invalid before sanitize", rawFailed],
  ["runtime sanitizer marker installed", runtime.includes("DEEP_JSON_CONTROL_SANITIZER_V1_APPLIED")],
  ["runtime sanitizer helper installed", runtime.includes("function escapeIllegalJsonControlChars")],
  ["parseJson uses sanitized fallback", runtime.includes("const sanitized = escapeIllegalJsonControlChars(repaired);") && runtime.includes("JSON.parse(sanitized)")],
  ["newline preserved semantically", parsed.content.includes("línea 1\nlínea 2")],
  ["tab and carriage return preserved semantically", parsed.content.includes("\t") && parsed.content.includes("\r")],
  ["other control char preserved via unicode escape", parsed.content.charCodeAt(parsed.content.indexOf("fin") - 1) === 1],
  ["already valid escaped JSON stays valid", JSON.stringify(JSON.parse(sanitize(valid))) === JSON.stringify(JSON.parse(valid))],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} JSON sanitizer checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

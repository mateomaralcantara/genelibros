#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "App.tsx");

if (!fs.existsSync(file)) {
  console.error("No encontré App.tsx en la raíz.");
  process.exit(1);
}

const c = fs.readFileSync(file, "utf8");

const checks = [
  ["ANTI-PROMPT-LEAKAGE", /ANTI-PROMPT-LEAKAGE/],
  ["extractChapterTitlesFromIdea", /function extractChapterTitlesFromIdea/],
  ["extractDesiredChapterCountSafe", /function extractDesiredChapterCountSafe/],
  ["normalizeOutlineTitles", /function normalizeOutlineTitles/],
  ["usa extractDesiredChapterCountSafe", /extractDesiredChapterCountSafe\(idea\)/],
  ["buildFallbackOutline usa títulos explícitos", /const explicitTitles = extractChapterTitlesFromIdea\(seed\)/],
];

let ok = true;

for (const [name, re] of checks) {
  const hit = re.test(c);
  console.log(`${hit ? "✅" : "❌"} ${name}`);
  if (!hit) ok = false;
}

if (/chapter_title:\s*`\$\{pickName\(i\)\}\s*—\s*\$\{topic\}`/.test(c)) {
  console.log("❌ Sigue el patrón peligroso `${pickName(i)} — ${topic}`");
  ok = false;
} else {
  console.log("✅ No existe el patrón peligroso `${pickName(i)} — ${topic}`");
}

process.exit(ok ? 0 : 1);

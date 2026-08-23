import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const files = {
  app: "App.tsx",
  gemini: "src/lib/gemini.ts",
  composer: "api/composer.ts",
  promptBank: "src/lib/elite/elite-prompt-bank.ts",
  qualityGate: "src/lib/elite/elite-quality-gate.ts",
  research: "src/lib/elite/elite-research-contract.ts",
  normalizer: "src/lib/elite/elite-blueprint-normalizer.ts",
  sql: "sql/elite-research-schema.sql",
};

function read(file) {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function has(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

function scoreItem(pass, points) {
  return pass ? points : 0;
}

const content = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)])
);

const all = Object.values(content).join("\n");

const areas = [
  {
    name: "Blueprint editorial",
    score:
      1 +
      scoreItem(has(all, "buildEliteBlueprintPrompt"), 2) +
      scoreItem(has(all, "editorial_blueprint"), 2) +
      scoreItem(has(all, "title_candidates"), 1.5) +
      scoreItem(has(all, "subtitle_candidates"), 1.5) +
      scoreItem(has(all, "subheads_h2"), 1) +
      scoreItem(has(all, "required_facts"), 1),
  },
  {
    name: "Control factual",
    score:
      1 +
      scoreItem(has(all, "buildEliteFactualRules"), 2) +
      scoreItem(has(all, "No inventes"), 1.5) +
      scoreItem(has(all, "VERIFIED"), 1.5) +
      scoreItem(has(all, "unsupported_claims"), 1.5) +
      scoreItem(has(all, "possible_hallucinations"), 1.5),
  },
  {
    name: "Investigación real",
    score:
      1 +
      scoreItem(has(all, "research_sources"), 2) +
      scoreItem(has(all, "research_facts"), 2) +
      scoreItem(has(all, "reliability_score"), 1.5) +
      scoreItem(has(all, "compactResearchForPrompt"), 1.5) +
      scoreItem(has(all, "source_type"), 1),
  },
  {
    name: "Quality gate",
    score:
      1 +
      scoreItem(has(all, "scoreEliteTitle"), 2) +
      scoreItem(has(all, "scoreEliteOutline"), 2) +
      scoreItem(has(all, "scoreEliteChapterText"), 2) +
      scoreItem(has(all, "mustRewrite"), 1.5) +
      scoreItem(has(all, "scoreEliteProject"), 1.5),
  },
  {
    name: "Prompts por género",
    score:
      1 +
      scoreItem(has(all, "detectEliteDomain"), 2) +
      scoreItem(has(all, "HISTORY"), 1) +
      scoreItem(has(all, "BIOGRAPHY"), 1) +
      scoreItem(has(all, "FINANCE"), 1) +
      scoreItem(has(all, "POLITICS"), 1) +
      scoreItem(has(all, "RELIGION"), 1) +
      scoreItem(has(all, "FICTION"), 1),
  },
];

for (const area of areas) {
  area.score = Math.max(1, Math.min(10, Number(area.score.toFixed(1))));
}

const overall = Number(
  (
    areas.reduce((sum, area) => sum + area.score, 0) /
    areas.length
  ).toFixed(1)
);

const label =
  overall >= 9 ? "EXCELENTE" :
  overall >= 8 ? "MUY BUENO" :
  overall >= 7 ? "BUENO" :
  overall >= 6 ? "ACEPTABLE" :
  overall >= 5 ? "DÉBIL" :
  "CRÍTICO";

console.log("");
console.log("==============================================");
console.log("EVALUACIÓN ELITE BESTSELLER");
console.log("==============================================");
console.log("Puntuación:", overall + "/10", "-", label);
console.log("");

for (const area of areas) {
  console.log(area.name + ":", area.score + "/10");
}

console.log("");
console.log("Dictamen:");
if (overall >= 8.5) {
  console.log("La capa Elite está instalada. El próximo salto es integrar investigación web real y fact-check automático en el flujo vivo.");
} else {
  console.log("La capa Elite existe parcialmente. Revisa los módulos faltantes y conecta la capa con App.tsx/gemini.ts/composer.ts.");
}
console.log("");

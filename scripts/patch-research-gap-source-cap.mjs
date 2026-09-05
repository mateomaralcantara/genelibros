import fs from "node:fs";
import path from "node:path";

const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/research-worker.ts");
let worker = fs.readFileSync(workerFile, "utf8").replace(/\r\n?/g, "\n");

function validateInstalled(source) {
  return (
    source.includes("RESEARCH_GAP_SOURCE_CAP_APPLIED") &&
    source.includes("const researchGapSourceLimit") &&
    source.includes("researchMaxSources") &&
    /rankSources\(\s*candidates\s*,\s*researchGapSourceLimit\s*\)/m.test(source)
  );
}

if (validateInstalled(worker)) {
  console.log("[Genelibros] GAP SOURCE CAP ya estaba instalado.");
  process.exit(0);
}

const gapRankMarker = 'if(checkpoint.step==="GAP_RANK"){';
const gapExtractMarker = 'if(checkpoint.step==="GAP_EXTRACT"){';
const gapRankStart = worker.indexOf(gapRankMarker);
const gapRankEnd = gapRankStart >= 0 ? worker.indexOf(gapExtractMarker, gapRankStart + gapRankMarker.length) : -1;

if (gapRankStart < 0 || gapRankEnd < 0) {
  console.error("[Genelibros] GAP SOURCE CAP: no se pudo aislar el bloque GAP_RANK.");
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(2);
}

let block = worker.slice(gapRankStart, gapRankEnd);
const rankedMarker = "const ranked=";
const rankedAt = block.indexOf(rankedMarker);

if (rankedAt < 0) {
  console.error("[Genelibros] GAP SOURCE CAP: GAP_RANK no contiene const ranked=.");
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(3);
}

const rankCallRe = /rankSources\(\s*candidates\s*,\s*sourceLimit\s*\)/m;
if (!rankCallRe.test(block)) {
  console.error("[Genelibros] GAP SOURCE CAP: no se encontró rankSources(candidates, sourceLimit) dentro de GAP_RANK.");
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(4);
}

const guardBlock = `// RESEARCH_GAP_SOURCE_CAP_APPLIED\n      const researchGapSourceLimit = researchCreditGuardEnabled\n        ? Math.min(Number(sourceLimit || 0), researchMaxSources)\n        : Number(sourceLimit || 0);\n\n      `;

block = block.slice(0, rankedAt) + guardBlock + block.slice(rankedAt);
block = block.replace(rankCallRe, "rankSources(candidates, researchGapSourceLimit)");

const patched = worker.slice(0, gapRankStart) + block + worker.slice(gapRankEnd);

if (!validateInstalled(patched)) {
  console.error("[Genelibros] GAP SOURCE CAP: validación posterior falló. No se escribe el worker.");
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(5);
}

fs.writeFileSync(workerFile, patched, "utf8");
console.log("[Genelibros] GAP SOURCE CAP instalado: rankSources limitado por researchMaxSources.");

import fs from "node:fs";
import path from "node:path";

const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/research-worker.ts");
let worker = fs.readFileSync(workerFile, "utf8").replace(/\r\n?/g, "\n");

if (worker.includes("RESEARCH_GAP_SOURCE_CAP_APPLIED")) {
  console.log("[Genelibros] GAP SOURCE CAP ya estaba instalado.");
  process.exit(0);
}

const re = /const\s+sourceLimit\s*=\s*Math\.min\(\s*MAX_GAP_SOURCES_PER_PASS\s*,\s*remainingCapacity\s*\)\s*;/m;

if (!re.test(worker)) {
  console.error("[Genelibros] GAP SOURCE CAP: no se encontró el bloque estructural sourceLimit en GAP_RANK.");
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(2);
}

worker = worker.replace(
  re,
  `// RESEARCH_GAP_SOURCE_CAP_APPLIED\n      const sourceLimit = Math.min(\n        MAX_GAP_SOURCES_PER_PASS,\n        researchMaxSources,\n        remainingCapacity\n      );`
);

if (
  !worker.includes("RESEARCH_GAP_SOURCE_CAP_APPLIED") ||
  !/Math\.min\(\s*MAX_GAP_SOURCES_PER_PASS\s*,\s*researchMaxSources\s*,\s*remainingCapacity\s*\)/m.test(worker)
) {
  console.error("[Genelibros] GAP SOURCE CAP: validación posterior falló. No se escribe el worker.");
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(3);
}

fs.writeFileSync(workerFile, worker, "utf8");
console.log("[Genelibros] GAP SOURCE CAP instalado: micro-rondas limitadas por researchMaxSources.");

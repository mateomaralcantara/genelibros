import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
const marker = "DEEP_REPAIR_SINGLE_CALL_V1_APPLIED";

if (runtime.includes(marker)) {
  console.log("[Genelibros] DEEP REPAIR SINGLE CALL ya estaba instalado.");
  process.exit(0);
}

const repairSignature = "export async function repairStep(";
const repairStart = runtime.indexOf(repairSignature);
if (repairStart < 0) {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: no se encontró repairStep. 0 llamadas LLM.");
  process.exit(2);
}

const nextExportAt = runtime.indexOf(
  "\nexport async function ",
  repairStart + repairSignature.length,
);
const repairEnd = nextExportAt > repairStart ? nextExportAt : runtime.length;
let repairBlock = runtime.slice(repairStart, repairEnd);

if (!/attempt\s*<=\s*maxAttempts/m.test(repairBlock)) {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: repairStep ya no usa maxAttempts en su loop. 0 llamadas LLM.");
  process.exit(3);
}

// Toleramos cualquier forma previa de la asignación: una línea, varias líneas,
// literal 2, Math.max(...), Number(env...), etc. Solo tocamos la primera
// declaración const maxAttempts dentro de repairStep.
const maxAttemptsRe = /const\s+maxAttempts\s*=\s*[\s\S]*?;/m;
const match = repairBlock.match(maxAttemptsRe);
if (!match || typeof match.index !== "number") {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: no se encontró una declaración maxAttempts dentro de repairStep. 0 llamadas LLM.");
  process.exit(4);
}

const replacement = [
  "// DEEP_REPAIR_SINGLE_CALL_V1_APPLIED",
  "  const maxAttempts = Math.max(",
  "    1,",
  "    Number(process.env.DEEP_REPAIR_INTERNAL_MAX_ATTEMPTS || 1)",
  "  );",
].join("\n");

repairBlock =
  repairBlock.slice(0, match.index) +
  replacement +
  repairBlock.slice(match.index + match[0].length);

const localChecks = [
  repairBlock.includes(marker),
  repairBlock.includes("DEEP_REPAIR_INTERNAL_MAX_ATTEMPTS || 1"),
  /attempt\s*<=\s*maxAttempts/m.test(repairBlock),
  !/const\s+maxAttempts\s*=\s*2\s*;/m.test(repairBlock),
];
if (localChecks.some((ok) => !ok)) {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: validación estructural falló. No se escribe runtime.");
  process.exit(5);
}

runtime = runtime.slice(0, repairStart) + repairBlock + runtime.slice(repairEnd);
fs.writeFileSync(runtimeFile, runtime, "utf8");
console.log("[Genelibros] DEEP REPAIR SINGLE CALL instalado: máximo 1 llamada interna por etapa REPAIR.");

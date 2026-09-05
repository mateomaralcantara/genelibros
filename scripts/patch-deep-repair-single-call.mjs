import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
const marker = "DEEP_REPAIR_SINGLE_CALL_V1_APPLIED";

if (runtime.includes(marker)) {
  console.log("[Genelibros] DEEP REPAIR SINGLE CALL ya estaba instalado.");
  process.exit(0);
}

const repairStart = runtime.indexOf("export async function repairStep(");
if (repairStart < 0) {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: no se encontró repairStep. 0 llamadas LLM.");
  process.exit(2);
}
const afterRepair = runtime.slice(repairStart);
const needle = "  const maxAttempts = 2;";
const localAt = afterRepair.indexOf(needle);
if (localAt < 0) {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: no se encontró maxAttempts=2 dentro de repairStep. 0 llamadas LLM.");
  process.exit(3);
}
const absoluteAt = repairStart + localAt;
const replacement = [
  "  // DEEP_REPAIR_SINGLE_CALL_V1_APPLIED",
  "  const maxAttempts = Math.max(",
  "    1,",
  "    Number(process.env.DEEP_REPAIR_INTERNAL_MAX_ATTEMPTS || 1)",
  "  );",
].join("\n");
runtime = runtime.slice(0, absoluteAt) + replacement + runtime.slice(absoluteAt + needle.length);

if (!runtime.includes(marker) || !runtime.includes("DEEP_REPAIR_INTERNAL_MAX_ATTEMPTS || 1")) {
  console.error("[Genelibros] DEEP REPAIR SINGLE CALL: validación estructural falló. No se escribe runtime.");
  process.exit(4);
}

fs.writeFileSync(runtimeFile, runtime, "utf8");
console.log("[Genelibros] DEEP REPAIR SINGLE CALL instalado: máximo 1 llamada interna por etapa REPAIR.");

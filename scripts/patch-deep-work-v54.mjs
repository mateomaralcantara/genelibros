import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
const templateFile = path.resolve(process.cwd(), "scripts/deep-work-repair-v54.template.txt");

let source = fs.readFileSync(runtimeFile, "utf8");

if (source.includes("TOKEN_GUARD_V5.4")) {
  console.log("[Genelibros] Deep Work V5.4 ya está instalado.");
  process.exit(0);
}

const startMarker = "export async function repairStep";
const endMarker = "export async function deepQualityStep";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0) {
  throw new Error("V5.4: no se encontró el bloque repairStep/deepQualityStep.");
}

const replacement = fs.readFileSync(templateFile, "utf8").trimEnd() + "\n\n";
source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(runtimeFile, source, "utf8");

console.log("[Genelibros] Deep Work V5.4 instalado.");
console.log("[Genelibros] REPAIR largo: compresión segmentada proporcional + calibración final.");
console.log("[Genelibros] Guard de longitud ±8% permanece intacto.");

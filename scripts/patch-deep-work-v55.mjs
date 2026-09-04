import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
const templateFile = path.resolve(process.cwd(), "scripts/deep-work-repair-v55.template.txt");

let source = fs.readFileSync(runtimeFile, "utf8");

if (source.includes("TOKEN_GUARD_V5.5")) {
  console.log("[Genelibros] Deep Work V5.5 ya está instalado.");
  process.exit(0);
}

const replacement = fs.readFileSync(templateFile, "utf8").trimEnd() + "\n\n";
const startMarker = "export async function repairStep";
const endMarker = "export async function deepQualityStep";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0) {
  throw new Error("V5.5: no se encontró repairStep/deepQualityStep.");
}

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(runtimeFile, source, "utf8");

console.log("[Genelibros] Deep Work V5.5 instalado.");
console.log("[Genelibros] REPAIR: segmentación estable también en reparaciones QUALITY.");
console.log("[Genelibros] Delimitadores de modelo se limpian antes de persistir.");
console.log("[Genelibros] Guard editorial 2300-2700 permanece intacto para target 2500.");

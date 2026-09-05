import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/deep-work-worker.ts");
const templateFile = path.resolve(process.cwd(), "scripts/deep-work-repair-v56.template.txt");

let runtime = fs.readFileSync(runtimeFile, "utf8");
let worker = fs.readFileSync(workerFile, "utf8");
const replacement = fs.readFileSync(templateFile, "utf8").trimEnd() + "\n\n";
let runtimeChanged = false;
let workerChanged = false;

if (!runtime.includes("TOKEN_GUARD_V5.6")) {
  const startMarker = "export async function repairStep";
  const endMarker = "export async function deepQualityStep";
  const start = runtime.indexOf(startMarker);
  const end = runtime.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error("V5.6: no se encontró repairStep/deepQualityStep en runtime.");
  }
  runtime = runtime.slice(0, start) + replacement + runtime.slice(end);
  runtimeChanged = true;
  console.log("[Genelibros] Deep Work V5.6 runtime instalado.");
} else {
  console.log("[Genelibros] Deep Work V5.6 runtime ya estaba instalado.");
}

if (!runtime.includes("CANDIDATE_WORD_COUNT_VERIFICADO")) {
  const qualityNeedle = 'CONTEXT:\n${JSON.stringify(input.context || {})}\nCANDIDATE:\n${input.candidate.content.slice(0, 85000)}';
  const qualityReplacement = 'CONTEXT:\n${JSON.stringify(input.context || {})}\nCANDIDATE_WORD_COUNT_VERIFICADO: ${clean(input.candidate.content).split(/\\s+/).filter(Boolean).length}\nREGLA DE LONGITUD: no estimes ni recalcules la longitud; usa exclusivamente CANDIDATE_WORD_COUNT_VERIFICADO. No penalices longitud si ese conteo está dentro del rango exigido por el job.\nCANDIDATE:\n${input.candidate.content.slice(0, 85000)}';
  if (!runtime.includes(qualityNeedle)) {
    throw new Error("V5.6: no se encontró el bloque de prompt QUALITY esperado.");
  }
  runtime = runtime.replace(qualityNeedle, qualityReplacement);
  runtimeChanged = true;
  console.log("[Genelibros] QUALITY V5.6: conteo determinístico de palabras conectado al juez.");
} else {
  console.log("[Genelibros] QUALITY V5.6 ya usa conteo determinístico.");
}

if (runtimeChanged) fs.writeFileSync(runtimeFile, runtime, "utf8");

if (!worker.includes("context: result.context") || !worker.includes("researchContext: result.researchContext")) {
  const oldCall = '    const out = await repairStep({ depth, title: result.title, sourceContent: String(target.content || ""), candidate: result.finalCandidate, quality: result.quality, targetWords: job.target_words });';
  const newCall = `    const out = await repairStep({
      depth,
      title: result.title,
      sourceContent: String(target.content || ""),
      candidate: result.finalCandidate,
      quality: result.quality,
      targetWords: job.target_words,
      context: result.context,
      researchContext: result.researchContext,
    });`;
  if (!worker.includes(oldCall)) {
    throw new Error("V5.6: no se encontró la llamada repairStep esperada en worker.");
  }
  worker = worker.replace(oldCall, newCall);
  workerChanged = true;
  console.log("[Genelibros] Worker V5.6: CONTEXT + Research conectados a REPAIR.");
} else {
  console.log("[Genelibros] Worker V5.6 ya estaba conectado a CONTEXT + Research.");
}

if (workerChanged) fs.writeFileSync(workerFile, worker, "utf8");

console.log("[Genelibros] V5.6: invariantes protegidos + QUALITY sin estimaciones falsas de longitud.");

import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/deep-work-worker.ts");
const templateFile = path.resolve(process.cwd(), "scripts/deep-work-repair-v58.template.txt");

const normalizeLf = (value) => String(value || "").replace(/\r\n?/g, "\n");

const originalRuntime = fs.readFileSync(runtimeFile, "utf8");
const originalWorker = fs.readFileSync(workerFile, "utf8");
const originalTemplate = fs.readFileSync(templateFile, "utf8");

let runtime = normalizeLf(originalRuntime);
let worker = normalizeLf(originalWorker);
let template = normalizeLf(originalTemplate);

// Node 22/24 + /u rechaza el identity escape \" dentro de una clase de caracteres.
// La comilla doble no necesita escape en un literal RegExp delimitado por /.../.
const badSentenceSplit = '/(?<=[.!?])\\s+(?=[A-ZÁÉÍÓÚÑÜ¿¡0-9“\\"(])/u';
const goodSentenceSplit = '/(?<=[.!?])\\s+(?=[A-ZÁÉÍÓÚÑÜ¿¡0-9“"(])/u';

template = template.replaceAll(badSentenceSplit, goodSentenceSplit);
runtime = runtime.replaceAll(badSentenceSplit, goodSentenceSplit);

const replacement = template.trimEnd() + "\n\n";

// ---------------------------------------------------------------------------
// 1) REPAIR V5.8
// ---------------------------------------------------------------------------
if (!runtime.includes("TOKEN_GUARD_V5.8")) {
  const startMarker = "export async function repairStep";
  const endMarker = "export async function deepQualityStep";
  const start = runtime.indexOf(startMarker);
  const end = runtime.indexOf(endMarker, start + startMarker.length);

  if (start < 0 || end < 0 || end <= start) {
    throw new Error("V5.8: no se encontró repairStep/deepQualityStep en runtime.");
  }

  runtime = runtime.slice(0, start) + replacement + runtime.slice(end);
  console.log("[Genelibros] Deep Work V5.8 runtime instalado.");
} else {
  console.log("[Genelibros] Deep Work V5.8 runtime ya estaba instalado.");
}

// ---------------------------------------------------------------------------
// 2) QUALITY: conteo determinístico.
// No depende de un substring completo; localiza estructuralmente deepQualityStep,
// CONTEXT y CANDIDATE. Esto lo hace estable entre Node 22/24 y LF/CRLF.
// ---------------------------------------------------------------------------
if (!runtime.includes("CANDIDATE_WORD_COUNT_VERIFICADO")) {
  const qualityStart = runtime.indexOf("export async function deepQualityStep");
  if (qualityStart < 0) {
    throw new Error("V5.8: no se encontró deepQualityStep en runtime.");
  }

  const contextAnchor = "${JSON.stringify(input.context || {})}";
  const contextAt = runtime.indexOf(contextAnchor, qualityStart);
  if (contextAt < 0) {
    throw new Error("V5.8: no se encontró CONTEXT dentro de deepQualityStep.");
  }

  const candidateAt = runtime.indexOf("CANDIDATE:", contextAt + contextAnchor.length);
  if (candidateAt < 0) {
    throw new Error("V5.8: no se encontró CANDIDATE dentro de deepQualityStep.");
  }

  const candidateWindow = runtime.slice(candidateAt, candidateAt + 220);
  if (!candidateWindow.includes("input.candidate.content.slice(0, 85000)")) {
    throw new Error("V5.8: CANDIDATE de deepQualityStep no tiene la forma esperada.");
  }

  const qualityInsertion =
    "CANDIDATE_WORD_COUNT_VERIFICADO: ${clean(input.candidate.content).split(/\\s+/).filter(Boolean).length}\n" +
    "REGLA DE LONGITUD: no estimes ni recalcules la longitud; usa exclusivamente CANDIDATE_WORD_COUNT_VERIFICADO. No penalices longitud si ese conteo está dentro del rango exigido por el job.\n";

  runtime = runtime.slice(0, candidateAt) + qualityInsertion + runtime.slice(candidateAt);
  console.log("[Genelibros] QUALITY V5.8: conteo determinístico conectado.");
}

// ---------------------------------------------------------------------------
// 3) Worker: conectar contexto y Research al repairStep.
// Reemplaza únicamente la llamada dentro del bloque REPAIR y valida su forma.
// ---------------------------------------------------------------------------
if (!worker.includes("context: result.context") || !worker.includes("researchContext: result.researchContext")) {
  const repairSection = worker.indexOf('if (step === "REPAIR")');
  if (repairSection < 0) {
    throw new Error("V5.8: no se encontró bloque REPAIR en worker.");
  }

  const callStart = worker.indexOf("const out = await repairStep({", repairSection);
  const callEnd = worker.indexOf("});", callStart);

  if (callStart < 0 || callEnd < 0) {
    throw new Error("V5.8: no se encontró llamada repairStep esperada en worker.");
  }

  const oldCall = worker.slice(callStart, callEnd + 3);
  if (!oldCall.includes("candidate: result.finalCandidate") || !oldCall.includes("targetWords: job.target_words")) {
    throw new Error("V5.8: llamada repairStep encontrada pero con forma incompatible.");
  }

  const indent = "    ";
  const newCall = [
    "const out = await repairStep({",
    "  depth,",
    "  title: result.title,",
    '  sourceContent: String(target.content || ""),',
    "  candidate: result.finalCandidate,",
    "  quality: result.quality,",
    "  targetWords: job.target_words,",
    "  context: result.context,",
    "  researchContext: result.researchContext,",
    "});",
  ].map((line, index) => (index === 0 ? line : indent + line)).join("\n");

  worker = worker.slice(0, callStart) + newCall + worker.slice(callEnd + 3);
  console.log("[Genelibros] Worker V5.8: CONTEXT + Research conectados.");
}

// ---------------------------------------------------------------------------
// 4) FAIL-CLOSED + escritura atómica lógica.
// Nada se escribe hasta que TODAS las transformaciones requeridas validen.
// ---------------------------------------------------------------------------
const required = [
  ["TOKEN_GUARD_V5.8", runtime.includes("TOKEN_GUARD_V5.8")],
  ["QUALITY deterministic word count", runtime.includes("CANDIDATE_WORD_COUNT_VERIFICADO")],
  ["worker context", worker.includes("context: result.context")],
  ["worker research context", worker.includes("researchContext: result.researchContext")],
  ["runtime regex compatible", !runtime.includes(badSentenceSplit)],
  ["template regex compatible", !template.includes(badSentenceSplit)],
];

const missing = required.filter(([, ok]) => !ok).map(([name]) => name);
if (missing.length) {
  throw new Error(`V5.8_PATCH_INCOMPLETE: ${missing.join(", ")}`);
}

if (runtime !== normalizeLf(originalRuntime)) {
  fs.writeFileSync(runtimeFile, runtime, "utf8");
}
if (worker !== normalizeLf(originalWorker)) {
  fs.writeFileSync(workerFile, worker, "utf8");
}
if (template !== normalizeLf(originalTemplate)) {
  fs.writeFileSync(templateFile, template, "utf8");
}

console.log("[Genelibros] V5.8 regex de separación de oraciones: OK.");
console.log("[Genelibros] V5.8: patch atómico/idempotente; prune-don't-rewrite para longitud; QUALITY quirúrgico cuando ya está en rango.");

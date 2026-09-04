import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let s = fs.readFileSync(file, "utf8");

if (s.includes("TOKEN_GUARD_V5.3")) {
  console.log("[Genelibros] Deep Work V5.3 ya está instalado.");
  process.exit(0);
}

const oldModel = `  const model = clean(
    process.env.DEEP_REPAIR_MODEL ||
    process.env.RESEARCH_DEEP_MODEL ||
    process.env.DEEP_FAST_MODEL ||
    "gemini-3.6-flash"
  );`;

const newModel = `  // TOKEN_GUARD_V5.3
  // REPAIR usa el modelo profundo por defecto. Solo DEEP_REPAIR_MODEL puede
  // sobrescribir el primer intento; el segundo siempre escala al modelo del depth.
  const primaryModel = clean(
    process.env.DEEP_REPAIR_MODEL ||
    modelFor(input.depth)
  );
  const deepModel = clean(modelFor(input.depth));`;

if (!s.includes(oldModel)) {
  throw new Error("V5.3: no se encontró el selector de modelo V5.2.");
}
s = s.replace(oldModel, newModel);

const loopNeedle = `  ) {
    const previousFailure =`;

const loopReplacement = `  ) {
    const model = attempt === 1 ? primaryModel : deepModel;
    const isGemini3 = /^gemini-3(?:\\\\.|[-])/i.test(model);
    const isGemini25 = /^gemini-2\\\\.5(?:[-]|$)/i.test(model);
    const thinkingConfig = isGemini3
      ? { thinkingLevel: "LOW" }
      : isGemini25
        ? { thinkingBudget: 1024 }
        : undefined;

    const previousFailure =`;

if (!s.includes(loopNeedle)) {
  throw new Error("V5.3: no se encontró el inicio del loop REPAIR.");
}
s = s.replace(loopNeedle, loopReplacement);

const oldConfig = `        temperature: 0.1,

        maxOutputTokens: Math.min(
          16000,
          Math.max(
            8000,
            Math.ceil(targetWords * 3.2)
          )
        )
      }`;

const newConfig = `        // Gemini 3 usa HIGH por defecto. REPAIR es edición de documento largo:
        // LOW reserva presupuesto para la salida visible y reduce truncaciones.
        // Google recomienda temperature=1.0 para Gemini 3.
        temperature: isGemini3 ? 1.0 : 0.2,

        maxOutputTokens:
          attempt === 1
            ? Math.min(18000, Math.max(12000, Math.ceil(targetWords * 4.2)))
            : Math.min(24000, Math.max(16000, Math.ceil(targetWords * 5.0))),

        ...(thinkingConfig ? { thinkingConfig } : {})
      } as any`;

if (!s.includes(oldConfig)) {
  throw new Error("V5.3: no se encontró config V5.2 de REPAIR.");
}
s = s.replace(oldConfig, newConfig);

const oldFailure = `    \`model=\${model}; \` +
    \`preview=\${JSON.stringify(lastText.slice(0, 900))}\``;

const newFailure = `    \`model=\${deepModel}; \` +
    \`preview=\${JSON.stringify(lastText.slice(0, 900))}\``;

if (s.includes(oldFailure)) {
  s = s.replace(oldFailure, newFailure);
}

const draftNeedle = `TARGET_WORDS: \${input.targetWords}
PLAN:`;
const draftReplacement = `TARGET_WORDS: \${input.targetWords}
RANGO_EDITORIAL_OBLIGATORIO: \${Math.floor(input.targetWords * 0.92)}-\${Math.ceil(input.targetWords * 1.08)} palabras.
No excedas ese rango salvo que preservar evidencia indispensable lo haga imposible.
PLAN:`;

if (s.includes(draftNeedle)) {
  s = s.replace(draftNeedle, draftReplacement);
}

const synthesisNeedle = `TARGET_WORDS: \${input.targetWords}

Devuelve JSON:`;
const synthesisReplacement = `TARGET_WORDS: \${input.targetWords}
RANGO_EDITORIAL_OBLIGATORIO: \${Math.floor(input.targetWords * 0.92)}-\${Math.ceil(input.targetWords * 1.08)} palabras.
La síntesis debe ser un capítulo completo dentro de ese rango; comprime redundancias antes de excederlo.

Devuelve JSON:`;

if (s.includes(synthesisNeedle)) {
  s = s.replace(synthesisNeedle, synthesisReplacement);
}

fs.writeFileSync(file, s, "utf8");
console.log("[Genelibros] Deep Work V5.3 instalado.");
console.log("[Genelibros] REPAIR: modelo profundo + thinking controlado + 2º intento escalado.");
console.log("[Genelibros] DRAFT/SYNTHESIS: rango editorial ±8% reforzado.");

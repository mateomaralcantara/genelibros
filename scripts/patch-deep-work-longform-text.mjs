import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");

const marker = "DEEP_LONGFORM_TEXT_V1_APPLIED";

if (runtime.includes(marker)) {
  console.log("[Genelibros] DEEP LONGFORM TEXT ya estaba instalado.");
  process.exit(0);
}

// Este parche corre DESPUÉS de Credit Guard. No reescribe Draft/Synthesis:
// intercepta generateJson() solo para las tres etapas de texto largo y devuelve
// internamente el mismo shape data.content que ya espera el runtime.
const requiredBefore = [
  runtime.includes("const creditGuardEnabled ="),
  runtime.includes("const budgetStage ="),
  runtime.includes("const model = creditGuardEnabled && budgetStage"),
  runtime.includes("  let maxOutputTokens = Math.max("),
];

if (requiredBefore.some((ok) => !ok)) {
  console.error("[Genelibros] DEEP LONGFORM TEXT: Credit Guard/runtime esperado no está instalado. 0 llamadas LLM.");
  process.exit(2);
}

const anchor = "  let maxOutputTokens = Math.max(";
const at = runtime.indexOf(anchor);
if (at < 0) {
  console.error("[Genelibros] DEEP LONGFORM TEXT: no se encontró anchor de generateJson. 0 llamadas LLM.");
  process.exit(3);
}

const block = [
  "  // DEEP_LONGFORM_TEXT_V1_APPLIED",
  "  const longformTextMode = /MULTI_PASS_WRITER|ALTERNATIVE_DRAFT_WRITER|SYNTHESIS_EDITOR/i.test(input.system);",
  "  if (longformTextMode) {",
  "    const longformMaxOutputTokens = Math.min(",
  "      32000,",
  "      Math.max(24000, Number(input.maxOutputTokens || 0))",
  "    );",
  "",
  "    const longformConfig: AnyRow = {",
  "      systemInstruction: input.system + \\\"\\nSALIDA OBLIGATORIA: devuelve exclusivamente el documento completo como texto plano. NO JSON. NO fences. NO comentarios editoriales.\\\" ,",
  "      maxOutputTokens: longformMaxOutputTokens,",
  "      temperature: input.temperature ?? 0.55,",
  "    };",
  "",
  "    if (creditGuardEnabled && budgetStage) {",
  "      longformConfig.thinkingConfig = {",
  "        thinkingBudget: Math.max(0, Number(process.env.DEEP_LONGFORM_THINKING_BUDGET || 1024)),",
  "        includeThoughts: false,",
  "      };",
  "    }",
  "",
  "    const response = await aiClient().models.generateContent({",
  "      model,",
  "      contents: [{ role: \\\"user\\\", parts: [{ text: input.prompt + \\\"\\n\\nDevuelve SOLO el documento completo en texto plano. No uses JSON.\\\" }] }],",
  "      config: longformConfig,",
  "    });",
  "",
  "    const text = clean((response as any)?.text);",
  "    const finishReason = clean((response as any)?.candidates?.[0]?.finishReason).toUpperCase();",
  "    if (!text) throw new Error(\\\"Deep Work: longform vacío con \\\" + model + \\\".\\\");",
  "    if (finishReason.includes(\\\"MAX_TOKENS\\\")) {",
  "      throw new Error(\\\"Deep Work: LONGFORM_TRUNCATED por MAX_TOKENS con \\\" + model + \\\"; no se reintenta automáticamente.\\\");",
  "    }",
  "",
  "    return {",
  "      data: {",
  "        content: text,",
  "        rationale: \\\"Longform text mode: contenido separado del JSON para evitar truncación de strings extensos.\\\",",
  "        strengths: [],",
  "        risks: [],",
  "      },",
  "      usage: usageOf(response as any),",
  "      model,",
  "    };",
  "  }",
  "",
].join("\n");

runtime = runtime.slice(0, at) + block + runtime.slice(at);

const checks = [
  runtime.includes(marker),
  runtime.includes("longformTextMode"),
  runtime.includes("MULTI_PASS_WRITER|ALTERNATIVE_DRAFT_WRITER|SYNTHESIS_EDITOR"),
  runtime.includes("Math.max(24000"),
  runtime.includes("DEEP_LONGFORM_THINKING_BUDGET || 1024"),
  runtime.includes("responseMimeType") && runtime.includes("NO JSON"),
  runtime.includes("LONGFORM_TRUNCATED"),
  runtime.includes("usage: usageOf(response as any)"),
];

if (checks.some((ok) => !ok)) {
  console.error("[Genelibros] DEEP LONGFORM TEXT: validación estructural falló. No se escribe runtime.");
  process.exit(4);
}

fs.writeFileSync(runtimeFile, runtime, "utf8");
console.log("[Genelibros] DEEP LONGFORM TEXT instalado: Draft A/B y Synthesis usan texto plano; Critic/Quality conservan JSON.");

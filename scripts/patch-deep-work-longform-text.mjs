import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
let changed = false;

const marker = "DEEP_LONGFORM_TEXT_V1_APPLIED";

if (!runtime.includes(marker)) {
  const draftStart = runtime.indexOf("export async function deepDraftStep(");
  const criticStart = runtime.indexOf("export async function criticCouncilStep(", draftStart);
  if (draftStart < 0 || criticStart <= draftStart) {
    console.error("[Genelibros] DEEP LONGFORM TEXT: no se encontró bloque deepDraftStep. 0 llamadas LLM.");
    process.exit(2);
  }

  const helperAndDraft = String.raw`// DEEP_LONGFORM_TEXT_V1_APPLIED
async function generateLongformText(input: {
  depth: DeepWorkDepth;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  useBudgetModel: boolean;
}) {
  const creditGuardEnabled = !["0", "false", "off"].includes(
    clean(process.env.DEEP_CREDIT_GUARD || "1").toLowerCase()
  );

  const model = creditGuardEnabled && input.useBudgetModel
    ? clean(process.env.DEEP_BUDGET_MODEL || process.env.DEEP_FAST_MODEL || "gemini-3.6-flash")
    : clean(modelFor(input.depth));

  const config: AnyRow = {
    systemInstruction: input.system,
    maxOutputTokens: Math.max(12000, Math.min(32000, Number(input.maxOutputTokens || 24000))),
    temperature: input.temperature,
  };

  // En el draft alternativo Flash reservamos el presupuesto para el capítulo,
  // no para razonamiento interno ilimitado. 1024 es configurable y no añade llamadas.
  if (creditGuardEnabled && input.useBudgetModel) {
    config.thinkingConfig = {
      thinkingBudget: Math.max(0, Number(process.env.DEEP_LONGFORM_THINKING_BUDGET || 1024)),
      includeThoughts: false,
    };
  }

  const response = await aiClient().models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    config,
  });

  const text = clean((response as any)?.text);
  const finishReason = clean((response as any)?.candidates?.[0]?.finishReason).toUpperCase();
  if (!text) throw new Error(`Deep Work: ${model} devolvió longform vacío.`);
  if (finishReason.includes("MAX_TOKENS")) {
    throw new Error(`Deep Work: LONGFORM_TRUNCATED por MAX_TOKENS con ${model}; no se reintenta automáticamente.`);
  }

  return { text, usage: usageOf(response as any), model };
}

export async function deepDraftStep(input: {
  depth: DeepWorkDepth;
  label: "A" | "B" | "C";
  operation: DeepWorkOperation;
  title: string;
  sourceContent: string;
  targetWords: number;
  plan: DeepWorkPlan;
  context?: DeepContextAnalysis;
}) {
  const approaches: Record<string, string> = {
    A: "máxima claridad, arquitectura lógica y precisión",
    B: "máxima profundidad, fuerza narrativa y capacidad explicativa",
    C: "síntesis editorial: concisión, ritmo, originalidad y utilidad práctica",
  };

  const { text, usage, model } = await generateLongformText({
    depth: input.depth,
    temperature: input.label === "A" ? 0.55 : 0.7,
    maxOutputTokens: Math.min(32000, Math.max(20000, Math.floor(input.targetWords * 7.5))),
    useBudgetModel: input.label !== "A",
    system: `Eres ${input.label === "A" ? "MULTI_PASS_WRITER" : "ALTERNATIVE_DRAFT_WRITER"}. Produces un candidato independiente de calidad editorial. Tu salida es EXCLUSIVAMENTE el capítulo completo como texto plano. No JSON. No fences. No notas editoriales. ${NO_FABRICATION}`,
    prompt: `
CANDIDATO: ${input.label}
ENFOQUE: ${approaches[input.label]}
OPERACIÓN: ${input.operation}
CAPÍTULO: ${input.title}
TARGET_WORDS: ${input.targetWords}
PLAN:
${JSON.stringify(input.plan)}
CONTEXT_ANALYSIS:
${JSON.stringify(input.context || {})}
SOURCE:
${input.sourceContent.slice(0, 75000)}

REGLAS:
- Entrega el CAPÍTULO COMPLETO, no resumen, no esquema, no explicación.
- Si operation=IMPROVE o REWRITE, preserva significado editorial, nombres, voz y continuidad.
- SOURCE no certifica hechos: cuando CONTEXT_ANALYSIS contenga Research, toda cifra, fecha, institución, costo, porcentaje y relación causal debe estar respaldada por claims certificados.
- Si un claim certificado contiene atribución o procedencia, conserva esa procedencia explícitamente.
- Si operation=GENERATE, usa solo hechos presentes en contexto; no rellenes con datos inventados.
- Apunta a ${input.targetWords} palabras; evita relleno y redundancia.
- Devuelve exclusivamente el texto final del capítulo. NO JSON.
`,
  });

  const draft: DeepDraft = {
    label: input.label,
    content: text,
    rationale: `Longform text ${input.label}; contenido separado del metadata JSON para evitar truncación de strings extensos.`,
    strengths: [],
    risks: [],
  };
  if (!draft.content || draft.content.length < 500) {
    throw new Error(`Deep Work: borrador ${input.label} insuficiente.`);
  }
  return { draft, usage, model };
}

`;

  runtime = runtime.slice(0, draftStart) + helperAndDraft + runtime.slice(criticStart);
  changed = true;

  const synthesisStart = runtime.indexOf("export async function synthesisStep(");
  const repairStart = runtime.indexOf("export async function repairStep(", synthesisStart);
  if (synthesisStart < 0 || repairStart <= synthesisStart) {
    console.error("[Genelibros] DEEP LONGFORM TEXT: no se encontró bloque synthesisStep. No se escribe runtime.");
    process.exit(3);
  }

  const synthesis = String.raw`export async function synthesisStep(input: {
  depth: DeepWorkDepth;
  title: string;
  sourceContent: string;
  targetWords: number;
  plan: DeepWorkPlan;
  context?: DeepContextAnalysis;
  drafts: DeepDraft[];
  council: DraftCouncilResult;
}) {
  const { text, usage, model } = await generateLongformText({
    depth: input.depth,
    temperature: 0.4,
    maxOutputTokens: Math.min(32000, Math.max(22000, Math.floor(input.targetWords * 8))),
    useBudgetModel: false,
    system: `Eres SYNTHESIS_EDITOR. Fusionas lo mejor de candidatos independientes en un capítulo coherente. Las atribuciones, reservas y procedencia de claims certificados son inseparables del hecho. Tu salida es EXCLUSIVAMENTE el capítulo completo como texto plano. No JSON. No fences. ${NO_FABRICATION}`,
    prompt: `
CAPÍTULO: ${input.title}
PLAN: ${JSON.stringify(input.plan)}
CONTEXT: ${JSON.stringify(input.context || {})}
COUNCIL: ${JSON.stringify(input.council)}
SOURCE ORIGINAL:
${input.sourceContent.slice(0, 55000)}
DRAFTS:
${JSON.stringify(input.drafts.map((d) => ({ label: d.label, content: d.content.slice(0, 55000) })))}
TARGET_WORDS: ${input.targetWords}

TAREA:
- Produce el capítulo final completo.
- Integra lo mejor de los drafts según el council sin crear collage.
- Mantén estrictamente atribuciones y límites del Research.
- No inventes los gaps abiertos.
- Apunta a ${input.targetWords} palabras.
- Devuelve SOLO el capítulo, texto plano. NO JSON.
`,
  });

  const draft: DeepDraft = {
    label: "SYNTHESIS",
    content: text,
    rationale: "Síntesis longform en texto plano para evitar truncación de JSON extenso.",
    strengths: [],
    risks: [],
  };
  if (draft.content.length < 500) throw new Error("Deep Work: síntesis insuficiente.");
  return { draft, usage, model };
}

`;

  runtime = runtime.slice(0, synthesisStart) + synthesis + runtime.slice(repairStart);
}

const required = [
  runtime.includes(marker),
  runtime.includes("async function generateLongformText"),
  runtime.includes("useBudgetModel: input.label !== \"A\""),
  runtime.includes("thinkingBudget"),
  runtime.includes("LONGFORM_TRUNCATED"),
  runtime.includes("useBudgetModel: false"),
  runtime.includes("NO JSON"),
];
if (required.some((ok) => !ok)) {
  console.error("[Genelibros] DEEP LONGFORM TEXT: validación estructural falló. No se escribe runtime.");
  process.exit(4);
}

if (changed) {
  fs.writeFileSync(runtimeFile, runtime, "utf8");
  console.log("[Genelibros] DEEP LONGFORM TEXT instalado: Draft/Synthesis salen como texto plano; JSON queda para metadata corta.");
} else {
  console.log("[Genelibros] DEEP LONGFORM TEXT ya estaba instalado.");
}

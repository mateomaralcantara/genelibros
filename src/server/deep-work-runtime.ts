import { GoogleGenAI } from "@google/genai";
import type {
  CriticReview,
  DeepContextAnalysis,
  DeepDraft,
  DeepQualityScore,
  DeepWorkDepth,
  DeepWorkOperation,
  DeepWorkPlan,
  DeepWorkUsage,
  DraftCouncilResult,
} from "../lib/deep-work/types";

type AnyRow = Record<string, any>;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Number(n.toFixed(2))));
}

function stringArray(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, max);
}

function modelFor(depth: DeepWorkDepth) {
  if (depth === "FAST") {
    return process.env.DEEP_FAST_MODEL || process.env.OS4_FAST_MODEL || "gemini-2.5-flash";
  }
  return (
    process.env.DEEP_SUPREME_MODEL ||
    process.env.DEEP_DEEP_MODEL ||
    process.env.REFINERY_DEEP_MODEL ||
    process.env.OS4_DEEP_MODEL ||
    "gemini-2.5-pro"
  );
}

function aiClient() {
  const apiKey = clean(process.env.GEMINI_API_KEY);
  if (!apiKey) throw new Error("Deep Work: falta GEMINI_API_KEY server-side.");
  return new GoogleGenAI({ apiKey });
}

function jsonCandidate(text: string): string {
  const raw = clean(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = raw.indexOf("{");
  if (start < 0) return raw;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw.slice(start);
}

function parseJson(text: string): AnyRow {
  const candidate = jsonCandidate(text);
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = candidate.replace(/,\s*([}\]])/g, "$1").replace(/\u0000/g, "");
    try {
      return JSON.parse(repaired);
    } catch (error) {
      throw new Error(
        `Deep Work: respuesta JSON inválida. ${String((error as any)?.message || error)}. Preview: ${repaired.slice(0, 350)}`,
      );
    }
  }
}

function usageOf(resp: AnyRow): DeepWorkUsage {
  const u = resp?.usageMetadata || resp?.usage || {};
  const inputTokens = Number(u.promptTokenCount || u.inputTokens || 0) || 0;
  const outputTokens = Number(u.candidatesTokenCount || u.outputTokens || 0) || 0;
  const totalTokens = Number(u.totalTokenCount || u.totalTokens || inputTokens + outputTokens) || 0;
  return { inputTokens, outputTokens, totalTokens, calls: 1 };
}

async function generateJson(input: {
  depth: DeepWorkDepth;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const model = modelFor(input.depth);

  let maxOutputTokens = Math.max(
    1024,
    Number(input.maxOutputTokens || 8192),
  );

  let accumulatedUsage: DeepWorkUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
  };

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await aiClient().models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: input.prompt }],
        },
      ],
      config: {
        systemInstruction: input.system,
        responseMimeType: "application/json",
        maxOutputTokens,
        temperature: input.temperature ?? 0.55,
      } as any,
    });

    const callUsage = usageOf(response as any);

    accumulatedUsage = {
      inputTokens:
        accumulatedUsage.inputTokens + callUsage.inputTokens,
      outputTokens:
        accumulatedUsage.outputTokens + callUsage.outputTokens,
      totalTokens:
        accumulatedUsage.totalTokens + callUsage.totalTokens,
      calls:
        accumulatedUsage.calls + callUsage.calls,
    };

    const text = clean((response as any)?.text);

    if (!text) {
      throw new Error(
        `Deep Work: ${model} devolvió respuesta vacía.`,
      );
    }

    const finishReason = clean(
      (response as any)?.candidates?.[0]?.finishReason,
    ).toUpperCase();

    try {
      return {
        data: parseJson(text),
        usage: accumulatedUsage,
        model,
      };
    } catch (error) {
      lastError = error;

      const message = String(
        (error as any)?.message || error,
      );

      const looksTruncated =
        finishReason.includes("MAX_TOKENS") ||
        /unterminated string/i.test(message) ||
        /unexpected end of json/i.test(message) ||
        /unexpected end of input/i.test(message);

      if (!looksTruncated) {
        throw error;
      }

      if (attempt >= 3 || maxOutputTokens >= 32000) {
        throw error;
      }

      const previous = maxOutputTokens;

      maxOutputTokens = Math.min(
        32000,
        Math.max(
          previous + 4096,
          Math.ceil(previous * 1.8),
        ),
      );

      console.warn(
        `[Deep Work] Respuesta truncada. Reintento ${attempt + 1}/3: ${previous} -> ${maxOutputTokens} tokens.`,
      );
    }
  }

  throw (
    lastError ||
    new Error("Deep Work: generación JSON falló.")
  );
}

const NO_FABRICATION = `
REGLA DE INTEGRIDAD:
- No inventes fuentes, estadísticas, fechas, nombres, citas ni hechos.
- No conviertas inferencias en hechos.
- Si el material fuente no respalda un dato, conserva la incertidumbre o elimina el dato.
- No añadas claims factuales nuevos que no estén en SOURCE/CONTEXT.
- Puedes mejorar estructura, claridad, profundidad conceptual y razonamiento sin fabricar evidencia.
`;

export async function deepPlanStep(input: {
  depth: DeepWorkDepth;
  operation: DeepWorkOperation;
  objective: string;
  targetWords: number;
  title: string;
  sourceContent: string;
}) {
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: 0.35,
    system: `Eres DEEP_PLANNER de Genelibros. Diseñas un plan verificable antes de escribir. ${NO_FABRICATION}`,
    prompt: `
TAREA: ${input.operation}
OBJETIVO: ${input.objective}
CAPÍTULO: ${input.title}
PALABRAS OBJETIVO: ${input.targetWords}
SOURCE:
${input.sourceContent.slice(0, 60000)}

Devuelve JSON:
{
  "objective":"...",
  "operation":"${input.operation}",
  "targetWords":${input.targetWords},
  "constraints":[...],
  "successCriteria":[...],
  "passes":[...],
  "risks":[...],
  "requiredContext":[...]
}`,
  });
  const plan: DeepWorkPlan = {
    objective: clean(data.objective) || input.objective,
    operation: input.operation,
    targetWords: Math.max(300, Number(data.targetWords || input.targetWords) || input.targetWords),
    constraints: stringArray(data.constraints),
    successCriteria: stringArray(data.successCriteria),
    passes: stringArray(data.passes),
    risks: stringArray(data.risks),
    requiredContext: stringArray(data.requiredContext),
  };
  return { plan, usage, model };
}

export async function deepContextStep(input: {
  depth: DeepWorkDepth;
  title: string;
  sourceContent: string;
  priorContext: string;
  nextContext: string;
  projectContext: AnyRow;
  plan: DeepWorkPlan;
}) {
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: 0.25,
    system: `Eres LONG_CONTEXT_ANALYST. Extraes dependencias, hechos y reglas de continuidad antes de redactar. ${NO_FABRICATION}`,
    prompt: `
PROJECT_CONTEXT:
${JSON.stringify(input.projectContext).slice(0, 20000)}

PLAN:
${JSON.stringify(input.plan)}

PREVIOUS_CHAPTER_CONTEXT:
${input.priorContext.slice(-24000)}

TARGET_SOURCE:
${input.sourceContent.slice(0, 60000)}

NEXT_CHAPTER_CONTEXT:
${input.nextContext.slice(0, 24000)}

Devuelve JSON:
{
 "chapterPurpose":"...",
 "priorDependencies":[...],
 "futureDependencies":[...],
 "factsToPreserve":[...],
 "terminology":[...],
 "voiceRules":[...],
 "continuityRisks":[...],
 "omissions":[...]
}`,
  });
  const context: DeepContextAnalysis = {
    chapterPurpose: clean(data.chapterPurpose),
    priorDependencies: stringArray(data.priorDependencies),
    futureDependencies: stringArray(data.futureDependencies),
    factsToPreserve: stringArray(data.factsToPreserve, 40),
    terminology: stringArray(data.terminology, 40),
    voiceRules: stringArray(data.voiceRules),
    continuityRisks: stringArray(data.continuityRisks),
    omissions: stringArray(data.omissions),
  };
  return { context, usage, model };
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
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: input.label === "A" ? 0.55 : 0.7,
    maxOutputTokens: Math.min(30000, Math.max(9000, Math.floor(input.targetWords * 2.4))),
    system: `Eres ${input.label === "A" ? "MULTI_PASS_WRITER" : "ALTERNATIVE_DRAFT_WRITER"}. Produces un candidato independiente de calidad editorial. ${NO_FABRICATION}`,
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
- Si operation=IMPROVE o REWRITE, preserva significado, hechos respaldados, nombres y continuidad.
- Si operation=GENERATE, usa solo hechos presentes en contexto; no rellenes con datos inventados.
- El contenido debe ser un capítulo terminado, no notas ni esquema.

Devuelve JSON:
{
 "content":"texto completo",
 "rationale":"...",
 "strengths":[...],
 "risks":[...]
}`,
  });
  const draft: DeepDraft = {
    label: input.label,
    content: clean(data.content),
    rationale: clean(data.rationale),
    strengths: stringArray(data.strengths),
    risks: stringArray(data.risks),
  };
  if (!draft.content || draft.content.length < 500) {
    throw new Error(`Deep Work: borrador ${input.label} insuficiente.`);
  }
  return { draft, usage, model };
}

export async function criticCouncilStep(input: {
  depth: DeepWorkDepth;
  title: string;
  sourceContent: string;
  plan: DeepWorkPlan;
  context?: DeepContextAnalysis;
  drafts: DeepDraft[];
}) {
  const packed = input.drafts.map((d) => ({ label: d.label, content: d.content.slice(0, 50000) }));
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: 0.2,
    maxOutputTokens: 10000,
    system: `Eres CRITIC_COUNCIL. Actúas como cinco críticos independientes: STRUCTURE, CLARITY, DEPTH, CONTINUITY y ADVERSARIAL. No apruebes por cortesía. ${NO_FABRICATION}`,
    prompt: `
CAPÍTULO: ${input.title}
PLAN: ${JSON.stringify(input.plan)}
CONTEXT: ${JSON.stringify(input.context || {})}
SOURCE ORIGINAL:
${input.sourceContent.slice(0, 45000)}
DRAFTS:
${JSON.stringify(packed)}

Evalúa comparativamente. Devuelve JSON:
{
 "selectedDrafts":["A","B"],
 "ranking":[{"label":"A","score":8.7,"reason":"..."}],
 "reviews":[
   {"critic":"STRUCTURE","score":8.5,"strengths":[...],"problems":[...],"requiredRepairs":[...]}
 ],
 "synthesisInstructions":[...],
 "fatalProblems":[...]
}`,
  });
  const allowedCritics = new Set(["STRUCTURE", "CLARITY", "DEPTH", "CONTINUITY", "ADVERSARIAL"]);
  const reviews: CriticReview[] = (Array.isArray(data.reviews) ? data.reviews : [])
    .map((r: AnyRow) => ({
      critic: allowedCritics.has(clean(r.critic).toUpperCase())
        ? (clean(r.critic).toUpperCase() as CriticReview["critic"])
        : "ADVERSARIAL",
      score: clampScore(r.score),
      strengths: stringArray(r.strengths),
      problems: stringArray(r.problems),
      requiredRepairs: stringArray(r.requiredRepairs),
    }))
    .slice(0, 12);
  const council: DraftCouncilResult = {
    selectedDrafts: stringArray(data.selectedDrafts, 3),
    ranking: (Array.isArray(data.ranking) ? data.ranking : [])
      .map((r: AnyRow) => ({ label: clean(r.label), score: clampScore(r.score), reason: clean(r.reason) }))
      .filter((r: AnyRow) => r.label),
    reviews,
    synthesisInstructions: stringArray(data.synthesisInstructions, 30),
    fatalProblems: stringArray(data.fatalProblems),
  };
  return { council, usage, model };
}

export async function synthesisStep(input: {
  depth: DeepWorkDepth;
  title: string;
  sourceContent: string;
  targetWords: number;
  plan: DeepWorkPlan;
  context?: DeepContextAnalysis;
  drafts: DeepDraft[];
  council: DraftCouncilResult;
}) {
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: 0.4,
    maxOutputTokens: Math.min(32000, Math.max(10000, Math.floor(input.targetWords * 2.5))),
    system: `Eres SYNTHESIS_EDITOR. Fusionas lo mejor de candidatos independientes sin crear un collage incoherente. ${NO_FABRICATION}`,
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

Devuelve JSON:
{"content":"capítulo final sintetizado","rationale":"...","strengths":[...],"risks":[...]}
`,
  });
  const draft: DeepDraft = {
    label: "SYNTHESIS",
    content: clean(data.content),
    rationale: clean(data.rationale),
    strengths: stringArray(data.strengths),
    risks: stringArray(data.risks),
  };
  if (draft.content.length < 500) throw new Error("Deep Work: síntesis insuficiente.");
  return { draft, usage, model };
}

export async function repairStep(input: {
  depth: DeepWorkDepth;
  title: string;
  sourceContent: string;
  candidate: DeepDraft;
  quality: DeepQualityScore;
  targetWords: number;
}) {
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: 0.3,
    maxOutputTokens: Math.min(32000, Math.max(10000, Math.floor(input.targetWords * 2.5))),
    system: `Eres REPAIR_AGENT. Corriges únicamente problemas diagnosticados; no introduces claims nuevos. ${NO_FABRICATION}`,
    prompt: `
CAPÍTULO: ${input.title}
SOURCE ORIGINAL:
${input.sourceContent.slice(0, 50000)}
CANDIDATE:
${input.candidate.content.slice(0, 75000)}
QUALITY_REPORT:
${JSON.stringify(input.quality)}

Aplica todas las reparaciones requeridas y conserva lo que ya funciona.
Devuelve JSON:
{"content":"texto reparado completo","rationale":"...","strengths":[...],"risks":[...]}
`,
  });
  const draft: DeepDraft = {
    label: "REPAIR",
    content: clean(data.content),
    rationale: clean(data.rationale),
    strengths: stringArray(data.strengths),
    risks: stringArray(data.risks),
  };
  if (draft.content.length < 500) throw new Error("Deep Work: reparación insuficiente.");
  return { draft, usage, model };
}

export async function deepQualityStep(input: {
  depth: DeepWorkDepth;
  title: string;
  sourceContent: string;
  candidate: DeepDraft;
  context?: DeepContextAnalysis;
}) {
  const { data, usage, model } = await generateJson({
    depth: input.depth,
    temperature: 0.15,
    maxOutputTokens: 7000,
    system: `Eres DEEP_QUALITY_JUDGE. Juzgas con estándar editorial alto y detectas claims nuevos no respaldados. ${NO_FABRICATION}`,
    prompt: `
CAPÍTULO: ${input.title}
SOURCE ORIGINAL:
${input.sourceContent.slice(0, 50000)}
CONTEXT:
${JSON.stringify(input.context || {})}
CANDIDATE:
${input.candidate.content.slice(0, 85000)}

Devuelve JSON:
{
 "overallScore":8.9,
 "verdict":"APPROVED|REPAIR|REJECTED",
 "scores":{"structure":0,"depth":0,"clarity":0,"continuity":0,"style":0,"originality":0,"factualDiscipline":0,"usefulness":0,"publishability":0},
 "strengths":[...],"weaknesses":[...],"requiredRepairs":[...],"unsupportedNewClaims":[...]
}`,
  });
  const s = data.scores || {};
  const unsupported = stringArray(data.unsupportedNewClaims, 40);
  const rawVerdict = clean(data.verdict).toUpperCase();
  const overall = clampScore(data.overallScore);
  let verdict: DeepQualityScore["verdict"] = rawVerdict === "APPROVED" ? "APPROVED" : rawVerdict === "REJECTED" ? "REJECTED" : "REPAIR";
  if (unsupported.length) verdict = "REPAIR";
  const quality: DeepQualityScore = {
    overallScore: overall,
    verdict,
    scores: {
      structure: clampScore(s.structure),
      depth: clampScore(s.depth),
      clarity: clampScore(s.clarity),
      continuity: clampScore(s.continuity),
      style: clampScore(s.style),
      originality: clampScore(s.originality),
      factualDiscipline: clampScore(s.factualDiscipline),
      usefulness: clampScore(s.usefulness),
      publishability: clampScore(s.publishability),
    },
    strengths: stringArray(data.strengths),
    weaknesses: stringArray(data.weaknesses),
    requiredRepairs: stringArray(data.requiredRepairs, 30),
    unsupportedNewClaims: unsupported,
  };
  return { quality, usage, model };
}

export function deepModePolicy(depth: DeepWorkDepth) {
  if (depth === "FAST") return { draftCount: 1, maxRepairAttempts: 0, threshold: 8.6, useContext: false, useCouncil: false };
  if (depth === "DEEP") return { draftCount: 2, maxRepairAttempts: 1, threshold: 9.0, useContext: true, useCouncil: true };
  if (depth === "SUPREME") return { draftCount: 3, maxRepairAttempts: 2, threshold: 9.3, useContext: true, useCouncil: true };
  return { draftCount: 3, maxRepairAttempts: 3, threshold: 9.5, useContext: true, useCouncil: true };
}

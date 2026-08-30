import { GoogleGenAI } from "@google/genai";
import { manuscriptDeterministicMetrics, wordCount } from "../lib/refinery/metrics";
import type {
  ChapterAuditScores,
  ChapterOverlap,
  ManuscriptAuditMode,
  ManuscriptAuditResult,
  ManuscriptChapterAudit,
  ManuscriptChapterInput,
  ManuscriptGlobalAudit,
  ManuscriptGlobalScores,
} from "../lib/refinery/types";

type AnyRow = Record<string, any>;

const RUNTIME_VERSION = "11B-manuscript-auditor-1.0.0";
const DEFAULT_DEEP_MODEL = "gemini-2.5-pro";
const MAX_CHAPTER_CHARS = 52000;
const MAX_GLOBAL_SUMMARY_CHARS = 120000;

function apiKey(): string {
  return String(process.env.GEMINI_API_KEY || "").trim();
}

function selectedModel(): string {
  return String(
    process.env.REFINERY_DEEP_MODEL ||
      process.env.OS4_DEEP_MODEL ||
      DEFAULT_DEEP_MODEL,
  ).trim();
}

function aiClient() {
  const key = apiKey();
  if (!key) throw new Error("Book Refinery: GEMINI_API_KEY no configurado.");
  return new GoogleGenAI({ apiKey: key });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function clampScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Number(Math.max(0, Math.min(10, n)).toFixed(2));
}

function integer(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function jsonCandidate(text: string): string {
  const raw = clean(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const firstObject = raw.indexOf("{");
  const lastObject = raw.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return raw.slice(firstObject, lastObject + 1);
  }
  return raw;
}

function parseJson(text: string): AnyRow {
  const candidate = jsonCandidate(text);
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\u0000/g, "");
    return JSON.parse(repaired);
  }
}

function usageOf(response: any) {
  const usage = response?.usageMetadata || {};
  const inputTokens = integer(
    usage.promptTokenCount ?? usage.inputTokenCount ?? 0,
  );
  const outputTokens = integer(
    usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0,
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens: integer(
      usage.totalTokenCount || inputTokens + outputTokens,
    ),
  };
}

async function generateJson(
  prompt: string,
  temperature = 0.15,
): Promise<{ data: AnyRow; usage: ReturnType<typeof usageOf> }> {
  const response: any = await aiClient().models.generateContent({
    model: selectedModel(),
    contents: prompt,
    config: {
      temperature,
      responseMimeType: "application/json",
    },
  });

  const text = clean(response?.text);
  if (!text) throw new Error("Book Refinery: Gemini devolvió respuesta vacía.");

  return {
    data: parseJson(text),
    usage: usageOf(response),
  };
}

function scoreObject(raw: AnyRow): ChapterAuditScores {
  return {
    structure: clampScore(raw?.structure),
    thesis: clampScore(raw?.thesis),
    depth: clampScore(raw?.depth),
    clarity: clampScore(raw?.clarity),
    redundancy: clampScore(raw?.redundancy),
    continuity: clampScore(raw?.continuity),
    style: clampScore(raw?.style),
    pacing: clampScore(raw?.pacing),
    originality: clampScore(raw?.originality),
    factuality: clampScore(raw?.factuality),
    evidence: clampScore(raw?.evidence),
    publishability: clampScore(raw?.publishability),
  };
}

function globalScoreObject(raw: AnyRow): ManuscriptGlobalScores {
  return {
    structure: clampScore(raw?.structure),
    centralThesis: clampScore(raw?.centralThesis ?? raw?.central_thesis),
    depth: clampScore(raw?.depth),
    clarity: clampScore(raw?.clarity),
    nonRepetition: clampScore(raw?.nonRepetition ?? raw?.non_repetition),
    continuity: clampScore(raw?.continuity),
    style: clampScore(raw?.style),
    pacing: clampScore(raw?.pacing),
    originality: clampScore(raw?.originality),
    factuality: clampScore(raw?.factuality),
    evidence: clampScore(raw?.evidence),
    introduction: clampScore(raw?.introduction),
    conclusion: clampScore(raw?.conclusion),
    commercialValue: clampScore(raw?.commercialValue ?? raw?.commercial_value),
    publishability: clampScore(raw?.publishability),
  };
}

function list(value: unknown, max = 30): string[] {
  return (Array.isArray(value) ? value : [])
    .map((x) => clean(x))
    .filter(Boolean)
    .slice(0, max);
}

function chapterPrompt(
  project: AnyRow,
  chapter: ManuscriptChapterInput,
  mode: ManuscriptAuditMode,
): string {
  const content = clean(chapter.content);
  const clipped = content.slice(0, MAX_CHAPTER_CHARS);

  return `
Eres MANUSCRIPT_AUDITOR, un editor senior de libros comerciales y de no ficción.
Tu misión NO es reescribir el capítulo. Debes diagnosticarlo con severidad editorial.
No premies prosa genérica. No confundas longitud con profundidad.
No inventes hechos. Marca afirmaciones que requieran verificación.
Evalúa repetición semántica, no solo frases idénticas.

PROYECTO
Título: ${clean(project.title)}
Tema: ${clean(project.topic)}
Audiencia: ${clean(project.audience)}
Estilo objetivo: ${clean(project.tone_style)}
Modo de auditoría: ${mode}

CAPÍTULO
Número: ${chapter.chapterNumber}
Título: ${chapter.title}
Palabras aproximadas: ${wordCount(content)}
Texto truncado para auditoría: ${content.length > clipped.length ? "SÍ" : "NO"}

TEXTO
<<<
${clipped}
>>>

Devuelve SOLO JSON válido con esta forma exacta:
{
  "scores": {
    "structure": 0,
    "thesis": 0,
    "depth": 0,
    "clarity": 0,
    "redundancy": 0,
    "continuity": 0,
    "style": 0,
    "pacing": 0,
    "originality": 0,
    "factuality": 0,
    "evidence": 0,
    "publishability": 0
  },
  "overallScore": 0,
  "thesis": "",
  "keyIdeas": [],
  "strengths": [],
  "weaknesses": [],
  "repetitions": [],
  "unsupportedClaims": [],
  "continuityRisks": [],
  "recommendedAction": "PRESERVE|POLISH|REDUCE|EXPAND|REWRITE|RESTRUCTURE|MERGE",
  "targetReductionPercent": 0,
  "estimatedRemovableWords": 0,
  "estimatedExpansionWords": 0,
  "editorialInstructions": [],
  "confidence": 0
}

Criterio:
9.5+ excepcional/publicable.
9.0-9.49 fuerte pero aún mejorable.
8.0-8.99 necesita edición real.
7.0-7.99 necesita intervención importante.
<7 requiere reestructuración o reescritura.
Para "redundancy", 10 significa ausencia de redundancia problemática.
`.trim();
}

function normalizeChapterAudit(
  chapter: ManuscriptChapterInput,
  raw: AnyRow,
): ManuscriptChapterAudit {
  const allowedActions = new Set([
    "PRESERVE",
    "POLISH",
    "REDUCE",
    "EXPAND",
    "REWRITE",
    "RESTRUCTURE",
    "MERGE",
  ]);
  const action = clean(raw?.recommendedAction).toUpperCase();

  return {
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    scores: scoreObject(raw?.scores || {}),
    overallScore: clampScore(raw?.overallScore),
    thesis: clean(raw?.thesis),
    keyIdeas: list(raw?.keyIdeas, 20),
    strengths: list(raw?.strengths, 20),
    weaknesses: list(raw?.weaknesses, 30),
    repetitions: list(raw?.repetitions, 30),
    unsupportedClaims: list(raw?.unsupportedClaims, 40),
    continuityRisks: list(raw?.continuityRisks, 30),
    recommendedAction: (allowedActions.has(action)
      ? action
      : "POLISH") as ManuscriptChapterAudit["recommendedAction"],
    targetReductionPercent: Math.max(
      0,
      Math.min(70, integer(raw?.targetReductionPercent)),
    ),
    estimatedRemovableWords: integer(raw?.estimatedRemovableWords),
    estimatedExpansionWords: integer(raw?.estimatedExpansionWords),
    editorialInstructions: list(raw?.editorialInstructions, 40),
    confidence: clampScore(raw?.confidence, 7),
  };
}

function globalPrompt(
  project: AnyRow,
  chapters: ManuscriptChapterInput[],
  audits: ManuscriptChapterAudit[],
  deterministic: ReturnType<typeof manuscriptDeterministicMetrics>,
  mode: ManuscriptAuditMode,
): string {
  const chapterSummaries = chapters.map((chapter) => {
    const audit = audits.find((x) => x.chapterNumber === chapter.chapterNumber);
    const content = clean(chapter.content);
    return {
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      words: wordCount(content),
      thesis: audit?.thesis || "",
      keyIdeas: audit?.keyIdeas || [],
      overallScore: audit?.overallScore || 0,
      recommendedAction: audit?.recommendedAction || "POLISH",
      weaknesses: audit?.weaknesses?.slice(0, 8) || [],
      repetitions: audit?.repetitions?.slice(0, 8) || [],
      unsupportedClaims: audit?.unsupportedClaims?.slice(0, 8) || [],
      opening: content.slice(0, 900),
      closing: content.slice(-700),
    };
  });

  const input = JSON.stringify({
    project: {
      title: project.title,
      topic: project.topic,
      audience: project.audience,
      tone_style: project.tone_style,
      outline_12: project.outline_12,
      dossier: project.dossier,
    },
    mode,
    deterministic: {
      meanChapterWords: deterministic.meanChapterWords,
      chapterWordStdDev: deterministic.chapterWordStdDev,
      imbalanceRatio: deterministic.imbalanceRatio,
      repeatedParagraphWords: deterministic.repeatedParagraphWords,
      strongestLexicalOverlaps: deterministic.lexicalOverlapMatrix.slice(0, 30),
    },
    chapters: chapterSummaries,
  }).slice(0, MAX_GLOBAL_SUMMARY_CHARS);

  return `
Eres el CONSEJO EDITORIAL GLOBAL de Genelibros.
Recibes auditorías independientes de cada capítulo y métricas del manuscrito.
Debes evaluar EL LIBRO COMPLETO, detectar problemas que un análisis aislado por capítulo no puede ver y producir un plan de cirugía editorial.

Reglas:
- No reescribas el libro.
- No inventes fuentes ni hechos.
- Busca repetición conceptual entre capítulos.
- Señala contradicciones, huecos, capítulos fuera de propósito y progresión defectuosa.
- La reducción recomendada debe ser editorialmente necesaria, no una cuota arbitraria.
- Un libro largo no debe reducirse si cada sección aporta valor.
- Si dos capítulos repiten la misma función, puedes recomendar MERGE.
- "nonRepetition" 10 = prácticamente sin repetición problemática.
- Produce semanticOverlap 0-100 entre pares realmente problemáticos.
- Para libros de no ficción, castiga factualidad/evidencia débil.

DATOS DEL MANUSCRITO
${input}

Devuelve SOLO JSON válido:
{
  "scores": {
    "structure": 0,
    "centralThesis": 0,
    "depth": 0,
    "clarity": 0,
    "nonRepetition": 0,
    "continuity": 0,
    "style": 0,
    "pacing": 0,
    "originality": 0,
    "factuality": 0,
    "evidence": 0,
    "introduction": 0,
    "conclusion": 0,
    "commercialValue": 0,
    "publishability": 0
  },
  "overallScore": 0,
  "verdict": "NOT_READY|NEEDS_MAJOR_EDIT|NEEDS_REFINEMENT|PUBLISHABLE|PUBLISH_READY",
  "centralThesis": "",
  "promiseToReader": "",
  "strongestElements": [],
  "globalProblems": [],
  "missingElements": [],
  "factualRisks": [],
  "structuralRecommendations": [],
  "crossChapterOverlaps": [
    {
      "chapterA": 1,
      "chapterB": 2,
      "semanticOverlap": 0,
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "repeatedIdeas": [],
      "recommendation": ""
    }
  ],
  "surgeryPlan": [
    {
      "priority": "CRITICAL|HIGH|MEDIUM|LOW",
      "scope": "BOOK|CHAPTER|SECTION",
      "chapterNumber": 1,
      "action": "PRESERVE|POLISH|REDUCE|EXPAND|REWRITE|RESTRUCTURE|MERGE",
      "problem": "",
      "instruction": "",
      "expectedImpact": ""
    }
  ],
  "recommendedReductionPercent": 0,
  "recommendedWordCount": 0,
  "finalEditorialBrief": "",
  "confidence": 0
}
`.trim();
}

function normalizeOverlap(
  raw: AnyRow,
  deterministic: ChapterOverlap[],
): ChapterOverlap {
  const a = integer(raw?.chapterA);
  const b = integer(raw?.chapterB);
  const lexical = deterministic.find(
    (x) =>
      (x.chapterA === a && x.chapterB === b) ||
      (x.chapterA === b && x.chapterB === a),
  );

  const semantic = Math.max(
    0,
    Math.min(100, Number(raw?.semanticOverlap || 0) || 0),
  );
  const severityRaw = clean(raw?.severity).toUpperCase();
  const severity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severityRaw)
    ? severityRaw
    : semantic >= 70
      ? "CRITICAL"
      : semantic >= 50
        ? "HIGH"
        : semantic >= 30
          ? "MEDIUM"
          : "LOW";

  return {
    chapterA: a,
    chapterB: b,
    lexicalOverlap: lexical?.lexicalOverlap || 0,
    semanticOverlap: Number(semantic.toFixed(1)),
    severity: severity as ChapterOverlap["severity"],
    repeatedIdeas: list(raw?.repeatedIdeas, 15),
    recommendation: clean(raw?.recommendation),
  };
}

function normalizeGlobal(
  raw: AnyRow,
  currentWords: number,
  deterministicOverlaps: ChapterOverlap[],
): ManuscriptGlobalAudit {
  const allowedVerdicts = new Set([
    "NOT_READY",
    "NEEDS_MAJOR_EDIT",
    "NEEDS_REFINEMENT",
    "PUBLISHABLE",
    "PUBLISH_READY",
  ]);
  const verdictRaw = clean(raw?.verdict).toUpperCase();
  const reduction = Math.max(
    0,
    Math.min(60, Number(raw?.recommendedReductionPercent || 0) || 0),
  );
  const recommendedWordCount =
    integer(raw?.recommendedWordCount) ||
    Math.round(currentWords * (1 - reduction / 100));

  return {
    scores: globalScoreObject(raw?.scores || {}),
    overallScore: clampScore(raw?.overallScore),
    verdict: (allowedVerdicts.has(verdictRaw)
      ? verdictRaw
      : "NEEDS_REFINEMENT") as ManuscriptGlobalAudit["verdict"],
    centralThesis: clean(raw?.centralThesis),
    promiseToReader: clean(raw?.promiseToReader),
    strongestElements: list(raw?.strongestElements, 30),
    globalProblems: list(raw?.globalProblems, 40),
    missingElements: list(raw?.missingElements, 30),
    factualRisks: list(raw?.factualRisks, 40),
    structuralRecommendations: list(raw?.structuralRecommendations, 40),
    crossChapterOverlaps: (Array.isArray(raw?.crossChapterOverlaps)
      ? raw.crossChapterOverlaps
      : []
    )
      .map((x: AnyRow) => normalizeOverlap(x, deterministicOverlaps))
      .filter((x: ChapterOverlap) => x.chapterA > 0 && x.chapterB > 0)
      .slice(0, 80),
    surgeryPlan: (Array.isArray(raw?.surgeryPlan) ? raw.surgeryPlan : [])
      .map((x: AnyRow) => ({
        priority: ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(
          clean(x?.priority).toUpperCase(),
        )
          ? clean(x.priority).toUpperCase()
          : "MEDIUM",
        scope: ["BOOK", "CHAPTER", "SECTION"].includes(
          clean(x?.scope).toUpperCase(),
        )
          ? clean(x.scope).toUpperCase()
          : "BOOK",
        chapterNumber: x?.chapterNumber
          ? integer(x.chapterNumber)
          : undefined,
        action: [
          "PRESERVE",
          "POLISH",
          "REDUCE",
          "EXPAND",
          "REWRITE",
          "RESTRUCTURE",
          "MERGE",
        ].includes(clean(x?.action).toUpperCase())
          ? clean(x.action).toUpperCase()
          : "POLISH",
        problem: clean(x?.problem),
        instruction: clean(x?.instruction),
        expectedImpact: clean(x?.expectedImpact),
      }))
      .slice(0, 100) as ManuscriptGlobalAudit["surgeryPlan"],
    recommendedReductionPercent: Number(reduction.toFixed(1)),
    recommendedWordCount,
    finalEditorialBrief: clean(raw?.finalEditorialBrief),
    confidence: clampScore(raw?.confidence, 7),
  };
}

export async function auditManuscript(args: {
  project: AnyRow;
  chapters: ManuscriptChapterInput[];
  mode?: ManuscriptAuditMode;
}): Promise<ManuscriptAuditResult> {
  const mode: ManuscriptAuditMode =
    args.mode === "SUPREME" ? "SUPREME" : "DEEP";

  const chapters = args.chapters
    .filter((x) => clean(x.content))
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  if (!chapters.length) {
    throw new Error("Book Refinery: el proyecto no contiene capítulos auditables.");
  }

  const deterministic = manuscriptDeterministicMetrics(chapters);
  const warnings: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 };
  const chapterAudits: ManuscriptChapterAudit[] = [];

  for (const chapter of chapters) {
    if (chapter.content.length > MAX_CHAPTER_CHARS) {
      warnings.push(
        `chapter-${chapter.chapterNumber}:contenido-truncado-en-auditoria`,
      );
    }

    const response = await generateJson(
      chapterPrompt(args.project, chapter, mode),
      mode === "SUPREME" ? 0.08 : 0.15,
    );

    usage.calls += 1;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.totalTokens += response.usage.totalTokens;

    chapterAudits.push(normalizeChapterAudit(chapter, response.data));
  }

  const globalResponse = await generateJson(
    globalPrompt(
      args.project,
      chapters,
      chapterAudits,
      deterministic,
      mode,
    ),
    0.08,
  );

  usage.calls += 1;
  usage.inputTokens += globalResponse.usage.inputTokens;
  usage.outputTokens += globalResponse.usage.outputTokens;
  usage.totalTokens += globalResponse.usage.totalTokens;

  const currentWords = chapters.reduce(
    (sum, chapter) => sum + wordCount(chapter.content),
    0,
  );
  const global = normalizeGlobal(
    globalResponse.data,
    currentWords,
    deterministic.lexicalOverlapMatrix,
  );

  return {
    version: RUNTIME_VERSION,
    mode,
    projectId: clean(args.project.id),
    projectTitle: clean(args.project.title),
    createdAt: new Date().toISOString(),
    model: selectedModel(),
    currentWords,
    recommendedWords: global.recommendedWordCount,
    recommendedReductionPercent: global.recommendedReductionPercent,
    chapterCount: chapters.length,
    deterministic,
    chapters: chapterAudits,
    global,
    warnings,
    usage,
  };
}


// GENELIBROS_11B2_DURABLE_EXPORTS
export async function auditSingleChapterStep(args: {
  project: AnyRow;
  chapter: ManuscriptChapterInput;
  mode?: ManuscriptAuditMode;
}) {
  const mode: ManuscriptAuditMode =
    args.mode === "SUPREME" ? "SUPREME" : "DEEP";

  const response = await generateJson(
    chapterPrompt(args.project, args.chapter, mode),
    mode === "SUPREME" ? 0.08 : 0.15,
  );

  return {
    audit: normalizeChapterAudit(args.chapter, response.data),
    usage: response.usage,
    model: selectedModel(),
    warning:
      String(args.chapter.content || "").length > MAX_CHAPTER_CHARS
        ? `chapter-${args.chapter.chapterNumber}:contenido-truncado-en-auditoria`
        : null,
  };
}

export async function auditGlobalManuscriptStep(args: {
  project: AnyRow;
  chapters: ManuscriptChapterInput[];
  audits: ManuscriptChapterAudit[];
  deterministic: ReturnType<typeof manuscriptDeterministicMetrics>;
  mode?: ManuscriptAuditMode;
}) {
  const mode: ManuscriptAuditMode =
    args.mode === "SUPREME" ? "SUPREME" : "DEEP";

  const response = await generateJson(
    globalPrompt(
      args.project,
      args.chapters,
      args.audits,
      args.deterministic,
      mode,
    ),
    0.08,
  );

  const currentWords = args.chapters.reduce(
    (sum, chapter) => sum + wordCount(chapter.content),
    0,
  );

  return {
    global: normalizeGlobal(
      response.data,
      currentWords,
      args.deterministic.lexicalOverlapMatrix,
    ),
    usage: response.usage,
    model: selectedModel(),
    currentWords,
  };
}

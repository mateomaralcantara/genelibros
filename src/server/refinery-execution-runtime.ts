import { GoogleGenAI } from "@google/genai";
import { wordCount } from "../lib/refinery/metrics.js";
import type {
  ManuscriptChapterAudit,
  ManuscriptChapterInput,
  ManuscriptGlobalAudit,
} from "../lib/refinery/types.js";
import type {
  EditorialDelta,
  RefinementAction,
  RefinementCandidate,
  RefinementMode,
  RefinementPlanItem,
  RefinementResearchGap,
} from "../lib/refinery-execution/types.js";

type AnyRow = Record<string, any>;

const RUNTIME_VERSION = "refinery-11b3-execution-1.0.0";
const MAX_CHAPTER_CHARS = 56000;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampScore(value: unknown, fallback = 0): number {
  return Number(Math.max(0, Math.min(10, number(value, fallback))).toFixed(2));
}

function list(value: unknown, max = 30): string[] {
  return (Array.isArray(value) ? value : [])
    .map((x) => clean(x))
    .filter(Boolean)
    .slice(0, max);
}

function selectedModel(): string {
  return clean(
    process.env.REFINERY_EXECUTION_MODEL ||
      process.env.REFINERY_DEEP_MODEL ||
      process.env.OS4_DEEP_MODEL ||
      "gemini-2.5-pro",
  );
}

function aiClient() {
  const key = clean(process.env.GEMINI_API_KEY);
  if (!key) throw new Error("Refinery 11B.3: GEMINI_API_KEY no configurado.");
  return new GoogleGenAI({ apiKey: key });
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
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
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
    return JSON.parse(
      candidate.replace(/,\s*([}\]])/g, "$1").replace(/\u0000/g, "").trim(),
    );
  }
}

function usageOf(response: any) {
  const usage = response?.usageMetadata || {};
  const inputTokens = Math.max(
    0,
    Math.round(number(usage.promptTokenCount ?? usage.inputTokenCount, 0)),
  );
  const outputTokens = Math.max(
    0,
    Math.round(number(usage.candidatesTokenCount ?? usage.outputTokenCount, 0)),
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(
      0,
      Math.round(number(usage.totalTokenCount, inputTokens + outputTokens)),
    ),
  };
}

async function generateJson(prompt: string, temperature = 0.12) {
  const response: any = await aiClient().models.generateContent({
    model: selectedModel(),
    contents: prompt,
    config: {
      temperature,
      responseMimeType: "application/json",
    },
  });
  const text = clean(response?.text);
  if (!text) throw new Error("Refinery 11B.3: Gemini devolvió respuesta vacía.");
  return { data: parseJson(text), usage: usageOf(response), model: selectedModel() };
}

function priorityOf(value: unknown): RefinementPlanItem["priority"] {
  const v = clean(value).toUpperCase();
  return (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(v)
    ? v
    : "MEDIUM") as RefinementPlanItem["priority"];
}

function actionOf(value: unknown): RefinementAction {
  const v = clean(value).toUpperCase();
  return ([
    "PRESERVE",
    "POLISH",
    "REDUCE",
    "EXPAND",
    "REWRITE",
    "RESTRUCTURE",
    "MERGE",
  ].includes(v)
    ? v
    : "POLISH") as RefinementAction;
}

function surgeryForChapter(global: ManuscriptGlobalAudit, chapterNumber: number) {
  return (global?.surgeryPlan || [])
    .filter((item) => Number(item.chapterNumber || 0) === chapterNumber)
    .sort((a, b) => {
      const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
      return rank[priorityOf(a.priority)] - rank[priorityOf(b.priority)];
    });
}

export function buildRefinementPlan(args: {
  chapters: ManuscriptChapterInput[];
  chapterAudits: ManuscriptChapterAudit[];
  global: ManuscriptGlobalAudit;
}): {
  plan: RefinementPlanItem[];
  researchGaps: RefinementResearchGap[];
  structuralPlan: Array<Record<string, unknown>>;
} {
  const researchGaps: RefinementResearchGap[] = [];
  const structuralPlan: Array<Record<string, unknown>> = [];

  const plan = args.chapters.map((chapter) => {
    const audit = args.chapterAudits.find(
      (x) => x.chapterNumber === chapter.chapterNumber,
    );
    if (!audit) {
      return {
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        action: "PRESERVE" as const,
        priority: "LOW" as const,
        beforeScore: 0,
        evidenceScore: 0,
        factualityScore: 0,
        targetReductionPercent: 0,
        instruction: "Sin auditoría previa: conservar hasta nueva evaluación.",
        researchRequired: false,
        hardResearchBlock: false,
        status: "PRESERVED" as const,
        repairAttempts: 0,
        reason: "missing_audit",
      };
    }

    const surgery = surgeryForChapter(args.global, chapter.chapterNumber);
    const top = surgery[0];
    let action = actionOf(top?.action || audit.recommendedAction);
    let priority = priorityOf(top?.priority || (audit.overallScore < 7.5 ? "HIGH" : "MEDIUM"));

    if (
      audit.overallScore >= 9.2 &&
      audit.weaknesses.length === 0 &&
      audit.repetitions.length === 0 &&
      audit.unsupportedClaims.length === 0
    ) {
      action = "PRESERVE";
      priority = "LOW";
    } else if (action === "PRESERVE" && audit.overallScore < 8.8) {
      action = "POLISH";
    }

    const evidence = clampScore(audit.scores?.evidence);
    const factuality = clampScore(audit.scores?.factuality);
    const unsupported = audit.unsupportedClaims || [];
    const researchRequired = evidence < 7.5 || factuality < 7.5 || unsupported.length > 0;
    const hardResearchBlock =
      evidence < 6.0 ||
      factuality < 6.0 ||
      (unsupported.length >= 4 && ["EXPAND", "REWRITE"].includes(action));

    if (researchRequired) {
      researchGaps.push({
        chapterNumber: chapter.chapterNumber,
        severity:
          evidence < 5.5 || factuality < 5.5
            ? "CRITICAL"
            : evidence < 6.5 || factuality < 6.5
              ? "HIGH"
              : "MEDIUM",
        reason: `Evidencia ${evidence}/10; factualidad ${factuality}/10; claims sin respaldo: ${unsupported.length}.`,
        unsupportedClaims: unsupported.slice(0, 30),
        requestedEvidence: [
          "fuentes primarias u oficiales para cifras, fechas y afirmaciones verificables",
          "fecha de corte y entidad responsable de los datos",
          "contraste independiente cuando el claim sea controvertido",
        ],
        blocksActions: hardResearchBlock ? ["EXPAND", "REWRITE"] : [],
      });
    }

    if (action === "MERGE") {
      structuralPlan.push({
        chapterNumber: chapter.chapterNumber,
        action: "MERGE",
        priority,
        problem: top?.problem || audit.repetitions.join(" | "),
        instruction: top?.instruction || "Preparar fusión; no aplicar automáticamente.",
      });
    }

    const status =
      action === "PRESERVE"
        ? "PRESERVED"
        : action === "MERGE"
          ? "STRUCTURAL_PLAN"
          : hardResearchBlock && ["EXPAND", "REWRITE"].includes(action)
            ? "NEEDS_RESEARCH"
            : "PENDING";

    return {
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      action,
      priority,
      beforeScore: clampScore(audit.overallScore),
      evidenceScore: evidence,
      factualityScore: factuality,
      targetReductionPercent: Math.max(
        0,
        Math.min(60, number(audit.targetReductionPercent, 0)),
      ),
      instruction:
        clean(top?.instruction) ||
        audit.editorialInstructions.slice(0, 6).join(" | ") ||
        "Mejorar el capítulo sin cambiar su tesis ni añadir hechos.",
      researchRequired,
      hardResearchBlock,
      status,
      repairAttempts: 0,
      reason:
        status === "NEEDS_RESEARCH"
          ? "La intervención solicitada podría inventar o reforzar claims sin evidencia."
          : undefined,
    } as RefinementPlanItem;
  });

  for (const item of args.global?.surgeryPlan || []) {
    if (String(item.scope || "").toUpperCase() === "BOOK" || item.action === "MERGE") {
      structuralPlan.push({
        priority: item.priority,
        scope: item.scope,
        chapterNumber: item.chapterNumber,
        action: item.action,
        problem: item.problem,
        instruction: item.instruction,
        expectedImpact: item.expectedImpact,
      });
    }
  }

  return { plan, researchGaps, structuralPlan };
}

function agentChain(action: RefinementAction): string[] {
  switch (action) {
    case "REDUCE":
      return ["REDUNDANCY_HUNTER", "COMPRESSION_EDITOR", "REWRITE_EDITOR"];
    case "EXPAND":
      return ["EXPANSION_EDITOR", "REWRITE_EDITOR"];
    case "RESTRUCTURE":
      return ["STRUCTURAL_EDITOR", "REWRITE_EDITOR"];
    case "REWRITE":
      return ["STRUCTURAL_EDITOR", "REWRITE_EDITOR", "STYLE_REFINER"];
    case "POLISH":
      return ["CLARITY_EDITOR", "STYLE_REFINER", "LINE_EDITOR"];
    default:
      return ["MASTER_BOOK_REFINER"];
  }
}

function refinePrompt(args: {
  project: AnyRow;
  chapter: ManuscriptChapterInput;
  audit: ManuscriptChapterAudit;
  plan: RefinementPlanItem;
  mode: RefinementMode;
  repairContext?: AnyRow | null;
}) {
  const original = clean(args.chapter.content).slice(0, MAX_CHAPTER_CHARS);
  const chain = agentChain(args.plan.action);
  const repair = args.repairContext
    ? `\nREPARACIÓN DE INTENTO PREVIO\n${JSON.stringify(args.repairContext).slice(0, 12000)}\n`
    : "";

  return `
GENELIBROS — BOOK REFINERY 11B.3
Actúas como esta cadena editorial: ${chain.join(" -> ")}.
Modo: ${args.mode}

OBJETIVO
Aplicar una cirugía editorial CONTROLADA al capítulo. No eres investigador.

REGLAS DE SEGURIDAD EDITORIAL
1. NO inventes fuentes, autores, citas, estadísticas, fechas, instituciones, leyes, estudios ni hechos.
2. NO agregues nuevos claims verificables que no estén ya presentes en el texto original.
3. Si una mejora requiere evidencia externa, devuelve status="NEEDS_RESEARCH" y content exactamente igual al original.
4. Conserva números, nombres, fechas y afirmaciones factuales existentes salvo que el plan ordene eliminar una repetición completa.
5. No "mejores" factualidad aparentando certeza. La evidencia solo puede venir de Research Intelligence.
6. Mantén la voz y tesis del autor.
7. Elimina relleno, redundancia y frases genéricas cuando corresponda.
8. Para EXPAND, solo puedes ampliar explicación lógica de ideas YA presentes; no agregar conocimiento externo.
9. Para RESTRUCTURE, puedes reordenar el contenido del capítulo, no inventar contenido.
10. Devuelve el capítulo COMPLETO, no fragmentos ni comentarios entre el texto.

PROYECTO
Título: ${clean(args.project.title)}
Tema: ${clean(args.project.topic)}
Audiencia: ${clean(args.project.audience)}
Estilo: ${clean(args.project.tone_style)}

CAPÍTULO
Número: ${args.chapter.chapterNumber}
Título: ${args.chapter.title}
Acción: ${args.plan.action}
Prioridad: ${args.plan.priority}
Palabras: ${wordCount(original)}
Reducción objetivo: ${args.plan.targetReductionPercent}%
Instrucción: ${args.plan.instruction}
Research requerido: ${args.plan.researchRequired ? "SÍ" : "NO"}

AUDITORÍA PREVIA
Score: ${args.audit.overallScore}
Debilidades: ${JSON.stringify(args.audit.weaknesses)}
Repeticiones: ${JSON.stringify(args.audit.repetitions)}
Claims sin respaldo: ${JSON.stringify(args.audit.unsupportedClaims)}
Riesgos continuidad: ${JSON.stringify(args.audit.continuityRisks)}
${repair}
TEXTO ORIGINAL
<<<
${original}
>>>

Devuelve SOLO JSON válido:
{
  "status": "OK|NEEDS_RESEARCH",
  "content": "capítulo completo",
  "summary": "qué se hizo",
  "changes": [],
  "removedIdeas": [],
  "addedIdeas": [],
  "researchNeeds": []
}
`.trim();
}

export async function refineChapterStep(args: {
  project: AnyRow;
  chapter: ManuscriptChapterInput;
  audit: ManuscriptChapterAudit;
  plan: RefinementPlanItem;
  mode?: RefinementMode;
  repairContext?: AnyRow | null;
}): Promise<{ candidate: RefinementCandidate; usage: AnyRow; model: string }> {
  const mode: RefinementMode = args.mode === "SUPREME" ? "SUPREME" : "DEEP";
  const chain = agentChain(args.plan.action);
  const response = await generateJson(
    refinePrompt({ ...args, mode }),
    mode === "SUPREME" ? 0.06 : 0.12,
  );
  const raw = response.data || {};
  const status = clean(raw.status).toUpperCase() === "NEEDS_RESEARCH" ? "NEEDS_RESEARCH" : "OK";
  const original = String(args.chapter.content || "");
  let content = String(raw.content || "");

  if (status === "NEEDS_RESEARCH") content = original;
  if (status === "OK" && !clean(content)) {
    throw new Error(`Refinery 11B.3: candidato vacío para capítulo ${args.chapter.chapterNumber}.`);
  }

  const originalWords = Math.max(1, wordCount(original));
  const candidateWords = wordCount(content);
  const ratio = candidateWords / originalWords;
  const minRatio = args.plan.action === "REDUCE" ? 0.55 : 0.72;
  const maxRatio = args.plan.action === "EXPAND" ? 1.55 : 1.3;

  if (status === "OK" && (ratio < minRatio || ratio > maxRatio)) {
    throw new Error(
      `Refinery 11B.3: cambio de longitud fuera de límites (${Math.round(ratio * 100)}%).`,
    );
  }

  return {
    candidate: {
      status,
      content,
      summary: clean(raw.summary),
      changes: list(raw.changes, 30),
      removedIdeas: list(raw.removedIdeas, 30),
      addedIdeas: list(raw.addedIdeas, 30),
      researchNeeds: list(raw.researchNeeds, 30),
      agentChain: chain,
    },
    usage: response.usage,
    model: response.model,
  };
}

function delta(a: unknown, b: unknown): number {
  return Number((number(b) - number(a)).toFixed(2));
}

export function evaluateEditorialDelta(args: {
  action: RefinementAction;
  before: ManuscriptChapterAudit;
  after: ManuscriptChapterAudit;
  beforeContent: string;
  afterContent: string;
}): EditorialDelta {
  const beforeWords = wordCount(args.beforeContent);
  const afterWords = wordCount(args.afterContent);
  const wordDelta = afterWords - beforeWords;
  const wordDeltaPercent = beforeWords
    ? Number(((wordDelta / beforeWords) * 100).toFixed(2))
    : 0;

  const scoreDelta = {
    structure: delta(args.before.scores.structure, args.after.scores.structure),
    clarity: delta(args.before.scores.clarity, args.after.scores.clarity),
    redundancy: delta(args.before.scores.redundancy, args.after.scores.redundancy),
    continuity: delta(args.before.scores.continuity, args.after.scores.continuity),
    style: delta(args.before.scores.style, args.after.scores.style),
    factuality: delta(args.before.scores.factuality, args.after.scores.factuality),
    evidence: delta(args.before.scores.evidence, args.after.scores.evidence),
    publishability: delta(args.before.scores.publishability, args.after.scores.publishability),
  };

  const overallDelta = delta(args.before.overallScore, args.after.overallScore);
  const hardGateFailures: string[] = [];
  const improvements: string[] = [];
  const regressions: string[] = [];

  if (scoreDelta.factuality < -0.15) hardGateFailures.push("factuality_regressed");
  if (scoreDelta.evidence < -0.15) hardGateFailures.push("evidence_regressed");
  if (scoreDelta.continuity < -0.4) hardGateFailures.push("continuity_regressed");
  if ((args.after.unsupportedClaims || []).length > (args.before.unsupportedClaims || []).length) {
    hardGateFailures.push("unsupported_claims_increased");
  }
  if (overallDelta < -0.15) hardGateFailures.push("overall_score_regressed");

  for (const [name, value] of Object.entries(scoreDelta)) {
    if (value >= 0.2) improvements.push(`${name}:+${value}`);
    if (value <= -0.2) regressions.push(`${name}:${value}`);
  }

  let accepted = false;
  let reason = "El candidato no supera el gate editorial.";

  if (!hardGateFailures.length) {
    if (overallDelta >= 0.15) {
      accepted = true;
      reason = "Mejora global medible sin degradar factualidad/evidencia.";
    } else if (
      args.action === "REDUCE" &&
      wordDeltaPercent <= -5 &&
      overallDelta >= -0.05 &&
      scoreDelta.redundancy >= 0.2
    ) {
      accepted = true;
      reason = "Compresión útil: reduce palabras y mejora redundancia sin perder calidad.";
    } else if (
      args.action === "POLISH" &&
      overallDelta >= -0.02 &&
      scoreDelta.clarity + scoreDelta.style >= 0.3
    ) {
      accepted = true;
      reason = "Pulido aceptado por mejora combinada de claridad/estilo.";
    } else if (
      args.action === "RESTRUCTURE" &&
      overallDelta >= -0.02 &&
      scoreDelta.structure >= 0.25
    ) {
      accepted = true;
      reason = "Reestructura aceptada por mejora estructural sin regresión global.";
    }
  }

  return {
    accepted,
    reason,
    beforeScore: clampScore(args.before.overallScore),
    afterScore: clampScore(args.after.overallScore),
    overallDelta,
    beforeWords,
    afterWords,
    wordDelta,
    wordDeltaPercent,
    scoreDelta,
    hardGateFailures,
    improvements,
    regressions,
  };
}

export function runtimeVersion() {
  return RUNTIME_VERSION;
}

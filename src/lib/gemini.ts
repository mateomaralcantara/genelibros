// ==========================================
// FILE: src/lib/gemini.ts
// ==========================================
//
// ✅ OPTIMIZADO:
// - BUILD_FULL_DOSSIER => JSON (estructura corta)
// - PROPOSAL/INTRO/CHAPTER => TEXTO PLANO + AUTO-CONTINUE hasta llegar al target
// - Si dossier devuelve JSON inválido: se intenta reparación local y si falla, REPAIR con Gemini (barato).
// - Retry inteligente para 429/503 y fallback de modelos.

import type { ComposerTask } from "./types.local";
import type { Project } from "../../types";

import {
  safeJsonParse,
  validateEngineResult,
  ensureString,
  ensureArray,
  countWordsQuick,
  normalizeProjectState,
  buildMasterFromState,
  sanitizeEditorialChapterText,
  isBibliographyAllowedForProject,
  recomputeGenerationProgress,
} from "./editor";

export type ComposerCallOpts = {
  task: ComposerTask;
  state: any;
  model: string;
  isDev: boolean;
  devApiKey?: string;
  devSystemPrompt?: string;
  endpoint?: string;
  maxOutputTokensHint?: number;
};

export type EngineResult = ReturnType<typeof validateEngineResult>;
type LongAction = "GENERATE_PROPOSAL" | "GENERATE_INTRODUCTION" | "GENERATE_CHAPTER";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanPlainText(raw: unknown): string {
  return String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```txt/gi, "")
    .replace(/```markdown/gi, "")
    .replace(/```/g, "")
    .trim();
}

function stripChapterHeader(text: string): string {
  let out = cleanPlainText(text);
  out = out.replace(/^\s{0,3}#{1,3}\s*cap[ií]tulo\b[^\n]*\n+/i, "");
  out = out.replace(/^\s*cap[ií]tulo\s*\d+\s*[:\-–—]?\s*/i, "");
  return out.trimStart();
}

function extractJsonFromMessage(msg: string): any | null {
  const t = String(msg || "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    return null;
  }
}

function getErrorMessage(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  const anyE = e as any;
  if (typeof anyE?.message === "string") return anyE.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function getStatusFromError(e: unknown): number | null {
  const msg = getErrorMessage(e);
  const j = extractJsonFromMessage(msg);
  const code = j?.error?.code ?? j?.code ?? null;
  if (typeof code === "number") return code;
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(msg)) return 429;
  if (/UNAVAILABLE|Service Unavailable|503/i.test(msg)) return 503;
  return null;
}

function isDailyQuotaExhausted(e: unknown): boolean {
  const msg = getErrorMessage(e);
  return (
    /GenerateRequestsPerDayPerProjectPerModel-FreeTier/i.test(msg) ||
    /GenerateContentInputTokensPerModelPerDay-FreeTier/i.test(msg) ||
    /limit:\s*0/i.test(msg) ||
    /limit:\s*20/i.test(msg)
  );
}

function parseRetryDelayMs(e: unknown): number | null {
  const msg = getErrorMessage(e);
  const j = extractJsonFromMessage(msg);
  const retryDelay =
    j?.error?.details?.find?.((d: any) => d?.retryDelay)?.retryDelay ||
    j?.details?.find?.((d: any) => d?.retryDelay)?.retryDelay;

  if (typeof retryDelay === "string") {
    const m = retryDelay.match(/^(\d+(\.\d+)?)\s*s$/i);
    if (m) return Math.ceil(Number(m[1]) * 1000);
  }

  const m2 = msg.match(/retry in\s+(\d+(\.\d+)?)s/i);
  if (m2) return Math.ceil(Number(m2[1]) * 1000);
  return null;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: any = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;

      if (isDailyQuotaExhausted(e)) {
        throw new Error(
          "Cuota diaria de Gemini agotada para este modelo/proyecto. Activa billing/prepay o espera el reset diario."
        );
      }

      const code = getStatusFromError(e);
      const retriable = code === 429 || code === 503 || /ETIMEDOUT|ECONNRESET|fetch failed/i.test(getErrorMessage(e));
      if (!retriable || i === attempts - 1) throw e;

      const retryFromServer = parseRetryDelayMs(e);
      const wait = retryFromServer ?? Math.min(60000, 3500 * Math.pow(2, i) + Math.floor(Math.random() * 900));
      console.warn(`Gemini retry ${i + 1}/${attempts} in ${wait}ms`, getErrorMessage(e));
      await sleep(wait);
    }
  }

  throw last;
}

function getFallbackModels(primary: string): string[] {
  const raw = (import.meta as any)?.env?.VITE_GEMINI_FALLBACK_MODELS ?? "";
  const envList = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const defaults = ["gemini-3.1-flash", "gemini-3.1-flash-lite", "gemini-3-pro-preview"];
  return Array.from(new Set([primary, ...envList, ...defaults].map((s) => s.trim()).filter(Boolean)));
}

function getBookTitle(state: any): string {
  return ensureString(state?.book_title, ensureString(state?.bookTitle, "Libro sin título"));
}

function getBookTopic(state: any): string {
  return ensureString(state?.book_topic, ensureString(state?.bookTopic, ""));
}

function getChapterTitle(state: any, n: number): string {
  const outline = ensureArray<any>(state?.outline_12, []);
  const item = outline.find((x: any) => Number(x?.chapter_number ?? 0) === n);
  const fromOutline = ensureString(item?.chapter_title, ensureString(item?.title, ""));
  if (fromOutline.trim()) return fromOutline.trim();

  const chapters = ensureArray<any>(state?.chapters, []);
  const ch = chapters.find((x: any) => Number(x?.chapter_number ?? 0) === n);
  const fromChapter = ensureString(ch?.title, "");
  if (fromChapter.trim()) return fromChapter.trim();

  return `Capítulo ${n}`;
}

function getOutlineHints(state: any, n: number) {
  const outline = ensureArray<any>(state?.outline_12, []);
  const item = outline.find((x: any) => Number(x?.chapter_number ?? 0) === n);
  return {
    objective: ensureString(item?.objective, ""),
    keyPoints: ensureArray<any>(item?.key_points, []).map(String).filter(Boolean).slice(0, 18),
    subheads: ensureArray<any>(item?.subheads_h2, []).map(String).filter(Boolean).slice(0, 18),
  };
}


type EditorialDomain =
  | "HISTORY"
  | "BIOGRAPHY"
  | "FINANCE"
  | "POLITICS"
  | "GENERAL_NONFICTION"
  | "FICTION";

function detectEditorialDomain(state: any): EditorialDomain {
  const raw = [
    state?.book_title,
    state?.bookTitle,
    state?.book_topic,
    state?.bookTopic,
    state?.category,
    state?.genre,
    state?.tone_style,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/novela|ficci[oó]n|cuento|thriller|romance|terror|fantas[ií]a/.test(raw)) {
    return "FICTION";
  }

  if (/historia|hist[oó]rico|cronolog[ií]a|archivo|origen|evoluci[oó]n|siglo|guerra|dictadura/.test(raw)) {
    return "HISTORY";
  }

  if (/biograf[ií]a|trayectoria|personaje|comunicador|artista|pol[ií]tico|empresario|vida de/.test(raw)) {
    return "BIOGRAPHY";
  }

  if (/finanzas|econom[ií]a|inversi[oó]n|dinero|riqueza|mercado|empresa|deuda|rentabilidad|patrimonio/.test(raw)) {
    return "FINANCE";
  }

  if (/pol[ií]tica|gobierno|estado|elecciones|poder|partido|sociedad|institucional/.test(raw)) {
    return "POLITICS";
  }

  return "GENERAL_NONFICTION";
}

function getResearchContext(state: any): string {
  const candidates = [
    state?.research_context,
    state?.researchContext,
    state?.research_pack,
    state?.researchPack,
    state?.verified_facts,
    state?.verifiedFacts,
    state?.sources_summary,
    state?.sourcesSummary,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 30000);
    }

    if (value && typeof value === "object") {
      try {
        const serialized = JSON.stringify(value);
        if (serialized.length > 2) return serialized.slice(0, 30000);
      } catch {
        // Ignorar contexto no serializable.
      }
    }
  }

  return "";
}

function buildFactualRules(state: any): string {
  const domain = detectEditorialDomain(state);
  const researchContext = getResearchContext(state);

  const common = [
    "DISCIPLINA FACTUAL:",
    "- No inventes fechas, cifras, porcentajes, citas, cargos, premios, instituciones, leyes, estudios, fuentes ni acontecimientos.",
    "- Distingue hechos confirmados, inferencias, interpretaciones, controversias y datos no verificados.",
    "- Si no puedes respaldar un dato, omítelo o preséntalo explícitamente como hipótesis.",
    "- No fabriques citas textuales ni bibliografía.",
    "- No uses precisión falsa.",
    "- No rellenes extensión con repeticiones ni datos dudosos.",
    "- Profundiza mediante causas, contexto, comparación, consecuencias, contradicciones e impactos.",
  ];

  const domainRules: Record<EditorialDomain, string[]> = {
    HISTORY: [
      "REGLAS PARA HISTORIA:",
      "- Construye cronología, antecedentes, causas, actores, consecuencias y contexto de época.",
      "- Evita anacronismos y presentismo.",
      "- Señala versiones contradictorias cuando existan.",
      "- No conviertas una interpretación histórica en hecho incontrovertible.",
    ],
    BIOGRAPHY: [
      "REGLAS PARA PERSONAJES:",
      "- Separa trayectoria comprobada, imagen pública, controversias verificadas y rumores.",
      "- No inventes pensamientos, escenas privadas, conversaciones ni motivaciones internas.",
      "- No atribuyas relaciones, trabajos o polémicas sin respaldo.",
      "- Usa lenguaje de inferencia cuando analices motivaciones.",
    ],
    FINANCE: [
      "REGLAS PARA FINANZAS:",
      "- Toda cifra debe indicar año, moneda, país o período cuando esté disponible.",
      "- Distingue ingreso, beneficio, patrimonio, valoración, deuda, flujo de caja y proyección.",
      "- Expón supuestos, riesgos, límites y escenarios.",
      "- No presentes rendimientos futuros como garantías.",
    ],
    POLITICS: [
      "REGLAS PARA POLÍTICA Y SOCIEDAD:",
      "- Diferencia hechos institucionales, discursos, acusaciones y opiniones.",
      "- Explica actores, intereses, incentivos, correlaciones de fuerza y consecuencias.",
      "- No atribuyas delitos, intenciones o responsabilidades sin respaldo.",
    ],
    GENERAL_NONFICTION: [
      "REGLAS PARA NO FICCIÓN:",
      "- Prioriza precisión, explicación, ejemplos plausibles y análisis.",
      "- No conviertas ejemplos hipotéticos en sucesos reales.",
    ],
    FICTION: [
      "REGLAS PARA FICCIÓN:",
      "- La creatividad está permitida, pero no presentes elementos ficticios como hechos reales.",
      "- Si usas personajes reales, evita atribuirles delitos, pensamientos o actos no documentados.",
    ],
  };

  const research = researchContext
    ? [
        "",
        "EXPEDIENTE DE INVESTIGACIÓN DISPONIBLE:",
        researchContext,
        "",
        "Usa el expediente anterior como base factual prioritaria.",
        "No contradigas ese expediente sin explicar la discrepancia.",
      ]
    : [
        "",
        "NO HAY EXPEDIENTE DE INVESTIGACIÓN ADJUNTO.",
        "No afirmes que realizaste búsquedas web, scraping o consulta de fuentes externas.",
        "Reduce el nivel de certeza cuando falte respaldo.",
      ];

  return [...common, "", ...domainRules[domain], ...research].join("\n");
}

function buildPlainPrompt(action: LongAction, task: ComposerTask, state: any): { prompt: string; minWords: number } {
  const title = getBookTitle(state);
  const topic = getBookTopic(state);
  const audience = ensureString(state?.audience, "");
  const tone = ensureString(state?.tone_style, "editorial, claro, profundo y profesional");
  const targetWords = Math.max(800, Math.floor(Number((task as any)?.target_length_words ?? 0) || 0));
  const factualRules = buildFactualRules(state);

  if (action === "GENERATE_PROPOSAL") {
    const minWords = Math.max(2000, targetWords);
    return {
      minWords,
      prompt: `
Eres un editor senior de libros.

Escribe la PROPUESTA EDITORIAL completa del libro.
Devuelve SOLO TEXTO PLANO. NO JSON. NO fences. NO comentarios externos.

Libro:
- Título: ${title}
- Tema: ${topic}
- Audiencia: ${audience}
- Tono: ${tone}
- Objetivo mínimo: ${minWords} palabras

Reglas:
- Nada de placeholders.
- No termines a mitad de frase.
- ELITE_GENERATION_RULES_V1: usa subtítulos internos cuando existan en subheads_h2.
- Cada sección debe aportar análisis, contexto, datos prudentes, consecuencias y profundidad.
- No inventes datos para llenar palabras.
- Si falta evidencia, explica los límites de la evidencia.
- Evita títulos genéricos, repeticiones y relleno.
- No escribas "Propuesta editorial" como encabezado.

${factualRules}
`.trim(),
    };
  }

  if (action === "GENERATE_INTRODUCTION") {
    const minWords = Math.max(1400, targetWords);
    return {
      minWords,
      prompt: `
Eres un editor senior de libros.

Escribe la INTRODUCCIÓN completa del libro.
Devuelve SOLO TEXTO PLANO. NO JSON. NO fences. NO comentarios externos.

Libro:
- Título: ${title}
- Tema: ${topic}
- Audiencia: ${audience}
- Tono: ${tone}
- Objetivo mínimo: ${minWords} palabras

Reglas:
- Nada de placeholders.
- No termines a mitad de frase.
- ELITE_GENERATION_RULES_V1: usa subtítulos internos cuando existan en subheads_h2.
- Cada sección debe aportar análisis, contexto, datos prudentes, consecuencias y profundidad.
- No inventes datos para llenar palabras.
- Si falta evidencia, explica los límites de la evidencia.
- Evita títulos genéricos, repeticiones y relleno.
- No escribas "Introducción" como encabezado.

${factualRules}
`.trim(),
    };
  }

  const n = Number((task as any)?.chapter_number ?? 0) || 0;
  const chapterTitle = getChapterTitle(state, n);
  const hints = getOutlineHints(state, n);

  const minWords = Math.max(2000, targetWords);

  return {
    minWords,
    prompt: `
Eres un escritor editorial profesional.

Escribe el CAPÍTULO ${n} completo.
Devuelve SOLO TEXTO PLANO. NO JSON. NO fences. NO comentarios externos.

Libro:
- Título: ${title}
- Tema: ${topic}
- Audiencia: ${audience}
- Tono: ${tone}

Capítulo:
- Número: ${n}
- Título: ${chapterTitle}
- Objetivo mínimo: ${minWords} palabras
- Objetivo editorial: ${hints.objective || "(no especificado)"}
- Puntos clave: ${hints.keyPoints.length ? hints.keyPoints.join("; ") : "(no especificado)"}
- Subtítulos sugeridos: ${hints.subheads.length ? hints.subheads.join("; ") : "(no especificado)"}

Reglas duras:
- No incluyas encabezado "Capítulo ${n}".
- No repitas el título al inicio.
- Puedes usar subtítulos internos con ###.
- Nada de placeholders.
- No termines a mitad de frase.
- ELITE_GENERATION_RULES_V1: usa subtítulos internos cuando existan en subheads_h2.
- Cada sección debe aportar análisis, contexto, datos prudentes, consecuencias y profundidad.
- No inventes datos para llenar palabras.
- Si falta evidencia, explica los límites de la evidencia.
- Evita títulos genéricos, repeticiones y relleno.
- No incluyas bloques de bibliografía dentro del capítulo.
- Cuando menciones cifras o hechos específicos, contextualízalos.
- Separa claramente hechos, inferencias e interpretación.

${factualRules}
`.trim(),
  };
}

async function callGeminiPlain(args: {
  apiKey: string;
  model: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: args.apiKey });

  const models = getFallbackModels(args.model);
  let lastErr: any = null;

  for (const m of models) {
    try {
      const resp = await withRetry(() =>
        ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: args.prompt }] }],
          config: { maxOutputTokens: args.maxOutputTokens, temperature: args.temperature } as any,
        })
      );

      const text = cleanPlainText((resp as any)?.text || "");
      if (countWordsQuick(text) < 40) throw new Error(`Respuesta demasiado corta del modelo ${m}.`);
      return text;
    } catch (e) {
      lastErr = e;
      if (isDailyQuotaExhausted(e)) throw e;
      const code = getStatusFromError(e);
      if (code === 429 || code === 503) {
        console.warn(`Plain model ${m} failed (${code}). Trying fallback…`);
        continue;
      }
      throw e;
    }
  }

  throw lastErr ?? new Error("Error llamando Gemini en texto plano.");
}

function appendNonRepeating(base: string, addition: string): string {
  const a = (base ?? "").trim();
  const b = (addition ?? "").trim();
  if (!a) return b;
  if (!b) return a;

  // remove overlap by suffix/prefix match
  const tail = a.slice(-2000);
  for (let k = Math.min(1200, tail.length); k >= 160; k -= 40) {
    const suffix = tail.slice(-k);
    if (b.startsWith(suffix)) {
      return (a + "\n\n" + b.slice(k).trimStart()).trim() + "\n";
    }
  }
  return (a + "\n\n" + b).trim() + "\n";
}

async function ensureMinWordsByContinuing(args: {
  apiKey: string;
  model: string;
  basePrompt: string;
  currentText: string;
  minWords: number;
  maxSteps: number;
  temperature: number;
}): Promise<string> {
  let text = (args.currentText ?? "").trim();
  let wc = countWordsQuick(text);

  if (wc >= args.minWords) return text;

  for (let step = 1; step <= args.maxSteps && wc < args.minWords; step++) {
    const remaining = args.minWords - wc;

    const chunkWords =
      remaining >= 4000 ? 2600 :
      remaining >= 2500 ? 2000 :
      remaining >= 1600 ? 1600 :
      Math.max(900, remaining + 200);

    const contPrompt = [
      args.basePrompt,
      "",
      "CONTINÚA el texto SIN repetir lo ya escrito.",
      `Devuelve SOLO el texto NUEVO. Objetivo: añadir ~${chunkWords} palabras.`,
      "",
      "ÚLTIMO CONTEXTO (NO REPETIR):",
      text.slice(-4500),
    ].join("\n");

    const maxOutputTokens = Math.min(32000, Math.max(9000, Math.floor(chunkWords * 3.2)));

    const addition = await callGeminiPlain({
      apiKey: args.apiKey,
      model: args.model,
      prompt: contPrompt,
      maxOutputTokens,
      temperature: args.temperature,
    });

    text = appendNonRepeating(text, addition);
    wc = countWordsQuick(text);
  }

  return text.trim();
}

function buildEngineResultFromText(action: LongAction, task: ComposerTask, state: any, rawText: string): EngineResult {
  const nextState: any = normalizeProjectState(state);
  const text = cleanPlainText(rawText);
  const words = countWordsQuick(text);

  if (action === "GENERATE_PROPOSAL") {
    nextState.proposal = { ...(nextState.proposal ?? {}), id: "sec_proposal", text, status: "COMPLETED", words };
  }

  if (action === "GENERATE_INTRODUCTION") {
    nextState.introduction = { ...(nextState.introduction ?? {}), id: "sec_introduction", text, status: "COMPLETED", words };
  }

  if (action === "GENERATE_CHAPTER") {
    const n = Number((task as any)?.chapter_number ?? 0) || 0;
    const chapters = ensureArray<any>(nextState.chapters, []);
    const idx = chapters.findIndex((c: any) => Number(c?.chapter_number ?? 0) === n);

    const chapterText = stripChapterHeader(text);
    const chapter = {
      ...(idx >= 0 ? chapters[idx] : {}),
      id: `sec_chapter_${String(n).padStart(2, "0")}`,
      chapter_number: n,
      title: getChapterTitle(nextState, n),
      text: chapterText,
      status: "COMPLETED",
      words: countWordsQuick(chapterText),
    };

    if (idx >= 0) chapters[idx] = chapter;
    else chapters.push(chapter);

    nextState.chapters = chapters.sort((a, b) => (Number(a?.chapter_number ?? 0) || 0) - (Number(b?.chapter_number ?? 0) || 0));
  }

  const master = buildMasterFromState(nextState as any, getBookTitle(nextState));

  return validateEngineResult({
    ok: true,
    dashboard: (state as any)?.dashboard ?? {},
    project_state_updated: nextState,
    master_document: { title: getBookTitle(nextState), text: master },
  });
}

async function repairDossierJsonWithGemini(apiKey: string, model: string, badText: string): Promise<any> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = [
    "Corrige el siguiente contenido para que sea JSON válido.",
    "Devuelve SOLO JSON válido. Sin Markdown. Sin texto adicional.",
    "Mantén el schema del motor: { ok, dashboard, project_state_updated, master_document, needs_input? }",
    "",
    "INPUT:",
    badText.slice(0, 14000),
  ].join("\n");

  const resp = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        temperature: 0.0,
      } as any,
    })
  );

  return safeJsonParse((resp as any)?.text || "");
}

async function callLongSectionPlainDev(opts: ComposerCallOpts): Promise<EngineResult> {
  const apiKey = opts.devApiKey ?? "";
  if (!apiKey) throw new Error("Falta VITE_GEMINI_API_KEY en .env.local.");

  const action = String((opts.task as any)?.action || "") as LongAction;
  const { prompt, minWords } = buildPlainPrompt(action, opts.task, opts.state ?? {});

  const targetWords = Math.max(0, Math.floor(Number((opts.task as any)?.target_length_words ?? 0) || 0));
  const required = action === "GENERATE_CHAPTER" ? Math.max(2000, targetWords) : minWords;

  // 1) primera generación grande
  const maxOutputTokens =
    opts.maxOutputTokensHint ??
    (action === "GENERATE_CHAPTER"
      ? Math.min(32000, Math.max(14000, Math.floor((required || 3000) * 3.1)))
      : action === "GENERATE_PROPOSAL"
        ? 20000
        : 15000);

  const firstText = await callGeminiPlain({
    apiKey,
    model: opts.model,
    prompt,
    maxOutputTokens,
    temperature:
      detectEditorialDomain(opts.state) === "FICTION"
        ? action === "GENERATE_CHAPTER" ? 0.82 : 0.68
        : action === "GENERATE_CHAPTER" ? 0.48 : 0.38,
  });

  // 2) auto-continue hasta llegar al mínimo (y si target=6000, llega a 6000)
  const completedText = await ensureMinWordsByContinuing({
    apiKey,
    model: opts.model,
    basePrompt: prompt,
    currentText: firstText,
    minWords: required,
    maxSteps: action === "GENERATE_CHAPTER" ? 6 : 4,
    temperature:
      detectEditorialDomain(opts.state) === "FICTION"
        ? action === "GENERATE_CHAPTER" ? 0.82 : 0.68
        : action === "GENERATE_CHAPTER" ? 0.48 : 0.38,
  });

  return buildEngineResultFromText(action, opts.task, opts.state ?? {}, completedText);
}

async function callDossierJsonDev(opts: ComposerCallOpts): Promise<EngineResult> {
  const apiKey = opts.devApiKey ?? "";
  if (!apiKey) throw new Error("Falta VITE_GEMINI_API_KEY en .env.local.");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `TASK:\n${JSON.stringify(opts.task)}\n\nPROJECT_STATE:\n${JSON.stringify(opts.state)}`;
  const models = getFallbackModels(opts.model);
  let lastErr: any = null;

  for (const m of models) {
    try {
      const resp = await withRetry(() =>
        ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction: opts.devSystemPrompt ?? "",
            responseMimeType: "application/json",
            maxOutputTokens: opts.maxOutputTokensHint ?? 14000,
            temperature: 0.45,
          } as any,
        })
      );

      // 1) parse local
      try {
        return validateEngineResult(safeJsonParse((resp as any)?.text || ""));
      } catch (e) {
        // 2) repair con Gemini (barato) si el JSON salió mal
        const repaired = await repairDossierJsonWithGemini(apiKey, m, String((resp as any)?.text || ""));
        return validateEngineResult(repaired);
      }
    } catch (e) {
      lastErr = e;
      if (isDailyQuotaExhausted(e)) throw e;
      const code = getStatusFromError(e);
      if (code === 429 || code === 503) {
        console.warn(`Dossier model ${m} failed (${code}). Trying fallback…`);
        continue;
      }
      throw e;
    }
  }

  throw lastErr ?? new Error("Error llamando Gemini para dossier.");
}

export async function callComposer(opts: ComposerCallOpts): Promise<EngineResult> {
  const action = String((opts.task as any)?.action || "");

  if (opts.isDev) {
    if (action === "GENERATE_PROPOSAL" || action === "GENERATE_INTRODUCTION" || action === "GENERATE_CHAPTER") {
      return callLongSectionPlainDev(opts);
    }
    return callDossierJsonDev(opts);
  }

  // PROD: conserva endpoint
  const endpoint = opts.endpoint ?? "/api/composer";
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: opts.task, state: opts.state, model: opts.model }),
  });

  const raw = await r.text();
  const data = safeJsonParse(raw) as any;
  if (!r.ok) throw new Error(ensureString(data?.error, ensureString(data?.message, `HTTP ${r.status}`)));
  return validateEngineResult(data);
}

// Compatibilidad con App.tsx existente (si lo importa).
export async function autoExtendChapterDev(params: {
  project: Project;
  chapterNum: number;
  targetWords: number;
  model: string;
  apiKey?: string;
  devApiKey?: string;
  minWords?: number;
  maxSteps?: number;
}): Promise<Project> {
  // Ya se auto-extiende dentro del flujo principal (callLongSectionPlainDev).
  return params.project;
}

// Títulos de libro y de capítulos, y construcción del índice (outline) a partir
// del encargo del autor. Funciones puras: sin red ni estado de React.

import type { Project } from "../../types";
import { ensureArray, ensureString } from "./editor";

/* -------------------------- variable chapter count (N) -------------------------- */

export function clampInt(n: number, min: number, max: number): number {
  const x = Math.floor(Number(n || 0));
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

/**
 * Permite el flujo “tírame un libro de 22 capítulos”:
 * - Detecta "22 capítulos", "22 cap", "22 chapters", etc.
 * - Si no hay número, retorna null y el sistema usa el default (12).
 */
export function extractDesiredChapterCount(idea: string): number | null {
  const s = String(idea ?? "");
  const m =
    s.match(/(\d{1,3})\s*(cap[ií]tulos?|cap\b|chapters?\b)/i) ||
    s.match(/cap[ií]tulos?\s*(\d{1,3})/i) ||
    s.match(/chapters?\s*(\d{1,3})/i);
  if (!m) return null;
  const digits = (m[1] ?? (m[0].match(/\d{1,3}/)?.[0] ?? "")).toString();
  const n = Number(digits || 0) || 0;
  if (!n) return null;
  return clampInt(n, 1, 120);
}

export function stripChapterPrefix(title: string, n: number): string {
  const t = String(title ?? "").trim();
  if (!t) return "";
  const re = new RegExp(String.raw`^\s*cap[ií]tulo\s*${n}\s*[:\-–—]\s*`, "i");
  return t.replace(re, "").trim();
}

/**
 * Outline variable (guardado en projects.outline_12 como JSONB, pero puede tener N items).
 * El UI arma "Capítulo N: {chapter_title}", por eso chapter_title debe ir SIN "Capítulo N:".
 */
export const FALLBACK_CHAPTER_TITLES = [
  "Panorama general",
  "Historia y evolución",
  "Conceptos clave",
  "Actores y dinámicas",
  "Mecanismos y procesos",
  "Casos y ejemplos",
  "Impactos y consecuencias",
  "Estrategias y herramientas",
  "Errores comunes y mitos",
  "Ética y riesgos",
  "Futuro y escenarios",
  "Plan de acción y cierre",
];

export function squashSpaces(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function firstUsefulLine(value: string): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)[0] ?? "";
}

export function stripOuterQuotes(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .trim();
}

export function extractLabeledValue(text: string, labels: string[]): string {
  const raw = String(text ?? "");
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:\\s*([^\\r\\n]+)`, "i");
    const m = raw.match(re);
    if (m?.[1]) return squashSpaces(stripOuterQuotes(m[1]));
  }
  return "";
}

export function hasPromptLeak(value: string): boolean {
  return /act[uú]a como|eres un escritor|como escritor|objetivo general|t[ií]tulo del libro|subt[ií]tulo|los\s+\d+\s+perfiles|enfoque editorial|tono del libro|regla legal|estructura general|conclusi[oó]n general|anexos obligatorios|formato final|estilo de escritura|regla de profundidad|regla de equilibrio|regla de datos|requisitos|project_state|task:|system:|prompt/i.test(
    String(value ?? "")
  );
}

export function truncateEditorialTitle(value: string, fallback: string): string {
  let out = squashSpaces(stripOuterQuotes(value))
    .replace(/[.:;,\-–—]+$/g, "")
    .trim();

  if (!out || hasPromptLeak(out)) return fallback;

  if (out.length > 110) {
    out = out.slice(0, 110).replace(/\s+\S*$/, "").trim();
  }

  return out || fallback;
}

export function extractBookTitleFromIdea(idea: string): string {
  const raw = String(idea ?? "").trim();

  const markdownTitle = raw.match(/(?:^|\n)\s*#{0,6}\s*\*{0,2}T[IÍ]TULO(?: DEL LIBRO| DE TRABAJO)?\*{0,2}\s*:?\s*\n+\s*(?:#{1,6}\s*)?([^\n]+)/i)?.[1];
  if (markdownTitle) {
    const title = markdownTitle.replace(/^\*+|\*+$/g, "").trim();
    if (title && !hasPromptLeak(title)) return truncateEditorialTitle(title, "Nuevo libro");
  }
  const labeled = extractLabeledValue(raw, [
    "T[IÍ]TULO DE TRABAJO",
    "T[IÍ]TULO DEL LIBRO",
    "T[IÍ]TULO",
    "NOMBRE DEL LIBRO",
    "BOOK TITLE",
    "TITLE",
  ]);

  if (labeled && !hasPromptLeak(labeled)) {
    return truncateEditorialTitle(labeled, "Nuevo libro");
  }

  const topic = extractLabeledValue(raw, [
    "TEMA PRINCIPAL",
    "TEMA DEL LIBRO",
    "TEMA",
    "ASUNTO",
  ]);

  if (topic && !hasPromptLeak(topic)) {
    return truncateEditorialTitle(topic, "Nuevo libro");
  }

  const cleaned = raw
    .replace(/\bact[uú]a como\b[^\n.]*(?:[.\n]|$)/gi, " ")
    .replace(/\beres un(?:a)? escritor(?:a)?\b[^\n.]*(?:[.\n]|$)/gi, " ")
    .replace(/\bcomo escritor(?:a)?\b[^\n.]*(?:[.\n]|$)/gi, " ")
    .replace(/\bobjetivo general\s*[:\-–—]?/gi, " ")
    .replace(/\benfoque editorial\s*[:\-–—]?/gi, " ")
    .replace(/\btono del libro\s*[:\-–—]?/gi, " ")
    .replace(/\brequisitos\s*[:\-–—]?/gi, " ")
    .replace(/\bformato final\s*[:\-–—]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleaned
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    if (
      sentence.length >= 5 &&
      !hasPromptLeak(sentence)
    ) {
      return truncateEditorialTitle(sentence, "Nuevo libro");
    }
  }

  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(" ");

  if (words && !hasPromptLeak(words)) {
    return truncateEditorialTitle(words, "Nuevo libro");
  }

  return "Nuevo libro";
}

export function cleanSeedForOutlineContext(seed: string): string {
  const titled = extractBookTitleFromIdea(seed);

  const normalizedTitle = String(titled ?? "")
    .trim()
    .toLowerCase();

  const isPlaceholderTitle =
    !normalizedTitle ||
    normalizedTitle === "libro sin título" ||
    normalizedTitle === "libro sin titulo" ||
    normalizedTitle === "nuevo libro" ||
    normalizedTitle === "nuevo libro sin título" ||
    normalizedTitle === "nuevo libro sin titulo";

  if (!isPlaceholderTitle) return titled;

  let s = String(seed ?? "").trim();

  const topic = extractLabeledValue(s, [
    "TEMA",
    "OBJETIVO GENERAL",
    "ENFOQUE EDITORIAL",
  ]);

  if (topic && !hasPromptLeak(topic)) {
    return truncateEditorialTitle(topic, "");
  }

  s = s
    .replace(/\bact[uú]a como\b[\s\S]*$/i, "")
    .replace(/\beres un escritor\b[\s\S]*$/i, "")
    .replace(/\bobjetivo general\b[\s\S]*$/i, "")
    .replace(/\blos\s+\d+\s+perfiles\b[\s\S]*$/i, "")
    .replace(/\bformato final\b[\s\S]*$/i, "")
    .replace(/\banexos obligatorios\b[\s\S]*$/i, "")
    .replace(/\brequisitos\b[\s\S]*$/i, "");

  return truncateEditorialTitle(s, "");
}

export function pickFallbackChapterTitle(
  index: number,
  context = ""
): string {
  const topic = String(context ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const base =
    index < FALLBACK_CHAPTER_TITLES.length
      ? FALLBACK_CHAPTER_TITLES[index]
      : `Desarrollo editorial ${index + 1}`;

  if (!topic) return base;

  const shortTopic =
    topic.length > 65
      ? topic.slice(0, 65).replace(/\s+\S*$/, "").trim()
      : topic;

  const domainText = shortTopic.toLowerCase();

  const historicalTitles = [
    `Orígenes y contexto de ${shortTopic}`,
    `Evolución histórica de ${shortTopic}`,
    `Actores y acontecimientos determinantes`,
    `Transformaciones políticas y sociales`,
    `Momentos decisivos y puntos de ruptura`,
    `Conflictos, debates y versiones contrapuestas`,
    `Consecuencias históricas y sociales`,
    `Instituciones, poder y relaciones de fuerza`,
    `Interpretaciones, mitos y controversias`,
    `El legado de ${shortTopic}`,
    `Continuidades y cambios en el presente`,
    `Conclusiones y perspectiva histórica`,
  ];

  const biographyTitles = [
    `Orígenes y entorno familiar`,
    `Formación y primeras influencias`,
    `Los primeros pasos de su trayectoria`,
    `La construcción de una identidad pública`,
    `Ascenso, oportunidades y desafíos`,
    `Colaboradores, aliados y círculos de influencia`,
    `Conflictos, polémicas y momentos críticos`,
    `Aportes profesionales y sociales`,
    `Imagen pública, discurso y percepción social`,
    `Contradicciones y límites de su trayectoria`,
    `Legado, influencia y proyección`,
    `Balance biográfico y perspectivas futuras`,
  ];

  const financeTitles = [
    `Fundamentos económicos de ${shortTopic}`,
    `Origen y evolución del modelo financiero`,
    `Ingresos, costos y flujo de efectivo`,
    `Capital, deuda y estructura financiera`,
    `Rentabilidad, riesgo y rendimiento`,
    `Mercado, competencia y posicionamiento`,
    `Datos históricos y ciclos económicos`,
    `Estrategias de crecimiento y expansión`,
    `Errores financieros y decisiones críticas`,
    `Escenarios, proyecciones y sensibilidad`,
    `Riesgos futuros y oportunidades`,
    `Conclusiones y plan financiero`,
  ];

  const generalTitles = [
    `El contexto general de ${shortTopic}`,
    `Origen y evolución de ${shortTopic}`,
    `Conceptos fundamentales para comprender el tema`,
    `Actores, instituciones y dinámicas principales`,
    `Procesos y mecanismos determinantes`,
    `Casos, experiencias y ejemplos relevantes`,
    `Impactos sociales, económicos y culturales`,
    `Problemas, contradicciones y desafíos`,
    `Mitos, errores y debates frecuentes`,
    `Riesgos, ética y responsabilidades`,
    `Tendencias y escenarios futuros`,
    `Conclusiones y propuestas de acción`,
  ];

  let collection = generalTitles;

  if (
    /historia|histórico|histórica|origen|evolución|guerra|dictadura|siglo/.test(
      domainText
    )
  ) {
    collection = historicalTitles;
  } else if (
    /biografía|biografico|biográfico|trayectoria|vida de|personaje|comunicador|artista|empresario|político/.test(
      domainText
    )
  ) {
    collection = biographyTitles;
  } else if (
    /finanza|economía|dinero|riqueza|inversión|empresa|mercado|rentabilidad|deuda/.test(
      domainText
    )
  ) {
    collection = financeTitles;
  }

  return collection[index] || base;
}

export function isGenericFallbackTitle(title: string, chapterNumber: number): boolean {
  const t = squashSpaces(title).toLowerCase();
  const fallback = pickFallbackChapterTitle(
    chapterNumber - 1,
    ""
  ).toLowerCase();
  return (
    t === fallback ||
    t === `parte ${chapterNumber}: desarrollo` ||
    t === `capítulo ${chapterNumber}` ||
    t === `capitulo ${chapterNumber}` ||
    /^parte\s+\d+\s*:\s*desarrollo$/i.test(t)
  );
}

export function cleanChapterTitle(value: string, chapterNumber: number, fallback: string): string {
  let title = String(value ?? "").trim();

  title = title
    .replace(new RegExp(String.raw`^\s*cap[ií]tulo\s*${chapterNumber}\s*[:\-–—.]?\s*`, "i"), "")
    .replace(/^\s*cap[ií]tulo\s*[:\-–—.]?\s*/i, "")
    .trim();

  title = title
    .replace(/\s+[—–-]\s+(act[uú]a como|eres un escritor|objetivo general|t[ií]tulo del libro|subt[ií]tulo|formato final|requisitos)\b[\s\S]*$/i, "")
    .replace(/\b(act[uú]a como|eres un escritor|objetivo general|t[ií]tulo del libro|subt[ií]tulo|formato final|anexos obligatorios|requisitos|prompt)\b[\s\S]*$/i, "")
    .trim();

  return truncateEditorialTitle(title, fallback);
}

export function extractTitleFromChapterChunk(chunk: string, chapterNumber: number): string {
  let raw = String(chunk ?? "").trim();
  if (!raw) return "";

  const quoted = raw.match(/^[“"'«]([^”"'»]{3,180})[”"'»]/);
  if (quoted?.[1]) raw = quoted[1];
  else {
    raw = raw
      .replace(/\s+(Analizar|Trabajar|Explicar|Desarrollar|Estudiar|Crear|Incluir|Capítulo\s+crítico)\b[\s\S]*$/i, "")
      .replace(/\s+(Debe|Este\s+capítulo|Capítulo\s+crítico)\b[\s\S]*$/i, "")
      .trim();
  }

  return cleanChapterTitle(raw, chapterNumber, "");
}

export function extractChapterTitlesFromIdea(seed: string): Map<number, string> {
  const out = new Map<number, string>();
  const raw = String(seed ?? "");

  // 1) Funciona si el usuario pegó cada capítulo en líneas separadas.
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^\s*cap[ií]tulo\s+(\d{1,3})\s*[:\-–—.]\s*(.+?)\s*$/i);
    if (!m) continue;
    const n = Number(m[1] || 0) || 0;
    if (!n) continue;
    const title = extractTitleFromChapterChunk(m[2] || "", n);
    if (title && !hasPromptLeak(title)) out.set(n, title);
  }

  // 2) Funciona si todo vino en un solo bloque largo.
  const re = /cap[ií]tulo\s+(\d{1,3})\s*[:\-–—.]\s*([\s\S]*?)(?=\s+cap[ií]tulo\s+\d{1,3}\s*[:\-–—.]|\s+conclusi[oó]n general\s*:|\s+anexos obligatorios\s*:|\s+estilo de escritura\s*:|\s+regla de profundidad\s*:|\s+formato final\s*:|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const n = Number(m[1] || 0) || 0;
    if (!n || out.has(n)) continue;
    const title = extractTitleFromChapterChunk(m[2] || "", n);
    if (title && !hasPromptLeak(title)) out.set(n, title);
  }

  return out;
}

export function inferChapterCountFromIdea(seed: string): number | null {
  const titles = extractChapterTitlesFromIdea(seed);
  if (titles.size > 0) return Math.max(...Array.from(titles.keys()));
  return null;
}

export function extractDesiredChapterCountSafe(idea: string): number | null {
  const explicit = extractDesiredChapterCount(idea) ?? 0;
  const fromHeadings = inferChapterCountFromIdea(idea) ?? 0;

  // El patrón "capítulos N" también encaja con encabezados como "CAPÍTULO 1: ...",
  // así que un índice pegado por el autor daba 1. Si el encargo lista capítulos
  // numerados, nunca se crean menos que el último capítulo listado.
  const count = Math.max(explicit, fromHeadings);
  return count ? clampInt(count, 1, 120) : null;
}

export function isOutsiderDemoBrief(idea: string): boolean {
  const raw = String(idea ?? "");
  return /\bEL\s+OUTSIDER\b/i.test(raw) && /\b2028\b/.test(raw) && /#\s*PROMPT\s+MAESTRO|MISI[ÓO]N\s+GENERAL/i.test(raw);
}

/**
 * Outline variable limpio.
 * Lee títulos explícitos tipo CAPÍTULO N: "Título", pero NUNCA mete el prompt completo.
 */
export function buildFallbackOutline(count: number, seed: string, targetWords: number) {
  const n = clampInt(count, 1, 120);
  const safeContext = cleanSeedForOutlineContext(seed);
  const explicitTitles = extractChapterTitlesFromIdea(seed);

  return Array.from({ length: n }, (_, i) => {
    const chapterNumber = i + 1;
    const fallbackTitle = pickFallbackChapterTitle(
      i,
      safeContext
    );
    const explicitTitle = explicitTitles.get(chapterNumber);
    const title = cleanChapterTitle(explicitTitle || fallbackTitle, chapterNumber, fallbackTitle);

    return {
      id: `outline_${String(chapterNumber).padStart(2, "0")}`,
      chapter_number: chapterNumber,
      chapter_title: title,
      status: "PENDING" as const,
      target_words: Math.max(0, Math.floor(Number(targetWords || 0))),
      objective: safeContext ? `Desarrollar ${title.toLowerCase()} dentro del marco editorial de ${safeContext}.` : "",
      key_points: [],
      subheads_h2: [],
      tools_frameworks: [],
      exercises: [],
      deliverable: "",
      transition_to_next: "",
    };
  });
}

export function normalizeOutlineTitles(outline: any[], fallbackSeed: string, defaultChapterWords: number): any[] {
  const safeFallback = cleanSeedForOutlineContext(fallbackSeed);
  const explicitTitles = extractChapterTitlesFromIdea(fallbackSeed);

  return ensureArray<any>(outline, [])
    .map((o: any, idx: number) => {
      const n = Number(o?.chapter_number ?? idx + 1) || idx + 1;
      const fallback = pickFallbackChapterTitle(
        n - 1,
        safeFallback
      );
      const rawTitle = ensureString(o?.chapter_title, ensureString(o?.title, fallback));
      const promptTitle = explicitTitles.get(n);
      const shouldPreferPromptTitle =
        Boolean(promptTitle) &&
        (hasPromptLeak(rawTitle) || isGenericFallbackTitle(rawTitle, n) || rawTitle.length > 120);

      const cleanTitle = cleanChapterTitle(
        shouldPreferPromptTitle ? promptTitle || fallback : rawTitle,
        n,
        fallback
      );

      return {
        ...(o || {}),
        id: ensureString(o?.id, `outline_${String(n).padStart(2, "0")}`),
        chapter_number: n,
        chapter_title: cleanTitle,
        target_words: Math.max(0, Number(o?.target_words ?? defaultChapterWords ?? 0) || 0),
        objective: hasPromptLeak(ensureString(o?.objective, ""))
          ? safeFallback
            ? `Desarrollar ${cleanTitle.toLowerCase()} dentro del marco editorial de ${safeFallback}.`
            : ""
          : ensureString(o?.objective, ""),
      };
    })
    .sort((a, b) => (Number(a?.chapter_number ?? 0) || 0) - (Number(b?.chapter_number ?? 0) || 0));
}

/**
 * Garantiza que el proyecto tenga outline_12 y con longitud >= desiredCount.
 * - Si viene vacío pero ya hay chapters en state => reconstruimos desde chapters.
 * - Si viene corto => completamos con fallback.
 */
export function ensureOutlineForProject(proj: Project, desiredCount: number, seed: string, defaultChapterWords: number): Project {
  const st: any = (proj as any).state ?? {};
  const rawOutline: any[] = Array.isArray(st?.outline_12) ? st.outline_12 : [];
  const outline = normalizeOutlineTitles(rawOutline, seed, defaultChapterWords);
  const desired = clampInt(desiredCount, 1, 120);

  // 1) Si no hay outline pero ya hay capítulos, reconstruimos títulos desde capítulos.
  if (!outline.length) {
    const chs: any[] = Array.isArray(st?.chapters) ? st.chapters : [];
    const byNum = new Map<number, any>();
    for (const c of chs) {
      const n = Number(c?.chapter_number ?? 0) || 0;
      if (!n) continue;
      const rawTitle = String(c?.title ?? `Capítulo ${n}`).trim();
      byNum.set(n, {
        id: `outline_${String(n).padStart(2, "0")}`,
        chapter_number: n,
        chapter_title: stripChapterPrefix(rawTitle, n) || rawTitle || `Capítulo ${n}`,
        status: "PENDING",
        target_words: Math.max(0, Number(defaultChapterWords || 0)),
      });
    }
    const rebuilt = Array.from(byNum.values()).sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0));
    if (rebuilt.length) {
      const nextState = { ...st, outline_12: rebuilt };
      return { ...proj, state: nextState } as Project;
    }
  }

  // 2) Si outline existe pero es más corto que desired => completamos
  if (outline.length < desired) {
    const existingNums = new Set<number>(outline.map((o) => Number(o?.chapter_number ?? 0) || 0).filter(Boolean));
    const fillers = buildFallbackOutline(desired, seed, defaultChapterWords).filter((o: any) => !existingNums.has(o.chapter_number));
    const merged = [...outline, ...fillers].sort((a, b) => (Number(a?.chapter_number ?? 0) || 0) - (Number(b?.chapter_number ?? 0) || 0));
    const nextState = { ...st, outline_12: merged };
    return { ...proj, state: nextState } as Project;
  }

  if (outline.length) {
    return { ...proj, state: { ...st, outline_12: outline } } as Project;
  }

  return proj;
}

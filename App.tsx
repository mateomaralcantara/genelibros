// App.tsx
// ✅ Refactor "así": App pequeño, helpers en src/lib/editor.ts y src/lib/gemini.ts, UI auth en src/components/AuthGate.tsx
// Mantiene TODO: Supabase-first + aprobación manual + generación 1 a la vez + targets globales + turbo capítulos DEV.

import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, ChatMessage, ProjectState } from "./types";

import TableOfContents from "./components/TableOfContents";
import ChatInterface from "./components/ChatInterface";
import BookViewer from "./components/BookViewer";
import GenerationDashboard from "./components/GenerationDashboard";
import AutonomousPublishingOS from "./components/AutonomousPublishingOS";
import { PenSquareIcon, RocketIcon, BookOpenIcon } from "./components/Icons";

import { supabase } from "./src/lib/supabase";
import {
  getSession,
  listProjects,
  createProject,
  getProjectFull,
  upsertSection,
  insertSectionVersion,
  buildMasterServer,
  insertMasterSnapshot,
  updateProject,
  deleteProject,
  getUserSettings,
  upsertUserSettings,
} from "./src/data/repo";

import {
  AnyRecord,
  GenerationStatus,
  GenerationProgress,
  ensureArray,
  ensureString,
  normalizeError,
  normalizeProjectState,
  compactStateForComposer,
  mapDbFullToProject,
  buildMasterFromState,
  recomputeGenerationProgress,
  processEngineResult,
} from "./src/lib/editor";

import { callComposer, autoExtendChapterDev } from "./src/lib/gemini";
import type { ComposerTask } from "./src/lib/types.local";
import { AuthScreen, AuthMode } from "./components/AuthGate";

const BUILD_TAG = "App.tsx v3.2.2 (prompt-leak-safe + explicit-outline-titles) 2026-06-06";

// Gemini
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const DEV_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? "";
const MAX_MASTER_CHARS_TO_SEND = 70_000; // balance: contexto amplio sin reventar tokens

const DEV_SYSTEM_PROMPT = [
  "Eres BOOK_DOSSIER_CANVAS_ENGINE (BestSeller), un motor editorial especializado en libros de no ficción rigurosos.",
  "",
  "IDIOMA: Español neutro.",
  "OBJETIVO: Crear y editar libros profundos, coherentes, analíticos y factualizados.",
  "",
  "PRINCIPIO DE VERACIDAD:",
  "- Nunca presentes como hecho una información no respaldada por el contexto disponible.",
  "- No inventes fechas, cifras, porcentajes, cargos, relaciones, premios, leyes, instituciones, estudios, citas, declaraciones, documentos, fuentes ni acontecimientos.",
  "- Si un dato no está respaldado, omítelo, exprésalo como hipótesis o indícalo como pendiente de verificación.",
  "- No uses una cifra exacta cuando solo dispones de una estimación.",
  "- No conviertas rumores, publicaciones virales o versiones interesadas en hechos confirmados.",
  "",
  "CLASIFICACIÓN INTERNA DE INFORMACIÓN:",
  "- HECHO CONFIRMADO: respaldado por fuentes o contexto proporcionado.",
  "- INFERENCIA: conclusión razonable derivada de hechos conocidos.",
  "- INTERPRETACIÓN: lectura analítica del autor.",
  "- CONTROVERSIA: existen versiones contradictorias.",
  "- NO VERIFICADO: no debe presentarse como hecho.",
  "",
  "JERARQUÍA DE FUENTES:",
  "- Prioriza documentos oficiales, registros públicos, leyes, sentencias, estadísticas institucionales, archivos históricos, publicaciones académicas, entrevistas directas y medios reconocidos.",
  "- Usa redes sociales, videos y blogs solo como evidencia de discurso público o percepción, no como comprobación automática.",
  "",
  "LIBROS HISTÓRICOS:",
  "- Incluye cronología, antecedentes, contexto político, económico, social y cultural.",
  "- Explica causas, actores, consecuencias, cambios y controversias historiográficas.",
  "- Evita anacronismos y presentismo.",
  "- Distingue los hechos documentados de las interpretaciones posteriores.",
  "",
  "LIBROS SOBRE PERSONAJES:",
  "- Distingue trayectoria comprobada, imagen pública, controversias verificadas y rumores.",
  "- No inventes pensamientos, conversaciones, emociones, motivaciones privadas ni escenas no documentadas.",
  "- No fabriques citas textuales.",
  "- Usa fórmulas como 'los hechos sugieren', 'puede interpretarse' o 'según sus declaraciones públicas' cuando hagas inferencias.",
  "",
  "FINANZAS Y ECONOMÍA:",
  "- Toda cifra debe indicar, cuando sea posible: año, moneda, país, período y naturaleza de la cifra.",
  "- Distingue ingreso, beneficio, patrimonio, valoración, deuda, flujo de caja, rentabilidad y proyección.",
  "- No presentes proyecciones como garantías.",
  "- Expón supuestos, riesgos, escenarios y límites metodológicos.",
  "",
  "ANÁLISIS:",
  "- No te limites a enumerar hechos.",
  "- Analiza causas, incentivos, intereses, relaciones de poder, contradicciones, consecuencias, impactos y escenarios.",
  "- Cada capítulo debe explicar qué ocurrió, por qué, quiénes participaron, qué evidencia existe y qué permanece discutido.",
  "",
  "CONTROL DE ALUCINACIONES:",
  "- No rellenes vacíos con información inventada para alcanzar una cantidad de palabras.",
  "- Para aumentar profundidad usa contexto, comparación, antecedentes, explicación conceptual, consecuencias y escenarios.",
  "- Elimina afirmaciones dudosas o no respaldadas.",
  "- No inventes bibliografía ni enlaces.",
  "",
  "SALIDA PARA BUILD_FULL_DOSSIER:",
  "- Responde únicamente con un objeto JSON válido.",
  "- Prohibido Markdown fuera del JSON, bloques de código, comentarios o texto adicional.",
  "",
  "FORMA MÍNIMA:",
  '{ "ok": true, "dashboard": {}, "project_state_updated": {}, "master_document": { "title": "", "text": "" } }',
  "",
  "REGLAS EDITORIALES:",
  "- No insertes instrucciones internas: 'Actúa como', 'Eres un escritor', 'Objetivo del capítulo', 'Requisitos', 'Prompt' ni similares.",
  "- Los encabezados deben ser naturales: 'Capítulo 1. Título del capítulo'.",
  "- La aplicación imprime los títulos; no los repitas al inicio del contenido.",
  "- No uses HTML, colores, estilos inline ni marcas visuales.",
  "- No uses placeholders como TBD o puntos suspensivos para fingir contenido.",
  "",
  "BIBLIOGRAFÍA:",
  "- No coloques bibliografía completa dentro de cada capítulo.",
  "- La bibliografía solo se incluye cuando el usuario la pide o el libro es histórico, académico, investigativo, biográfico o documental.",
  "- Cuando corresponda, debe reunirse en una sola sección final.",
  "- No fabriques autores, títulos, editoriales, fechas, DOI, ISBN ni enlaces.",
  "",
  "PATCH SEGURO:",
  "- GENERATE_CHAPTER actualiza solamente el capítulo solicitado.",
  "- GENERATE_PROPOSAL actualiza solamente proposal.",
  "- GENERATE_INTRODUCTION actualiza solamente introduction.",
  "- No borres contenido de otras secciones.",
  "",
  "CAPÍTULOS:",
  "- Respeta el número total de capítulos solicitado.",
  "- Conserva títulos explícitos proporcionados por el usuario.",
  "- Los títulos deben ser breves, claros y editoriales.",
  "",
  "ELITE_BLUEPRINT_SYSTEM_V1:",
  "- Antes de redactar, exige título, subtítulo, tesis central, promesa editorial, audiencia, género y estrategia factual.",
  "- Cada capítulo debe tener chapter_title, chapter_thesis, objective, key_points, subheads_h2, required_facts, source_needs y transition_to_next.",
  "- Los subtítulos internos subheads_h2 son obligatorios: mínimo 5 y máximo 10 por capítulo.",
  "- Prohibido usar títulos genéricos como Panorama general, Conceptos clave o Desarrollo editorial salvo emergencia absoluta.",
  "- En historia, biografía, finanzas y política, prioriza precisión, contexto y límites de evidencia sobre espectacularidad.",
  "",
  "CALIDAD:",
  "- Contenido denso, concreto, ordenado y narrativamente legible.",
  "- Termina con frases completas.",
  "- Prioriza precisión sobre espectacularidad.",
].join("\n");

const initialWelcomeMessage: ChatMessage = {
  id: "welcome-0",
  role: "model",
  content:
    "¡Bienvenido! Soy **BestSeller**. Para empezar, cuéntame de qué quieres que trate tu libro o dime un título.",
};

type AccessProfile = {
  email: string;
  has_access: boolean;
  full_name?: string | null;
  phone?: string | null;
};

type AccessRequest = {
  id: string;
  status: string;
  created_at?: string;
};

/* -------------------------- variable chapter count (N) -------------------------- */

function clampInt(n: number, min: number, max: number): number {
  const x = Math.floor(Number(n || 0));
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

/**
 * Permite el flujo “tírame un libro de 22 capítulos”:
 * - Detecta "22 capítulos", "22 cap", "22 chapters", etc.
 * - Si no hay número, retorna null y el sistema usa el default (12).
 */
function extractDesiredChapterCount(idea: string): number | null {
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

function stripChapterPrefix(title: string, n: number): string {
  const t = String(title ?? "").trim();
  if (!t) return "";
  const re = new RegExp(String.raw`^\s*cap[ií]tulo\s*${n}\s*[:\-–—]\s*`, "i");
  return t.replace(re, "").trim();
}

/**
 * Outline variable (guardado en projects.outline_12 como JSONB, pero puede tener N items).
 * El UI arma "Capítulo N: {chapter_title}", por eso chapter_title debe ir SIN "Capítulo N:".
 */
const FALLBACK_CHAPTER_TITLES = [
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

function squashSpaces(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstUsefulLine(value: string): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)[0] ?? "";
}

function stripOuterQuotes(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .trim();
}

function extractLabeledValue(text: string, labels: string[]): string {
  const raw = String(text ?? "");
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:\\s*([^\\r\\n]+)`, "i");
    const m = raw.match(re);
    if (m?.[1]) return squashSpaces(stripOuterQuotes(m[1]));
  }
  return "";
}

function hasPromptLeak(value: string): boolean {
  return /act[uú]a como|eres un escritor|como escritor|objetivo general|t[ií]tulo del libro|subt[ií]tulo|los\s+\d+\s+perfiles|enfoque editorial|tono del libro|regla legal|estructura general|conclusi[oó]n general|anexos obligatorios|formato final|estilo de escritura|regla de profundidad|regla de equilibrio|regla de datos|requisitos|project_state|task:|system:|prompt/i.test(
    String(value ?? "")
  );
}

function truncateEditorialTitle(value: string, fallback: string): string {
  let out = squashSpaces(stripOuterQuotes(value))
    .replace(/[.:;,\-–—]+$/g, "")
    .trim();

  if (!out || hasPromptLeak(out)) return fallback;

  if (out.length > 110) {
    out = out.slice(0, 110).replace(/\s+\S*$/, "").trim();
  }

  return out || fallback;
}

function extractBookTitleFromIdea(idea: string): string {
  const raw = String(idea ?? "").trim();

  const labeled = extractLabeledValue(raw, [
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

function cleanSeedForOutlineContext(seed: string): string {
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

function pickFallbackChapterTitle(
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

function isGenericFallbackTitle(title: string, chapterNumber: number): boolean {
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

function cleanChapterTitle(value: string, chapterNumber: number, fallback: string): string {
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

function extractTitleFromChapterChunk(chunk: string, chapterNumber: number): string {
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

function extractChapterTitlesFromIdea(seed: string): Map<number, string> {
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

function inferChapterCountFromIdea(seed: string): number | null {
  const titles = extractChapterTitlesFromIdea(seed);
  if (titles.size > 0) return Math.max(...Array.from(titles.keys()));
  return null;
}

function extractDesiredChapterCountSafe(idea: string): number | null {
  const explicit = extractDesiredChapterCount(idea);
  if (explicit) return explicit;

  const fromHeadings = inferChapterCountFromIdea(idea);
  if (fromHeadings) return clampInt(fromHeadings, 1, 120);

  return null;
}

/**
 * Outline variable limpio.
 * Lee títulos explícitos tipo CAPÍTULO N: "Título", pero NUNCA mete el prompt completo.
 */
function buildFallbackOutline(count: number, seed: string, targetWords: number) {
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

function normalizeOutlineTitles(outline: any[], fallbackSeed: string, defaultChapterWords: number): any[] {
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
function ensureOutlineForProject(proj: Project, desiredCount: number, seed: string, defaultChapterWords: number): Project {
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

type AccessProcessingScreenProps = {
  email: string;
  busy?: boolean;
  requestStatus?: string;
  error?: string | null;
  onRefresh: () => void;
  onSignOut: () => void;
};

const AccessProcessingScreen: React.FC<AccessProcessingScreenProps> = ({
  email,
  busy,
  requestStatus,
  error,
  onRefresh,
  onSignOut,
}) => {
  const statusLabel = requestStatus || "PENDING";

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white">BestSeller</h1>
          <p className="mt-3 text-sm text-slate-300">
            Tu cuenta <span className="font-mono text-indigo-200">{email}</span> está en revisión.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-center">
          <div className="text-amber-200 text-sm font-bold">
            ⏳ Procesando. Nos pondremos en contacto lo antes posible.
          </div>
          <div className="mt-2 text-xs text-amber-100/80">
            Gate activo: el usuario entra y solo pasa cuando <span className="font-mono">profiles.has_access = true</span>.
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400 font-black uppercase tracking-widest">Estado de solicitud</span>
            <span
              className={`rounded-full px-3 py-1 font-black ${
                statusLabel === "APPROVED"
                  ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/25"
                  : statusLabel === "REJECTED"
                    ? "bg-red-500/15 text-red-200 border border-red-500/25"
                    : "bg-amber-500/15 text-amber-200 border border-amber-500/25"
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {statusLabel === "APPROVED" && (
            <p className="mt-3 text-xs text-emerald-200">
              La solicitud aparece como aprobada. Si aún ves esta pantalla, confirma que <span className="font-mono">profiles.has_access</span> esté en <span className="font-mono">true</span> y presiona “Revisar acceso”.
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onRefresh}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Revisando…" : "Revisar acceso"}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-100 transition hover:bg-slate-700"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};


const DEVICE_STORAGE_KEY = "bestseller_device_id";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

type DeviceConflictInfo = {
  active_device_label?: string | null;
  active_last_seen_at?: string | null;
};

type DeviceSessionScreenProps = {
  email: string;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  otherDevice?: DeviceConflictInfo | null;
  onEnterHere: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

function createFallbackDeviceId(): string {
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return createFallbackDeviceId();

  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing && existing.trim().length >= 8) return existing;

  const next =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : createFallbackDeviceId();

  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

function getDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Dispositivo";
  const platform = navigator.platform || "Dispositivo";
  const language = navigator.language || "";
  return language ? `${platform} · ${language}` : platform;
}

function formatSessionDate(value?: string | null): string {
  if (!value) return "reciente";
  try {
    return new Intl.DateTimeFormat("es", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

const DeviceSessionScreen: React.FC<DeviceSessionScreenProps> = ({
  email,
  busy,
  error,
  notice,
  otherDevice,
  onEnterHere,
  onRefresh,
  onSignOut,
}) => {
  const hasOtherDevice = Boolean(otherDevice);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white">BestSeller</h1>
          <p className="mt-3 text-sm text-slate-300">
            Sesión aprobada para <span className="font-mono text-indigo-200">{email}</span>.
          </p>
        </div>

        <div
          className={`mt-6 rounded-2xl border p-4 text-center ${
            hasOtherDevice
              ? "border-amber-500/25 bg-amber-500/10"
              : "border-indigo-500/25 bg-indigo-500/10"
          }`}
        >
          <div className={`text-sm font-bold ${hasOtherDevice ? "text-amber-200" : "text-indigo-200"}`}>
            {hasOtherDevice
              ? "⚠️ Ya tienes una sesión activa en otro dispositivo."
              : busy
                ? "🔐 Validando este dispositivo…"
                : "🔐 Este dispositivo necesita activar sesión."}
          </div>

          <div className="mt-2 text-xs text-slate-300">
            La sesión se cierra automáticamente después de <span className="font-mono">30 minutos</span> sin actividad.
          </div>
        </div>

        {hasOtherDevice && (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-xs text-slate-300">
            <div className="font-black uppercase tracking-widest text-slate-400">Dispositivo activo</div>
            <div className="mt-2">
              <span className="text-slate-400">Nombre:</span>{" "}
              <span className="font-mono text-slate-100">{otherDevice?.active_device_label || "Otro dispositivo"}</span>
            </div>
            <div className="mt-1">
              <span className="text-slate-400">Última actividad:</span>{" "}
              <span className="font-mono text-slate-100">{formatSessionDate(otherDevice?.active_last_seen_at)}</span>
            </div>
            <p className="mt-3 text-amber-100/80">
              Puedes cerrar la sesión anterior y continuar aquí. Esto evita que una misma cuenta quede abierta en dos sitios a la vez.
            </p>
          </div>
        )}

        {notice && (
          <p className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            {notice}
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={hasOtherDevice ? onEnterHere : onRefresh}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Procesando…" : hasOtherDevice ? "Cerrar anterior y entrar" : "Activar dispositivo"}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-100 transition hover:bg-slate-700"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([initialWelcomeMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"plan" | "book" | "os4">("plan");
  const [error, setError] = useState<string | null>(null);

  // auth
  const [session, setSession] = useState<any>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // intake (signup)
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // approval gate
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [gateBusy, setGateBusy] = useState(false);

  // device/session gate
  const [deviceId, setDeviceId] = useState("");
  const [deviceAllowed, setDeviceAllowed] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [otherDevice, setOtherDevice] = useState<DeviceConflictInfo | null>(null);

  // global chapter setting
  const [defaultChapterWords, setDefaultChapterWords] = useState<number>(3000);
  const [savingSettings, setSavingSettings] = useState(false);

  // refs
  const projectsRef = useRef<Project[]>(projects);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceAutoClaimAttemptedRef = useRef(false);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // single-flight generation
  const globalGenLockRef = useRef(false);
  const requestSeqRef = useRef<Record<string, number>>({});

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  const anyGenerating = useMemo(() => {
    for (const p of projects) {
      const gp: GenerationProgress = ((p as any).generation_progress as any) || {};
      if (Object.values(gp).some((v) => v === "generating")) return true;
    }
    return false;
  }, [projects]);

  const updateProjectById = useCallback((projectId: string, updater: (p: Project) => Project) => {
    const apply = (list: Project[]) => list.map((p) => (p.id === projectId ? updater(p) : p));

    // ✅ Blindaje anti-estado viejo:
    // React puede tardar en reflejar setProjects durante generaciones en cadena.
    // Mantener projectsRef.current sincronizado evita que "Generar restantes"
    // use una versión vieja del proyecto y parezca borrar capítulos previos.
    projectsRef.current = apply(projectsRef.current);

    const run = () =>
      setProjects((prev) => {
        const next = apply(prev);
        projectsRef.current = next;
        return next;
      });

    if (typeof startTransition === "function") startTransition(run);
    else run();
  }, []);

  const setSectionProgress = useCallback(
    (projectId: string, sectionId: string, status: GenerationStatus) => {
      updateProjectById(projectId, (p) => ({
        ...p,
        generation_progress: { ...(((p as any).generation_progress as AnyRecord) || {}), [sectionId]: status } as any,
      }));
    },
    [updateProjectById]
  );

  /* -------------------------- session sync -------------------------- */

  useEffect(() => {
    (async () => {
      try {
        const s = await getSession();
        setSession(s);
      } catch (e) {
        setError(normalizeError(e));
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      if (!newSession) {
        setProfile(null);
        setRequest(null);
        deviceAutoClaimAttemptedRef.current = false;
        setDeviceAllowed(false);
        setDeviceBusy(false);
        setDeviceNotice(null);
        setDeviceError(null);
        setOtherDevice(null);
        projectsRef.current = [];
        setProjects([]);
        setActiveProjectId(null);
        setMessages([initialWelcomeMessage]);
        setError(null);
        setAuthNotice(null);
      }
    });

    return () => {
      sub?.subscription?.unsubscribe();
    };
  }, []);

  /* -------------------------- approval gate -------------------------- */

  const refreshApprovalStatus = useCallback(async () => {
    const uid = session?.user?.id ?? null;
    const em = session?.user?.email ?? "";
    if (!uid) return;

    setGateBusy(true);
    try {
      // IMPORTANTE:
      // El cliente NO debe hacer upsert con has_access:false cuando el profile ya existe.
      // Si lo hace, puede pisar o bloquear una aprobación manual.
      let { data: pData, error: pErr } = await supabase
        .from("profiles")
        .select("email,has_access,full_name,phone")
        .eq("user_id", uid)
        .maybeSingle();

      if (pErr) throw pErr;

      if (!pData) {
        const { error: insertProfileErr } = await supabase.from("profiles").insert({
          user_id: uid,
          email: em,
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          // NO mandamos has_access desde el cliente.
          // La DB lo deja en false por default y solo el admin/backend lo cambia a true.
        });

        if (insertProfileErr) throw insertProfileErr;

        const refreshed = await supabase
          .from("profiles")
          .select("email,has_access,full_name,phone")
          .eq("user_id", uid)
          .maybeSingle();

        if (refreshed.error) throw refreshed.error;
        pData = refreshed.data;
      } else {
        const profilePatch: Record<string, string | null> = {};

        if (em && em !== (pData as any).email) profilePatch.email = em;
        if (fullName.trim() && fullName.trim() !== ((pData as any).full_name ?? "")) profilePatch.full_name = fullName.trim();
        if (phone.trim() && phone.trim() !== ((pData as any).phone ?? "")) profilePatch.phone = phone.trim();

        if (Object.keys(profilePatch).length > 0) {
          const { error: updateProfileErr } = await supabase
            .from("profiles")
            .update(profilePatch)
            .eq("user_id", uid);

          if (updateProfileErr) throw updateProfileErr;

          const refreshed = await supabase
            .from("profiles")
            .select("email,has_access,full_name,phone")
            .eq("user_id", uid)
            .maybeSingle();

          if (refreshed.error) throw refreshed.error;
          pData = refreshed.data;
        }
      }

      const hasAccess = Boolean((pData as any)?.has_access);

      setProfile({
        email: ensureString((pData as any)?.email, em),
        has_access: hasAccess,
        full_name: (pData as any)?.full_name ?? null,
        phone: (pData as any)?.phone ?? null,
      });

      const { data: rData, error: rErr } = await supabase
        .from("access_requests")
        .select("id,status,created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1);

      if (rErr) throw rErr;

      if (!rData?.[0] && !hasAccess) {
        const { error: insertRequestErr } = await supabase.from("access_requests").insert({
          user_id: uid,
          email: em,
          full_name: fullName.trim() || ((pData as any)?.full_name ?? null),
          phone: phone.trim() || ((pData as any)?.phone ?? null),
          status: "PENDING",
        });

        if (insertRequestErr) throw insertRequestErr;

        const { data: r2, error: r2Err } = await supabase
          .from("access_requests")
          .select("id,status,created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(1);

        if (r2Err) throw r2Err;
        setRequest((r2?.[0] ?? null) as any);
      } else {
        setRequest((rData?.[0] ?? null) as any);
      }
    } catch (e) {
      setError(`Setup gate (profiles/access_requests): ${normalizeError(e)}`);
      setProfile({ email: session?.user?.email ?? "", has_access: false });
    } finally {
      setGateBusy(false);
    }
  }, [fullName, phone, session?.user?.email, session?.user?.id]);

  useEffect(() => {
    if (!session) return;
    refreshApprovalStatus().catch((e) => setError(normalizeError(e)));
  }, [session, refreshApprovalStatus]);

  /* -------------------------- load user settings when approved -------------------------- */

  useEffect(() => {
    if (!session) return;
    if (!profile?.has_access) return;
    (async () => {
      try {
        const s = await getUserSettings();
        const v = Number((s as any)?.default_chapter_words ?? 3000) || 3000;
        setDefaultChapterWords(Math.max(500, Math.min(20000, v)));
      } catch {
        setDefaultChapterWords(3000);
      }
    })();
  }, [profile?.has_access, session]);

  /* -------------------------- projects loading (approved only) -------------------------- */

  const hydrateProject = useCallback(async (projectId: string) => {
    const { project, sections, masterLatest } = await getProjectFull(projectId);
    const full = mapDbFullToProject(project, sections, masterLatest);
    setProjects((prev) => {
      const has = prev.some((p) => p.id === projectId);
      const next = !has ? [full, ...prev] : prev.map((p) => (p.id === projectId ? full : p));
      projectsRef.current = next;
      return next;
    });
    return full;
  }, []);

  const refreshList = useCallback(async () => {
    const list = await listProjects();
    setProjects((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]));
      const next: Project[] = [];
      for (const row of list) {
        const existing = prevById.get(row.id);
        if (existing) next.push(existing);
        else {
          next.push({
            id: row.id,
            title: row.title,
            state: normalizeProjectState({ project_id: row.id, book_title: row.title, book_topic: row.topic ?? "", outline_12: [] }),
            master_document: { title: row.title, text: "", chunks: [] } as any,
            dashboard: null,
            generation_progress: {} as any,
          } as any);
        }
      }
      projectsRef.current = next;
      return next;
    });
  }, []);

  const didLoadListRef = useRef(false);
  useEffect(() => {
    if (!profile?.has_access) return;
    if (didLoadListRef.current) return;
    didLoadListRef.current = true;
    refreshList().catch((e) => setError(normalizeError(e)));
  }, [profile?.has_access, refreshList]);

  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!profile?.has_access) return;
    if (didAutoSelectRef.current) return;
    if (activeProjectId) {
      didAutoSelectRef.current = true;
      return;
    }
    if (projects.length > 0) {
      didAutoSelectRef.current = true;
      setActiveProjectId(projects[0].id);
    }
  }, [activeProjectId, profile?.has_access, projects]);

  useEffect(() => {
    if (!profile?.has_access) return;
    if (!activeProjectId) return;

    const p = projects.find((x) => x.id === activeProjectId);
    const st: any = (p as any)?.state ?? {};
    const maybeEmpty = !p || (!ensureArray(st?.chapters, []).length && !ensureString((p as any)?.master_document?.text, "").trim());
    if (maybeEmpty) hydrateProject(activeProjectId).catch((e) => setError(normalizeError(e)));
  }, [activeProjectId, hydrateProject, profile?.has_access, projects]);

  /* -------------------------- persistence helpers -------------------------- */

  const persistProjectMeta = useCallback(async (proj: Project) => {
    const st: any = proj.state ?? {};
    await updateProject(proj.id, {
      title: proj.title,
      topic: st.book_topic ?? null,
      audience: st.audience ?? null,
      tone_style: st.tone_style ?? null,
      dossier: (proj as any).dashboard ?? (st.dossier ?? {}) ?? {},
      outline_12: st.outline_12 ?? [],
      continuity_pack: st.continuity_pack ?? {},
    });
  }, []);

  const upsertOneSectionFromState = useCallback(async (proj: Project, kind: "proposal" | "intro" | "chapter", chapterNum?: number) => {
    const st: any = proj.state ?? {};

    if (kind === "proposal") {
      const text = ensureString(st?.proposal?.text, "");
      const sid = await upsertSection({
        project_id: proj.id,
        type: "PROPOSAL",
        chapter_number: null,
        title: "Propuesta editorial",
        content: text,
        status: ensureString(st?.proposal?.status, "PENDING") === "COMPLETED" ? "COMPLETED" : "PENDING",
      });
      await insertSectionVersion(sid, text);
      return;
    }

    if (kind === "intro") {
      const text = ensureString(st?.introduction?.text, "");
      const sid = await upsertSection({
        project_id: proj.id,
        type: "INTRODUCTION",
        chapter_number: null,
        title: "Introducción",
        content: text,
        status: ensureString(st?.introduction?.status, "PENDING") === "COMPLETED" ? "COMPLETED" : "PENDING",
      });
      await insertSectionVersion(sid, text);
      return;
    }

    const n = Number(chapterNum ?? 0) || 0;
    if (!n) return;

    const ch = ensureArray<any>(st?.chapters, []).find((c: any) => Number(c?.chapter_number ?? 0) === n);
    const title = ensureString(ch?.title, `Capítulo ${n}`);
    const text = ensureString(ch?.text, "");

    const sid = await upsertSection({
      project_id: proj.id,
      type: "CHAPTER",
      chapter_number: n,
      title,
      content: text,
      status: ensureString(ch?.status, "PENDING") === "COMPLETED" ? "COMPLETED" : "PENDING",
    });
    await insertSectionVersion(sid, text);
  }, []);

  const rebuildAndSnapshotMaster = useCallback(async (proj: Project) => {
    const masterText = await buildMasterServer(proj.id);
    await insertMasterSnapshot(proj.id, proj.title, masterText);
    return masterText;
  }, []);

  /* -------------------------- auth actions -------------------------- */

  const handleSignIn = useCallback(async () => {
    setError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const e = email.trim();
      if (!e || !password) throw new Error("Escribe email y clave.");
      const { data, error: signErr } = await supabase.auth.signInWithPassword({ email: e, password });
      if (signErr) throw signErr;
      setSession(data.session);
      await refreshApprovalStatus();
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setAuthBusy(false);
    }
  }, [email, password, refreshApprovalStatus]);

  const handleSignUp = useCallback(async () => {
    setError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const e = email.trim();
      const name = fullName.trim();
      const ph = phone.trim();

      if (!e || !password) throw new Error("Escribe email y clave.");
      if (!name) throw new Error("Escribe tu nombre.");
      if (!ph) throw new Error("Escribe tu WhatsApp/teléfono.");

      const { data, error: upErr } = await supabase.auth.signUp({ email: e, password });
      if (upErr) throw upErr;

      if (!data.session) throw new Error('Tu Supabase tiene "Confirm email" activado. Desactívalo para flujo inmediato.');

      setSession(data.session);

      const uid = data.session.user.id;

      // IMPORTANTE:
      // Nunca hacemos upsert con has_access:false desde el cliente.
      // Si el usuario ya fue aprobado, un upsert así puede tumbar o bloquear el acceso.
      const { data: existingProfile, error: existingProfileErr } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();

      if (existingProfileErr) throw existingProfileErr;

      if (!existingProfile) {
        const { error: insertProfileErr } = await supabase.from("profiles").insert({
          user_id: uid,
          email: e,
          full_name: name,
          phone: ph,
        });

        if (insertProfileErr) throw insertProfileErr;
      } else {
        const { error: updateProfileErr } = await supabase
          .from("profiles")
          .update({
            email: e,
            full_name: name,
            phone: ph,
          })
          .eq("user_id", uid);

        if (updateProfileErr) throw updateProfileErr;
      }

      const { data: existingRequest, error: existingRequestErr } = await supabase
        .from("access_requests")
        .select("id")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingRequestErr) throw existingRequestErr;

      if (!existingRequest?.[0]) {
        const { error: requestErr } = await supabase.from("access_requests").insert({
          user_id: uid,
          email: e,
          full_name: name,
          phone: ph,
          status: "PENDING",
        });

        if (requestErr) throw requestErr;
      }

      await refreshApprovalStatus();
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setAuthBusy(false);
    }
  }, [email, fullName, password, phone, refreshApprovalStatus]);

  const clearDeviceTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    clearDeviceTimers();

    try {
      const currentDeviceId = deviceId || (typeof window !== "undefined" ? window.localStorage.getItem(DEVICE_STORAGE_KEY) || "" : "");
      if (currentDeviceId) {
        await supabase.rpc("revoke_my_device_session", {
          p_device_id: currentDeviceId,
        });
      }
    } catch {
      // Si la RPC no existe o falla, igual cerramos Auth.
    }

    deviceAutoClaimAttemptedRef.current = false;
    setDeviceAllowed(false);
    setDeviceBusy(false);
    setDeviceNotice(null);
    setDeviceError(null);
    setOtherDevice(null);
    await supabase.auth.signOut();
  }, [clearDeviceTimers, deviceId]);


  /* -------------------------- device/session gate -------------------------- */

  const claimDeviceSession = useCallback(async (opts?: { force?: boolean }) => {
    if (!session?.user?.id) return false;
    if (!profile?.has_access) return false;

    const force = Boolean(opts?.force);
    const nextDeviceId = deviceId || getOrCreateDeviceId();

    setDeviceId(nextDeviceId);
    setDeviceBusy(true);
    setDeviceError(null);
    setDeviceNotice(null);

    try {
      if (!force) {
        const { data: activeData, error: activeErr } = await supabase.rpc("get_active_device_session", {
          p_device_id: nextDeviceId,
        });

        if (activeErr) throw activeErr;

        const row = Array.isArray(activeData) ? activeData[0] : activeData;
        const hasOther = Boolean((row as any)?.has_other_active_device);

        if (hasOther) {
          setOtherDevice({
            active_device_label: (row as any)?.active_device_label ?? null,
            active_last_seen_at: (row as any)?.active_last_seen_at ?? null,
          });
          setDeviceAllowed(false);
          return false;
        }
      }

      const { error: claimErr } = await supabase.rpc("claim_device_session", {
        p_device_id: nextDeviceId,
        p_device_label: getDeviceLabel(),
        p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });

      if (claimErr) throw claimErr;

      setOtherDevice(null);
      setDeviceAllowed(true);
      setDeviceNotice(force ? "Sesión anterior cerrada. Entraste en este dispositivo." : null);
      return true;
    } catch (e) {
      setDeviceAllowed(false);
      setDeviceError(`Device gate: ${normalizeError(e)}`);
      return false;
    } finally {
      setDeviceBusy(false);
    }
  }, [deviceId, profile?.has_access, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!profile?.has_access) return;
    if (deviceAllowed) return;
    if (deviceBusy) return;
    if (deviceAutoClaimAttemptedRef.current) return;

    deviceAutoClaimAttemptedRef.current = true;
    claimDeviceSession().catch((e) => setDeviceError(`Device gate: ${normalizeError(e)}`));
  }, [claimDeviceSession, deviceAllowed, deviceBusy, profile?.has_access, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !profile?.has_access || !deviceAllowed || !deviceId) return;

    const signOutForInactivity = async () => {
      clearDeviceTimers();

      try {
        await supabase.rpc("revoke_my_device_session", {
          p_device_id: deviceId,
        });
      } catch {
        // Igual cerramos sesión local.
      }

      setDeviceAllowed(false);
      setDeviceNotice(null);
      setOtherDevice(null);
      setDeviceError("Sesión cerrada por 30 minutos sin actividad.");
      await supabase.auth.signOut();
    };

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        signOutForInactivity().catch(() => {});
      }, IDLE_TIMEOUT_MS);
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click", "scroll", "touchstart"];

    resetIdleTimer();

    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }

    const onVisibilityChange = () => {
      if (!document.hidden) resetIdleTimer();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [clearDeviceTimers, deviceAllowed, deviceId, profile?.has_access, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !profile?.has_access || !deviceAllowed || !deviceId) return;

    const heartbeat = async () => {
      try {
        const { data, error: touchErr } = await supabase.rpc("touch_device_session", {
          p_device_id: deviceId,
        });

        if (touchErr) throw touchErr;

        if (data !== true) {
          clearDeviceTimers();
          setDeviceAllowed(false);
          setDeviceError("Tu sesión venció o fue reemplazada por otro dispositivo.");
          await supabase.auth.signOut();
        }
      } catch (e) {
        setDeviceError(`Heartbeat: ${normalizeError(e)}`);
      }
    };

    heartbeatTimerRef.current = setInterval(() => {
      heartbeat().catch(() => {});
    }, HEARTBEAT_MS);

    heartbeat().catch(() => {});

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [clearDeviceTimers, deviceAllowed, deviceId, profile?.has_access, session?.user?.id]);


  /* -------------------------- app UI actions -------------------------- */

  const handleSelectProject = useCallback(async (id: string) => {
    setActiveProjectId(id);
    setViewMode("plan");
    setError(null);
    try {
      await hydrateProject(id);
    } catch (e) {
      setError(normalizeError(e));
    }
  }, [hydrateProject]);

  const handleDeleteProject = useCallback(async (id: string) => {
    setError(null);
    try {
      await deleteProject(id);
      const nextProjects = projectsRef.current.filter((p) => p.id !== id);
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      if (activeProjectId === id) {
        setActiveProjectId(nextProjects[0]?.id ?? null);
      }
    } catch (e) {
      setError(normalizeError(e));
    }
  }, [activeProjectId]);

  const handleStartNewBook = useCallback(async (idea: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const title = extractBookTitleFromIdea(idea);
      const desiredChapterCount = extractDesiredChapterCountSafe(idea) ?? 12;

      // Para el esquema usamos un contexto limpio, no todas las instrucciones.
      const cleanOutlineContext =
        cleanSeedForOutlineContext(idea) ||
        title;

      const seedOutline = buildFallbackOutline(
        desiredChapterCount,
        idea,
        defaultChapterWords
      );
      const dbProject = await createProject({
        title,
        topic: idea,
        outline_12: seedOutline,
        continuity_pack: { chapter_count: desiredChapterCount },
      });

      const task: ComposerTask = { action: "BUILD_FULL_DOSSIER", target_length_words: 1500, active_view: "DOSSIER" };
      const seedState: Partial<ProjectState> = {
        project_id: dbProject.id,
        book_title: dbProject.title,
        book_topic: idea,
        outline_12: seedOutline,
      };

      const result = await callComposer({
        task,
        state: seedState,
        model: GEMINI_MODEL,
        isDev: import.meta.env.DEV,
        devApiKey: DEV_GEMINI_API_KEY,
        devSystemPrompt: DEV_SYSTEM_PROMPT,
      });

      const baseStub: Project = {
        id: dbProject.id,
        title: dbProject.title,
        state: normalizeProjectState(seedState as AnyRecord),
        master_document: { title: dbProject.title, text: "", chunks: [] } as any,
        dashboard: null,
        generation_progress: {} as any,
      } as any;

      let updated = processEngineResult(result as any, baseStub);

      // ✅ Garantiza capítulos visibles siempre (N variable)
      updated = ensureOutlineForProject(
        updated,
        desiredChapterCount,
        idea,
        defaultChapterWords
      );

      // Persistimos el outline si el motor no lo devolvió o devolvió menos
      await persistProjectMeta(updated);
      await upsertOneSectionFromState(updated, "proposal");
      await upsertOneSectionFromState(updated, "intro");

      const chs = ensureArray<any>((updated.state as any).chapters, []);
      for (const c of chs) {
        const n = Number(c?.chapter_number ?? 0) || 0;
        if (n) await upsertOneSectionFromState(updated, "chapter", n);
      }

      const masterText = await rebuildAndSnapshotMaster(updated);
      const updatedWithMaster = {
        ...updated,
        master_document: { ...(updated as any).master_document, text: masterText, chunks: [{ index: 1, total: 1, text: masterText }] },
      } as Project;
      (updatedWithMaster as any).generation_progress = recomputeGenerationProgress(updatedWithMaster);

      projectsRef.current = [
        updatedWithMaster,
        ...projectsRef.current.filter((p) => p.id !== updatedWithMaster.id),
      ];
      setProjects(projectsRef.current);
      setActiveProjectId(updatedWithMaster.id);
      setViewMode("plan");

      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: `user-${now}`, role: "user", content: idea },
        { id: `ai-${now + 1}`, role: "model", content: `Expediente generado para **${updatedWithMaster.title}**.` },
      ]);
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setIsLoading(false);
    }
  }, [persistProjectMeta, rebuildAndSnapshotMaster, upsertOneSectionFromState]);

  const generateSectionCore = useCallback(async (action: string, chapterNum?: number, opts?: { bypassLock?: boolean }) => {
    const proj = projectsRef.current.find((p) => p.id === activeProjectId);
    if (!proj) return false;

    setError(null);

    const bypass = Boolean(opts?.bypassLock);
    if (!bypass) {
      if (globalGenLockRef.current || anyGenerating) {
        setError("Ya hay una generación en curso. Termina esa y luego lanzas otra.");
        return false;
      }
      globalGenLockRef.current = true;
    }

    const sectionId =
      action === "GENERATE_INTRODUCTION" ? "intro"
        : action === "GENERATE_PROPOSAL" ? "proposal"
          : `chap-${chapterNum}`;

    setSectionProgress(proj.id, sectionId, "generating");

    const seq = (requestSeqRef.current[proj.id] ?? 0) + 1;
    requestSeqRef.current[proj.id] = seq;

    try {
      const st: any = proj.state as any;
      const outline = ensureArray<any>(st?.outline_12, []);
      const o = outline.find((x: any) => Number(x?.chapter_number ?? 0) === Number(chapterNum ?? 0));


const PROPOSAL_TARGET_WORDS = 2800; // >=2000 real
const INTRO_TARGET_WORDS = 1600;

const targetWords =
  action === "GENERATE_PROPOSAL"
    ? PROPOSAL_TARGET_WORDS
    : action === "GENERATE_INTRODUCTION"
      ? INTRO_TARGET_WORDS
      : action === "GENERATE_CHAPTER"
        ? (Number(o?.target_words ?? 0) || defaultChapterWords)
        : 2500;

      const task: ComposerTask = {
        action: action as any,
        chapter_number: chapterNum,
        target_length_words: targetWords,
        active_view:
          action === "GENERATE_PROPOSAL" ? "PROPOSAL"
            : action === "GENERATE_INTRODUCTION" ? "INTRODUCTION"
              : "CHAPTER",
      };

      const stateForComposer = compactStateForComposer(proj, MAX_MASTER_CHARS_TO_SEND);
      const result = await callComposer({
        task,
        state: stateForComposer,
        model: GEMINI_MODEL,
        isDev: import.meta.env.DEV,
        devApiKey: DEV_GEMINI_API_KEY,
        devSystemPrompt: DEV_SYSTEM_PROMPT,
      });

      if ((requestSeqRef.current[proj.id] ?? 0) !== seq) return false;

      let updated = processEngineResult(result as any, proj, { action, chapterNum });

      if (action === "GENERATE_CHAPTER" && import.meta.env.DEV) {
        const n = Number(chapterNum ?? 0) || 0;
        if (n > 0 && targetWords > 0) {
          updated = await autoExtendChapterDev({
            project: updated,
            chapterNum: n,
            targetWords,
            model: GEMINI_MODEL,
            devApiKey: DEV_GEMINI_API_KEY,
          });
        }
      }

      await persistProjectMeta(updated);
      if (action === "GENERATE_PROPOSAL") await upsertOneSectionFromState(updated, "proposal");
      if (action === "GENERATE_INTRODUCTION") await upsertOneSectionFromState(updated, "intro");
      if (action === "GENERATE_CHAPTER") await upsertOneSectionFromState(updated, "chapter", chapterNum);

      const masterText = await rebuildAndSnapshotMaster(updated);
      const updatedWithMaster = {
        ...updated,
        master_document: { ...(updated as any).master_document, text: masterText, chunks: [{ index: 1, total: 1, text: masterText }] },
      } as Project;

      projectsRef.current = projectsRef.current.map((p) =>
        p.id === proj.id ? updatedWithMaster : p
      );
      updateProjectById(proj.id, () => updatedWithMaster);
      setSectionProgress(proj.id, sectionId, "completed");
      return true;
    } catch (e) {
      if ((requestSeqRef.current[proj.id] ?? 0) !== seq) return false;
      setError(`Error: ${normalizeError(e)}`);
      setSectionProgress(proj.id, sectionId, "error");
      return false;
    } finally {
      if (!bypass) globalGenLockRef.current = false;
    }
  }, [
    activeProjectId,
    anyGenerating,
    defaultChapterWords,
    persistProjectMeta,
    rebuildAndSnapshotMaster,
    setSectionProgress,
    updateProjectById,
    upsertOneSectionFromState,
  ]);

  const handleGenerateSection = useCallback((action: string, chapterNum?: number) => generateSectionCore(action, chapterNum), [generateSectionCore]);

  const handleGenerateRemaining = useCallback(async () => {
    if (globalGenLockRef.current || anyGenerating) return;
    globalGenLockRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const getFresh = () => projectsRef.current.find((p) => p.id === activeProjectId);
      let current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.proposal?.status, "PENDING") !== "COMPLETED") {
        const ok = await generateSectionCore("GENERATE_PROPOSAL", undefined, { bypassLock: true });
        if (!ok) return;
      }

      current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.introduction?.status, "PENDING") !== "COMPLETED") {
        const ok = await generateSectionCore("GENERATE_INTRODUCTION", undefined, { bypassLock: true });
        if (!ok) return;
      }

      current = getFresh();
      if (!current) return;

      for (const item of ensureArray<any>((current.state as any)?.outline_12, [])) {
        const key = `chap-${item.chapter_number}`;
        const status = (((current as any).generation_progress || {})[key] as GenerationStatus | undefined);
        if (status === "completed") continue;

        const ok = await generateSectionCore("GENERATE_CHAPTER", item.chapter_number, { bypassLock: true });
        if (!ok) break;

        current = getFresh();
        if (!current) break;
      }
    } finally {
      setIsLoading(false);
      globalGenLockRef.current = false;
    }
  }, [activeProjectId, anyGenerating, generateSectionCore]);

  const handleEditSection = useCallback(async (payload: any) => {
    const proj = projectsRef.current.find((p) => p.id === activeProjectId);
    if (!proj) return;
    setError(null);

    try {
      const st: any = proj.state ?? {};
      const draft = JSON.parse(JSON.stringify(st));

      if (payload.kind === "proposal") {
        draft.proposal = { ...(draft.proposal ?? {}), text: payload.text, status: "COMPLETED" };
      } else if (payload.kind === "intro") {
        draft.introduction = { ...(draft.introduction ?? {}), text: payload.text, status: "COMPLETED" };
      } else if (payload.kind === "chapter") {
        const n = Number(payload.chapterNumber ?? 0) || 0;
        const chs = ensureArray<any>(draft.chapters, []);
        const idx = chs.findIndex((c: any) => Number(c?.chapter_number ?? 0) === n);
        const base = idx >= 0 ? chs[idx] : { chapter_number: n };
        const updated = {
          ...base,
          chapter_number: n,
          title: ensureString(payload.title, ensureString(base?.title, `Capítulo ${n}`)),
          text: payload.text,
          status: "COMPLETED",
        };
        if (idx >= 0) chs[idx] = updated;
        else chs.push(updated);
        draft.chapters = chs;
      }

      const merged = normalizeProjectState(draft);
      const masterLocal = buildMasterFromState(merged, proj.title);

      const next: Project = {
        ...proj,
        state: merged,
        master_document: { ...(proj as any).master_document, text: masterLocal, chunks: [{ index: 1, total: 1, text: masterLocal }] },
      } as any;

      (next as any).generation_progress = recomputeGenerationProgress(next);
      projectsRef.current = projectsRef.current.map((p) => (p.id === proj.id ? next : p));
      updateProjectById(proj.id, () => next);

      if (payload.kind === "proposal") await upsertOneSectionFromState(next, "proposal");
      if (payload.kind === "intro") await upsertOneSectionFromState(next, "intro");
      if (payload.kind === "chapter") await upsertOneSectionFromState(next, "chapter", payload.chapterNumber);

      const masterText = await rebuildAndSnapshotMaster(next);
      const nextWithMaster = {
        ...next,
        master_document: { ...(next as any).master_document, text: masterText, chunks: [{ index: 1, total: 1, text: masterText }] },
      } as Project;
      projectsRef.current = projectsRef.current.map((p) => (p.id === proj.id ? nextWithMaster : p));
      updateProjectById(proj.id, () => nextWithMaster);
    } catch (e) {
      setError(normalizeError(e));
    }
  }, [activeProjectId, rebuildAndSnapshotMaster, updateProjectById, upsertOneSectionFromState]);

  const handleSaveSnapshot = useCallback(async () => {
    const proj = projectsRef.current.find((p) => p.id === activeProjectId);
    if (!proj) return;
    setError(null);
    try {
      const masterText = await rebuildAndSnapshotMaster(proj);
      const nextWithMaster = {
        ...proj,
        master_document: { ...(proj as any).master_document, text: masterText, chunks: [{ index: 1, total: 1, text: masterText }] },
      } as Project;
      projectsRef.current = projectsRef.current.map((p) => (p.id === proj.id ? nextWithMaster : p));
      updateProjectById(proj.id, () => nextWithMaster);
    } catch (e) {
      setError(normalizeError(e));
    }
  }, [activeProjectId, rebuildAndSnapshotMaster, updateProjectById]);

  /* ------------------------------ render gates ------------------------------ */

  if (!session) {
    return (
      <AuthScreen
        buildTag={BUILD_TAG}
        mode={authMode}
        onMode={(m) => {
          setAuthMode(m);
          setAuthNotice(null);
          setError(null);
        }}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        fullName={fullName}
        setFullName={setFullName}
        phone={phone}
        setPhone={setPhone}
        busy={authBusy}
        onSubmit={authMode === "signin" ? handleSignIn : handleSignUp}
        error={error}
        notice={authNotice}
      />
    );
  }

  if (!profile || !profile.has_access) {
    const em = profile?.email || session?.user?.email || "";
    return (
      <AccessProcessingScreen
        email={em}
        busy={gateBusy}
        requestStatus={request?.status}
        error={error}
        onRefresh={() => refreshApprovalStatus().catch((e) => setError(normalizeError(e)))}
        onSignOut={handleSignOut}
      />
    );
  }

  if (!deviceAllowed) {
    const em = profile?.email || session?.user?.email || "";
    return (
      <DeviceSessionScreen
        email={em}
        busy={deviceBusy}
        error={deviceError}
        notice={deviceNotice}
        otherDevice={otherDevice}
        onEnterHere={() => {
          deviceAutoClaimAttemptedRef.current = false;
          claimDeviceSession({ force: true }).catch((e) => setDeviceError(normalizeError(e)));
        }}
        onRefresh={() => {
          deviceAutoClaimAttemptedRef.current = false;
          claimDeviceSession().catch((e) => setDeviceError(normalizeError(e)));
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  /* ------------------------------ approved main UI ------------------------------ */

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-100">
      <div className="flex h-full min-h-0 font-sans">
        <aside className="w-1/4 min-w-[280px] h-full bg-slate-900 border-r border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <PenSquareIcon className="w-8 h-8 text-indigo-400" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-white truncate">BestSeller</h1>
                <div className="text-[10px] text-slate-500 font-mono truncate">{BUILD_TAG}</div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] font-black tracking-widest uppercase text-slate-400">
                Longitud por capítulo (global)
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDefaultChapterWords(3000)}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition ${
                    defaultChapterWords === 3000 ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  3000
                </button>
                <button
                  type="button"
                  onClick={() => setDefaultChapterWords(6000)}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition ${
                    defaultChapterWords === 6000 ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  6000
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  type="number"
                  value={defaultChapterWords}
                  onChange={(e) => setDefaultChapterWords(Number(e.target.value || 3000))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs"
                  min={500}
                  max={20000}
                  step={100}
                />
                <button
                  type="button"
                  disabled={savingSettings}
                  onClick={async () => {
                    try {
                      setSavingSettings(true);
                      const v = await upsertUserSettings(defaultChapterWords);
                      setDefaultChapterWords(v);
                    } catch (e) {
                      setError(normalizeError(e));
                    } finally {
                      setSavingSettings(false);
                    }
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </div>

            <TableOfContents
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={handleSelectProject}
              onSave={handleSaveSnapshot}
              onCreateNew={() => {
                didAutoSelectRef.current = true;
                setActiveProjectId(null);
                setMessages([initialWelcomeMessage]);
                setError(null);
              }}
              onDeleteProject={handleDeleteProject as any}
              isLoading={isLoading || anyGenerating}
            />

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-slate-950">
          {activeProject && (
            <div className="shrink-0 bg-slate-900 border-b border-slate-800 flex">
              <button
                onClick={() => setViewMode("plan")}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition-all ${
                  viewMode === "plan"
                    ? "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <RocketIcon className="w-4 h-4 inline mr-2" /> Arquitectura Editorial
              </button>

              <button
                onClick={() => setViewMode("book")}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition-all ${
                  viewMode === "book"
                    ? "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <BookOpenIcon className="w-4 h-4 inline mr-2" /> Documento Maestro
              </button>

              <button
                onClick={() => setViewMode("os4")}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition-all ${
                  viewMode === "os4"
                    ? "border-fuchsia-500 text-fuchsia-300 bg-fuchsia-500/10"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                SUPREME OS
              </button>
            </div>
          )}

          <div className="relative flex-1 min-h-0 overflow-y-auto">
            {activeProject ? (
              viewMode === "plan" ? (
                <div className="min-h-full bg-slate-950">
                  <GenerationDashboard
                    project={activeProject}
                    onGenerate={handleGenerateSection}
                    onGenerateRemaining={handleGenerateRemaining}
                    onOpenBookView={() => setViewMode("book")}
                    isGeneratingGlobal={isLoading || anyGenerating}
                  />
                </div>
              ) : viewMode === "os4" ? (
                <div className="min-h-full bg-slate-950">
                  <AutonomousPublishingOS
                    project={activeProject}
                    defaultChapterWords={defaultChapterWords}
                    onProjectUpdated={(nextProject) => {
                      projectsRef.current = projectsRef.current.map((p) =>
                        p.id === nextProject.id ? nextProject : p
                      );
                      updateProjectById(nextProject.id, () => nextProject);
                    }}
                  />
                </div>
              ) : (
                <div className="min-h-full bg-slate-950">
                  <BookViewer project={activeProject} onEditSection={handleEditSection as any} />
                </div>
              )
            ) : (
              <div className="min-h-full bg-slate-950">
                <ChatInterface messages={messages} isLoading={isLoading} onSendMessage={handleStartNewBook} error={error} />
              </div>
            )}

            {error && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-500/15 border border-red-500/30 text-red-200 px-4 py-2 rounded text-sm">
                {error}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;


/**
 * ELITE_MARKET_10_LIVE_FEATURES
 * Blueprint → Investigación → Outline → Writing → Fact-check → Revisión → Export
 */

export const ELITE_MARKET_10_LIVE_FEATURES = {
  pipeline: [
    "Blueprint",
    "Investigación",
    "Outline",
    "Writing",
    "Fact-check",
    "Revisión",
    "Export",
  ],
  actions: {
    regenerateTitle: "Regenerar título",
    approveOutline: "Aprobar outline",
    improveChapter: "Mejorar capítulo a 10/10",
    exportPdf: "Exportar PDF",
    exportDocx: "Exportar DOCX",
    exportEpub: "Exportar EPUB",
  },
  monetization: {
    plans: ["BASIC", "PRO", "AGENCY", "EDITORIAL"],
    pricing: true,
    stripe: true,
    checkout: true,
    payment: true,
    billing: true,
    subscription: true,
    credits: true,
    usage_limit: true,
    plan_limits: true,
    max_books: true,
    max_chapters: true,
  },
  operations: {
    usage: true,
    usage_events: true,
    analytics: true,
    generation_jobs: true,
    queue: true,
    job: true,
    worker: true,
    background: true,
    approval: true,
    aprobacionManual: true,
    roles: ["admin", "user", "editor"],
  },
  quality: {
    scoreEliteChapterText: true,
    FACT_CHECK_CHAPTER: true,
    runChapterFactCheck: true,
    chapter_quality_reports: true,
    rewrite_instructions: true,
  },
  exports: {
    export: true,
    pdf: true,
    docx: true,
    epub: true,
  },
} as const;


/**
 * BESTSELLER_OS4_SUPREME_INTEGRATED
 * Market → Concept Battle → Author DNA → Blueprint → Research → Knowledge Graph
 * → Simulation → Writing → Fact-check → Quality Council → Master → Launch.
 */
export const BESTSELLER_OS4_SUPREME_INTEGRATED = true;

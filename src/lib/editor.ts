// ==========================================
// FILE: src/lib/editor.ts
// ==========================================

import type { Project, ProjectState } from "../../types";

/* -------------------------------- Types --------------------------------- */

export type AnyRecord = Record<string, any>;

export type GenerationStatus = "pending" | "generating" | "completed" | "error";
export type GenerationProgress = Record<string, GenerationStatus>;

export type EngineResult = {
  ok: boolean;
  dashboard?: unknown;
  project_state_updated?: unknown;
  master_document?: unknown;
  needs_input?: { message?: string };
};

export type ProcessCtx = { action?: string; chapterNum?: number };

/* ----------------------------- tiny helpers ----------------------------- */



export function isBibliographyAllowedForProject(projectLike: any): boolean {
  const raw = [
    projectLike?.title,
    projectLike?.topic,
    projectLike?.book_topic,
    projectLike?.dossier?.book_title,
    projectLike?.dossier?.book_topic,
    projectLike?.tone_style,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /hist[oó]ric|historia|acad[eé]mic|investigaci[oó]n|tesis|bibliograf|fuentes|citas|referencias|documental|ensayo cr[ií]tico/.test(raw);
}

export function sanitizeEditorialChapterText(
  text: string,
  opts?: {
    allowBibliography?: boolean;
    allowInstructionLines?: boolean;
  }
): string {
  const allowBibliography = Boolean(opts?.allowBibliography);
  const allowInstructionLines = Boolean(opts?.allowInstructionLines);

  let out = String(text || "");

  // Quita fences y etiquetas raras.
  out = out
    .replace(/\`\`\`[a-zA-Z0-9_-]*\s*/g, "")
    .replace(/\`\`\`/g, "");

  const lines = out.split(/\r?\n/);
  const cleanLines: string[] = [];

  let skippingBibliography = false;

  const instructionLineRe =
    /^\s*(act[uú]a como|eres un|como escritor|como edit(or|ora)|instrucciones?|reglas?|objetivo del cap[ií]tulo|requisitos?|devuelve solo|no uses|no incluyas|prompt|task:|project_state:|system:)\b/i;

  const bibliographyStartRe =
    /^\s*(bibliograf[ií]a|referencias|fuentes consultadas|fuentes|citas|notas bibliogr[aá]ficas|obras consultadas|lecturas recomendadas)\s*[:\-–—]?\s*$/i;

  const chapterHeadingRe =
    /^\s*(cap[ií]tulo\s+\d+)\s*[:\-–—.]\s*(.+?)\s*$/i;

  for (const line of lines) {
    const raw = line;
    const trimmed = raw.trim();

    if (!trimmed) {
      if (!skippingBibliography) cleanLines.push(raw);
      continue;
    }

    // Normaliza encabezados tipo:
    // "Capítulo 1. Los comunicadores dominicanos. Actúa como..."
    const chMatch = trimmed.match(chapterHeadingRe);
    if (chMatch) {
      let title = chMatch[2] || "";

      title = title
        .replace(/\b(act[uú]a como|eres un|como escritor|como editor|instrucciones?|reglas?|objetivo del cap[ií]tulo|requisitos?).*$/i, "")
        .replace(/\s+/g, " ")
        .trim();

      title = title.replace(/[.:;,-]+$/g, "").trim();

      if (title) {
        cleanLines.push(`${chMatch[1]}. ${title}`);
      } else {
        cleanLines.push(chMatch[1]);
      }

      skippingBibliography = false;
      continue;
    }

    // Quita líneas de instrucciones internas.
    if (!allowInstructionLines && instructionLineRe.test(trimmed)) {
      continue;
    }

    // Quita bibliografía dentro del capítulo si no está permitida.
    if (!allowBibliography && bibliographyStartRe.test(trimmed)) {
      skippingBibliography = true;
      continue;
    }

    // Si ya estamos saltando bibliografía, seguimos saltando hasta un nuevo capítulo o corte fuerte.
    if (skippingBibliography) {
      if (/^\s*cap[ií]tulo\s+\d+/i.test(trimmed)) {
        skippingBibliography = false;
        cleanLines.push(raw);
      }
      continue;
    }

    // Quita líneas bibliográficas típicas aunque no tengan encabezado.
    if (
      !allowBibliography &&
      /^(\-\s*)?(autor|obra|editorial|isbn|doi|url|http|https|www\.|fuente:|referencia:)/i.test(trimmed)
    ) {
      continue;
    }

    cleanLines.push(raw);
  }

  out = cleanLines.join("\n");

  // Quita bloques inline típicos de bibliografía/fuentes entre párrafos.
  if (!allowBibliography) {
    out = out.replace(
      /\n\s*(bibliograf[ií]a|referencias|fuentes consultadas|obras consultadas|lecturas recomendadas)\s*[:\-–—]?[\s\S]*$/i,
      ""
    );
  }

  // Limpieza de exceso de líneas.
  out = out
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return out;
}

export function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function ensureArray<T>(v: unknown, fallback: T[] = []): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}

export function ensureString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function normalizeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (isRecord(e) && "message" in e) return String((e as AnyRecord).message);
  return "Error desconocido";
}

/* ----------------------------- engine parse ----------------------------- */

function cleanModelText(text: string): string {
  return String(text ?? "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function escapeControlCharsInsideStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code >= 0 && code < 32) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }

    out += ch;
  }

  return out;
}

function removeTrailingCommasOutsideStrings(input: string): string {
  let out = "";
  let inStr = false;
  let esc = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      const next = input[j];
      if (next === "}" || next === "]") {
        continue; // drop trailing comma
      }
    }

    out += ch;
  }

  return out;
}

/**
 * Fix muy común: falta coma entre propiedades.
 * Ej: {"a":"x" "b":1} -> {"a":"x","b":1}
 * (Heurística: inserta coma cuando termina un valor y empieza un "key":)
 */
function insertMissingCommasBetweenProps(input: string): string {
  // Solo trabajamos en texto “fuera de strings” mediante un scan,
  // y aplicamos inserción en patrones súper comunes.
  let out = "";
  let inStr = false;
  let esc = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }

    out += ch;

    // Detecta: ... } "key":
    //          ... "value" "key":
    //          ... 123 "key":
    //          ... true "key":
    //          ... null "key":
    // Para no hacer regex gigante, miramos lookahead.
    if (ch === "}" || ch === '"' || ch === "e" || ch === "l" || ch === "n" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '"') {
        // Buscar hacia adelante si esto parece el inicio de una key: "xxx":
        const k = input.indexOf(":", j);
        if (k > j) {
          // Asegurar que entre j y k solo haya algo tipo "key"
          const mid = input.slice(j, k).trim();
          if (/^"[^"]+"$/.test(mid)) {
            // Retrocede para ver el último token "significativo" emitido
            let t = out.trimEnd();
            const last = t[t.length - 1];
            // Si ya hay coma/llave abierta/colon, no insertes
            if (last && last !== "{" && last !== "[" && last !== ":" && last !== ",") {
              out = t + "," + out.slice(t.length);
            }
          }
        }
      }
    }
  }

  return out;
}

function extractFirstJsonObject(text: string): string | null {
  const t = cleanModelText(text);
  const first = t.indexOf("{");
  if (first < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = first; i < t.length; i++) {
    const ch = t[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(first, i + 1);
    }
  }

  const last = t.lastIndexOf("}");
  return last > first ? t.slice(first, last + 1) : null;
}

function parseJsonCandidate(candidate: string): any {
  const cleaned = cleanModelText(candidate);

  // pipeline de reparaciones locales (sin IA)
  const repaired1 = escapeControlCharsInsideStrings(cleaned);
  const repaired2 = removeTrailingCommasOutsideStrings(repaired1);
  const repaired3 = insertMissingCommasBetweenProps(repaired2);

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(repaired2);
    } catch {
      return JSON.parse(repaired3);
    }
  }
}

export function safeJsonParse(text: string): any {
  const t = cleanModelText(text);
  if (!t) throw new Error("Respuesta vacía");

  try {
    return parseJsonCandidate(t);
  } catch (firstError: any) {
    const obj = extractFirstJsonObject(t);
    if (!obj) {
      throw new Error(`No se pudo extraer JSON. ${firstError?.message || ""}`.trim());
    }

    try {
      return parseJsonCandidate(obj);
    } catch (secondError: any) {
      const preview = obj.slice(0, 1200);
      throw new Error(`JSON inválido del modelo: ${secondError?.message || secondError}. Preview: ${preview}`);
    }
  }
}

export function validateEngineResult(raw: unknown): EngineResult {
  if (!isRecord(raw)) throw new Error("Respuesta no es JSON object.");
  if ((raw as AnyRecord).ok !== true) {
    const needs = (raw as AnyRecord).needs_input;
    const msg = isRecord(needs) ? ensureString(needs.message, "") : "";
    throw new Error(msg || "Error del motor editorial.");
  }
  if (!("project_state_updated" in raw)) throw new Error("Respuesta inválida: falta project_state_updated.");
  if (!("master_document" in raw)) throw new Error("Respuesta inválida: falta master_document.");
  if (!("dashboard" in raw)) throw new Error("Respuesta inválida: falta dashboard.");
  return raw as EngineResult;
}

/* ------------------- word count + placeholder detection ------------------- */

const WORD_RE = /\S+/g;

export function countWordsQuick(text: string): number {
  const t = (text ?? "").trim();
  if (!t) return 0;
  const m = t.match(WORD_RE);
  return m ? m.length : 0;
}

export function isPlaceholderText(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  const compact = t.replace(/\s+/g, "");
  if (compact === "..." || compact === "…") return true;
  const dots = (t.match(/\.\.\./g) ?? []).length;
  const wc = countWordsQuick(t);
  if (dots >= 2 && wc < 120) return true;
  if (wc > 0 && wc < 40 && /\.\.\.|…/.test(t)) return true;
  return false;
}

/** Palabras mínimas para considerar que una sección tiene contenido real. */
export const MIN_GENERATED_WORDS = 100;

/** Una sección "generada" (y por tanto cerrada) tiene texto real, no un marcador de posición. */
export function hasGeneratedText(text: unknown): boolean {
  const t = ensureString(text, "").trim();
  return countWordsQuick(t) >= MIN_GENERATED_WORDS && !isPlaceholderText(t);
}

export function chapterIsComplete(chText: string, targetWords?: number): boolean {
  const wc = countWordsQuick(chText);
  if (!wc) return false;
  if (isPlaceholderText(chText)) return false;

  const target = typeof targetWords === "number" && Number.isFinite(targetWords) ? Math.floor(targetWords) : 0;

  // ✅ Regla dura: siempre mínimo 2000, y si target existe, hay que llegar al target.
  const required = target > 0 ? Math.max(2000, target) : 2000;
  return wc >= required;
}

/* ----------------------- outline helpers (variable N) ----------------------- */

function stripChapterLabel(title: string, chapterNum?: number): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  const n = typeof chapterNum === "number" && Number.isFinite(chapterNum) ? chapterNum : null;

  if (n) {
    const re1 = new RegExp(String.raw`^\s*(cap[ií]tulo|chapter)\s*${n}\s*[:\-–—]\s*`, "i");
    if (re1.test(t)) return t.replace(re1, "").trim();
  }
  return t.replace(/^\s*(cap[ií]tulo|chapter)\s*[:\-–—]\s*/i, "").trim();
}

function buildOutlineFromChapterSections(
  chapters: Array<{ chapter_number: number; title: string; text: string; status?: string }>
) {
  return chapters
    .filter((c) => (Number(c?.chapter_number ?? 0) || 0) > 0)
    .slice()
    .sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0))
    .map((c) => {
      const n = Number(c.chapter_number ?? 0) || 0;
      const cleanTitle = stripChapterLabel(ensureString(c.title, n ? `Capítulo ${n}` : "Capítulo"), n) || `Capítulo ${n}`;
      const wc = countWordsQuick(ensureString(c.text, ""));
      return {
        id: `outline_${String(n).padStart(2, "0")}`,
        chapter_number: n,
        chapter_title: cleanTitle,
        status: c?.status === "COMPLETED" ? "COMPLETED" : "PENDING",
        target_words: wc > 0 ? wc : 0,
        objective: "",
        key_points: [],
        subheads_h2: [],
        tools_frameworks: [],
        exercises: [],
        deliverable: "",
        transition_to_next: "",
      };
    });
}

/* ----------------------- duplicate heading cleanup ------------------------ */

function stripLeadingChapterHeading(text: string, chapterNum?: number, chapterTitle?: string): string {
  const t = (text ?? "").trimStart();
  if (!t) return "";

  const title = (chapterTitle ?? "").trim();
  const n = typeof chapterNum === "number" && Number.isFinite(chapterNum) ? chapterNum : null;

  const capLine = n
    ? new RegExp(String.raw`^\s{0,3}#{1,3}\s*cap[ií]tulo\s*${n}\b[^\n]*\n+`, "i")
    : null;

  let out = t;

  if (capLine && capLine.test(out)) out = out.replace(capLine, "");

  if (title) {
    const titleLine = new RegExp(String.raw`^\s{0,3}#{1,3}\s*${escapeRegExp(title)}\s*\n+`, "i");
    if (titleLine.test(out)) out = out.replace(titleLine, "");
  }

  out = out.replace(/^\s{0,3}#{1,3}\s*cap[ií]tulo\b[^\n]*\n+/i, "");
  return out.trimStart();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ----------------------- progress computed from text ----------------------- */

export function recomputeGenerationProgress(project: Project): GenerationProgress {
  const prev = ((project as any).generation_progress as AnyRecord) || {};
  const progress: GenerationProgress = { ...(prev as GenerationProgress) };
  const st = ((project as any).state as AnyRecord) || {};

  const proposalText = ensureString((st as any).proposal?.text, "");
  const introText = ensureString((st as any).introduction?.text, "");

  const PROPOSAL_MIN_WORDS = 2000;
  const INTRO_MIN_WORDS = 1200;

  const proposalDone = countWordsQuick(proposalText) >= PROPOSAL_MIN_WORDS && !isPlaceholderText(proposalText);
  const introDone = countWordsQuick(introText) >= INTRO_MIN_WORDS && !isPlaceholderText(introText);

  if (progress.proposal !== "generating") progress.proposal = proposalDone ? "completed" : "pending";
  if (progress.intro !== "generating") progress.intro = introDone ? "completed" : "pending";

  const outline = ensureArray<any>((st as any).outline_12, []);
  const chapters = ensureArray<any>((st as any).chapters, []);

  const byNum = new Map<number, any>();
  for (const c of chapters) {
    const cn = Number(c?.chapter_number ?? 0) || 0;
    if (cn > 0) byNum.set(cn, c);
  }

  for (const o of outline) {
    const n = Number(o?.chapter_number ?? 0) || 0;
    if (!n) continue;
    const id = `chap-${n}`;
    if (progress[id] === "generating") continue;
    const ch = byNum.get(n);
    const text = ensureString(ch?.text, "");
    progress[id] = chapterIsComplete(text, o?.target_words) ? "completed" : "pending";
  }

  return progress;
}

/* ----------------------- composer compaction helpers ----------------------- */

export function clipText(s: string, maxChars: number): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  return `[[CLIPPED ${t.length - maxChars} chars]]\n` + t.slice(t.length - maxChars);
}

export function compactStateForComposer(project: Project, maxMasterChars: number): AnyRecord {
  const st = ((project as any).state as AnyRecord) ?? {};
  const dash = ((project as any).dashboard as AnyRecord) ?? {};
  const md = ((project as any).master_document as AnyRecord) ?? {};
  return {
    ...st,
    dashboard: dash,
    master_document: {
      title: ensureString((md as any).title, ""),
      text: clipText(ensureString((md as any).text, ""), maxMasterChars),
    },
  };
}

/* -------------------------- master builder -------------------------- */

// GENELIBROS_V14_5_LEGACY_BRIEF_RECOVERY
// Los proyectos creados antes de V14.4 pueden conservar en Supabase títulos
// genéricos o fragmentos del prompt. Recuperamos únicamente metadatos explícitos
// del encargo original; nunca inventamos un título nuevo.
function cleanBriefTitleLine(value: unknown): string {
  let out = String(value ?? "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .trim();

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['«', '»'],
  ];

  for (const [open, close] of quotePairs) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }

  return out;
}

export function extractBookTitleFromBrief(brief: string): string {
  const lines = String(brief ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const heading = cleanBriefTitleLine(lines[i]);
    if (!/^t[ií]tulo\s+de\s+trabajo\s*[:\-–—]?$/i.test(heading)) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const candidate = cleanBriefTitleLine(lines[j]);
      if (!candidate || candidate === "---") continue;
      if (/^t[ií]tulos?\s+alternativos?/i.test(candidate)) break;
      if (/^(?:subt[ií]tulo|misi[oó]n general|objetivo general)\b/i.test(candidate)) continue;
      return candidate;
    }
  }

  for (const line of lines) {
    const cleaned = cleanBriefTitleLine(line);
    const m = /^(?:t[ií]tulo|nombre\s+del\s+libro)\s*[:\-–—]\s*(.+)$/i.exec(cleaned);
    const candidate = cleanBriefTitleLine(m?.[1] ?? "");
    if (candidate) return candidate;
  }

  return "";
}

function isBadChapterTitle(chapterNumber: number, value: unknown): boolean {
  const n = Number(chapterNumber) || 0;
  const t = cleanBriefTitleLine(value);
  if (!t) return true;

  const compact = t.toLowerCase().replace(/\s+/g, " ").trim();
  if (n > 0 && (
    compact === `capítulo ${n}` ||
    compact === `capitulo ${n}` ||
    compact === `chapter ${n}` ||
    compact === `parte ${n}`
  )) return true;

  if (/^(?:cap[ií]tulo|chapter|parte)\s*\d*\s*[:.\-–—]?$/i.test(t)) return true;
  if (/\b(?:misi[oó]n general|objetivo general|prompt maestro|act[uú]a como)\b/i.test(t)) return true;
  if (/\b(?:produzca|produce|escriba|escribe|crea|crear)\s+un\s+libro\b/i.test(t)) return true;
  if (t.length > 150 && /\b(?:investigaci[oó]n|requisitos?|instrucciones?|formato final)\b/i.test(t)) return true;
  return false;
}

export function extractChapterTitlesFromBrief(brief: string): Map<number, string> {
  const lines = String(brief ?? "").split(/\r?\n/);
  const titles = new Map<number, string>();

  for (let i = 0; i < lines.length; i += 1) {
    const raw = cleanBriefTitleLine(lines[i]);
    if (!raw) continue;

    const inline = /^cap[ií]tulo\s+(\d+)\s*[:.\-–—]\s*(.+)$/i.exec(raw);
    if (inline) {
      const n = Number(inline[1]) || 0;
      const candidate = cleanBriefTitleLine(inline[2]);
      if (n > 0 && candidate && !isBadChapterTitle(n, candidate) && !titles.has(n)) {
        titles.set(n, candidate);
      }
      continue;
    }

    const standalone = /^cap[ií]tulo\s+(\d+)\s*[:.\-–—]?$/i.exec(raw);
    if (!standalone) continue;
    const n = Number(standalone[1]) || 0;
    if (!n || titles.has(n)) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const candidate = cleanBriefTitleLine(lines[j]);
      if (!candidate || candidate === "---") continue;
      if (/^(?:parte\s+[ivxlcdm]+|pr[oó]logo|ep[ií]logo)$/i.test(candidate)) continue;
      if (/^cap[ií]tulo\s+\d+/i.test(candidate)) break;
      if (!isBadChapterTitle(n, candidate)) titles.set(n, candidate);
      break;
    }
  }

  return titles;
}

function isBadBookTitle(value: unknown): boolean {
  const t = cleanBriefTitleLine(value);
  if (!t) return true;
  if (/^(libro sin t[ií]tulo|documento maestro|documento|untitled)$/i.test(t)) return true;
  if (/^(?:misi[oó]n general|objetivo general|prompt maestro)\b/i.test(t)) return true;
  if (/\b(?:produzca|produce|escriba|escribe|crea|crear)\s+un\s+libro\b/i.test(t)) return true;
  if (t.length > 150 && /\b(?:requisitos?|instrucciones?|formato final|investigaci[oó]n)\b/i.test(t)) return true;
  return false;
}

function getCanonicalBookTitle(currentProject: any, mergedState: any, dashboard?: any): string {
  const projectTitle = cleanBriefTitleLine(currentProject?.title);
  if (!isBadBookTitle(projectTitle)) return projectTitle;

  const brief = ensureString(mergedState?.book_topic, ensureString(mergedState?.bookTopic, ""));
  const explicitBriefTitle = extractBookTitleFromBrief(brief);
  if (explicitBriefTitle && !isBadBookTitle(explicitBriefTitle)) return explicitBriefTitle;

  const stateTitle = cleanBriefTitleLine(mergedState?.book_title ?? mergedState?.bookTitle);
  if (!isBadBookTitle(stateTitle)) return stateTitle;

  const dashboardTitle = cleanBriefTitleLine(dashboard?.book_title);
  if (!isBadBookTitle(dashboardTitle)) return dashboardTitle;

  return "Libro sin título";
}

function enforceCanonicalBookTitle(currentProject: any, mergedState: any, dashboard?: any): string {
  const canonicalTitle = getCanonicalBookTitle(currentProject, mergedState, dashboard);

  if (mergedState && typeof mergedState === "object") {
    mergedState.book_title = canonicalTitle;
    mergedState.bookTitle = canonicalTitle;
  }

  if (dashboard && typeof dashboard === "object") {
    dashboard.book_title = canonicalTitle;
  }

  return canonicalTitle;
}

// GENELIBROS_V14_4_CANONICAL_CHAPTER_TITLES
// El título planificado del outline es la fuente canónica. Un resultado parcial
// del modelo nunca debe convertir "Capítulo 4: Título real" en solo "Capítulo 4".
export function pickCanonicalChapterTitle(chapterNumber: number, ...candidates: unknown[]): string {
  const n = Number(chapterNumber) || 0;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const raw = cleanBriefTitleLine(candidate);
    if (isBadChapterTitle(n, raw)) continue;
    const title = raw.replace(new RegExp(String.raw`^(?:cap[ií]tulo|chapter)\s*${n}\s*[:.\-–—]\s*`, "i"), "").trim();
    if (title && !isBadChapterTitle(n, title)) return title;
  }
  return n > 0 ? `Capítulo ${n}` : "Capítulo";
}

/**
 * Legacy repair for the first EL OUTSIDER test book.
 *
 * The original prompt was accidentally persisted as the project title and the
 * dossier stored generic chapter labels.  Keep the user's existing chapter
 * text, but restore the explicit twelve-chapter editorial contract whenever
 * that unmistakable legacy prompt is loaded.
 */
export const OUTSIDER_DEMO_TITLES = [
  "El outsider: una ruptura que necesita definición",
  "América Latina: promesas, victorias y fracasos desde 2006",
  "Trump, Zelenski y Europa: la celebridad frente al sistema",
  "La anatomía de una ruptura electoral",
  "República Dominicana: de los partidos históricos al mapa actual",
  "La arquitectura del poder dominicano",
  "El malestar y el voto: economía, confianza y representación",
  "Popularidad, rechazo y redes: por qué los seguidores no son votos",
  "El ADN del outsider dominicano",
  "Las reglas de entrada: candidatura, organización y territorio",
  "2028: escenarios de sucesión, competencia y segunda vuelta",
  "Después de la victoria: gobernabilidad y límites de la ruptura",
] as const;

export function buildOutsiderDemoOutline(previousOutline: any[] = [], targetWords = 3500): any[] {
  const byNumber = new Map<number, any>();
  for (const item of ensureArray<any>(previousOutline, [])) {
    const n = Number(item?.chapter_number ?? 0) || 0;
    if (n > 0) byNumber.set(n, item);
  }

  return OUTSIDER_DEMO_TITLES.map((chapter_title, index) => {
    const n = index + 1;
    const old = byNumber.get(n) ?? {};
    return {
      ...old,
      id: ensureString(old?.id, `outline_${String(n).padStart(2, "0")}`),
      chapter_number: n,
      chapter_title,
      title: chapter_title,
      status: old?.status === "COMPLETED" ? "COMPLETED" : "PENDING",
      target_words: Number(old?.target_words ?? targetWords) || targetWords,
      objective: ensureString(old?.objective, `Analizar ${chapter_title.toLowerCase()} con evidencia, contexto y límites de inferencia.`),
      key_points: ensureArray(old?.key_points, []),
      subheads_h2: ensureArray(old?.subheads_h2, []),
    };
  });
}

export function repairLegacyOutsiderProject(db: any): {
  title: string;
  topic: string;
  outline_12: any[];
  continuity_pack: AnyRecord;
} | null {
  const title = ensureString(db?.title, "").trim();
  const topic = ensureString(db?.topic, ensureString(db?.book_topic, ""));
  const unmistakablePrompt = /(?:#\s*PROMPT\s+MAESTRO|MISI[ÓO]N\s+GENERAL)/i.test(topic);
  const outsiderTopic = /\bEL\s+OUTSIDER\b/i.test(topic) && /2028/.test(topic);
  const legacyTitle = /MISI[ÓO]N\s+GENERAL|^Libro sin t[ií]tulo$|^Nuevo libro$/i.test(title);
  const previousOutline = ensureArray<any>(db?.outline_12, []);
  const hasGenericTitles = previousOutline.some((item: any) => {
    const n = Number(item?.chapter_number ?? 0) || 0;
    const candidate = ensureString(item?.chapter_title, ensureString(item?.title, "")).trim();
    return n > 0 && (!candidate || /^(?:cap[ií]tulo|chapter|parte)\s*\d+\s*$/i.test(candidate));
  });
  const needsRepair = legacyTitle || previousOutline.length !== OUTSIDER_DEMO_TITLES.length || hasGenericTitles;

  if (!outsiderTopic || !unmistakablePrompt || !needsRepair) return null;

  const outline_12 = buildOutsiderDemoOutline(previousOutline);

  const continuity_pack = {
    ...(isRecord(db?.continuity_pack) ? db.continuity_pack : {}),
    chapter_count: 12,
  };

  return { title: "EL OUTSIDER", topic, outline_12, continuity_pack };
}

export function buildMasterFromState(state: ProjectState, title?: string): string {
  const parts: string[] = [];
  const bookTitle = (title || (state as any).book_title || "Documento maestro").trim();
  parts.push(`# ${bookTitle}\n`);

  const proposalText = ensureString((state as any).proposal?.text, "").trim();
  if (proposalText) parts.push(`## Propuesta editorial\n\n${proposalText}`);

  const introText = ensureString((state as any).introduction?.text, "").trim();
  if (introText) parts.push(`## Introducción\n\n${introText}`);

  const outlineTitleByNum = new Map<number, any>();
  for (const item of ensureArray<any>((state as any).outline_12, [])) {
    const n = Number(item?.chapter_number ?? 0) || 0;
    if (n > 0) outlineTitleByNum.set(n, item);
  }

  const chapters = ensureArray<any>((state as any).chapters, [])
    .slice()
    .sort((a, b) => (Number(a?.chapter_number ?? 0) || 0) - (Number(b?.chapter_number ?? 0) || 0));

  for (const ch of chapters) {
    const n = Number(ch?.chapter_number ?? 0) || 0;
    const planned = outlineTitleByNum.get(n);
    const chTitle = pickCanonicalChapterTitle(
      n,
      planned?.chapter_title,
      planned?.title,
      ch?.title,
      ch?.chapter_title
    );
    const t = stripLeadingChapterHeading(ensureString(ch?.text, ""), n, chTitle).trim();
    if (!t) continue;
    parts.push(`## ${n ? `Capítulo ${n}: ` : ""}${chTitle}\n\n${t}`);
  }

  return parts.join("\n\n---\n\n").trim() + "\n";
}

/* -------------------------- normalize / merge state -------------------------- */

export function normalizeProjectState(input: unknown): ProjectState {
  const state: AnyRecord = isRecord(input) ? { ...(input as AnyRecord) } : {};

  const proposal = isRecord((state as any).proposal) ? { ...((state as any).proposal as AnyRecord) } : {};
  proposal.id = ensureString(proposal.id, "sec_proposal");
  proposal.text = ensureString(proposal.text, "");
  proposal.status = proposal.status === "COMPLETED" ? "COMPLETED" : "PENDING";
  proposal.words = typeof proposal.words === "number" ? proposal.words : 0;
  (state as any).proposal = proposal;

  const introduction = isRecord((state as any).introduction) ? { ...((state as any).introduction as AnyRecord) } : {};
  introduction.id = ensureString(introduction.id, "sec_introduction");
  introduction.text = ensureString(introduction.text, "");
  introduction.status = introduction.status === "COMPLETED" ? "COMPLETED" : "PENDING";
  introduction.words = typeof introduction.words === "number" ? introduction.words : 0;
  (state as any).introduction = introduction;

  // Legacy recovery must run before outline normalization so an old saved
  // "Capítulo N" can be replaced by an explicit title from the original brief.
  (state as any).book_topic = ensureString((state as any).book_topic, ensureString((state as any).bookTopic, ""));
  (state as any).bookTopic = (state as any).book_topic;
  const briefChapterTitles = extractChapterTitlesFromBrief((state as any).book_topic);
  const explicitBriefBookTitle = extractBookTitleFromBrief((state as any).book_topic);
  const existingStateBookTitle = ensureString((state as any).book_title, ensureString((state as any).bookTitle, ""));
  if (explicitBriefBookTitle && isBadBookTitle(existingStateBookTitle)) {
    (state as any).book_title = explicitBriefBookTitle;
    (state as any).bookTitle = explicitBriefBookTitle;
  }

  (state as any).outline_12 = ensureArray<any>((state as any).outline_12, []).map((o: any, idx: number) => {
    const chapterNum = Number(o?.chapter_number ?? o?.chapterNumber ?? (idx + 1)) || idx + 1;
    const normalized: AnyRecord = isRecord(o) ? { ...(o as AnyRecord) } : {};
    normalized.id = ensureString(normalized.id, `outline_${String(chapterNum).padStart(2, "0")}`);
    normalized.chapter_number = chapterNum;
    normalized.chapter_title = pickCanonicalChapterTitle(
      chapterNum,
      normalized.chapter_title,
      normalized.chapterTitle,
      normalized.title,
      briefChapterTitles.get(chapterNum)
    );
    normalized.status = normalized.status === "COMPLETED" || normalized.status === "DRAFTED" ? normalized.status : "PENDING";
    normalized.target_words = typeof normalized.target_words === "number" ? normalized.target_words : 0;
    normalized.objective = ensureString(normalized.objective, "");
    normalized.key_points = ensureArray(normalized.key_points, []);
    normalized.subheads_h2 = ensureArray(normalized.subheads_h2, []);
    return normalized;
  });

  (state as any).chapters = ensureArray<any>((state as any).chapters, []).map((c: any, idx: number) => {
    const cn = Number(c?.chapter_number ?? c?.chapterNumber ?? c?.number ?? (idx + 1)) || idx + 1;
    const normalized: AnyRecord = isRecord(c) ? { ...(c as AnyRecord) } : {};
    normalized.chapter_number = cn;
    normalized.id = ensureString(normalized.id, `sec_chapter_${String(cn).padStart(2, "0")}`);
    const planned = (state as any).outline_12.find((o: any) => o.chapter_number === cn);
    normalized.title = pickCanonicalChapterTitle(cn, planned?.chapter_title, planned?.title, normalized.title, normalized.chapter_title);
    normalized.text = stripLeadingChapterHeading(ensureString(normalized.text, ""), cn, normalized.title);
    normalized.status = normalized.status === "COMPLETED" ? "COMPLETED" : "PENDING";
    normalized.words = typeof normalized.words === "number" ? normalized.words : 0;
    return normalized;
  });

  const continuity = isRecord((state as any).continuity_pack) ? { ...((state as any).continuity_pack as AnyRecord) } : {};
  continuity.style_guide = ensureString(continuity.style_guide, "");
  continuity.canon = ensureString(continuity.canon, "");
  continuity.outline_progress = ensureString(continuity.outline_progress, "");
  continuity.open_loops = ensureArray(continuity.open_loops, []);
  continuity.chapter_summaries = ensureArray(continuity.chapter_summaries, []);
  continuity.next_chapter_plan = ensureArray(continuity.next_chapter_plan, []);
  (state as any).continuity_pack = continuity;

  (state as any).project_id = ensureString((state as any).project_id, ensureString((state as any).projectId, `proj_${Date.now()}`));
  (state as any).book_title = ensureString((state as any).book_title, ensureString((state as any).bookTitle, "Libro sin título"));
  (state as any).bookTitle = (state as any).book_title;
  (state as any).book_topic = ensureString((state as any).book_topic, ensureString((state as any).bookTopic, ""));
  (state as any).audience = ensureString((state as any).audience, "");
  (state as any).tone_style = ensureString((state as any).tone_style, "");

  return state as unknown as ProjectState;
}

function shouldPreservePrevText(prevText: string, nextText: string): boolean {
  const prev = (prevText ?? "").trim();
  const next = (nextText ?? "").trim();
  if (!prev) return false;
  if (!next) return true;
  if (isPlaceholderText(next)) return true;
  if (next.length < Math.max(160, Math.floor(prev.length * 0.7))) return true;
  const prevW = countWordsQuick(prev);
  const nextW = countWordsQuick(next);
  if (prevW >= 220 && nextW < Math.max(80, Math.floor(prevW * 0.6))) return true;
  return false;
}

export function mergeProjectState(prev: ProjectState | undefined, next: ProjectState): ProjectState {
  if (!prev) return next;

  const merged: AnyRecord = { ...(prev as any), ...(next as any) };
  // The author's original brief is input, not a field for the model to rewrite.
  merged.book_topic = ensureString((prev as any).book_topic, "").trim() || ensureString((next as any).book_topic, "");
  merged.bookTopic = merged.book_topic;
  for (const key of ["audience", "tone_style"]) {
    if (!ensureString(merged[key], "").trim()) merged[key] = (prev as any)[key] || "";
  }

  merged.proposal = { ...(prev as any).proposal, ...(next as any).proposal };
  if (!ensureString(merged.proposal?.text, "").trim() && ensureString((prev as any).proposal?.text, "").trim()) {
    merged.proposal = { ...(prev as any).proposal };
  }

  merged.introduction = { ...(prev as any).introduction, ...(next as any).introduction };
  if (!ensureString(merged.introduction?.text, "").trim() && ensureString((prev as any).introduction?.text, "").trim()) {
    merged.introduction = { ...(prev as any).introduction };
  }

  const prevOutline = ensureArray<any>((prev as any).outline_12, []);
  const nextOutline = ensureArray<any>((next as any).outline_12, []);
  const outlineByNum = new Map<number, any>();

  for (const o of prevOutline) outlineByNum.set(Number(o?.chapter_number ?? 0) || 0, o);

  for (const o of nextOutline) {
    const n = Number(o?.chapter_number ?? 0) || 0;
    if (!n) continue;
    const previous = outlineByNum.get(n) || {};
    outlineByNum.set(n, { ...previous, ...o, chapter_number: n,
      chapter_title: pickCanonicalChapterTitle(n, o?.chapter_title, o?.title, previous.chapter_title, previous.title),
    });
  }

  merged.outline_12 = Array.from(outlineByNum.values())
    .filter(Boolean)
    .sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0));

  const prevCh = ensureArray<any>((prev as any).chapters, []);
  const nextCh = ensureArray<any>((next as any).chapters, []);
  const byNum = new Map<number, any>();

  for (const c of prevCh) {
    const cn = Number(c?.chapter_number ?? 0) || 0;
    if (cn > 0) byNum.set(cn, c);
  }

  for (const c of nextCh) {
    const cn = Number(c?.chapter_number ?? 0) || 0;
    if (!cn) continue;

    const existing = byNum.get(cn);
    const prevText = ensureString(existing?.text, "");
    const nextText = ensureString(c?.text, "");

    const mergedC: AnyRecord = { ...(existing || {}), ...(c || {}), chapter_number: cn };
    const plannedOutline = outlineByNum.get(cn);
    mergedC.title = pickCanonicalChapterTitle(
      cn,
      plannedOutline?.chapter_title,
      plannedOutline?.title,
      existing?.title,
      existing?.chapter_title,
      c?.title,
      c?.chapter_title
    );
    mergedC.text = stripLeadingChapterHeading(ensureString(mergedC.text, ""), cn, mergedC.title);

    if (existing && shouldPreservePrevText(prevText, nextText)) {
      mergedC.text = existing.text;
      mergedC.status = existing.status;
      mergedC.words = existing.words;
    }

    byNum.set(cn, mergedC);
  }

  merged.chapters = Array.from(byNum.values())
    .filter((c) => (Number(c?.chapter_number ?? 0) || 0) > 0)
    .sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0));

  merged.continuity_pack = { ...(prev as any).continuity_pack, ...(next as any).continuity_pack };
  for (const k of ["style_guide", "canon", "outline_progress"] as const) {
    if (!ensureString(merged.continuity_pack?.[k], "").trim() && ensureString((prev as any).continuity_pack?.[k], "").trim()) {
      merged.continuity_pack[k] = (prev as any).continuity_pack[k];
    }
  }

  return merged as unknown as ProjectState;
}

/* ----------------------- Supabase <-> UI mapping ----------------------- */

export function mapDbFullToProject(db: any, sections: any[], masterLatest: any): Project {
  const legacyRepair = repairLegacyOutsiderProject(db);
  const sourceDb = legacyRepair ? { ...db, ...legacyRepair } : db;
  const sourceOutline = ensureArray<any>(sourceDb?.outline_12, []);
  const proposal = sections.find((s: any) => s?.type === "PROPOSAL");
  const intro = sections.find((s: any) => s?.type === "INTRODUCTION");

  const chapters = sections
    .filter((s: any) => s?.type === "CHAPTER")
    .slice()
    .sort((a: any, b: any) => (a?.chapter_number ?? 0) - (b?.chapter_number ?? 0))
    .map((s: any) => {
      const n = Number(s?.chapter_number ?? 0) || 0;
      const outlineItem = sourceOutline.find((o: any) => Number(o?.chapter_number ?? 0) === n);
      const title = pickCanonicalChapterTitle(n, outlineItem?.chapter_title, outlineItem?.title, s?.title, s?.chapter_title);
      const text = stripLeadingChapterHeading(ensureString(s?.content, ""), n, title);
      return {
        chapter_number: n,
        title,
        text,
        status: s?.status === "COMPLETED" ? "COMPLETED" : "PENDING",
        words: countWordsQuick(text),
      };
    });

  const stateInput: AnyRecord = {
    project_id: ensureString(db?.id, ""),
    book_title: ensureString(sourceDb?.title, "Libro sin título"),
    book_topic: ensureString(sourceDb?.topic, ""),
    audience: ensureString(sourceDb?.audience, ""),
    tone_style: ensureString(sourceDb?.tone_style, ""),
    outline_12: (() => {
      const fromDb = sourceOutline;
      if (fromDb.length) return fromDb;
      if (chapters.length) return buildOutlineFromChapterSections(chapters as any);
      return [];
    })(),
    continuity_pack: (sourceDb?.continuity_pack ?? {}) as any,
    proposal: {
      id: "sec_proposal",
      text: ensureString(proposal?.content, ""),
      status: proposal?.status === "COMPLETED" ? "COMPLETED" : "PENDING",
      words: countWordsQuick(ensureString(proposal?.content, "")),
    },
    introduction: {
      id: "sec_introduction",
      text: ensureString(intro?.content, ""),
      status: intro?.status === "COMPLETED" ? "COMPLETED" : "PENDING",
      words: countWordsQuick(ensureString(intro?.content, "")),
    },
    chapters,
  };

  const state = recoverLegacyStateFromDashboard(normalizeProjectState(stateInput), db?.dossier ?? {});
  const canonicalTitle = legacyRepair
    ? ensureString(sourceDb?.title, "Libro sin título")
    : getCanonicalBookTitle({ title: ensureString(db?.title, "") }, state, db?.dossier ?? {});
  (state as any).book_title = canonicalTitle;
  (state as any).bookTitle = canonicalTitle;
  const rebuiltMasterText = buildMasterFromState(state, canonicalTitle).trim();
  const masterText = rebuiltMasterText || ensureString(masterLatest?.content, "").trim();

  const repairedDashboard = legacyRepair
    ? {
        ...(isRecord(db?.dossier) ? db.dossier : {}),
        menu_items: [
          { id: "proposal", label: "Propuesta editorial" },
          { id: "intro", label: "Introducción" },
          ...sourceOutline.map((item: any) => ({
            id: `chap-${item.chapter_number}`,
            label: `Capítulo ${item.chapter_number}: ${item.chapter_title}`,
          })),
        ],
      }
    : db?.dossier ?? null;

  const p: Project = {
    id: ensureString(db?.id, ""),
    title: canonicalTitle,
    state,
    dashboard: repairedDashboard,
    master_document: {
      title: canonicalTitle,
      text: masterText,
      chunks: masterText ? [{ index: 1, total: 1, text: masterText }] : [],
    } as any,
    generation_progress: {} as any,
  } as Project;

  if (legacyRepair) {
    (p as any).__legacyRepair = legacyRepair;
  }

  (p as any).generation_progress = recomputeGenerationProgress(p);
  return p;
}

/* ---------------------- outline extraction + fallback ---------------------- */

function looksLikeOutlineArray(arr: any[]): boolean {
  if (!Array.isArray(arr) || arr.length < 1) return false;

  const sample = arr.slice(0, 12);
  let recognized = 0;
  for (const x of sample) {
    if (!isRecord(x)) continue;
    const hasNumber = "chapter_number" in x || "chapterNumber" in x;
    const hasTitle = "chapter_title" in x || "chapterTitle" in x || "title" in x;
    if (hasNumber && hasTitle) recognized += 1;
  }

  const required = sample.length <= 3 ? sample.length : Math.max(2, Math.ceil(sample.length * 0.5));
  return recognized >= required;
}

function deepFindOutline(node: any, depth = 0): any[] | null {
  if (depth > 6) return null;

  if (Array.isArray(node)) {
    if (looksLikeOutlineArray(node)) return node;
    for (const it of node) {
      const found = deepFindOutline(it, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (isRecord(node)) {
    const keys = Object.keys(node);
    const preferred = keys.filter((k) => /outline|blueprint|chapters/i.test(k));
    for (const k of preferred) {
      const found = deepFindOutline((node as any)[k], depth + 1);
      if (found) return found;
    }
    for (const k of keys) {
      const found = deepFindOutline((node as any)[k], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function recoverLegacyStateFromDashboard(state: ProjectState, dashboard?: AnyRecord): ProjectState {
  // GENELIBROS_V14_6_DOSSIER_RECOVERY
  if (!dashboard || !isRecord(dashboard)) return state;

  const dashboardOutline = deepFindOutline(dashboard);
  if (!dashboardOutline?.length) return state;

  const st = state as AnyRecord;
  const currentOutline = ensureArray<any>(st.outline_12, []);
  const chapterCountHint = Number(st?.continuity_pack?.chapter_count ?? 0) || 0;

  const dashboardByNum = new Map<number, any>();
  for (let idx = 0; idx < dashboardOutline.length; idx += 1) {
    const item = dashboardOutline[idx];
    if (!isRecord(item)) continue;
    const n = Number(item?.chapter_number ?? item?.chapterNumber ?? idx + 1) || 0;
    if (n > 0) dashboardByNum.set(n, item);
  }

  // Nunca expandas silenciosamente un outline existente. Si está vacío,
  // recupera del dossier respetando chapter_count cuando exista.
  const recoveryBase = currentOutline.length
    ? currentOutline
    : Array.from(dashboardByNum.entries())
        .filter(([n]) => !chapterCountHint || n <= chapterCountHint)
        .sort(([a], [b]) => a - b)
        .map(([n, item]) => ({ ...(item as AnyRecord), chapter_number: n }));

  st.outline_12 = recoveryBase.map((item: any, idx: number) => {
    const n = Number(item?.chapter_number ?? item?.chapterNumber ?? idx + 1) || idx + 1;
    const fromDashboard = dashboardByNum.get(n);
    return {
      ...(isRecord(item) ? item : {}),
      chapter_number: n,
      chapter_title: pickCanonicalChapterTitle(
        n,
        item?.chapter_title,
        item?.chapterTitle,
        item?.title,
        fromDashboard?.chapter_title,
        fromDashboard?.chapterTitle,
        fromDashboard?.title
      ),
    };
  });

  const plannedByNum = new Map<number, any>();
  for (const item of ensureArray<any>(st.outline_12, [])) {
    const n = Number(item?.chapter_number ?? 0) || 0;
    if (n > 0) plannedByNum.set(n, item);
  }

  st.chapters = ensureArray<any>(st.chapters, []).map((chapter: any, idx: number) => {
    const n = Number(chapter?.chapter_number ?? chapter?.chapterNumber ?? idx + 1) || idx + 1;
    const planned = plannedByNum.get(n);
    const title = pickCanonicalChapterTitle(
      n,
      planned?.chapter_title,
      planned?.title,
      chapter?.title,
      chapter?.chapter_title
    );
    return {
      ...(isRecord(chapter) ? chapter : {}),
      chapter_number: n,
      title,
      text: stripLeadingChapterHeading(ensureString(chapter?.text, ""), n, title),
    };
  });

  return state;
}

export function ensureOutline12InState(state: AnyRecord, dashboard?: AnyRecord): AnyRecord {
  const outline = ensureArray<any>((state as any).outline_12, []);
  if (outline.length) return state;

  const candidate = dashboard ? deepFindOutline(dashboard) : null;
  if (!candidate) return state;

  (state as any).outline_12 = candidate;
  return state;
}

/* ----------------------- Apply engine result -> project ----------------------- */

const SECTION_ACTIONS = new Set(["GENERATE_PROPOSAL", "GENERATE_INTRODUCTION", "GENERATE_CHAPTER"]);

/**
 * GENELIBROS_SEALED_SECTIONS
 * Cada generación solo puede cambiar SU sección. La IA devuelve el estado
 * completo del libro y, sin este sello, generar la introducción podía
 * reemplazar capítulos ya escritos (mergeProjectState solo protegía textos
 * mucho más cortos). Toda sección ya generada que no sea el objetivo de la
 * acción se restaura tal como estaba. Modifica mergedState en sitio.
 */
export function sealGeneratedSections(prevState: any, mergedState: any, ctx?: ProcessCtx): void {
  const action = String(ctx?.action ?? "");
  if (!prevState || !mergedState || !SECTION_ACTIONS.has(action)) return;

  const targetChapter = action === "GENERATE_CHAPTER" ? Number(ctx?.chapterNum ?? 0) || 0 : 0;

  if (action !== "GENERATE_PROPOSAL" && hasGeneratedText(prevState?.proposal?.text)) {
    mergedState.proposal = { ...prevState.proposal };
  }
  if (action !== "GENERATE_INTRODUCTION" && hasGeneratedText(prevState?.introduction?.text)) {
    mergedState.introduction = { ...prevState.introduction };
  }

  const sealed = new Map<number, any>();
  for (const ch of ensureArray<any>(prevState?.chapters, [])) {
    const n = Number(ch?.chapter_number ?? 0) || 0;
    if (n > 0 && n !== targetChapter && hasGeneratedText(ch?.text)) sealed.set(n, ch);
  }
  if (!sealed.size) return;

  const chapters = ensureArray<any>(mergedState.chapters, []).map((ch: any) => {
    const n = Number(ch?.chapter_number ?? 0) || 0;
    const original = sealed.get(n);
    if (!original) return ch;
    sealed.delete(n);
    return { ...original };
  });
  // Un capítulo sellado que la respuesta omitió también se conserva.
  for (const original of sealed.values()) chapters.push({ ...original });
  mergedState.chapters = chapters.sort(
    (a: any, b: any) => (Number(a?.chapter_number) || 0) - (Number(b?.chapter_number) || 0)
  );
}

export function processEngineResult(result: EngineResult, currentProject: Project | undefined, ctx?: ProcessCtx): Project {
  const dashboard = isRecord(result.dashboard) ? (result.dashboard as AnyRecord) : {};
  const nextState0 = isRecord(result.project_state_updated) ? (result.project_state_updated as AnyRecord) : {};
  const nextState = normalizeProjectState(ensureOutline12InState(nextState0, dashboard));

  if (ctx?.action === "GENERATE_CHAPTER" && ctx?.chapterNum) {
    const expected = ctx.chapterNum;
    const chs = ensureArray<any>((nextState as any).chapters, []);
    const pickWords = (x: any) => countWordsQuick(ensureString(x?.text, ""));

    let chosen = chs.find((c: any) => Number(c?.chapter_number ?? 0) === expected);
    if (!chosen || !ensureString(chosen?.text, "").trim()) {
      throw new Error(`El motor no devolvió contenido para el capítulo ${expected}. No se ha reemplazado ningún capítulo.`);
    }

    if (chosen) {
      const currentState: any = (currentProject as any)?.state ?? {};
      const planned = ensureArray<any>(currentState?.outline_12, []).find(
        (item: any) => Number(item?.chapter_number ?? 0) === expected
      );
      const existingChapter = ensureArray<any>(currentState?.chapters, []).find(
        (item: any) => Number(item?.chapter_number ?? 0) === expected
      );
      const title = pickCanonicalChapterTitle(
        expected,
        planned?.chapter_title,
        planned?.title,
        existingChapter?.title,
        existingChapter?.chapter_title,
        chosen?.title,
        chosen?.chapter_title
      );
      const text = stripLeadingChapterHeading(ensureString(chosen?.text, ""), expected, title);
      (nextState as any).chapters = [{ ...(chosen as any), chapter_number: expected, title, text }];
    } else {
      (nextState as any).chapters = [];
    }
  }

  const mergedState = mergeProjectState((currentProject as any)?.state as any, nextState);
  sealGeneratedSections((currentProject as any)?.state, mergedState, ctx);

  const canonicalTitle = enforceCanonicalBookTitle(currentProject, mergedState, dashboard);
  const stateMaster = buildMasterFromState(mergedState, canonicalTitle).trim();
  const prevMaster = ensureString((currentProject as any)?.master_document?.text, "").trim();
  const finalMaster = stateMaster || prevMaster;

  const updatedProject: Project = {
    id: ensureString((currentProject as any)?.id, ensureString((mergedState as any).project_id, `proj_${Date.now()}`)),
    title: canonicalTitle,
    state: mergedState,
    master_document: {
      title: canonicalTitle,
      text: finalMaster,
      chunks: finalMaster ? [{ index: 1, total: 1, text: finalMaster }] : [],
    } as any,
    dashboard: result.dashboard as any,
    generation_progress: currentProject ? ({ ...(((currentProject as any).generation_progress as AnyRecord) || {}) } as any) : ({} as any),
  } as Project;

  (updatedProject as any).generation_progress = recomputeGenerationProgress(updatedProject);
  return updatedProject;
}

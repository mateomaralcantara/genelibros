// Planificador de prompt: arma el encargo del libro a partir de un formulario
// guiado, sin depender de ChatGPT, Gemini o Claude. El texto usa las etiquetas
// que ya interpreta el motor (TÍTULO DE TRABAJO, N capítulos, CAPÍTULO N: …).

export type BookPlan = {
  bookType: string;
  idea: string;
  workingTitle: string;
  audience: string;
  goal: string;
  tone: string;
  pointOfView: string;
  language: string;
  chapters: number;
  wordsPerChapter: number;
  references: string;
  mustInclude: string;
  avoid: string;
  chapterTitles: string; // uno por línea (opcional)
};

export const BOOK_TYPES = [
  "Novela",
  "Autoayuda y desarrollo personal",
  "Negocios y emprendimiento",
  "Divulgación (no ficción)",
  "Biografía o memorias",
  "Guía práctica o manual",
  "Ensayo",
  "Espiritual o religioso",
  "Infantil o juvenil",
  "Académico o técnico",
] as const;

export const TONES = [
  "Cercano y conversacional",
  "Inspirador y motivador",
  "Profesional y claro",
  "Narrativo y literario",
  "Académico y riguroso",
  "Persuasivo",
  "Con humor",
] as const;

export const POINTS_OF_VIEW = ["Primera persona", "Tercera persona", "Segunda persona (te hablo a ti)"] as const;

export const LANGUAGES = ["Español", "Inglés", "Portugués", "Francés"] as const;

export const WORDS_PER_CHAPTER = [1500, 2500, 3500, 5000] as const;

/** Tipos de libro en los que el punto de vista narrativo es relevante. */
export function needsPointOfView(bookType: string): boolean {
  return /novela|biograf|memorias|infantil/i.test(bookType);
}

export function emptyPlan(): BookPlan {
  return {
    bookType: BOOK_TYPES[1],
    idea: "",
    workingTitle: "",
    audience: "",
    goal: "",
    tone: TONES[0],
    pointOfView: POINTS_OF_VIEW[0],
    language: LANGUAGES[0],
    chapters: 12,
    wordsPerChapter: 2500,
    references: "",
    mustInclude: "",
    avoid: "",
    chapterTitles: "",
  };
}

const oneLine = (v: string) => String(v ?? "").replace(/\s+/g, " ").trim();
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(n) || min)));

/** Campos que faltan para poder generar. */
export function planProblems(plan: BookPlan): string[] {
  const problems: string[] = [];
  if (oneLine(plan.idea).length < 15) problems.push("Cuéntanos la idea del libro (al menos una frase).");
  if (!oneLine(plan.audience)) problems.push("Indica para quién es el libro.");
  return problems;
}

/** Construye el prompt final, listo para enviar al motor. */
export function buildBookPrompt(plan: BookPlan): string {
  const chapters = clamp(plan.chapters, 3, 40);
  const words = clamp(plan.wordsPerChapter, 500, 8000);
  const titles = String(plan.chapterTitles ?? "")
    .split("\n")
    .map((t) => oneLine(t).replace(/^(cap[ií]tulo\s*\d+\s*[:.\-–—]\s*|\d+\s*[.)\-–—]\s*)/i, ""))
    .filter(Boolean)
    .slice(0, chapters);

  const lines: string[] = [];
  if (oneLine(plan.workingTitle)) lines.push(`TÍTULO DE TRABAJO: ${oneLine(plan.workingTitle)}`);
  lines.push(`TIPO DE LIBRO: ${oneLine(plan.bookType)}`);
  lines.push(`TEMA PRINCIPAL: ${oneLine(plan.idea)}`);
  lines.push(`PÚBLICO LECTOR: ${oneLine(plan.audience)}`);
  if (oneLine(plan.goal)) lines.push(`OBJETIVO DEL LIBRO: ${oneLine(plan.goal)}`);
  lines.push(`TONO Y ESTILO: ${oneLine(plan.tone)}`);
  if (needsPointOfView(plan.bookType)) lines.push(`PUNTO DE VISTA: ${oneLine(plan.pointOfView)}`);
  lines.push(`IDIOMA: ${oneLine(plan.language)}`);
  lines.push(`EXTENSIÓN: ${chapters} capítulos de unas ${words.toLocaleString("es-DO")} palabras cada uno.`);
  if (oneLine(plan.references)) lines.push(`REFERENCIAS DE ESTILO: ${oneLine(plan.references)}`);
  if (oneLine(plan.mustInclude)) lines.push(`DEBE INCLUIR: ${oneLine(plan.mustInclude)}`);
  if (oneLine(plan.avoid)) lines.push(`EVITAR: ${oneLine(plan.avoid)}`);
  lines.push("");
  lines.push(
    oneLine(plan.workingTitle)
      ? "Respeta el título de trabajo y propón un subtítulo editorial."
      : "Propón un título editorial atractivo y un subtítulo."
  );
  lines.push(
    `Diseña la estructura completa del libro con ${chapters} capítulos, cada uno con un título específico y un objetivo claro, en un orden lógico para el lector.`
  );
  if (titles.length) {
    lines.push("");
    lines.push("ÍNDICE PROPUESTO POR EL AUTOR (respeta estos títulos):");
    titles.forEach((t, i) => lines.push(`CAPÍTULO ${i + 1}: ${t}`));
  }
  return lines.join("\n");
}

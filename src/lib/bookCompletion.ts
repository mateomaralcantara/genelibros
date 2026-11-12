// Contenido generado = contenido cerrado.
//
// Petición del autor: todo lo que ya se generó (propuesta, introducción o
// capítulo con texto real) se considera terminado y no se vuelve a generar
// solo. Para cambiarlo hay que pulsar "Editar" en esa sección y confirmar.
//
// recomputeGenerationProgress (src/lib/editor.ts) mide si una sección alcanza
// su objetivo de palabras; lo siguen usando OS4 y el modo desarrollo. Esta capa
// se aplica encima para el panel, "Autogenerar todo" y el cierre del libro.

import type { Project } from "../../types";
import { ensureArray, ensureString, hasGeneratedText, recomputeGenerationProgress } from "./editor";

export { MIN_GENERATED_WORDS, hasGeneratedText } from "./editor";

/** Texto actual de una sección: "proposal", "intro" o "chap-N". */
export function sectionText(project: Project | null | undefined, sectionId: string): string {
  const st: any = (project as any)?.state ?? {};
  if (sectionId === "proposal") return ensureString(st.proposal?.text, "");
  if (sectionId === "intro") return ensureString(st.introduction?.text, "");
  const n = Number(/^chap-(\d+)$/.exec(sectionId)?.[1] ?? 0) || 0;
  if (!n) return "";
  const ch = ensureArray<any>(st.chapters, []).find((c: any) => Number(c?.chapter_number ?? 0) === n);
  return ensureString(ch?.text, "");
}

export function sectionIsGenerated(project: Project | null | undefined, sectionId: string): boolean {
  return hasGeneratedText(sectionText(project, sectionId));
}

/** Números de capítulo del índice. */
function outlineChapters(project: Project): number[] {
  const st: any = (project as any).state ?? {};
  return ensureArray<any>(st.outline_12, [])
    .map((o: any) => Number(o?.chapter_number ?? 0) || 0)
    .filter((n: number) => n > 0);
}

/**
 * Progreso para la interfaz: lo que tiene texto aparece como "completed"
 * (cerrado), aunque no llegue al objetivo de palabras. Respeta "generating".
 */
export function generatedProgress(project: Project): Record<string, string> {
  const progress: Record<string, string> = { ...(recomputeGenerationProgress(project) as any) };
  for (const id of ["proposal", "intro", ...outlineChapters(project).map((n) => `chap-${n}`)]) {
    if (progress[id] !== "generating" && sectionIsGenerated(project, id)) progress[id] = "completed";
  }
  return progress;
}

/** Libro terminado: propuesta, introducción y todos los capítulos del índice con texto. */
export function isBookComplete(project: Project | null | undefined): boolean {
  if (!project) return false;
  const chapters = outlineChapters(project);
  if (!chapters.length) return false;
  return ["proposal", "intro", ...chapters.map((n) => `chap-${n}`)].every((id) => sectionIsGenerated(project, id));
}

export const REGENERATE_CONFIRM_MESSAGE =
  "Esta sección ya está generada y cerrada.\n\n¿Quieres regenerarla? Se reemplazará el texto actual.";

// ¿Está el libro terminado? Propuesta, introducción y todos los capítulos del
// índice completos, con los mismos criterios que muestra el panel de
// generación (recomputeGenerationProgress):
//   - propuesta ≥ 2.000 palabras, introducción ≥ 1.200 palabras;
//   - cada capítulo ≥ max(2.000, su objetivo de palabras);
//   - ninguno es un marcador de posición ("...").
// Un libro terminado se "cierra": la app no lo regenera salvo que el autor
// lo reabra a propósito.

import type { Project } from "../../types";
import { ensureArray, recomputeGenerationProgress } from "./editor";

export function isBookComplete(project: Project | null | undefined): boolean {
  if (!project) return false;
  const st: any = (project as any).state ?? {};
  const chapterNumbers = ensureArray<any>(st.outline_12, [])
    .map((o: any) => Number(o?.chapter_number ?? 0) || 0)
    .filter((n: number) => n > 0);
  if (!chapterNumbers.length) return false;

  // Ignora el estado "generating" en curso: solo cuenta el contenido guardado.
  const progress: any = recomputeGenerationProgress({ ...(project as any), generation_progress: {} });
  return (
    progress.proposal === "completed" &&
    progress.intro === "completed" &&
    chapterNumbers.every((n: number) => progress[`chap-${n}`] === "completed")
  );
}

export const BOOK_LOCKED_MESSAGE =
  "El libro está terminado y cerrado. Pulsa «Reabrir para modificar» si quieres cambiar algo.";

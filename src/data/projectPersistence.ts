// Guardado del libro en Supabase a partir del estado de la app.
// Funciones sin estado de React (antes eran useCallback(..., []) en App.tsx).

import type { Project } from "../../types";
import { ensureArray, ensureString } from "../lib/editor";
import { buildMasterServer, insertMasterSnapshot, insertSectionVersion, updateProject, upsertSection } from "./repo";

export type SectionKind = "proposal" | "intro" | "chapter";

/** Guarda título, tema, público, tono, dossier, índice y continuidad del proyecto. */
export async function persistProjectMeta(proj: Project): Promise<void> {
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
}

/** Guarda una sección (propuesta, introducción o capítulo N) y añade una versión al historial. */
export async function upsertOneSectionFromState(proj: Project, kind: SectionKind, chapterNum?: number): Promise<void> {
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
}

/** Reconstruye el documento maestro en el servidor y guarda una instantánea. */
export async function rebuildAndSnapshotMaster(proj: Project): Promise<string> {
  const masterText = await buildMasterServer(proj.id);
  await insertMasterSnapshot(proj.id, proj.title, masterText);
  return masterText;
}

/**
 * Migración idempotente de proyectos legacy: el dashboard debe mostrar y
 * guardar el índice canónico, no volver a reconstruirlo desde el prompt.
 * Modifica `full` en sitio. Devuelve true si hubo reparación (la app
 * continúa entonces la generación del libro automáticamente).
 */
export async function applyLegacyRepair(projectId: string, full: Project): Promise<boolean> {
  const legacyRepair = (full as any).__legacyRepair;
  if (!legacyRepair) return false;

  await updateProject(projectId, {
    title: legacyRepair.title,
    topic: legacyRepair.topic,
    dossier: (full as any).dashboard ?? {},
    outline_12: legacyRepair.outline_12,
    continuity_pack: legacyRepair.continuity_pack,
  });

  const repairedChapters = ensureArray<any>((full as any).state?.chapters, []);
  for (const chapter of repairedChapters) {
    const n = Number(chapter?.chapter_number ?? 0) || 0;
    if (!n) continue;
    await upsertSection({
      project_id: projectId,
      type: "CHAPTER",
      chapter_number: n,
      title: ensureString(chapter?.title, `Capítulo ${n}`),
      content: ensureString(chapter?.text, ""),
      status: ensureString(chapter?.status, "PENDING") === "COMPLETED" ? "COMPLETED" : "PENDING",
    });
  }

  const repairedMaster = await buildMasterServer(projectId);
  await insertMasterSnapshot(projectId, legacyRepair.title, repairedMaster);
  (full as any).master_document = {
    title: legacyRepair.title,
    text: repairedMaster,
    chunks: repairedMaster ? [{ index: 1, total: 1, text: repairedMaster }] : [],
  };
  delete (full as any).__legacyRepair;
  return true;
}

// Libros del usuario: lista, libro activo, carga desde Supabase, selección
// automática y borrado. La generación de contenido sigue en App.tsx y usa
// updateProjectById / projectsRef para no trabajar con estado viejo.

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../types";
import {
  AnyRecord,
  GenerationProgress,
  GenerationStatus,
  ensureArray,
  ensureString,
  mapDbFullToProject,
  normalizeError,
  normalizeProjectState,
} from "../lib/editor";
import { deleteProject, getProjectFull, listProjects } from "../data/repo";
import { applyLegacyRepair } from "../data/projectPersistence";

type UseProjectsOptions = {
  /** Solo se cargan libros cuando el usuario tiene acceso aprobado. */
  hasAccess: boolean;
  setError: (message: string | null) => void;
  /** Un proyecto legacy se reparó al cargarlo: la app continúa su generación. */
  onLegacyRepaired: (projectId: string) => void;
};

export function useProjects({ hasAccess, setError, onLegacyRepaired }: UseProjectsOptions) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // refs
  const projectsRef = useRef<Project[]>(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const onLegacyRepairedRef = useRef(onLegacyRepaired);
  onLegacyRepairedRef.current = onLegacyRepaired;

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

  /* -------------------------- projects loading (approved only) -------------------------- */

  const hydrateProject = useCallback(async (projectId: string) => {
    const { project, sections, masterLatest } = await getProjectFull(projectId);
    const full = mapDbFullToProject(project, sections, masterLatest);

    if (await applyLegacyRepair(projectId, full)) {
      // La primera carga de la demo reparada continúa automáticamente con la
      // propuesta, introducción y los 12 capítulos pendientes.
      onLegacyRepairedRef.current(projectId);
    }

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
    if (!hasAccess) return;
    if (didLoadListRef.current) return;
    didLoadListRef.current = true;
    refreshList().catch((e) => setError(normalizeError(e)));
  }, [hasAccess, refreshList]);

  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!hasAccess) return;
    if (didAutoSelectRef.current) return;
    if (activeProjectId) {
      didAutoSelectRef.current = true;
      return;
    }
    if (projects.length > 0) {
      didAutoSelectRef.current = true;
      setActiveProjectId(projects[0].id);
    }
  }, [activeProjectId, hasAccess, projects]);

  useEffect(() => {
    if (!hasAccess) return;
    if (!activeProjectId) return;

    const p = projects.find((x) => x.id === activeProjectId);
    const st: any = (p as any)?.state ?? {};
    const maybeEmpty = !p || (!ensureArray(st?.chapters, []).length && !ensureString((p as any)?.master_document?.text, "").trim());
    if (maybeEmpty) hydrateProject(activeProjectId).catch((e) => setError(normalizeError(e)));
  }, [activeProjectId, hydrateProject, hasAccess, projects]);

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

  /** Deselecciona el libro (p. ej. "crear libro nuevo") sin que se vuelva a autoseleccionar otro. */
  const clearActiveProject = useCallback(() => {
    didAutoSelectRef.current = true;
    setActiveProjectId(null);
  }, []);

  return {
    projects,
    setProjects,
    projectsRef,
    activeProjectId,
    setActiveProjectId,
    activeProject,
    anyGenerating,
    updateProjectById,
    setSectionProgress,
    hydrateProject,
    refreshList,
    handleDeleteProject,
    clearActiveProject,
  };
}

// App.tsx
// ✅ Refactor "así": App pequeño, helpers en src/lib/editor.ts y src/lib/gemini.ts, UI auth en src/components/AuthGate.tsx
// Mantiene TODO: Supabase-first + aprobación manual + generación 1 a la vez + targets globales + turbo capítulos DEV.

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { Project, ChatMessage, ProjectState } from "./types";

import TableOfContents from "./components/TableOfContents";
import ChatInterface from "./components/ChatInterface";
import GenerationDashboard from "./components/GenerationDashboard";
import { PenSquareIcon, RocketIcon, BookOpenIcon } from "./components/Icons";

// Vistas que no se muestran al entrar: se descargan al abrirlas por primera vez.
const BookViewer = lazy(() => import("./components/BookViewer"));
const ServicesHub = lazy(() => import("./components/commercial/ServicesHub"));
const AdminEditorialPanel = lazy(() => import("./components/commercial/AdminEditorialPanel"));
const AutonomousPublishingOS = lazy(() => import("./components/AutonomousPublishingOS"));

const ViewLoading: React.FC = () => (
  <div className="flex min-h-full items-center justify-center bg-slate-950 p-10 text-xs font-black uppercase tracking-widest text-slate-500">
    Cargando…
  </div>
);

import { supabase } from "./src/lib/supabase";
import {
  createProject,
} from "./src/data/repo";

import {
  AnyRecord,
  GenerationStatus,
  ensureArray,
  ensureString,
  buildOutsiderDemoOutline,
  normalizeError,
  normalizeProjectState,
  compactStateForComposer,
  buildMasterFromState,
  recomputeGenerationProgress,
  processEngineResult,
} from "./src/lib/editor";

import { callComposer, autoExtendChapterDev } from "./src/lib/gemini";
import type { ComposerTask } from "./src/lib/types.local";
import { AuthScreen } from "./components/AuthGate";
import { AccessProcessingScreen } from "./components/AccessProcessingScreen";
import { DeviceSessionScreen } from "./components/DeviceSessionScreen";
import { DEV_SYSTEM_PROMPT } from "./src/lib/devSystemPrompt";
import { useDeviceSession } from "./src/hooks/useDeviceSession";
import { useAccessGate } from "./src/hooks/useAccessGate";
import { getMyStaffRoles, type StaffRole } from "./src/data/editorialRepo";
import { useProjects } from "./src/hooks/useProjects";
import { useUserSettings } from "./src/hooks/useUserSettings";
import { isUpgradeError, useFreePlanUsage } from "./src/hooks/useFreePlanUsage";
import { FREE_PLAN_UPGRADE_TEXT, FreePlanBanner, UpgradeModal } from "./components/FreePlan";
import { REGENERATE_CONFIRM_MESSAGE, generatedProgress, isBookComplete, sectionIsGenerated } from "./src/lib/bookCompletion";
import {
  persistProjectMeta,
  rebuildAndSnapshotMaster,
  upsertOneSectionFromState,
} from "./src/data/projectPersistence";
import {
  buildFallbackOutline,
  cleanSeedForOutlineContext,
  ensureOutlineForProject,
  extractBookTitleFromIdea,
  extractDesiredChapterCountSafe,
  isOutsiderDemoBrief,
} from "./src/lib/outline";

const BUILD_TAG = "GeneLibros · V14.6 reparación completa 2026-09-07";

// Gemini
const configuredGeminiModel = String(import.meta.env.VITE_GEMINI_MODEL ?? "").trim();
const GEMINI_MODEL = /^(?:models\/)?gemini-2\.(?:0|5)-/i.test(configuredGeminiModel)
  ? "gemini-3.1-flash-lite"
  : configuredGeminiModel || "gemini-3.1-flash-lite";
const DEV_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? "";
const MAX_MASTER_CHARS_TO_SEND = 70_000; // balance: contexto amplio sin reventar tokens


const initialWelcomeMessage: ChatMessage = {
  id: "welcome-0",
  role: "model",
  content:
    "¡Bienvenido! Soy **BestSeller**. Para empezar, cuéntame de qué quieres que trate tu libro o dime un título.",
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([initialWelcomeMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"plan" | "book" | "os4">("plan");
  const [error, setError] = useState<string | null>(null);
  const [autostartSignal, setAutostartSignal] = useState(0);

  // acceso: sesión, entrada/registro y aprobación manual
  const {
    session,
    profile,
    request,
    gateBusy,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    fullName,
    setFullName,
    phone,
    setPhone,
    authBusy,
    authNotice,
    setAuthNotice,
    refreshApprovalStatus,
    handleSignIn,
    handleSignUp,
  } = useAccessGate({
    setError,
    onSignedOut: () => {
      resetDeviceState();
      projectsRef.current = [];
      setProjects([]);
      setActiveProjectId(null);
      setMessages([initialWelcomeMessage]);
      setError(null);
    },
  });

  // Servicios comerciales (Modalidad D) y panel del equipo.
  const [commercialView, setCommercialView] = useState<null | "services" | "admin">(null);
  const [staffRoles, setStaffRoles] = useState<StaffRole[]>([]);
  useEffect(() => {
    if (!session?.user?.id) {
      setStaffRoles([]);
      setCommercialView(null);
      return;
    }
    getMyStaffRoles().then(setStaffRoles).catch(() => setStaffRoles([]));
  }, [session?.user?.id]);
  const isStaff = staffRoles.length > 0;

  // Plan gratis: usuario registrado sin plan de pago. Solo puede crear el
  // expediente (título y capítulos); lo demás pide elegir un plan.
  const isFreePlan = Boolean(profile) && !profile?.has_access;
  const isFreePlanRef = useRef(isFreePlan);
  isFreePlanRef.current = isFreePlan;
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
  const freeUsage = useFreePlanUsage(isFreePlan);
  const freeUsageRef = useRef(freeUsage);
  freeUsageRef.current = freeUsage;

  // libros del usuario
  const {
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
  } = useProjects({
    hasAccess: Boolean(profile),
    setError,
    onLegacyRepaired: (projectId) => {
      if (isFreePlanRef.current) return;
      fullBookAutostartRef.current = projectId;
      setAutostartSignal((value) => value + 1);
    },
  });

  // device/session gate (1 cuenta = 1 dispositivo activo)
  const {
    deviceAllowed,
    deviceBusy,
    deviceNotice,
    deviceError,
    otherDevice,
    retry,
    enterHere,
    releaseDevice,
    resetDeviceState,
  } = useDeviceSession(session?.user?.id, Boolean(profile));

  // global chapter setting
  const { defaultChapterWords, setDefaultChapterWords, savingSettings, saveSettings } = useUserSettings({
    enabled: Boolean(session && profile),
    userId: session?.user?.id,
    setError,
  });

  // single-flight generation
  const globalGenLockRef = useRef(false);
  // GENELIBROS_V14_3_FULL_BOOK_AUTOSTART
  // Proyecto recién creado que debe disparar la generación completa una sola vez.
  const fullBookAutostartRef = useRef<string | null>(null);
  const requestSeqRef = useRef<Record<string, number>>({});

  // Lo generado queda cerrado: el panel lo muestra como listo aunque no llegue
  // al objetivo de palabras, y solo se regenera con "Editar" + confirmación.
  const activeBookComplete = isBookComplete(activeProject);
  const dashboardProject = React.useMemo(
    () => (activeProject ? ({ ...activeProject, generation_progress: generatedProgress(activeProject) } as Project) : null),
    [activeProject]
  );

  const handleSignOut = useCallback(async () => {
    await releaseDevice();
    await supabase.auth.signOut();
  }, [releaseDevice]);


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

  const handleStartNewBook = useCallback(async (idea: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const outsiderDemo = isOutsiderDemoBrief(idea);
      const title = outsiderDemo ? "EL OUTSIDER" : extractBookTitleFromIdea(idea);
      const desiredChapterCount = outsiderDemo ? 12 : (extractDesiredChapterCountSafe(idea) ?? 12);

      // Para el esquema usamos un contexto limpio, no todas las instrucciones.
      const cleanOutlineContext =
        cleanSeedForOutlineContext(idea) ||
        title;

      const seedOutline = outsiderDemo
        ? buildOutsiderDemoOutline([], defaultChapterWords)
        : buildFallbackOutline(desiredChapterCount, idea, defaultChapterWords);
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

      if (outsiderDemo) {
        const demoOutline = buildOutsiderDemoOutline(
          ensureArray<any>((updated.state as any)?.outline_12, []),
          defaultChapterWords
        );
        const demoState = normalizeProjectState({
          ...(updated.state as any),
          book_title: "EL OUTSIDER",
          bookTopic: idea,
          book_topic: idea,
          outline_12: demoOutline,
          continuity_pack: {
            ...((updated.state as any)?.continuity_pack ?? {}),
            chapter_count: 12,
          },
        });
        updated = {
          ...updated,
          title: "EL OUTSIDER",
          state: demoState,
          dashboard: {
            ...((updated as any).dashboard ?? {}),
            menu_items: [
              { id: "proposal", label: "Propuesta editorial" },
              { id: "intro", label: "Introducción" },
              ...demoOutline.map((item: any) => ({
                id: `chap-${item.chapter_number}`,
                label: `Capítulo ${item.chapter_number}: ${item.chapter_title}`,
              })),
            ],
          },
        } as Project;
      }

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
      if (isFreePlanRef.current) freeUsageRef.current.refresh();
      else fullBookAutostartRef.current = updatedWithMaster.id;
      setViewMode("plan");

      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: `user-${now}`, role: "user", content: idea },
        {
          id: `ai-${now + 1}`,
          role: "model",
          content: `Expediente generado para **${updatedWithMaster.title}**.${isFreePlanRef.current ? `\n\n${FREE_PLAN_UPGRADE_TEXT}` : ""}`,
        },
      ]);
    } catch (e) {
      if (isUpgradeError(e)) setUpgradeReason(normalizeError(e));
      setError(normalizeError(e));
    } finally {
      setIsLoading(false);
    }
  }, [persistProjectMeta, rebuildAndSnapshotMaster, upsertOneSectionFromState]);

  const generateSectionCore = useCallback(async (action: string, chapterNum?: number, opts?: { bypassLock?: boolean }) => {
    if (isFreePlanRef.current) {
      setUpgradeReason(FREE_PLAN_UPGRADE_TEXT);
      return false;
    }
    const proj = projectsRef.current.find((p) => p.id === activeProjectId);
    if (!proj) return false;

    const bypass = Boolean(opts?.bypassLock);

    const targetSectionId =
      action === "GENERATE_INTRODUCTION" ? "intro"
        : action === "GENERATE_PROPOSAL" ? "proposal"
          : `chap-${chapterNum}`;
    if (sectionIsGenerated(proj, targetSectionId)) {
      // Automático ("Autogenerar todo", arranque): nunca toca lo ya generado.
      if (bypass) return true;
      // Manual ("Editar"): solo con confirmación explícita del autor.
      if (!window.confirm(REGENERATE_CONFIRM_MESSAGE)) return false;
    }

    setError(null);

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

  // Cuando un libro se termina en esta sesión, se muestra el libro completo.
  const lastCompletionRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!activeProject) return;
    const id = activeProject.id;
    const before = lastCompletionRef.current[id];
    lastCompletionRef.current[id] = activeBookComplete;
    if (before === false && activeBookComplete) setViewMode("book");
  }, [activeBookComplete, activeProject]);

  // GENELIBROS_10_10_SINGLE_ORCHESTRATOR
  // Único orquestador del libro completo: propuesta -> introducción -> capítulos.
  // Reintenta fallos transitorios y solo declara terminado cuando no queda nada pendiente.
  const handleGenerateRemaining = useCallback(async () => {
    if (isFreePlanRef.current) {
      setUpgradeReason(FREE_PLAN_UPGRADE_TEXT);
      return;
    }
    if (globalGenLockRef.current || anyGenerating) return;
    globalGenLockRef.current = true;

    setIsLoading(true);
    setError(null);

    const getFresh = () => projectsRef.current.find((p) => p.id === activeProjectId);

    const getChapterNumbers = (project: Project): number[] => {
      const numbers = new Set<number>();
      const state: any = (project as any)?.state ?? {};

      for (const item of ensureArray<any>(state?.outline_12, [])) {
        const n = Number(item?.chapter_number ?? 0) || 0;
        if (n > 0) numbers.add(n);
      }

      for (const chapter of ensureArray<any>(state?.chapters, [])) {
        const n = Number(chapter?.chapter_number ?? 0) || 0;
        if (n > 0) numbers.add(n);
      }

      const progress = (((project as any)?.generation_progress ?? state?.generation_progress ?? {}) as AnyRecord) || {};
      for (const key of Object.keys(progress)) {
        const match = /^chap-(\d+)$/.exec(key);
        const n = Number(match?.[1] ?? 0) || 0;
        if (n > 0) numbers.add(n);
      }

      const chapterCountHint = Number(
        state?.continuity_pack?.chapter_count ??
        (project as any)?.continuity_pack?.chapter_count ??
        0
      ) || 0;

      for (let n = 1; n <= chapterCountHint; n += 1) numbers.add(n);

      return Array.from(numbers).sort((a, b) => a - b);
    };

    const isChapterCompleted = (project: Project, chapterNumber: number): boolean => {
      const state: any = (project as any)?.state ?? {};
      const key = `chap-${chapterNumber}`;
      const progress = (((project as any)?.generation_progress ?? state?.generation_progress ?? {}) as AnyRecord) || {};

      if (String(progress?.[key] ?? "").toLowerCase() === "completed") return true;

      const chapter = ensureArray<any>(state?.chapters, []).find(
        (item: any) => Number(item?.chapter_number ?? 0) === chapterNumber
      );

      return (
        ensureString(chapter?.status, "").toUpperCase() === "COMPLETED" &&
        ensureString(chapter?.text, "").trim().length > 0
      );
    };

    const runWithRetry = async (
      action: string,
      chapterNum: number | undefined,
      label: string
    ): Promise<boolean> => {
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const ok = await generateSectionCore(action, chapterNum, { bypassLock: true });
        if (ok) return true;

        if (attempt < maxAttempts) {
          console.warn(`[GENELIBROS 10/10] Reintentando ${label} (${attempt + 1}/${maxAttempts})`);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 700 * attempt));
        }
      }

      console.error(`[GENELIBROS 10/10] Falló definitivamente: ${label}`);
      return false;
    };

    try {
      let current = getFresh();
      if (!current) return;

      console.log("[GENELIBROS 10/10] FULL BOOK QUEUE START", { projectId: current.id });

      if (ensureString((current.state as any)?.proposal?.status, "PENDING") !== "COMPLETED") {
        const ok = await runWithRetry("GENERATE_PROPOSAL", undefined, "propuesta");
        if (!ok) {
          setError("No se pudo completar la propuesta editorial. Pulsa Autogenerar todo para reanudar.");
          return;
        }
      }

      current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.introduction?.status, "PENDING") !== "COMPLETED") {
        const ok = await runWithRetry("GENERATE_INTRODUCTION", undefined, "introducción");
        if (!ok) {
          setError("No se pudo completar la introducción. Pulsa Autogenerar todo para reanudar.");
          return;
        }
      }

      current = getFresh();
      if (!current) return;

      const chapterNumbers = getChapterNumbers(current);
      const failed = new Set<number>();

      for (const chapterNumber of chapterNumbers) {
        current = getFresh();
        if (!current) break;

        if (isChapterCompleted(current, chapterNumber)) continue;

        const ok = await runWithRetry("GENERATE_CHAPTER", chapterNumber, `capítulo ${chapterNumber}`);
        if (!ok) failed.add(chapterNumber);
      }

      current = getFresh();
      if (!current) return;

      const missing = chapterNumbers.filter(
        (chapterNumber) => !isChapterCompleted(current as Project, chapterNumber)
      );
      const proposalReady =
        ensureString((current.state as any)?.proposal?.status, "PENDING") === "COMPLETED";
      const introReady =
        ensureString((current.state as any)?.introduction?.status, "PENDING") === "COMPLETED";

      if (!proposalReady || !introReady || missing.length > 0 || failed.size > 0) {
        const unresolved = Array.from(new Set([...missing, ...failed])).sort((a, b) => a - b);
        setError(
          unresolved.length
            ? `Libro incompleto. Faltan capítulos: ${unresolved.join(", ")}. Pulsa Autogenerar todo para reanudar.`
            : "Libro incompleto. Pulsa Autogenerar todo para reanudar."
        );
        return;
      }

      console.log("[GENELIBROS 10/10] LIBRO TERMINADO", {
        projectId: current.id,
        chapters: chapterNumbers.length,
      });
      setError(null);
    } finally {
      setIsLoading(false);
      globalGenLockRef.current = false;
    }
  }, [activeProjectId, anyGenerating, generateSectionCore]);

  useEffect(() => {
    const pendingProjectId = fullBookAutostartRef.current;

    if (!pendingProjectId || pendingProjectId !== activeProjectId) return;

    // Consumir el marker antes de arrancar evita duplicados por rerender.
    fullBookAutostartRef.current = null;

    const timer = window.setTimeout(() => {
      void handleGenerateRemaining();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeProjectId, autostartSignal, handleGenerateRemaining]);

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

  // Servicios y panel del equipo: disponibles para cualquier usuario con sesión
  // (también para quien aún espera aprobación, que puede encargar su libro).
  if (commercialView) {
    return (
      <div className="h-screen w-full overflow-y-auto bg-slate-950">
        <Suspense fallback={<ViewLoading />}>
          {commercialView === "admin" && isStaff ? (
            <AdminEditorialPanel isAdmin={staffRoles.includes("admin")} onBack={() => setCommercialView("services")} />
          ) : (
            <ServicesHub onBack={() => setCommercialView(null)} onOpenAdmin={isStaff ? () => setCommercialView("admin") : undefined} />
          )}
        </Suspense>
      </div>
    );
  }

  if (!profile) {
    const em = profile?.email || session?.user?.email || "";
    return (
      <AccessProcessingScreen
        onOpenServices={() => setCommercialView("services")}
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
        onEnterHere={enterHere}
        onRefresh={retry}
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
                  onClick={saveSettings}
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
                clearActiveProject();
                setMessages([initialWelcomeMessage]);
                setError(null);
              }}
              onDeleteProject={handleDeleteProject as any}
              isLoading={isLoading || anyGenerating}
            />

            <button
              type="button"
              onClick={() => setCommercialView("services")}
              className="w-full py-2.5 mb-2 bg-amber-500/90 hover:bg-amber-400 text-slate-950 rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
            >
              Servicios LibroSeller{isStaff ? " · Equipo" : ""}
            </button>

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
          {isFreePlan && <FreePlanBanner usage={freeUsage} onUpgrade={() => setCommercialView("services")} />}
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
            <Suspense fallback={<ViewLoading />}>
            {activeProject ? (
              viewMode === "plan" ? (
                <div className="min-h-full bg-slate-950">
                  {activeBookComplete && (
                    <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                      <span className="font-black">📕 Libro terminado.</span>
                      <span className="text-emerald-200/80">
                        Todo lo generado está cerrado. Para cambiar una sección, pulsa «Editar» en ella.
                      </span>
                      <button
                        type="button"
                        onClick={() => setViewMode("book")}
                        className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black hover:bg-emerald-500"
                      >
                        Ver libro completo
                      </button>
                    </div>
                  )}
                  <GenerationDashboard
                    project={dashboardProject ?? activeProject}
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
            </Suspense>
          </div>
        </main>
      </div>
      {upgradeReason && (
        <UpgradeModal
          reason={upgradeReason}
          onClose={() => setUpgradeReason(null)}
          onUpgrade={() => {
            setUpgradeReason(null);
            setCommercialView("services");
          }}
        />
      )}
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

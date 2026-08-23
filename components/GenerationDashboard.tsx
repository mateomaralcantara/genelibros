import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { dashboardStyles, type DashboardVariant } from "./dashboardStyles";
import type { Project } from "../types";
import {
  PlayCircleIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  RocketIcon,
  ClipboardCheckIcon,
  BookOpenIcon,
  ListIcon,
  PenSquareIcon,
  CircleIcon,
} from "./Icons";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function countWordsQuick(text: string) {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

type Status = "pending" | "generating" | "completed" | "error";

interface GenerationDashboardProps {
  project: Project;
  onGenerate: (action: string, chapterNum?: number) => void;
  onGenerateRemaining: () => void;
  onOpenBookView: () => void;
  isGeneratingGlobal: boolean;
}

type AccentKey = "proposal" | "intro" | "chapter";

const ACCENTS: Record<AccentKey, { ring: string; dot: string; left: string; badge: string; glow: string }> = {
  proposal: {
    ring: "ring-emerald-500/25",
    dot: "bg-emerald-400",
    left: "border-l-4 border-emerald-500/70",
    badge: "border border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    glow: "from-emerald-500/25 via-emerald-500/0",
  },
  intro: {
    ring: "ring-sky-500/25",
    dot: "bg-sky-400",
    left: "border-l-4 border-sky-500/70",
    badge: "border border-sky-500/20 bg-sky-500/10 text-sky-200",
    glow: "from-sky-500/25 via-sky-500/0",
  },
  chapter: {
    ring: "ring-fuchsia-500/25",
    dot: "bg-fuchsia-400",
    left: "border-l-4 border-fuchsia-500/70",
    badge: "border border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200",
    glow: "from-fuchsia-500/25 via-fuchsia-500/0",
  },
};

const StatusPill = memo(function StatusPill({ status }: { status: Status }) {
  const base =
    "inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] px-3 py-1.5 rounded-full border";
  if (status === "completed") return <span className={cx(base, "border-emerald-500/20 bg-emerald-500/10 text-emerald-200")}>Listo</span>;
  if (status === "generating") return <span className={cx(base, "border-sky-500/20 bg-sky-500/10 text-sky-200 animate-pulse")}>Escribiendo</span>;
  if (status === "error") return <span className={cx(base, "border-red-500/25 bg-red-500/10 text-red-200")}>Error</span>;
  return <span className={cx(base, "border-white/10 bg-white/5 text-slate-200/80")}>Pendiente</span>;
});

type SectionCardProps = {
  id: "proposal" | "intro";
  label: string;
  status: Status;
  words: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onAction: () => void;
  theme: any;
  accent: AccentKey;
};

const SectionCard = memo(function SectionCard({
  label,
  status,
  words,
  selected,
  disabled,
  onSelect,
  onAction,
  theme,
  accent,
}: SectionCardProps) {
  const s = theme ?? {};
  const a = ACCENTS[accent];

  const cardBase = s.sectionCard ?? "bg-slate-900/40 backdrop-blur p-5 rounded-2xl border flex items-center justify-between transition-all";
  const cardActive = s.sectionCardActive ?? "";
  const btnBase = s.sectionBtn ?? "p-3 rounded-2xl transition-all disabled:opacity-30";
  const btnState = s.sectionBtnState ?? "";

  // ✅ Regenerar permitido: solo bloqueamos si YA está generando o si hay lock global.
  const canRun = status !== "generating" && !disabled;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cx(
        "w-full text-left relative overflow-hidden",
        cardBase,
        a.left,
        selected ? cx("ring-1", a.ring, "border-white/15") : "border-white/10",
        status === "generating" ? cx("ring-1", a.ring) : "",
        status === "generating" ? "opacity-60" : "opacity-100",
        cardActive
      )}
      data-gen={status === "generating" ? "true" : "false"}
      aria-pressed={selected}
    >
      <div className={cx("absolute inset-0 pointer-events-none bg-gradient-to-r", a.glow, "to-transparent")} />
      <div className="relative flex items-center justify-between gap-4 w-full">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={cx("w-2.5 h-2.5 rounded-full", a.dot)} />
            <p className="font-black text-slate-100 truncate">{label}</p>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <span className={cx("text-[11px] font-mono px-3 py-1.5 rounded-full", s.chip ?? "bg-white/5 border border-white/10 text-slate-200/70")}>
              {words.toLocaleString()} palabras
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={!canRun}
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className={cx(btnBase, btnState, canRun ? "" : "opacity-40 cursor-not-allowed")}
          title={canRun ? (status === "completed" ? "Regenerar" : "Generar") : "Generando..."}
          data-done={status === "completed" ? "true" : "false"}
        >
          {/* Si está listo, mostramos Play para regenerar (igual puedes dejar el check en UI si prefieres). */}
          <PlayCircleIcon className="w-8 h-8" />
        </button>
      </div>
    </div>
  );
});

type ChapterRowProps = {
  chapterNumber: number;
  title: string;
  status: Status;
  words: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onAction: () => void;
  theme: any;
};

const ChapterRow = memo(function ChapterRow({
  chapterNumber,
  title,
  status,
  words,
  selected,
  disabled,
  onSelect,
  onAction,
  theme,
}: ChapterRowProps) {
  const s = theme ?? {};
  const a = ACCENTS.chapter;

  const rowBase = s.chapterRow ?? "bg-slate-900/35 backdrop-blur border rounded-2xl p-5 flex flex-col md:flex-row justify-between gap-4 transition-all";
  const rowActive = s.chapterRowActive ?? "";
  const rowIdle = s.chapterRowIdle ?? "";
  const chip = s.chip ?? "text-[9px] bg-white/5 px-2 py-0.5 rounded border border-white/10 text-slate-200/70";
  const btnBase = s.sectionBtn ?? "p-3 rounded-2xl transition-all disabled:opacity-30";
  const btnState = s.sectionBtnState ?? "";

  // ✅ Regenerar permitido
  const canRun = status !== "generating" && !disabled;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cx(
        "w-full text-left relative overflow-hidden",
        rowBase,
        a.left,
        selected ? cx("ring-1", a.ring, "border-white/15") : "border-white/10",
        status === "generating" ? cx("ring-1", a.ring) : "",
        status === "generating" ? "opacity-60" : "opacity-100",
        selected ? rowActive : rowIdle
      )}
      aria-pressed={selected}
    >
      <div className={cx("absolute inset-0 pointer-events-none bg-gradient-to-r", a.glow, "to-transparent")} />
      <div className="relative flex items-center justify-between gap-4 w-full">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={cx("w-2.5 h-2.5 rounded-full", a.dot)} />
            <p className="font-black text-slate-100 truncate">
              Capítulo {chapterNumber}: <span className="text-slate-200/90">{title}</span>
            </p>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <span className={cx("text-[11px] font-mono px-3 py-1.5 rounded-full", chip)}>
              {words.toLocaleString()} palabras
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={!canRun}
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className={cx(btnBase, btnState, canRun ? "" : "opacity-40 cursor-not-allowed")}
          title={canRun ? (status === "completed" ? "Regenerar capítulo" : "Generar capítulo") : "Generando..."}
          data-done={status === "completed" ? "true" : "false"}
        >
          <PlayCircleIcon className="w-8 h-8" />
        </button>
      </div>
    </div>
  );
});

const DossierItem = memo(function DossierItem({
  title,
  icon,
  content,
  list,
  theme,
}: {
  title: string;
  icon: React.ReactNode;
  content?: string;
  list?: string[];
  theme: any;
}) {
  const s = theme ?? {};
  const box = s.dossierItem ?? "bg-slate-900/35 backdrop-blur border p-6 rounded-2xl space-y-4";
  const titleCls = s.dossierTitle ?? "text-xs font-black uppercase tracking-widest flex items-center gap-2";
  const bullet = s.dossierBullet ?? "text-slate-300 mt-1 shrink-0";

  return (
    <div className={box}>
      <div className={titleCls}>
        {icon} {title}
      </div>
      {content ? <p className="text-slate-200/85 leading-relaxed whitespace-pre-wrap">{content}</p> : null}
      {Array.isArray(list) && list.length > 0 ? (
        <ul className="space-y-2">
          {list.map((t, i) => (
            <li key={i} className="flex gap-2 text-slate-200/85">
              <CircleIcon className={cx("w-3.5 h-3.5 mt-1", bullet)} />
              <span className="leading-relaxed">{t}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

function nextVariant(v: DashboardVariant): DashboardVariant {
  if (v === "classic") return "current";
  if (v === "current") return "vibrant";
  return "classic";
}

function normalizeVariant(v: unknown): DashboardVariant {
  if (v === "classic" || v === "current" || v === "vibrant") return v;
  return "vibrant";
}

function statusLabel(status: Status) {
  if (status === "completed") return "Listo";
  if (status === "generating") return "Escribiendo";
  if (status === "error") return "Error";
  return "Pendiente";
}

function keyToHuman(key: string) {
  if (key === "proposal") return "Propuesta Editorial";
  if (key === "intro") return "Introducción Maestro";
  if (key.startsWith("chap-")) return `Capítulo ${key.replace("chap-", "")}`;
  return "Sección";
}

const GenerationDashboard = function GenerationDashboard({
  project,
  onGenerate,
  onGenerateRemaining,
  onOpenBookView,
  isGeneratingGlobal,
}: GenerationDashboardProps) {
  const { dashboard, state } = project as any;

  const bookTitle = useMemo(() => {
    return (
      String(project?.title || "").trim() ||
      String(state?.book_title || "").trim() ||
      "Libro sin título"
    );
  }, [project?.title, state?.book_title]);

  const bookTopic = useMemo(() => {
    return (
      String(state?.book_topic || "").trim() ||
      String((project as any)?.topic || "").trim() ||
      String(dashboard?.one_liner || "").trim() ||
      ""
    );
  }, [state?.book_topic, project, dashboard?.one_liner]);

  const [variant, setVariant] = useState<DashboardVariant>(() =>
    normalizeVariant(localStorage.getItem("DASH_VARIANT"))
  );
  useEffect(() => {
    localStorage.setItem("DASH_VARIANT", String(variant));
  }, [variant]);

  const s = (dashboardStyles as any)?.[variant] ?? (dashboardStyles as any)?.vibrant ?? {};
  const [activeTab, setActiveTab] = useState<"blueprint" | "dossier">("blueprint");

  const gp: Record<string, Status> = (((project as any)?.generation_progress ?? state?.generation_progress ?? {}) as any) || {};
  const outline12: any[] = Array.isArray(state?.outline_12) ? state.outline_12 : [];
  const chaptersArr: any[] = Array.isArray(state?.chapters) ? state.chapters : [];

  // ✅ Fallback: si outline_12 viene vacío pero hay capítulos en state,
  // renderizamos capítulos igualmente (y el blueprint deja de ser 2/2).
  const effectiveOutline: any[] = useMemo(() => {
    if (outline12.length) return outline12;

    const byNum = new Map<number, any>();
    for (const ch of chaptersArr) {
      const n = Number(ch?.chapter_number ?? 0) || 0;
      if (!n) continue;

      const rawTitle = String(ch?.title ?? "").trim();
      const cleanTitle = rawTitle
        .replace(new RegExp(String.raw`^\s*cap[ií]tulo\s*${n}\s*[:\-–—]\s*`, "i"), "")
        .trim() || rawTitle || `Capítulo ${n}`;

      byNum.set(n, {
        id: `outline_${String(n).padStart(2, "0")}`,
        chapter_number: n,
        chapter_title: cleanTitle,
        target_words: 0,
        status: "PENDING",
      });
    }

    return Array.from(byNum.values()).sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0));
  }, [outline12, chaptersArr]);

  const proposalWords = useMemo(() => countWordsQuick(state?.proposal?.text || ""), [state?.proposal?.text]);
  const introWords = useMemo(() => countWordsQuick(state?.introduction?.text || ""), [state?.introduction?.text]);

  const chapterWordsByNum = useMemo(() => {
    const map = new Map<number, number>();
    for (const ch of chaptersArr) {
      const n = typeof ch?.chapter_number === "number" ? ch.chapter_number : 0;
      if (n > 0) map.set(n, countWordsQuick(ch?.text || ""));
    }
    return map;
  }, [chaptersArr]);

  const blueprintKeys = useMemo(() => {
    const keys: string[] = ["proposal", "intro"];
    for (const ch of effectiveOutline) {
      const n = typeof ch?.chapter_number === "number" ? ch.chapter_number : 0;
      if (n > 0) keys.push(`chap-${n}`);
    }
    return keys;
  }, [effectiveOutline]);

  const firstPendingKey = useMemo(() => {
    return blueprintKeys.find((k) => {
      const st = (gp?.[k] || "pending") as Status;
      return st === "pending" || st === "error";
    });
  }, [blueprintKeys, gp]);

  const [selectedKey, setSelectedKey] = useState<string>(() => "proposal");
  useEffect(() => {
    // Auto-ajuste: si seleccionaste algo que ya está listo, brinca al siguiente pendiente
    const st = (gp?.[selectedKey] || "pending") as Status;
    if ((st === "completed" || st === "generating") && firstPendingKey) {
      setSelectedKey(firstPendingKey);
    }
    // Si el key ya no existe (outline cambió), vuelve a propuesta
    if (!blueprintKeys.includes(selectedKey)) setSelectedKey("proposal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstPendingKey, blueprintKeys.join("|")]);

  const selectedStatus: Status = (gp?.[selectedKey] || "pending") as Status;

  const canGenerateSelected = useMemo(() => {
    if (isGeneratingGlobal) return false;
    if (selectedStatus === "generating") return false;
    return true;
  }, [isGeneratingGlobal, selectedStatus]);

  const handleGenerateSelected = useCallback(() => {
    if (!canGenerateSelected) return;
    if (selectedKey === "proposal") return onGenerate("GENERATE_PROPOSAL");
    if (selectedKey === "intro") return onGenerate("GENERATE_INTRODUCTION");
    if (selectedKey.startsWith("chap-")) {
      const n = Number(selectedKey.replace("chap-", ""));
      if (Number.isFinite(n) && n > 0) return onGenerate("GENERATE_CHAPTER", n);
    }
  }, [canGenerateSelected, onGenerate, selectedKey]);

  const blueprintDone = useMemo(() => {
    let done = 0;
    for (const k of blueprintKeys) {
      if ((gp?.[k] || "pending") === "completed") done += 1;
    }
    return { done, total: blueprintKeys.length };
  }, [blueprintKeys, gp]);

  const hasPendingBlueprint = blueprintDone.done < blueprintDone.total;

  const totalChapterWords = useMemo(() => {
    let total = 0;
    for (const value of chapterWordsByNum.values()) total += value;
    return total;
  }, [chapterWordsByNum]);

  const totalBookWords = proposalWords + introWords + totalChapterWords;

  const pageCls = s?.page ?? "p-6 h-full overflow-y-auto bg-slate-900";
  const containerCls = s?.container ?? "max-w-6xl mx-auto space-y-8 pb-24";
  const headerCardCls = s?.headerCard ?? "bg-slate-900/40 rounded-3xl p-8 border border-white/10 relative overflow-hidden";
  const headerGlowCls = s?.headerGlow ?? "hidden";
  const tabsWrapCls = s?.tabsWrap ?? "flex gap-2 border-b border-white/10";
  const tabBtnBase = s?.tabBtn ?? "px-4 py-3 text-xs font-black uppercase tracking-widest transition-all rounded-xl";
  const tabActiveCls = s?.tabActive ?? "text-white bg-white/5";
  const tabIdleCls = s?.tabIdle ?? "text-slate-400 hover:text-white";
  const actionBarCls = s?.actionBar ?? "flex items-center gap-3";
  const btnPrimary = s?.btnPrimary ?? "px-5 py-3 rounded-2xl bg-indigo-600 text-white";
  const btnSecondary = s?.btnSecondary ?? "px-5 py-3 rounded-2xl bg-emerald-500 text-slate-950";
  const btnGhost = s?.btnGhost ?? "px-5 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white";

  // Guard: si dashboard aún no existe
  if (!dashboard) {
    return <div className={cx(pageCls, "flex items-center justify-center text-slate-400 animate-pulse")}>Sincronizando Dashboard…</div>;
  }

  return (
    <div className={pageCls}>
      <div className={containerCls}>
        {/* Header */}
        <div className={headerCardCls}>
          <div className={headerGlowCls} />

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <PenSquareIcon className="w-6 h-6 text-slate-200 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300/60">
                    Libro activo
                  </div>
                  <h2 className="mt-1 text-3xl md:text-4xl font-black text-slate-50 truncate">
                    {bookTitle}
                  </h2>
                </div>
              </div>

              <p className="mt-3 max-w-4xl text-slate-200/75 leading-relaxed line-clamp-3">
                {bookTopic || "Define y genera tu obra por secciones, con control total."}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className={cx("text-[10px] font-black uppercase tracking-[0.28em] px-3 py-1.5 rounded-full border", "border-white/10 bg-white/5 text-slate-200/80")}>
                  Blueprint: {blueprintDone.done}/{blueprintDone.total}
                </span>
                <span className={cx("text-[10px] font-black uppercase tracking-[0.28em] px-3 py-1.5 rounded-full border", "border-white/10 bg-white/5 text-slate-200/80")}>
                  Capítulos: {effectiveOutline.length}
                </span>
                <span className={cx("text-[10px] font-black uppercase tracking-[0.28em] px-3 py-1.5 rounded-full border", "border-white/10 bg-white/5 text-slate-200/80")}>
                  Palabras: {totalBookWords.toLocaleString()}
                </span>
                <span className={cx("text-[10px] font-black uppercase tracking-[0.28em] px-3 py-1.5 rounded-full border", "border-white/10 bg-white/5 text-slate-200/80")}>
                  Selección: {keyToHuman(selectedKey)} · {statusLabel(selectedStatus)}
                </span>
              </div>
            </div>

            <div className={actionBarCls}>
              <button
                type="button"
                onClick={() => setVariant((v) => nextVariant(v))}
                className={btnGhost}
                title="Cambiar tema del dashboard"
              >
                <ClipboardCheckIcon className="w-5 h-5" />
                Tema: {variant === "vibrant" ? "Vibrant" : variant === "current" ? "Neón" : "Classic"}
              </button>

              <button type="button" onClick={onOpenBookView} className={btnGhost}>
                <BookOpenIcon className="w-5 h-5" />
                Ver libro
              </button>

              <button type="button" onClick={handleGenerateSelected} disabled={!canGenerateSelected} className={btnSecondary}>
                <PlayCircleIcon className="w-5 h-5" />
                Generar selección
              </button>

              <button
                type="button"
                onClick={onGenerateRemaining}
                disabled={isGeneratingGlobal || !hasPendingBlueprint}
                className={btnPrimary}
                title="Autogenera lo pendiente (propuesta, intro y capítulos)"
              >
                <RocketIcon className="w-5 h-5" />
                Autogenerar todo
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className={tabsWrapCls}>
          <button
            type="button"
            onClick={() => setActiveTab("blueprint")}
            className={cx(tabBtnBase, activeTab === "blueprint" ? tabActiveCls : tabIdleCls)}
            aria-current={activeTab === "blueprint" ? "page" : undefined}
          >
            <ListIcon className="w-4 h-4" /> Secciones
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("dossier")}
            className={cx(tabBtnBase, activeTab === "dossier" ? tabActiveCls : tabIdleCls)}
            aria-current={activeTab === "dossier" ? "page" : undefined}
          >
            <ClipboardCheckIcon className="w-4 h-4" /> Dossier
          </button>
        </div>

        {/* Content */}
        {activeTab === "blueprint" ? (
          <div className="space-y-6">
            {/* Quick section buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={cx(btnGhost, "py-2 px-4")}
                onClick={() => setSelectedKey("proposal")}
              >
                <span className={cx("w-2.5 h-2.5 rounded-full", ACCENTS.proposal.dot)} />
                Propuesta
              </button>
              <button
                type="button"
                className={cx(btnGhost, "py-2 px-4")}
                onClick={() => setSelectedKey("intro")}
              >
                <span className={cx("w-2.5 h-2.5 rounded-full", ACCENTS.intro.dot)} />
                Introducción
              </button>
              <button
                type="button"
                className={cx(btnGhost, "py-2 px-4")}
                onClick={() => setSelectedKey(firstPendingKey && firstPendingKey.startsWith("chap-") ? firstPendingKey : effectiveOutline?.[0]?.chapter_number ? `chap-${effectiveOutline[0].chapter_number}` : "chap-1")}
              >
                <span className={cx("w-2.5 h-2.5 rounded-full", ACCENTS.chapter.dot)} />
                Capítulos
              </button>
            </div>

            {/* Proposal & Intro */}
            <div className="grid md:grid-cols-2 gap-4">
              <SectionCard
                id="proposal"
                label="Propuesta Editorial"
                status={(gp?.proposal || "pending") as Status}
                words={proposalWords}
                selected={selectedKey === "proposal"}
                disabled={isGeneratingGlobal}
                onSelect={() => setSelectedKey("proposal")}
                onAction={() => onGenerate("GENERATE_PROPOSAL")}
                theme={s}
                accent="proposal"
              />
              <SectionCard
                id="intro"
                label="Introducción Maestro"
                status={(gp?.intro || "pending") as Status}
                words={introWords}
                selected={selectedKey === "intro"}
                disabled={isGeneratingGlobal}
                onSelect={() => setSelectedKey("intro")}
                onAction={() => onGenerate("GENERATE_INTRODUCTION")}
                theme={s}
                accent="intro"
              />
            </div>

            {/* Chapters */}
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-[11px] font-black text-slate-200/70 uppercase tracking-[0.28em] flex items-center gap-2">
                <ListIcon className="w-4 h-4" /> Capítulos
              </h3>
              <p className="text-xs text-slate-200/60">
                Tip: selecciona un capítulo y dale a <span className="font-bold text-slate-200">Generar selección</span>.
              </p>
            </div>

            <div className="grid gap-3">
              {effectiveOutline.map((ch: any) => {
                const n = typeof ch?.chapter_number === "number" ? ch.chapter_number : 0;
                const key = `chap-${n}`;
                const st = (gp?.[key] || "pending") as Status;
                const title = String(ch?.title || ch?.chapter_title || `Capítulo ${n}`);
                const words = chapterWordsByNum.get(n) || 0;

                return (
                  <ChapterRow
                    key={key}
                    chapterNumber={n}
                    title={title}
                    status={st}
                    words={words}
                    selected={selectedKey === key}
                    disabled={isGeneratingGlobal}
                    onSelect={() => setSelectedKey(key)}
                    onAction={() => onGenerate("GENERATE_CHAPTER", n)}
                    theme={s}
                  />
                );
              })}
            </div>

            {!hasPendingBlueprint ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-emerald-200">
                <CheckCircleIcon className="w-6 h-6" />
                Todo el blueprint está completado.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            <DossierItem
              title="Promesa del libro"
              icon={<RocketIcon className="w-4 h-4 text-slate-200" />}
              content={state?.dossier?.promise ? String(state.dossier.promise) : "—"}
              theme={s}
            />
            <DossierItem
              title="Guía de estilo"
              icon={<PenSquareIcon className="w-4 h-4 text-slate-200" />}
              list={Array.isArray(state?.dossier?.style_guide) ? state.dossier.style_guide.map(String) : []}
              theme={s}
            />
            <DossierItem
              title="Reglas del canon"
              icon={<AlertTriangleIcon className="w-4 h-4 text-slate-200" />}
              list={Array.isArray(state?.dossier?.canon_rules) ? state.dossier.canon_rules.map(String) : []}
              theme={s}
            />
            <DossierItem
              title="Resultados para el lector"
              icon={<ClipboardCheckIcon className="w-4 h-4 text-slate-200" />}
              list={Array.isArray(state?.dossier?.reader_outcomes) ? state.dossier.reader_outcomes.map(String) : []}
              theme={s}
            />
            <div className="lg:col-span-2">
              <DossierItem
                title="Glosario"
                icon={<ListIcon className="w-4 h-4 text-slate-200" />}
                list={Array.isArray(state?.dossier?.glossary) ? state.dossier.glossary.map(String) : []}
                theme={s}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GenerationDashboard;

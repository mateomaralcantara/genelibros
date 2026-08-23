// components/dashboardStyles.ts
export type DashboardVariant = "classic" | "current" | "vibrant";

export const dashboardStyles: Record<DashboardVariant, any> = {
  /**
   * Vibrant: colores variados, secciones muy claras, botones “de verdad”.
   * (Pensado para que se lea bien y no parezca una cueva neón.)
   */
  vibrant: {
    page: "p-6 h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950",
    container: "max-w-6xl mx-auto space-y-8 pb-24",

    headerCard:
      "bg-gradient-to-br from-slate-900/70 via-slate-900/50 to-slate-950/30 rounded-3xl p-8 border border-white/10 flex flex-col gap-6 shadow-2xl relative overflow-hidden backdrop-blur",
    headerGlow:
      "absolute -top-24 -right-24 w-[520px] h-[520px] bg-gradient-to-br from-fuchsia-500/15 via-sky-500/10 to-emerald-500/10 rounded-full blur-3xl",

    /* ---------- tabs (Blueprint / Dossier / etc.) ---------- */
    tabsWrap:
      "flex flex-wrap gap-2 border border-white/10 bg-slate-950/30 rounded-2xl p-2 backdrop-blur",
    tabBtn:
      "px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition-all rounded-xl border flex items-center gap-2",
    tabActive:
      "text-white bg-white/5 border-white/15 shadow-lg shadow-black/30",
    tabIdle:
      "text-slate-300/70 border-transparent hover:text-white hover:bg-white/5",

    /* ---------- barra de acciones (Auto / Generar / Ver) ---------- */
    actionBar: "flex flex-wrap items-center gap-3",
    btnPrimary:
      "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black tracking-wide text-sm bg-gradient-to-r from-fuchsia-500 to-sky-500 text-white shadow-xl shadow-fuchsia-500/10 hover:shadow-fuchsia-500/20 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed",
    btnSecondary:
      "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black tracking-wide text-sm bg-gradient-to-r from-emerald-500 to-lime-500 text-slate-950 shadow-xl shadow-emerald-500/10 hover:shadow-emerald-500/20 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed",
    btnGhost:
      "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black tracking-wide text-sm bg-slate-950/40 border border-white/10 text-slate-200 hover:bg-slate-950/60 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed",

    /* ---------- tarjetas: propuesta/intro (SectionCard) ---------- */
    sectionCard:
      "bg-slate-950/25 backdrop-blur p-5 rounded-2xl border border-white/10 flex items-center justify-between transition-all hover:bg-slate-950/35 hover:border-white/15",
    sectionCardActive:
      "data-[gen=true]:shadow-lg data-[gen=true]:shadow-black/30",
    sectionBtn:
      "p-3 rounded-2xl transition-all disabled:opacity-30 bg-slate-950/35 hover:bg-slate-950/55 border border-white/10",
    sectionBtnState:
      "data-[done=true]:text-emerald-300 data-[done=true]:bg-emerald-500/10 text-slate-100",

    /* ---------- capítulos ---------- */
    chapterRow:
      "bg-slate-950/25 backdrop-blur border rounded-2xl p-5 flex flex-col md:flex-row justify-between gap-4 transition-all hover:bg-slate-950/35",
    chapterRowActive: "ring-1 ring-white/15 border-white/15",
    chapterRowIdle: "border-white/10",
    chip: "text-[9px] bg-slate-950/35 px-2 py-0.5 rounded border border-white/10 text-slate-300/80",

    /* ---------- dossier ---------- */
    dossierItem:
      "bg-slate-950/25 backdrop-blur border border-white/10 p-6 rounded-2xl space-y-4 shadow-lg hover:bg-slate-950/35 transition-colors",
    dossierTitle:
      "text-[10px] font-black uppercase text-slate-200 tracking-[0.28em] flex items-center gap-2",
    dossierBullet: "text-slate-300 mt-1 shrink-0",

    /* ---------- métricas ---------- */
    metricCard:
      "bg-slate-950/25 backdrop-blur px-5 py-5 rounded-2xl border border-white/10 flex flex-col justify-between",
    metricLabel: "text-[10px] text-slate-300/70 uppercase font-black tracking-[0.28em] mb-1",
    metricValue: "text-3xl font-mono text-white font-black",
    monitorCard:
      "bg-slate-950/25 backdrop-blur px-5 py-5 rounded-2xl border border-white/10 md:col-span-2",

    /* ---------- glosario ---------- */
    glossaryWrap:
      "md:col-span-2 bg-slate-950/25 backdrop-blur p-6 rounded-2xl border border-white/10 shadow-xl",
    glossaryCard:
      "bg-slate-950/20 p-4 rounded-xl border border-white/10 hover:border-white/15 transition-colors",
  },

  /**
   * Current: tu look indigo/neón (mejorado), pero mantenido.
   */
  current: {
    page: "p-6 h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950",
    container: "max-w-6xl mx-auto space-y-8 pb-20",
    headerCard:
      "bg-gradient-to-br from-slate-800/80 to-slate-900/70 rounded-3xl p-8 border border-slate-700/40 flex flex-col gap-6 shadow-2xl relative overflow-hidden backdrop-blur",
    headerGlow:
      "absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full -mr-48 -mt-48 blur-3xl",

    tabsWrap: "flex gap-2 border-b border-slate-800 pb-0 px-2",
    tabBtn: "px-6 py-3 text-xs font-black uppercase tracking-widest transition-all",
    tabActive: "text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5",
    tabIdle: "text-slate-500 hover:text-slate-300",

    actionBar: "flex flex-wrap items-center gap-3",
    btnPrimary:
      "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black tracking-wide text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow-2xl shadow-indigo-600/30 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed",
    btnSecondary:
      "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black tracking-wide text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-2xl shadow-emerald-500/20 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed",
    btnGhost:
      "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-black tracking-wide text-sm bg-slate-950/40 border border-slate-700/30 text-slate-200 hover:bg-slate-950/60 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed",

    /* --------- tarjetas: propuesta/intro (SectionCard) --------- */
    sectionCard:
      "bg-slate-900/40 backdrop-blur p-5 rounded-2xl border border-slate-700/30 flex items-center justify-between transition-all hover:bg-slate-900/55 hover:border-slate-600/40",
    sectionCardActive:
      "data-[gen=true]:border-indigo-500 data-[gen=true]:shadow-indigo-500/20 data-[gen=true]:shadow-lg",
    sectionBtn: "p-2.5 rounded-xl transition-all disabled:opacity-30 bg-slate-950/40 hover:bg-slate-950/60",
    sectionBtnState:
      "text-indigo-400 hover:bg-indigo-500/10 data-[done=true]:text-green-500 data-[done=true]:bg-green-500/10",

    /* ------------------- dossier ------------------- */
    dossierItem:
      "bg-slate-900/35 backdrop-blur border border-slate-700/30 p-6 rounded-2xl space-y-4 shadow-lg hover:bg-slate-900/45 transition-colors",
    dossierTitle:
      "text-xs font-black uppercase text-indigo-300 tracking-widest flex items-center gap-2",
    dossierBullet: "text-indigo-400 mt-1 shrink-0",

    /* ------------------- capítulos ------------------- */
    chapterRow:
      "bg-slate-900/35 backdrop-blur border rounded-2xl p-5 flex flex-col md:flex-row justify-between gap-4 transition-all hover:bg-slate-900/50",
    chapterRowActive: "border-indigo-500 ring-1 ring-indigo-500/20",
    chapterRowIdle: "border-slate-700/30",
    chip: "text-[9px] bg-slate-950/30 px-2 py-0.5 rounded border border-slate-700/30 text-slate-400",

    /* ------------------- métricas ------------------- */
    metricCard:
      "bg-slate-950/35 backdrop-blur px-5 py-5 rounded-2xl border border-slate-700/30 flex flex-col justify-between",
    metricLabel: "text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1",
    metricValue: "text-3xl font-mono text-indigo-300 font-black",
    monitorCard:
      "bg-slate-950/35 backdrop-blur px-5 py-5 rounded-2xl border border-slate-700/30 md:col-span-2",

    /* ------------------- glosario ------------------- */
    glossaryWrap:
      "md:col-span-2 bg-slate-900/35 backdrop-blur p-6 rounded-2xl border border-slate-700/30 shadow-xl",
    glossaryCard:
      "bg-slate-950/20 p-4 rounded-xl border border-slate-700/20 hover:border-slate-600 transition-colors",
  },

  // Classic: más plano, menos glow, sin matar estructura.
  classic: {
    page: "p-6 h-full overflow-y-auto bg-slate-900",
    container: "max-w-5xl mx-auto space-y-6 pb-16",
    headerCard:
      "bg-slate-800 rounded-2xl p-6 border border-slate-700 flex flex-col gap-4 shadow-lg relative overflow-hidden",
    headerGlow: "hidden",

    tabsWrap: "flex gap-2 border-b border-slate-700 pb-0 px-0",
    tabBtn: "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all rounded-lg",
    tabActive: "text-slate-100 bg-slate-700",
    tabIdle: "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40",

    actionBar: "flex flex-wrap items-center gap-3",
    btnPrimary:
      "inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed",
    btnSecondary:
      "inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition disabled:opacity-40 disabled:cursor-not-allowed",
    btnGhost:
      "inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700 transition disabled:opacity-40 disabled:cursor-not-allowed",

    sectionCard:
      "bg-slate-800 p-5 rounded-2xl border border-slate-700 flex items-center justify-between transition-all hover:bg-slate-800/80 hover:border-slate-600",
    sectionCardActive: "data-[gen=true]:border-slate-500",
    sectionBtn: "p-2.5 rounded-xl transition-all disabled:opacity-30 bg-slate-700 hover:bg-slate-600",
    sectionBtnState:
      "text-slate-100 hover:bg-slate-600 data-[done=true]:text-green-400 data-[done=true]:bg-green-500/10",

    dossierItem:
      "bg-slate-800 border border-slate-700 p-6 rounded-2xl space-y-4 shadow-lg hover:bg-slate-800/80 transition-colors",
    dossierTitle:
      "text-xs font-black uppercase text-slate-200 tracking-widest flex items-center gap-2",
    dossierBullet: "text-slate-300 mt-1 shrink-0",

    chapterRow:
      "bg-slate-800 border rounded-2xl p-5 flex flex-col md:flex-row justify-between gap-4 transition-all hover:bg-slate-800/80",
    chapterRowActive: "border-slate-500",
    chapterRowIdle: "border-slate-700",
    chip: "text-[9px] bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700/60 text-slate-300",

    metricCard:
      "bg-slate-800 px-5 py-5 rounded-2xl border border-slate-700 flex flex-col justify-between",
    metricLabel: "text-[10px] text-slate-300 uppercase font-black tracking-widest mb-1",
    metricValue: "text-3xl font-mono text-slate-100 font-black",
    monitorCard: "bg-slate-800 px-5 py-5 rounded-2xl border border-slate-700 md:col-span-2",

    glossaryWrap: "md:col-span-2 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl",
    glossaryCard: "bg-slate-900/60 p-4 rounded-xl border border-slate-700 hover:border-slate-500 transition-colors",
  },
};

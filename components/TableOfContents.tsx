import React, { useMemo } from 'react';
import type { Project } from '../types';
import { countWords } from '../utils/helpers';
import { FileTextIcon, PlusCircleIcon, SaveIcon, CheckCircleIcon, CircleIcon, RocketIcon } from './Icons';

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onSave: () => void;
  onCreateNew: () => void;
  onDeleteProject?: (id: string) => void;
  isLoading: boolean;
}

function getMasterTextForCount(p: Project): string {
  const md: any = (p as any)?.master_document ?? {};
  const direct = typeof md?.text === 'string' ? md.text.trim() : '';
  if (direct) return direct;

  const chunks = Array.isArray(md?.chunks) ? md.chunks : [];
  if (!chunks.length) return '';

  return chunks
    .slice()
    .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0))
    .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
    .join('')
    .trim();
}

function normalizeProgressKeyFromMenuItem(item: any): string {
  const rawId = String(item?.id ?? '').trim();
  const id = rawId.toLowerCase();
  const label = String(item?.label ?? '').toLowerCase();

  // proposal
  if (id.includes('proposal') || label.includes('propuesta')) return 'proposal';

  // intro
  if (id.includes('intro') || id.includes('introduction') || label.includes('introdu')) return 'intro';

  // chapter numbers: from id or label
  const numMatch = rawId.match(/(\d{1,2})/) || String(item?.label ?? '').match(/(\d{1,2})/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return `chap-${n}`;
  }

  // if already like chap-3
  if (id.startsWith('chap-')) return rawId;

  return rawId || '';
}

function buildFallbackMenuItemsFromState(project: Project): Array<{ id: string; label: string }> {
  const st: any = (project as any)?.state ?? {};
  const outline = Array.isArray(st?.outline_12) ? st.outline_12 : [];
  const chapters = Array.isArray(st?.chapters) ? st.chapters : [];

  const chaptersItems = (outline.length ? outline : chapters).map((o: any, idx: number) => {
    const n = Number(o?.chapter_number ?? (idx + 1)) || (idx + 1);
    const title = String(o?.chapter_title ?? o?.title ?? `Capítulo ${n}`).trim();
    // Mantén label legible sin duplicar "Capítulo"
    const label = title.toLowerCase().startsWith('capítulo') ? title : `Capítulo ${n}: ${title}`;
    return { id: `chap-${n}`, label };
  });

  return [
    { id: 'proposal', label: 'Propuesta editorial' },
    { id: 'intro', label: 'Introducción' },
    ...chaptersItems,
  ];
}

const TableOfContents: React.FC<SidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onSave,
  onCreateNew,
  onDeleteProject,
  isLoading,
}) => {
  const safeProjects = Array.isArray(projects) ? projects : [];

  const activeProject = useMemo(
    () => safeProjects.find((p) => p.id === activeProjectId) ?? null,
    [safeProjects, activeProjectId]
  );

  // Optimización: calcula palabras una sola vez por render de lista
  const wordsByProjectId = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of safeProjects) {
      m.set(p.id, countWords(getMasterTextForCount(p)));
    }
    return m;
  }, [safeProjects]);

  const activeMenuItems = useMemo(() => {
    if (!activeProject) return [];

    const dash: any = (activeProject as any)?.dashboard ?? null;
    const dashItems = Array.isArray(dash?.menu_items) ? dash.menu_items : [];

    // Fix: si no hay menu_items, construimos el menú desde el state (outline_12)
    if (dashItems.length) return dashItems;

    return buildFallbackMenuItemsFromState(activeProject);
  }, [activeProject]);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="space-y-2">
        <button
          onClick={onCreateNew}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-xs uppercase tracking-widest transition-colors shadow-lg shadow-indigo-600/20"
        >
          <PlusCircleIcon className="w-4 h-4" /> Crear Nuevo Libro
        </button>

        <button
          onClick={onSave}
          className="w-full flex items-center justify-center gap-2 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold text-xs transition-colors"
        >
          <SaveIcon className="w-4 h-4" /> Guardar Estado
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 pr-2">
        <section>
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">
            Biblioteca Editorial
          </h3>

          <div className="space-y-1">
            {safeProjects.map((p) => {
              const totalWords = wordsByProjectId.get(p.id) ?? 0;

              return (
                <div
                  key={p.id}
                  className={`w-full flex items-stretch gap-2 p-3 rounded-xl transition-all ${
                    p.id === activeProjectId
                      ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/30'
                      : 'hover:bg-slate-700/50 text-slate-400'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectProject(p.id)}
                    className="flex-1 min-w-0 flex flex-col items-start gap-1 text-left"
                  >
                    <div className="flex items-center gap-3 w-full">
                      <FileTextIcon className="w-4 h-4 shrink-0" />
                      <span className="truncate flex-1 text-left font-bold text-sm">{p.title}</span>
                    </div>

                    <div className="flex items-center gap-2 ml-7">
                      <span className="text-[10px] opacity-60 font-mono">{totalWords.toLocaleString()} palabras</span>
                    </div>
                  </button>

                  {onDeleteProject && (
                    <button
                      type="button"
                      onClick={() => onDeleteProject(p.id)}
                      className="shrink-0 px-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-red-500/10 border border-red-500/20 text-red-200 hover:bg-red-500/15"
                      title="Borrar este libro"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {activeProject && activeMenuItems.length > 0 && (
          <section className="border-t border-slate-700 pt-4">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">
              Estructura Activa
            </h3>

            <div className="space-y-0.5">
              {activeMenuItems.map((item: any, idx: number) => {
                const key = normalizeProgressKeyFromMenuItem(item) || `item-${idx}`;
                const status = (((activeProject as any).generation_progress?.[key] ?? 'pending') as
                  | 'pending'
                  | 'generating'
                  | 'completed'
                  | 'error');

                const safeKey = String(item?.id ?? key ?? idx);
                const label = String(item?.label ?? item?.title ?? key).trim();

                return (
                  <div
                    key={safeKey}
                    className="flex items-center gap-3 p-2 rounded-lg text-[11px] text-slate-300 hover:bg-slate-700/30 transition-colors"
                  >
                    <div className="shrink-0">
                      {status === 'completed' ? (
                        <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
                      ) : status === 'generating' ? (
                        <RocketIcon className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                      ) : status === 'error' ? (
                        <CircleIcon className="w-3.5 h-3.5 text-red-400" />
                      ) : (
                        <CircleIcon className="w-3.5 h-3.5 text-slate-600" />
                      )}
                    </div>

                    <span
                      className={`truncate ${
                        status === 'generating'
                          ? 'text-slate-400'
                          : status === 'error'
                            ? 'text-red-300'
                            : status === 'completed'
                              ? 'text-slate-100 font-medium'
                              : 'text-slate-200'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50 text-[10px] text-slate-500">
        <p className="flex items-center gap-2">
          <RocketIcon className="w-3 h-3 text-indigo-500" /> Engine: V3-Dossier
        </p>
        <p className="mt-1">Modo: Arquitectura Modular</p>
        {isLoading && <p className="mt-2 text-indigo-400">Generando…</p>}
      </div>
    </div>
  );
};

export default TableOfContents;

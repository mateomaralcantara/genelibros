import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Project } from '../types';
import { generatePdf, generateDocx } from '../utils/download';
import { countWords } from '../utils/helpers';
import { FileDownIcon } from './Icons';

type EditSectionPayload =
  | { kind: 'proposal'; text: string }
  | { kind: 'intro'; text: string }
  | { kind: 'chapter'; chapterNumber: number; title?: string; text: string };

interface BookViewerProps {
  project: Project;
  onEditSection?: (payload: EditSectionPayload) => void;
}

type TocItem = {
  id: string;
  level: number;
  title: string;
};

type SectionOption = {
  key: string;
  label: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type ReaderTheme = 'paper' | 'sepia' | 'night';
type FontScale = 'sm' | 'md' | 'lg';

const READER_THEME_KEY = 'READER_THEME';
const READER_FONT_KEY = 'READER_FONT';
const LONG_TEXT_THRESHOLD = 220_000;

type ReaderThemeStyle = {
  shell: string;
  sidebar: string;
  sidebarHeader: string;
  header: string;
  progressTrack: string;
  progressFill: string;
  contentBg: string;
  article: string;
  prose: string;
  proseExtras: string;
  mark: string;
  selection: string;
};

const readerThemeStyles: Record<ReaderTheme, ReaderThemeStyle> = {
  paper: {
    shell: 'bg-slate-900',
    sidebar: 'border-slate-700 bg-slate-900/60',
    sidebarHeader: 'border-slate-700 bg-slate-800/60',
    header: 'bg-slate-900/70 backdrop-blur border-slate-700',
    progressTrack: 'bg-slate-800',
    progressFill: 'bg-indigo-500',
    contentBg: 'bg-slate-950/80',
    article: 'bg-white text-slate-900 border-slate-200',
    prose: 'prose-slate',
    proseExtras: 'prose-h2:border-slate-200 prose-a:text-inherit prose-a:no-underline',
    mark: 'bg-yellow-200/80 text-slate-900 px-0.5 rounded-sm',
    selection: 'selection:bg-indigo-100',
  },
  sepia: {
    shell: 'bg-slate-900',
    sidebar: 'border-slate-700 bg-slate-900/60',
    sidebarHeader: 'border-slate-700 bg-slate-800/60',
    header: 'bg-slate-900/70 backdrop-blur border-slate-700',
    progressTrack: 'bg-slate-800',
    progressFill: 'bg-indigo-500',
    contentBg: 'bg-slate-950/80',
    article: 'bg-[#fbf3e6] text-[#2a2017] border-amber-200/70',
    prose: 'prose-stone',
    proseExtras: 'prose-h2:border-amber-200/70 prose-a:text-inherit prose-a:no-underline',
    mark: 'bg-amber-200/90 text-[#2a2017] px-0.5 rounded-sm',
    selection: 'selection:bg-amber-200',
  },
  night: {
    shell: 'bg-slate-950',
    sidebar: 'border-slate-800 bg-slate-950/70',
    sidebarHeader: 'border-slate-800 bg-slate-950/60',
    header: 'bg-slate-950/70 backdrop-blur border-slate-800',
    progressTrack: 'bg-slate-900',
    progressFill: 'bg-indigo-400',
    contentBg: 'bg-transparent', // ✅ porque el fondo real es el del App
    article: 'bg-slate-900 text-slate-100 border-slate-800',
    prose: 'prose-invert prose-slate text-slate-100',
    proseExtras: 'prose-h2:border-slate-700 prose-a:text-inherit prose-a:no-underline prose-strong:text-inherit',
    mark: 'bg-yellow-500/20 text-yellow-100 px-0.5 rounded-sm',
    selection: 'selection:bg-indigo-500/30',
  },
};

const fontScaleStyles: Record<FontScale, string> = {
  sm: 'prose-p:text-base prose-li:text-base prose-h1:text-3xl prose-h2:text-xl',
  md: 'prose-p:text-lg prose-li:text-lg prose-h1:text-4xl prose-h2:text-2xl',
  lg: 'prose-p:text-xl prose-li:text-xl prose-h1:text-5xl prose-h2:text-3xl',
};

/** ---------- utils defensivos ---------- */
function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function arr<T>(v: unknown, fallback: T[] = []): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}
function toInt(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'section'
  );
}

function extractToc(markdown: string): TocItem[] {
  const lines = (markdown ?? '').split('\n');
  const counts = new Map<string, number>();
  const out: TocItem[] = [];

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;

    const level = m[1].length;
    const title = m[2].replace(/\s+#*\s*$/, '').trim();
    if (!title) continue;

    const base = slugify(title);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);

    out.push({ id: n === 1 ? base : `${base}-${n}`, level, title });
  }

  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  const h = (haystack ?? '').toLowerCase();
  const n = (needle ?? '').toLowerCase().trim();
  if (!n) return 0;

  let count = 0;
  let idx = 0;
  while (true) {
    idx = h.indexOf(n, idx);
    if (idx === -1) break;
    count++;
    idx += n.length;
  }
  return count;
}

function reconstructFromChunks(chunks: any[]): string {
  if (!Array.isArray(chunks) || !chunks.length) return '';
  return chunks
    .slice()
    .sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
    .map((c) => s(c?.text, ''))
    .join('\n');
}

function getMasterText(project: Project): string {
  const md: any = (project as any)?.master_document ?? {};
  const direct = s(md?.text, '').trim();
  if (direct) return direct;

  const fromChunks = reconstructFromChunks(arr<any>(md?.chunks, [])).trim();
  if (fromChunks) return fromChunks;

  return '';
}

function getChapterNumber(ch: any, idx: number): number {
  const raw = ch?.chapter_number ?? ch?.chapterNumber ?? ch?.number ?? idx + 1;
  const n = toInt(raw, idx + 1);
  return n > 0 ? n : idx + 1;
}

/** ---------- highlighting ---------- */
function highlightString(text: string, query: string, markClass: string): React.ReactNode[] {
  const q = query.trim();
  if (!q) return [text];

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const out: React.ReactNode[] = [];

  let i = 0;
  let hitIndex = 0;

  while (i < text.length) {
    const idx = lower.indexOf(qLower, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }

    if (idx > i) out.push(text.slice(i, idx));

    out.push(
      <mark key={`hit-${idx}-${hitIndex++}`} data-hit="1" className={markClass}>
        {text.slice(idx, idx + q.length)}
      </mark>
    );

    i = idx + q.length;
  }

  return out;
}

function highlightChildren(children: React.ReactNode, query: string, markClass: string, skip = false): React.ReactNode {
  if (skip) return children;

  return React.Children.map(children, (child) => {
    if (typeof child === 'string') return highlightString(child, query, markClass);
    if (typeof child === 'number') return highlightString(String(child), query, markClass);

    if (!React.isValidElement(child)) return child;

    // Evita resaltar dentro de code/pre
    const t = child.type as any;
    const isCodeLike = t === 'code' || t === 'pre';

    const nextChildren = highlightChildren(
      (child.props as any)?.children as React.ReactNode,
      query,
      markClass,
      isCodeLike
    );

    return React.cloneElement(child as React.ReactElement<any>, undefined, nextChildren);
  });
}

/** ---------- clave: reconstruir “expediente completo” desde state ---------- */
function buildFullDossierMarkdown(project: Project): string {
  const st: any = project?.state ?? {};

  const title = s(project?.title, s(st.book_title, 'Documento maestro')).trim();
  const topic = s(st.book_topic, '').trim();
  const audience = s(st.audience, '').trim();
  const tone = s(st.tone_style, '').trim();

  const parts: string[] = [];
  parts.push(`# ${title}\n`);

  const metaLines: string[] = [];
  if (topic) metaLines.push(`**Tema:** ${topic}`);
  if (audience) metaLines.push(`**Audiencia:** ${audience}`);
  if (tone) metaLines.push(`**Tono/estilo:** ${tone}`);
  if (metaLines.length) parts.push(metaLines.join('\n\n'));

  const proposal = s(st?.proposal?.text, '').trim();
  if (proposal) parts.push(`## Propuesta editorial\n\n${proposal}`);

  const intro = s(st?.introduction?.text, '').trim();
  if (intro) parts.push(`## Introducción\n\n${intro}`);

  const outline = arr<any>(st?.outline_12, [])
    .slice()
    .sort((a, b) => toInt(a?.chapter_number ?? a?.chapterNumber, 0) - toInt(b?.chapter_number ?? b?.chapterNumber, 0));

  if (outline.length) {
    const outlineParts: string[] = [];
    outlineParts.push(`## Arquitectura editorial (Outline)\n`);

    for (const o of outline) {
      const n = toInt(o?.chapter_number ?? o?.chapterNumber, 0);
      const t = s(o?.chapter_title, s(o?.title, n ? `Capítulo ${n}` : 'Capítulo')).trim();
      outlineParts.push(`### ${t}`);

      const objective = s(o?.objective, '').trim();
      if (objective) outlineParts.push(`**Objetivo:** ${objective}`);

      const keyPoints = arr<string>(o?.key_points, []).filter(Boolean);
      if (keyPoints.length) outlineParts.push(`**Puntos clave:**\n\n${keyPoints.map((x) => `- ${x}`).join('\n')}`);

      const subheads = arr<string>(o?.subheads_h2, []).filter(Boolean);
      if (subheads.length) outlineParts.push(`**Subtítulos (H2):**\n\n${subheads.map((x) => `- ${x}`).join('\n')}`);

      const tools = arr<string>(o?.tools_frameworks, []).filter(Boolean);
      if (tools.length) outlineParts.push(`**Herramientas / Frameworks:**\n\n${tools.map((x) => `- ${x}`).join('\n')}`);

      const exercises = arr<string>(o?.exercises, []).filter(Boolean);
      if (exercises.length) outlineParts.push(`**Ejercicios:**\n\n${exercises.map((x) => `- ${x}`).join('\n')}`);

      const deliverable = s(o?.deliverable, '').trim();
      if (deliverable) outlineParts.push(`**Entregable:** ${deliverable}`);

      const transition = s(o?.transition_to_next, '').trim();
      if (transition) outlineParts.push(`**Transición al siguiente:** ${transition}`);
    }

    parts.push(outlineParts.join('\n\n'));
  }

  const chaptersNorm = arr<any>(st?.chapters, [])
    .slice()
    .map((c, idx) => ({ c, n: getChapterNumber(c, idx) }))
    .filter(({ c }) => s(c?.text, '').trim())
    .sort((a, b) => a.n - b.n);

  if (chaptersNorm.length) {
    for (const { c, n } of chaptersNorm) {
      const text = s(c?.text, '').trim();
      if (!text) continue;
      const chTitle = s(c?.title, s(c?.chapter_title, n ? `Capítulo ${n}` : 'Capítulo')).trim();
      parts.push(`## ${chTitle}\n\n${text}`);
    }
  }

  return parts.join('\n\n---\n\n').trim() + '\n';
}

type SplitSection = {
  title: string;
  markdown: string;
};

function splitMarkdownByH2(markdown: string): SplitSection[] {
  const lines = (markdown ?? '').split('\n');
  const sections: SplitSection[] = [];

  let currentTitle = '';
  let currentLines: string[] = [];
  let startedH2 = false;

  const pushCurrent = () => {
    const md = currentLines.join('\n').trim();
    if (md) sections.push({ title: currentTitle || 'Sección', markdown: md + '\n' });
  };

  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (startedH2) {
        pushCurrent();
      } else {
        const pre = currentLines.join('\n').trim();
        if (pre) sections.push({ title: 'Inicio', markdown: pre + '\n' });
      }

      startedH2 = true;
      currentTitle = (m[1] ?? '').trim() || 'Sección';
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }

  if (startedH2 || currentLines.length) pushCurrent();

  if (sections.length === 1 && sections[0].title === 'Sección') return [];
  return sections;
}

function buildSectionMarkdown(project: Project, key: string, fullText: string, autoH2Sections: SplitSection[]): string {
  const st: any = project?.state ?? {};
  const title = s(project?.title, s(st.book_title, 'Documento maestro')).trim();

  if (key === 'FULL') return fullText;

  if (key === 'PROPOSAL') {
    const proposal = s(st?.proposal?.text, '').trim();
    return proposal ? `# ${title}\n\n## Propuesta editorial\n\n${proposal}\n` : '';
  }

  if (key === 'INTRO') {
    const intro = s(st?.introduction?.text, '').trim();
    return intro ? `# ${title}\n\n## Introducción\n\n${intro}\n` : '';
  }

  if (key === 'OUTLINE') {
    const outline = arr<any>(st?.outline_12, [])
      .slice()
      .sort((a, b) => toInt(a?.chapter_number ?? a?.chapterNumber, 0) - toInt(b?.chapter_number ?? b?.chapterNumber, 0));

    if (!outline.length) return '';
    const parts: string[] = [];
    parts.push(`# ${title}\n`);
    parts.push(`## Arquitectura editorial (Outline)\n`);
    for (const o of outline) {
      const n = toInt(o?.chapter_number ?? o?.chapterNumber, 0);
      const t = s(o?.chapter_title, s(o?.title, n ? `Capítulo ${n}` : 'Capítulo')).trim();
      parts.push(`### ${t}`);

      const objective = s(o?.objective, '').trim();
      if (objective) parts.push(`**Objetivo:** ${objective}`);

      const keyPoints = arr<string>(o?.key_points, []).filter(Boolean);
      if (keyPoints.length) parts.push(`**Puntos clave:**\n\n${keyPoints.map((x) => `- ${x}`).join('\n')}`);
    }
    return parts.join('\n\n').trim() + '\n';
  }

  if (key.startsWith('CHAPTER:')) {
    const n = toInt(key.split(':')[1], 0);

    const chaptersNorm = arr<any>(st?.chapters, [])
      .slice()
      .map((c, idx) => ({ c, cn: getChapterNumber(c, idx) }))
      .filter(({ c }) => s(c?.text, '').trim())
      .sort((a, b) => a.cn - b.cn);

    const found = chaptersNorm.find((x) => x.cn === n)?.c;
    const text = s(found?.text, '').trim();
    const chTitle = s(found?.title, s(found?.chapter_title, n ? `Capítulo ${n}` : 'Capítulo')).trim();

    if (!text) {
      const idx = autoH2Sections.findIndex((sec) => {
        const t = sec.title.toLowerCase();
        return /cap[ií]tulo/.test(t) && t.includes(String(n));
      });
      if (idx >= 0) return autoH2Sections[idx].markdown;
      return '';
    }

    return `# ${title}\n\n## ${chTitle}\n\n${text}\n`;
  }

  if (key.startsWith('H2:')) {
    const idx = toInt(key.split(':')[1], -1);
    if (Number.isFinite(idx) && idx >= 0 && idx < autoH2Sections.length) return autoH2Sections[idx].markdown;
    return '';
  }

  return '';
}

const BookViewer: React.FC<BookViewerProps> = ({ project, onEditSection }) => {
  // Texto “final” = expediente reconstruido vs master_document (elige el más completo)
  const fullText = useMemo(() => {
    const master = getMasterText(project).trim();
    const dossier = buildFullDossierMarkdown(project).trim();

    if (!master) return dossier;
    if (!dossier) return master;

    return dossier.length >= master.length ? dossier : master;
  }, [project]);

  // Auto-splitting por H2 (fallback cuando no hay capítulos en state)
  const autoH2Sections = useMemo(() => splitMarkdownByH2(fullText), [fullText]);

  const chapterOptionsFromState = useMemo(() => {
    const st: any = project?.state ?? {};

    const normalized = arr<any>(st?.chapters, [])
      .slice()
      .map((c, idx) => ({ c, n: getChapterNumber(c, idx) }))
      .filter(({ c }) => s(c?.text, '').trim())
      .sort((a, b) => a.n - b.n);

    const seen = new Set<number>();
    const out: SectionOption[] = [];
    for (const { c, n } of normalized) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({
        key: `CHAPTER:${n}`,
        label: s(c?.title, s(c?.chapter_title, `Capítulo ${n}`)).trim() || `Capítulo ${n}`,
      });
    }
    return out;
  }, [project]);

  const baseSectionOptions = useMemo<SectionOption[]>(() => {
    const st: any = project?.state ?? {};

    const out: SectionOption[] = [{ key: 'FULL', label: 'Libro completo' }];

    const proposal = s(st?.proposal?.text, '').trim();
    const intro = s(st?.introduction?.text, '').trim();
    const outline = arr<any>(st?.outline_12, []).length > 0;

    if (proposal) out.push({ key: 'PROPOSAL', label: 'Propuesta editorial' });
    if (intro) out.push({ key: 'INTRO', label: 'Introducción' });
    if (outline) out.push({ key: 'OUTLINE', label: 'Arquitectura (Outline)' });

    // Prioridad: capítulos en state; si no hay, secciones por H2 del texto completo
    if (chapterOptionsFromState.length) {
      out.push(...chapterOptionsFromState);
    } else if (autoH2Sections.length) {
      autoH2Sections.slice(0, 80).forEach((sec, idx) => {
        out.push({ key: `H2:${idx}`, label: sec.title });
      });
    }

    return out;
  }, [project, chapterOptionsFromState, autoH2Sections]);

  const [sectionKey, setSectionKey] = useState<string>('FULL');

  const editable = useMemo(() => {
    const st: any = project?.state ?? {};

    if (sectionKey === 'PROPOSAL') {
      return { kind: 'proposal' as const, text: s(st?.proposal?.text, '') };
    }

    if (sectionKey === 'INTRO') {
      return { kind: 'intro' as const, text: s(st?.introduction?.text, '') };
    }

    if (sectionKey.startsWith('CHAPTER:')) {
      const n = Number.parseInt(sectionKey.split(':')[1] || '0', 10);
      const ch = arr<any>(st?.chapters, []).find((c: any) => Number(c?.chapter_number ?? c?.chapterNumber ?? 0) === n);
      return {
        kind: 'chapter' as const,
        chapterNumber: n,
        title: s(ch?.title, s(ch?.chapter_title, `Capítulo ${n}`)).trim() || `Capítulo ${n}`,
        text: s(ch?.text, ''),
      };
    }

    return null;
  }, [project, sectionKey]);

  const canEdit = Boolean(onEditSection && editable);

  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftTitle, setDraftTitle] = useState('');

  // Cuando cambias de vista / proyecto, cerramos edición y sincronizamos el draft.
  useEffect(() => {
    setIsEditing(false);
    setDraftText((editable as any)?.text ?? '');
    setDraftTitle((editable as any)?.title ?? '');
  }, [project?.id, sectionKey, editable]);

  const startEdit = useCallback(() => {
    if (!editable) return;
    setDraftText((editable as any)?.text ?? '');
    setDraftTitle((editable as any)?.title ?? '');
    setIsEditing(true);
  }, [editable]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraftText((editable as any)?.text ?? '');
    setDraftTitle((editable as any)?.title ?? '');
  }, [editable]);

  const saveEdit = useCallback(() => {
    if (!onEditSection || !editable) return;

    if ((editable as any).kind === 'chapter') {
      onEditSection({
        kind: 'chapter',
        chapterNumber: (editable as any).chapterNumber,
        title: draftTitle,
        text: draftText,
      });
    } else {
      onEditSection({
        kind: (editable as any).kind,
        text: draftText,
      } as any);
    }

    setIsEditing(false);
  }, [onEditSection, editable, draftText, draftTitle]);

  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() =>
    readEnum(READER_THEME_KEY, ['paper', 'sepia', 'night'] as const, 'paper')
  );
  const [fontScale, setFontScale] = useState<FontScale>(() =>
    readEnum(READER_FONT_KEY, ['sm', 'md', 'lg'] as const, 'md')
  );

  useEffect(() => {
    try {
      localStorage.setItem(READER_THEME_KEY, readerTheme);
    } catch {}
  }, [readerTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(READER_FONT_KEY, fontScale);
    } catch {}
  }, [fontScale]);

  const rt = readerThemeStyles[readerTheme] ?? readerThemeStyles.paper;

  // ✅ FIX: no “pisar” la sección del usuario cada vez que cambian opciones o texto.
  // Solo reseteamos si:
  // - Cambia el libro, o
  // - La sección actual ya no existe (key inválida), o
  // - Si el libro es enorme, preferimos auto-abrir el primer capítulo/H2 *solo al entrar*.
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const projectId = (project as any)?.id ? String((project as any).id) : null;
    const projectChanged = prevProjectIdRef.current !== projectId;
    prevProjectIdRef.current = projectId;

    const validKeys = new Set(baseSectionOptions.map((x) => x.key));
    const currentKeyValid = validKeys.has(sectionKey);

    if (!projectChanged && currentKeyValid) return;

    const firstChunk = baseSectionOptions.find((x) => x.key.startsWith('CHAPTER:') || x.key.startsWith('H2:'))?.key;
    if (fullText.length > LONG_TEXT_THRESHOLD && firstChunk) setSectionKey(firstChunk);
    else setSectionKey('FULL');
  }, [project?.id, baseSectionOptions, fullText.length, sectionKey]);

  const displayText = useMemo(() => {
    const md = buildSectionMarkdown(project, sectionKey, fullText, autoH2Sections).trim();
    return md || '';
  }, [project, sectionKey, fullText, autoH2Sections]);

  const wordCount = useMemo(() => countWords(displayText), [displayText]);
  const toc = useMemo(() => extractToc(displayText), [displayText]);

  const [tocOpen, setTocOpen] = useState(true);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  const [hitCursor, setHitCursor] = useState(0);
  const hitsTotal = useMemo(() => countOccurrences(displayText, deferredQuery), [displayText, deferredQuery]);

  useEffect(() => setHitCursor(0), [deferredQuery]);

  useEffect(() => {
    setHitCursor(0);
    setProgress(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [sectionKey]);

  // Scroll tracking (throttle via rAF)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const max = el.scrollHeight - el.clientHeight;
        const p = max <= 0 ? 0 : el.scrollTop / max;
        setProgress(Math.max(0, Math.min(1, p)));
      });
    };

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll as any);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const scrollToId = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const esc = (globalThis as any)?.CSS?.escape ? (CSS as any).escape(id) : id;
    const target = root.querySelector(`#${esc}`);
    if (target && 'scrollIntoView' in target) {
      (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const jumpToHit = useCallback(
    (dir: 1 | -1) => {
      const root = scrollRef.current;
      if (!root) return;

      const hits = Array.from(root.querySelectorAll('mark[data-hit="1"]')) as HTMLElement[];
      if (!hits.length) return;

      let next = hitCursor + dir;
      if (next < 0) next = hits.length - 1;
      if (next >= hits.length) next = 0;

      setHitCursor(next);
      hits[next].scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [hitCursor]
  );

  // Para que PDF/DOCX salga con el texto completo (no la vista)
  const projectForDownload = useMemo(() => {
    return {
      ...project,
      master_document: {
        ...(project as any).master_document,
        text: fullText,
      },
    } as Project;
  }, [project, fullText]);

  const handleDownload = useCallback(
    (format: 'pdf' | 'docx') => {
      if (format === 'pdf') generatePdf(projectForDownload);
      else generateDocx(projectForDownload);
    },
    [projectForDownload]
  );

  const headingCountsRef = useRef<Map<string, number>>(new Map());

  const markClass = rt?.mark ?? readerThemeStyles.paper.mark;

  const mdComponents = useMemo<Components>(() => {
    headingCountsRef.current = new Map();

    const getPlainText = (children: React.ReactNode): string => {
      return React.Children.toArray(children)
        .map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const makeHeading =
      (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      ({ children }: { children?: React.ReactNode }) => {
        const titleRaw = getPlainText(children ?? null);
        const base = slugify(titleRaw || 'section');
        const n = (headingCountsRef.current.get(base) ?? 0) + 1;
        headingCountsRef.current.set(base, n);
        const id = n === 1 ? base : `${base}-${n}`;

        return (
          <Tag id={id} className="scroll-mt-24">
            {highlightChildren(children ?? null, deferredQuery, markClass, false)}
          </Tag>
        );
      };

    return {
      h1: makeHeading('h1'),
      h2: makeHeading('h2'),
      h3: makeHeading('h3'),
      h4: makeHeading('h4'),
      h5: makeHeading('h5'),
      h6: makeHeading('h6'),
      p: ({ children }) => <p>{highlightChildren(children ?? null, deferredQuery, markClass, false)}</p>,
      li: ({ children }) => <li>{highlightChildren(children ?? null, deferredQuery, markClass, false)}</li>,
      blockquote: ({ children }) => <blockquote>{highlightChildren(children ?? null, deferredQuery, markClass, false)}</blockquote>,
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noreferrer">
          {highlightChildren(children ?? null, deferredQuery, markClass, false)}
        </a>
      ),
      code: ({ children }) => <code>{children}</code>,
      pre: ({ children }) => <pre>{children}</pre>,
    };
  }, [deferredQuery, markClass]);

  const jumpOptions = useMemo(() => toc.filter((t) => t.level <= 3).slice(0, 80), [toc]);

  const sectionLabel = useMemo(() => {
    return baseSectionOptions.find((x) => x.key === sectionKey)?.label ?? 'Vista';
  }, [baseSectionOptions, sectionKey]);

  const proseCls = useMemo(
    () =>
      cx(
        'prose max-w-none prose-a:text-inherit prose-a:no-underline prose-strong:text-inherit prose-headings:text-inherit',
        rt?.prose,
        rt?.proseExtras,
        rt?.selection,
        'prose-headings:font-black prose-h2:border-b prose-h2:pb-2 prose-h2:mt-12 prose-p:leading-relaxed',
        fontScaleStyles[fontScale]
      ),
    [rt?.prose, rt?.proseExtras, rt?.selection, fontScale]
  );

  const title = useMemo(
    () => s((project as any)?.title, s((project as any)?.state?.book_title, 'Documento')),
    [project]
  );

  return (
    // FIX CLIPPING: min-h-0/min-w-0 en cadena flex
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-transparent">
      {/* Sidebar TOC */}
      <aside
        className={cx(
          'h-full min-h-0 border-r transition-all overflow-hidden',
          rt?.sidebar,
          tocOpen ? 'w-[320px]' : 'w-0'
        )}
      >
        <div className="h-full min-h-0 flex flex-col">
          <div className={cx('p-4 border-b', rt?.sidebarHeader)}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-black tracking-widest uppercase text-indigo-400">Índice</div>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
              >
                Ocultar
              </button>
            </div>

            <div className="mt-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar en esta vista..."
                className="w-full text-sm px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>{hitsTotal ? `${hitsTotal.toLocaleString()} coincidencias` : 'Sin búsqueda'}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => jumpToHit(-1)}
                    disabled={!hitsTotal}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpToHit(1)}
                    disabled={!hitsTotal}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-[10px] font-black tracking-widest uppercase text-slate-400">Vista</div>
              <select
                value={sectionKey}
                onChange={(e) => setSectionKey(e.target.value)}
                className="mt-1 w-full text-xs px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-600"
                title="Ver completo o por secciones/capítulos"
              >
                {baseSectionOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {fullText.length > LONG_TEXT_THRESHOLD && (
                <div className="mt-2 text-[11px] text-amber-300/90">
                  Tip: para libros largos, rinde mejor “por capítulos”. El render completo puede ponerse pesado.
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {toc.length === 0 ? (
              <div className="text-sm text-slate-400 p-3">
                No detecté encabezados (#, ##, ###) en esta vista. Si tu contenido viene sin headings, el índice queda vacío.
              </div>
            ) : (
              <ul className="space-y-1">
                {toc.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => scrollToId(item.id)}
                      className={cx(
                        'w-full text-left rounded px-2 py-1.5 hover:bg-slate-800/70 transition',
                        item.level === 1 ? 'text-slate-100 font-black' : 'text-slate-200'
                      )}
                      style={{ paddingInlineStart: 8 + Math.max(0, item.level - 1) * 12 }}
                      title={item.title}
                    >
                      <span className="text-sm leading-snug line-clamp-2">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* Progress bar */}
        <div className={cx('h-1', rt?.progressTrack)}>
          <div className={cx('h-1', rt?.progressFill)} style={{ inlineSize: `${Math.round(progress * 100)}%` }} />
        </div>

        <header className={cx('border-b p-4 flex justify-between items-center shadow-lg z-10', rt?.header)}>
          <div className="flex items-center gap-3 min-w-0">
            {!tocOpen && (
              <button
                type="button"
                onClick={() => setTocOpen(true)}
                className="text-xs px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 shrink-0"
              >
                Índice
              </button>
            )}

            <div className="flex flex-col min-w-0">
              <h2 className="text-lg font-bold leading-tight truncate max-w-md text-slate-100">{title}</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] text-indigo-400 font-black tracking-widest uppercase">{sectionLabel}</span>
                <span className="text-[10px] text-slate-500 font-mono">{wordCount.toLocaleString()} palabras</span>
                <span className="text-[10px] text-slate-500 font-mono">{Math.round(progress * 100)}% leído</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <div className="hidden lg:flex items-center gap-1 rounded-xl border border-slate-700/40 bg-slate-950/30 p-1">
              {([
                { k: 'paper' as const, label: 'Papel' },
                { k: 'sepia' as const, label: 'Sepia' },
                { k: 'night' as const, label: 'Noche' },
              ] as const).map((opt) => (
                <button
                  type="button"
                  key={opt.k}
                  onClick={() => setReaderTheme(opt.k)}
                  className={cx(
                    'px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition',
                    readerTheme === opt.k ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-300 hover:bg-slate-800/60'
                  )}
                  title="Cambia el look del lector"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-1 rounded-xl border border-slate-700/40 bg-slate-950/30 p-1">
              {([
                { k: 'sm' as const, label: 'A-' },
                { k: 'md' as const, label: 'A' },
                { k: 'lg' as const, label: 'A+' },
              ] as const).map((opt) => (
                <button
                  type="button"
                  key={opt.k}
                  onClick={() => setFontScale(opt.k)}
                  className={cx(
                    'px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition',
                    fontScale === opt.k ? 'bg-slate-800/70 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                  )}
                  title="Tamaño de letra"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <select
              onChange={(e) => {
                const id = e.target.value;
                if (id) scrollToId(id);
              }}
              className="hidden md:block text-xs px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-600"
              defaultValue=""
              title="Saltar a heading dentro de la vista"
            >
              <option value="" disabled>
                Saltar a...
              </option>
              {jumpOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>

            {canEdit && !isEditing && (
              <button
                type="button"
                onClick={startEdit}
                className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 text-slate-100"
                title="Editar esta sección"
              >
                Editar
              </button>
            )}

            {canEdit && isEditing && (
              <>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 text-white"
                  title="Guardar cambios"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 text-slate-100"
                  title="Cancelar edición"
                >
                  Cancelar
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => handleDownload('pdf')}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all active:scale-95 text-slate-100"
              title="Descarga el libro completo (no solo la vista)"
            >
              <FileDownIcon className="w-4 h-4" /> PDF
            </button>
            <button
              type="button"
              onClick={() => handleDownload('docx')}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all active:scale-95 text-slate-100"
              title="Descarga el libro completo (no solo la vista)"
            >
              <FileDownIcon className="w-4 h-4" /> Word
            </button>
          </div>
        </header>

        <div
          ref={scrollRef}
          className={cx('flex-1 min-h-0 overflow-y-auto p-4 md:p-10 flex justify-center', rt?.contentBg || 'bg-transparent')}
        >
          <article
            className={cx(
              'w-full max-w-[980px] shadow-[0_0_110px_rgba(0,0,0,0.45)] p-8 md:p-16 rounded-2xl min-h-[80vh] border',
              rt?.article
            )}
          >
            {isEditing && canEdit ? (
              <div className="space-y-3">
                {(editable as any)?.kind === 'chapter' && (
                  <div>
                    <div className="text-[10px] font-black tracking-widest uppercase text-slate-400">Título</div>
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className={cx(
                        'mt-1 w-full text-sm px-3 py-2 rounded-lg border focus:outline-none focus:ring-2',
                        readerTheme === 'night'
                          ? 'bg-slate-900 text-slate-100 border-slate-700 focus:ring-indigo-500/40'
                          : readerTheme === 'sepia'
                            ? 'bg-amber-50 text-slate-900 border-amber-200 focus:ring-indigo-500/30'
                            : 'bg-white text-slate-900 border-slate-200 focus:ring-indigo-500/30'
                      )}
                      placeholder="Título del capítulo"
                    />
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-black tracking-widest uppercase text-slate-400">Contenido (Markdown)</div>
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    className={cx(
                      'mt-1 w-full min-h-[60vh] text-sm p-4 rounded-xl border font-mono leading-relaxed focus:outline-none focus:ring-2',
                      readerTheme === 'night'
                        ? 'bg-slate-900 text-slate-100 border-slate-700 focus:ring-indigo-500/40'
                        : readerTheme === 'sepia'
                          ? 'bg-amber-50 text-slate-900 border-amber-200 focus:ring-indigo-500/30'
                          : 'bg-white text-slate-900 border-slate-200 focus:ring-indigo-500/30'
                    )}
                    placeholder="Escribe aquí..."
                  />
                  <div className="mt-2 text-[11px] text-slate-400">
                    Tip: guarda y el Documento Maestro se reconstruye sin borrar el resto del libro.
                  </div>
                </div>
              </div>
            ) : (
              <div className={cx(proseCls, "book-content [&_*]:text-inherit [&_a]:no-underline [&_a]:pointer-events-none")}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {displayText || 'Aún no hay contenido. Genera propuesta / introducción / capítulos.'}
                </ReactMarkdown>
              </div>
            )}

            <div
              className={cx(
                'mt-20 pt-10 border-t text-center',
                readerTheme === 'night'
                  ? 'border-slate-800'
                  : readerTheme === 'sepia'
                    ? 'border-amber-200/70'
                    : 'border-slate-200'
              )}
            >
              <p className="text-slate-400 font-mono text-xs uppercase tracking-[0.35em]">Fin de la vista</p>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
};

export default BookViewer;
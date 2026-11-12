from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 occurrence, found {count}")
    print(f"PASS: {label}")
    return text.replace(old, new, 1)


# ============================================================
# V14.5 — Recover canonical book/chapter titles from original brief
# for projects saved before the V14.4 title-preservation fix.
# ============================================================
editor_path = Path("src/lib/editor.ts")
editor = editor_path.read_text(encoding="utf-8")
marker = "GENELIBROS_V14_5_LEGACY_BRIEF_RECOVERY"

if marker in editor:
    print("V14.5 editor already installed")
else:
    helper_anchor = '''function isBadBookTitle(value: unknown): boolean {'''
    helpers = r'''// GENELIBROS_V14_5_LEGACY_BRIEF_RECOVERY
// Los proyectos creados antes de V14.4 pueden conservar en Supabase títulos
// genéricos o fragmentos del prompt. Recuperamos únicamente metadatos explícitos
// del encargo original; nunca inventamos un título nuevo.
function cleanBriefTitleLine(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}

export function extractBookTitleFromBrief(brief: string): string {
  const lines = String(brief ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const heading = cleanBriefTitleLine(lines[i]);
    if (!/^t[ií]tulo\s+de\s+trabajo\s*[:\-–—]?$/i.test(heading)) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const candidate = cleanBriefTitleLine(lines[j]);
      if (!candidate || candidate === "---") continue;
      if (/^t[ií]tulos?\s+alternativos?/i.test(candidate)) break;
      if (/^(?:subt[ií]tulo|misi[oó]n general|objetivo general)\b/i.test(candidate)) continue;
      return candidate;
    }
  }

  for (const line of lines) {
    const cleaned = cleanBriefTitleLine(line);
    const m = /^(?:t[ií]tulo|nombre\s+del\s+libro)\s*[:\-–—]\s*(.+)$/i.exec(cleaned);
    const candidate = cleanBriefTitleLine(m?.[1] ?? "");
    if (candidate) return candidate;
  }

  return "";
}

function isBadChapterTitle(chapterNumber: number, value: unknown): boolean {
  const n = Number(chapterNumber) || 0;
  const t = cleanBriefTitleLine(value);
  if (!t) return true;

  const compact = t.toLowerCase().replace(/\s+/g, " ").trim();
  if (n > 0 && (
    compact === `capítulo ${n}` ||
    compact === `capitulo ${n}` ||
    compact === `chapter ${n}` ||
    compact === `parte ${n}`
  )) return true;

  if (/^(?:cap[ií]tulo|chapter|parte)\s*\d*\s*[:.\-–—]?$/i.test(t)) return true;
  if (/\b(?:misi[oó]n general|objetivo general|prompt maestro|act[uú]a como)\b/i.test(t)) return true;
  if (/\b(?:produzca|produce|escriba|escribe|crea|crear)\s+un\s+libro\b/i.test(t)) return true;
  if (t.length > 150 && /\b(?:investigaci[oó]n|requisitos?|instrucciones?|formato final)\b/i.test(t)) return true;
  return false;
}

export function extractChapterTitlesFromBrief(brief: string): Map<number, string> {
  const lines = String(brief ?? "").split(/\r?\n/);
  const titles = new Map<number, string>();

  for (let i = 0; i < lines.length; i += 1) {
    const raw = cleanBriefTitleLine(lines[i]);
    if (!raw) continue;

    const inline = /^cap[ií]tulo\s+(\d+)\s*[:.\-–—]\s*(.+)$/i.exec(raw);
    if (inline) {
      const n = Number(inline[1]) || 0;
      const candidate = cleanBriefTitleLine(inline[2]);
      if (n > 0 && candidate && !isBadChapterTitle(n, candidate) && !titles.has(n)) {
        titles.set(n, candidate);
      }
      continue;
    }

    const standalone = /^cap[ií]tulo\s+(\d+)\s*[:.\-–—]?$/i.exec(raw);
    if (!standalone) continue;
    const n = Number(standalone[1]) || 0;
    if (!n || titles.has(n)) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const candidate = cleanBriefTitleLine(lines[j]);
      if (!candidate || candidate === "---") continue;
      if (/^(?:parte\s+[ivxlcdm]+|pr[oó]logo|ep[ií]logo)$/i.test(candidate)) continue;
      if (/^cap[ií]tulo\s+\d+/i.test(candidate)) break;
      if (!isBadChapterTitle(n, candidate)) titles.set(n, candidate);
      break;
    }
  }

  return titles;
}

'''
    editor = replace_once(editor, helper_anchor, helpers + helper_anchor, "insert legacy brief helpers")

    old_bad_book = r'''function isBadBookTitle(value: unknown): boolean {
  const t = String(value ?? "").trim();
  if (!t) return true;
  return /^(libro sin t[ií]tulo|documento maestro|documento|untitled)$/i.test(t);
}'''
    new_bad_book = r'''function isBadBookTitle(value: unknown): boolean {
  const t = cleanBriefTitleLine(value);
  if (!t) return true;
  if (/^(libro sin t[ií]tulo|documento maestro|documento|untitled)$/i.test(t)) return true;
  if (/^(?:misi[oó]n general|objetivo general|prompt maestro)\b/i.test(t)) return true;
  if (/\b(?:produzca|produce|escriba|escribe|crea|crear)\s+un\s+libro\b/i.test(t)) return true;
  if (t.length > 150 && /\b(?:requisitos?|instrucciones?|formato final|investigaci[oó]n)\b/i.test(t)) return true;
  return false;
}'''
    editor = replace_once(editor, old_bad_book, new_bad_book, "detect prompt-leaked book titles")

    old_get_title = r'''function getCanonicalBookTitle(currentProject: any, mergedState: any, dashboard?: any): string {
  const projectTitle = String(currentProject?.title ?? "").trim();
  if (!isBadBookTitle(projectTitle)) return projectTitle;

  const stateTitle = String(mergedState?.book_title ?? mergedState?.bookTitle ?? "").trim();
  if (!isBadBookTitle(stateTitle)) return stateTitle;

  const dashboardTitle = String(dashboard?.book_title ?? "").trim();
  if (!isBadBookTitle(dashboardTitle)) return dashboardTitle;

  return "Libro sin título";
}'''
    new_get_title = r'''function getCanonicalBookTitle(currentProject: any, mergedState: any, dashboard?: any): string {
  const projectTitle = cleanBriefTitleLine(currentProject?.title);
  if (!isBadBookTitle(projectTitle)) return projectTitle;

  const brief = ensureString(mergedState?.book_topic, ensureString(mergedState?.bookTopic, ""));
  const explicitBriefTitle = extractBookTitleFromBrief(brief);
  if (explicitBriefTitle && !isBadBookTitle(explicitBriefTitle)) return explicitBriefTitle;

  const stateTitle = cleanBriefTitleLine(mergedState?.book_title ?? mergedState?.bookTitle);
  if (!isBadBookTitle(stateTitle)) return stateTitle;

  const dashboardTitle = cleanBriefTitleLine(dashboard?.book_title);
  if (!isBadBookTitle(dashboardTitle)) return dashboardTitle;

  return "Libro sin título";
}'''
    editor = replace_once(editor, old_get_title, new_get_title, "recover book title from explicit brief metadata")

    old_picker = r'''export function pickCanonicalChapterTitle(chapterNumber: number, ...candidates: unknown[]): string {
  const n = Number(chapterNumber) || 0;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const raw = candidate.trim().replace(/^#{1,6}\s*/, "");
    if (!raw || /^(?:cap[ií]tulo|chapter|parte)\s*\d*\s*[:.\-–—]?$/i.test(raw)) continue;
    const title = raw.replace(new RegExp(String.raw`^(?:cap[ií]tulo|chapter)\s*${n}\s*[:.\-–—]\s*`, "i"), "").trim();
    if (title) return title;
  }
  return n > 0 ? `Capítulo ${n}` : "Capítulo";
}'''
    new_picker = r'''export function pickCanonicalChapterTitle(chapterNumber: number, ...candidates: unknown[]): string {
  const n = Number(chapterNumber) || 0;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const raw = cleanBriefTitleLine(candidate);
    if (isBadChapterTitle(n, raw)) continue;
    const title = raw.replace(new RegExp(String.raw`^(?:cap[ií]tulo|chapter)\s*${n}\s*[:.\-–—]\s*`, "i"), "").trim();
    if (title && !isBadChapterTitle(n, title)) return title;
  }
  return n > 0 ? `Capítulo ${n}` : "Capítulo";
}'''
    editor = replace_once(editor, old_picker, new_picker, "reject generic and prompt-leaked chapter titles")

    outline_anchor = '''  (state as any).outline_12 = ensureArray<any>((state as any).outline_12, []).map((o: any, idx: number) => {'''
    outline_prelude = r'''  // Legacy recovery must run before outline normalization so an old saved
  // "Capítulo N" can be replaced by an explicit title from the original brief.
  (state as any).book_topic = ensureString((state as any).book_topic, ensureString((state as any).bookTopic, ""));
  (state as any).bookTopic = (state as any).book_topic;
  const briefChapterTitles = extractChapterTitlesFromBrief((state as any).book_topic);
  const explicitBriefBookTitle = extractBookTitleFromBrief((state as any).book_topic);
  const existingStateBookTitle = ensureString((state as any).book_title, ensureString((state as any).bookTitle, ""));
  if (explicitBriefBookTitle && isBadBookTitle(existingStateBookTitle)) {
    (state as any).book_title = explicitBriefBookTitle;
    (state as any).bookTitle = explicitBriefBookTitle;
  }

'''
    editor = replace_once(editor, outline_anchor, outline_prelude + outline_anchor, "prepare brief metadata before outline normalization")

    old_outline_title = '''    normalized.chapter_title = pickCanonicalChapterTitle(chapterNum, normalized.chapter_title, normalized.chapterTitle, normalized.title);'''
    new_outline_title = '''    normalized.chapter_title = pickCanonicalChapterTitle(
      chapterNum,
      normalized.chapter_title,
      normalized.chapterTitle,
      normalized.title,
      briefChapterTitles.get(chapterNum)
    );'''
    editor = replace_once(editor, old_outline_title, new_outline_title, "repair legacy outline titles from brief")

    old_map = r'''  const state = normalizeProjectState(stateInput);
  const masterText =
    ensureString(masterLatest?.content, "").trim() || buildMasterFromState(state, ensureString(db?.title, "")).trim();

  const p: Project = {
    id: ensureString(db?.id, ""),
    title: ensureString(db?.title, "Libro sin título"),
    state,
    dashboard: db?.dossier ?? null,
    master_document: {
      title: ensureString(masterLatest?.title, ensureString(db?.title, "Documento maestro")),
      text: masterText,'''
    new_map = r'''  const state = normalizeProjectState(stateInput);
  const canonicalTitle = getCanonicalBookTitle({ title: ensureString(db?.title, "") }, state, db?.dossier ?? {});
  (state as any).book_title = canonicalTitle;
  (state as any).bookTitle = canonicalTitle;
  const rebuiltMasterText = buildMasterFromState(state, canonicalTitle).trim();
  const masterText = rebuiltMasterText || ensureString(masterLatest?.content, "").trim();

  const p: Project = {
    id: ensureString(db?.id, ""),
    title: canonicalTitle,
    state,
    dashboard: db?.dossier ?? null,
    master_document: {
      title: canonicalTitle,
      text: masterText,'''
    editor = replace_once(editor, old_map, new_map, "repair legacy project title and master on load")

    editor_path.write_text(editor, encoding="utf-8")
    print("GENELIBROS_V14_5_EDITOR_PASS")


# ============================================================
# Dashboard: show complete titles instead of ellipsis truncation.
# ============================================================
dash_path = Path("components/GenerationDashboard.tsx")
dash = dash_path.read_text(encoding="utf-8")
ui_marker = "GENELIBROS_V14_5_FULL_TITLE_WRAP"

if ui_marker in dash:
    print("V14.5 dashboard already installed")
else:
    old_row = '''            <p className="font-black text-slate-100 truncate">
              Capítulo {chapterNumber}: <span className="text-slate-200/90">{title}</span>
            </p>'''
    new_row = '''            {/* GENELIBROS_V14_5_FULL_TITLE_WRAP: nunca ocultar el título editorial con ellipsis. */}
            <p className="font-black text-slate-100 leading-snug break-words whitespace-normal">
              Capítulo {chapterNumber}: <span className="text-slate-200/90">{title}</span>
            </p>'''
    dash = replace_once(dash, old_row, new_row, "wrap complete chapter titles")
    dash_path.write_text(dash, encoding="utf-8")
    print("GENELIBROS_V14_5_DASHBOARD_PASS")

print("GENELIBROS_V14_5_SOURCE_PATCH_PASS")

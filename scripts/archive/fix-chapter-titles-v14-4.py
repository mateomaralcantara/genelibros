from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 occurrence, found {count}")
    print(f"PASS: {label}")
    return text.replace(old, new, 1)


# ============================================================
# 1. Canonical chapter titles in editor state/master
# ============================================================
editor_path = Path("src/lib/editor.ts")
editor = editor_path.read_text(encoding="utf-8")

marker = "GENELIBROS_V14_4_CANONICAL_CHAPTER_TITLES"
if marker in editor:
    print("V14.4 editor already installed")
else:
    helper_anchor = "export function buildMasterFromState(state: ProjectState, title?: string): string {"
    helper = r'''// GENELIBROS_V14_4_CANONICAL_CHAPTER_TITLES
// El título planificado del outline es la fuente canónica. Un resultado parcial
// del modelo nunca debe convertir "Capítulo 4: Título real" en solo "Capítulo 4".
function pickCanonicalChapterTitle(chapterNumber: number, ...candidates: unknown[]): string {
  const n = Number(chapterNumber || 0) || 0;
  const fallback = n > 0 ? `Capítulo ${n}` : "Capítulo";
  let firstNonEmpty = "";

  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw) continue;

    const stripped = n > 0
      ? raw.replace(new RegExp(String.raw`^\\s*cap[ií]tulo\\s*${n}\\s*[:\\-–—.]\\s*`, "i"), "").trim()
      : raw;
    const value = stripped || raw;

    if (!firstNonEmpty) firstNonEmpty = value;

    const normalized = value.toLowerCase().replace(/\\s+/g, " ").trim();
    const generic = n > 0 && (
      normalized === `capítulo ${n}` ||
      normalized === `capitulo ${n}` ||
      normalized === `chapter ${n}` ||
      normalized === `parte ${n}`
    );

    if (!generic) return value;
  }

  return firstNonEmpty || fallback;
}

'''
    editor = replace_once(editor, helper_anchor, helper + helper_anchor, "canonical title helper")

    old_master = '''  const chapters = ensureArray<any>((state as any).chapters, [])
    .slice()
    .sort((a, b) => (Number(a?.chapter_number ?? 0) || 0) - (Number(b?.chapter_number ?? 0) || 0));

  for (const ch of chapters) {
    const n = Number(ch?.chapter_number ?? 0) || 0;
    const chTitle = ensureString(ch?.title, n ? `Capítulo ${n}` : "Capítulo").trim();
    const t = stripLeadingChapterHeading(ensureString(ch?.text, ""), n, chTitle).trim();'''
    new_master = '''  const outlineTitleByNum = new Map<number, any>();
  for (const item of ensureArray<any>((state as any).outline_12, [])) {
    const n = Number(item?.chapter_number ?? 0) || 0;
    if (n > 0) outlineTitleByNum.set(n, item);
  }

  const chapters = ensureArray<any>((state as any).chapters, [])
    .slice()
    .sort((a, b) => (Number(a?.chapter_number ?? 0) || 0) - (Number(b?.chapter_number ?? 0) || 0));

  for (const ch of chapters) {
    const n = Number(ch?.chapter_number ?? 0) || 0;
    const planned = outlineTitleByNum.get(n);
    const chTitle = pickCanonicalChapterTitle(
      n,
      planned?.chapter_title,
      planned?.title,
      ch?.title,
      ch?.chapter_title
    );
    const t = stripLeadingChapterHeading(ensureString(ch?.text, ""), n, chTitle).trim();'''
    editor = replace_once(editor, old_master, new_master, "master uses canonical title")

    old_merge = '''    const mergedC: AnyRecord = { ...(existing || {}), ...(c || {}), chapter_number: cn };
    mergedC.title = ensureString(mergedC.title, ensureString(mergedC.chapter_title, `Capítulo ${cn}`)).trim();
    mergedC.text = stripLeadingChapterHeading(ensureString(mergedC.text, ""), cn, mergedC.title);'''
    new_merge = '''    const mergedC: AnyRecord = { ...(existing || {}), ...(c || {}), chapter_number: cn };
    const plannedOutline = outlineByNum.get(cn);
    mergedC.title = pickCanonicalChapterTitle(
      cn,
      plannedOutline?.chapter_title,
      plannedOutline?.title,
      existing?.title,
      existing?.chapter_title,
      c?.title,
      c?.chapter_title
    );
    mergedC.text = stripLeadingChapterHeading(ensureString(mergedC.text, ""), cn, mergedC.title);'''
    editor = replace_once(editor, old_merge, new_merge, "merge preserves planned title")

    old_process = '''    if (chosen) {
      const title = ensureString(chosen?.title, `Capítulo ${expected}`);
      const text = stripLeadingChapterHeading(ensureString(chosen?.text, ""), expected, title);
      (nextState as any).chapters = [{ ...(chosen as any), chapter_number: expected, title, text }];
    } else {'''
    new_process = '''    if (chosen) {
      const currentState: any = (currentProject as any)?.state ?? {};
      const planned = ensureArray<any>(currentState?.outline_12, []).find(
        (item: any) => Number(item?.chapter_number ?? 0) === expected
      );
      const existingChapter = ensureArray<any>(currentState?.chapters, []).find(
        (item: any) => Number(item?.chapter_number ?? 0) === expected
      );
      const title = pickCanonicalChapterTitle(
        expected,
        planned?.chapter_title,
        planned?.title,
        existingChapter?.title,
        existingChapter?.chapter_title,
        chosen?.title,
        chosen?.chapter_title
      );
      const text = stripLeadingChapterHeading(ensureString(chosen?.text, ""), expected, title);
      (nextState as any).chapters = [{ ...(chosen as any), chapter_number: expected, title, text }];
    } else {'''
    editor = replace_once(editor, old_process, new_process, "generated chapter preserves canonical title")

    editor_path.write_text(editor, encoding="utf-8")
    print("GENELIBROS_V14_4_EDITOR_PASS")


# ============================================================
# 2. Dashboard must prefer chapter_title over generic section title
# ============================================================
dash_path = Path("components/GenerationDashboard.tsx")
dash = dash_path.read_text(encoding="utf-8")

ui_marker = "GENELIBROS_V14_4_TITLE_DISPLAY"
if ui_marker in dash:
    print("V14.4 dashboard already installed")
else:
    old_title = '''                const title = String(ch?.title || ch?.chapter_title || `Capítulo ${n}`);'''
    new_title = '''                // GENELIBROS_V14_4_TITLE_DISPLAY
                // effectiveOutline.chapter_title ya representa el título editorial canónico.
                const title = String(ch?.chapter_title || ch?.title || `Capítulo ${n}`);'''
    dash = replace_once(dash, old_title, new_title, "dashboard prefers canonical chapter_title")
    dash_path.write_text(dash, encoding="utf-8")
    print("GENELIBROS_V14_4_DASHBOARD_PASS")

print("GENELIBROS_V14_4_SOURCE_PATCH_PASS")

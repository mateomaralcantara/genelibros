from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 occurrence, found {count}")
    print(f"PASS: {label}")
    return text.replace(old, new, 1)


editor_path = Path("src/lib/editor.ts")
editor = editor_path.read_text(encoding="utf-8")
marker = "GENELIBROS_V14_6_DOSSIER_RECOVERY"

if marker in editor:
    print("V14.6 editor already installed")
else:
    # A quote at the end of a title may be real punctuation (e.g. “los mismos de siempre”).
    # Strip quotes only when they are a matching wrapper around the whole value.
    old_clean = r'''function cleanBriefTitleLine(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}'''
    new_clean = r'''function cleanBriefTitleLine(value: unknown): string {
  let out = String(value ?? "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .trim();

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['«', '»'],
  ];

  for (const [open, close] of quotePairs) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }

  return out;
}'''
    editor = replace_once(editor, old_clean, new_clean, "preserve legitimate title quotation marks")

    # Remove one-book emergency workaround. Recovery must be generic for every book.
    old_title_seed = '''    book_title: ensureString(db?.title, "Libro sin título").replace(/^MISIÓN GENERAL.*$/i, "EL OUTSIDER"),'''
    new_title_seed = '''    book_title: ensureString(db?.title, "Libro sin título"),'''
    editor = replace_once(editor, old_title_seed, new_title_seed, "remove EL OUTSIDER hardcoded legacy workaround")

    old_state = '''  const state = normalizeProjectState(stateInput);
  const canonicalTitle = getCanonicalBookTitle({ title: ensureString(db?.title, "") }, state, db?.dossier ?? {});'''
    new_state = '''  // GENELIBROS_V14_6_DOSSIER_RECOVERY
  // Si un proyecto viejo perdió el brief, el dossier puede seguir conservando
  // los títulos canónicos. Solo repara candidatos genéricos/contaminados;
  // los títulos editoriales válidos del usuario siempre tienen prioridad.
  const state = recoverLegacyStateFromDashboard(normalizeProjectState(stateInput), db?.dossier ?? {});
  const canonicalTitle = getCanonicalBookTitle({ title: ensureString(db?.title, "") }, state, db?.dossier ?? {});'''
    editor = replace_once(editor, old_state, new_state, "recover legacy state from dossier on load")

    anchor = '''export function ensureOutline12InState(state: AnyRecord, dashboard?: AnyRecord): AnyRecord {'''
    helper = r'''function recoverLegacyStateFromDashboard(state: ProjectState, dashboard?: AnyRecord): ProjectState {
  if (!dashboard || !isRecord(dashboard)) return state;

  const dashboardOutline = deepFindOutline(dashboard);
  if (!dashboardOutline?.length) return state;

  const st = state as AnyRecord;
  const currentOutline = ensureArray<any>(st.outline_12, []);
  const chapterCountHint = Number(st?.continuity_pack?.chapter_count ?? 0) || 0;

  const dashboardByNum = new Map<number, any>();
  for (let idx = 0; idx < dashboardOutline.length; idx += 1) {
    const item = dashboardOutline[idx];
    if (!isRecord(item)) continue;
    const n = Number(item?.chapter_number ?? item?.chapterNumber ?? idx + 1) || 0;
    if (n > 0) dashboardByNum.set(n, item);
  }

  // Nunca expandas silenciosamente un outline existente. Si está vacío,
  // recupera del dossier respetando chapter_count cuando exista.
  const recoveryBase = currentOutline.length
    ? currentOutline
    : Array.from(dashboardByNum.entries())
        .filter(([n]) => !chapterCountHint || n <= chapterCountHint)
        .sort(([a], [b]) => a - b)
        .map(([n, item]) => ({ ...(item as AnyRecord), chapter_number: n }));

  st.outline_12 = recoveryBase.map((item: any, idx: number) => {
    const n = Number(item?.chapter_number ?? item?.chapterNumber ?? idx + 1) || idx + 1;
    const fromDashboard = dashboardByNum.get(n);
    return {
      ...(isRecord(item) ? item : {}),
      chapter_number: n,
      chapter_title: pickCanonicalChapterTitle(
        n,
        item?.chapter_title,
        item?.chapterTitle,
        item?.title,
        fromDashboard?.chapter_title,
        fromDashboard?.chapterTitle,
        fromDashboard?.title
      ),
    };
  });

  const plannedByNum = new Map<number, any>();
  for (const item of ensureArray<any>(st.outline_12, [])) {
    const n = Number(item?.chapter_number ?? 0) || 0;
    if (n > 0) plannedByNum.set(n, item);
  }

  st.chapters = ensureArray<any>(st.chapters, []).map((chapter: any, idx: number) => {
    const n = Number(chapter?.chapter_number ?? chapter?.chapterNumber ?? idx + 1) || idx + 1;
    const planned = plannedByNum.get(n);
    const title = pickCanonicalChapterTitle(
      n,
      planned?.chapter_title,
      planned?.title,
      chapter?.title,
      chapter?.chapter_title
    );
    return {
      ...(isRecord(chapter) ? chapter : {}),
      chapter_number: n,
      title,
      text: stripLeadingChapterHeading(ensureString(chapter?.text, ""), n, title),
    };
  });

  return state;
}

'''
    editor = replace_once(editor, anchor, helper + anchor, "insert generic dossier recovery helper")

    editor_path.write_text(editor, encoding="utf-8")
    print("GENELIBROS_V14_6_EDITOR_PASS")

print("GENELIBROS_V14_6_SOURCE_PATCH_PASS")

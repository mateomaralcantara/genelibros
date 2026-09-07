from pathlib import Path

path = Path('App.tsx')
s = path.read_text(encoding='utf-8')
original = s
marker = 'GENELIBROS_V14_3_FULL_BOOK_AUTOSTART'

if marker in s:
    print('V14.3 already installed')
    raise SystemExit(0)

def once(old: str, new: str, label: str):
    global s
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    s = s.replace(old, new, 1)
    print(f'PASS: {label}')

once(
    '  const globalGenLockRef = useRef(false);\n  const requestSeqRef = useRef<Record<string, number>>({});',
    '''  const globalGenLockRef = useRef(false);
  // GENELIBROS_V14_3_FULL_BOOK_AUTOSTART
  // Proyecto recién creado que debe disparar la generación completa una sola vez.
  const fullBookAutostartRef = useRef<string | null>(null);
  const requestSeqRef = useRef<Record<string, number>>({});''',
    'autostart ref',
)

once(
    '''      setProjects(projectsRef.current);
      setActiveProjectId(updatedWithMaster.id);
      setViewMode("plan");''',
    '''      setProjects(projectsRef.current);
      setActiveProjectId(updatedWithMaster.id);
      fullBookAutostartRef.current = updatedWithMaster.id;
      setViewMode("plan");''',
    'mark new book for full generation',
)

old_queue = '''  const handleGenerateRemaining = useCallback(async () => {
    if (globalGenLockRef.current || anyGenerating) return;
    globalGenLockRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const getFresh = () => projectsRef.current.find((p) => p.id === activeProjectId);
      let current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.proposal?.status, "PENDING") !== "COMPLETED") {
        const ok = await generateSectionCore("GENERATE_PROPOSAL", undefined, { bypassLock: true });
        if (!ok) return;
      }

      current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.introduction?.status, "PENDING") !== "COMPLETED") {
        const ok = await generateSectionCore("GENERATE_INTRODUCTION", undefined, { bypassLock: true });
        if (!ok) return;
      }

      current = getFresh();
      if (!current) return;

      for (const item of ensureArray<any>((current.state as any)?.outline_12, [])) {
        const key = `chap-${item.chapter_number}`;
        const status = (((current as any).generation_progress || {})[key] as GenerationStatus | undefined);
        if (status === "completed") continue;

        const ok = await generateSectionCore("GENERATE_CHAPTER", item.chapter_number, { bypassLock: true });
        if (!ok) break;

        current = getFresh();
        if (!current) break;
      }
    } finally {
      setIsLoading(false);
      globalGenLockRef.current = false;
    }
  }, [activeProjectId, anyGenerating, generateSectionCore]);'''

new_queue = '''  const handleGenerateRemaining = useCallback(async () => {
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
        const match = /^chap-(\\d+)$/.exec(key);
        const n = Number(match?.[1] ?? 0) || 0;
        if (n > 0) numbers.add(n);
      }

      const chapterCountHint = Number(
        state?.continuity_pack?.chapter_count ??
        (project as any)?.continuity_pack?.chapter_count ??
        0
      ) || 0;

      for (let n = 1; n <= chapterCountHint; n += 1) {
        numbers.add(n);
      }

      return Array.from(numbers).sort((a, b) => a - b);
    };

    const isChapterCompleted = (project: Project, chapterNumber: number): boolean => {
      const state: any = (project as any)?.state ?? {};
      const key = `chap-${chapterNumber}`;
      const progress = (((project as any)?.generation_progress ?? state?.generation_progress ?? {}) as AnyRecord) || {};

      if (String(progress?.[key] ?? "").toLowerCase() === "completed") {
        return true;
      }

      const chapter = ensureArray<any>(state?.chapters, []).find(
        (item: any) => Number(item?.chapter_number ?? 0) === chapterNumber
      );

      return (
        ensureString(chapter?.status, "").toUpperCase() === "COMPLETED" &&
        ensureString(chapter?.text, "").trim().length > 0
      );
    };

    try {
      let current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.proposal?.status, "PENDING") !== "COMPLETED") {
        const ok = await generateSectionCore("GENERATE_PROPOSAL", undefined, { bypassLock: true });
        if (!ok) return;
      }

      current = getFresh();
      if (!current) return;

      if (ensureString((current.state as any)?.introduction?.status, "PENDING") !== "COMPLETED") {
        const ok = await generateSectionCore("GENERATE_INTRODUCTION", undefined, { bypassLock: true });
        if (!ok) return;
      }

      current = getFresh();
      if (!current) return;

      const chapterNumbers = getChapterNumbers(current);

      console.log("[V14.3] FULL BOOK APP QUEUE START", {
        projectId: current.id,
        chapters: chapterNumbers,
      });

      for (const chapterNumber of chapterNumbers) {
        current = getFresh();
        if (!current) break;

        if (isChapterCompleted(current, chapterNumber)) continue;

        const ok = await generateSectionCore(
          "GENERATE_CHAPTER",
          chapterNumber,
          { bypassLock: true }
        );

        if (!ok) {
          console.warn(
            `[V14.3] Capítulo ${chapterNumber} falló; la cola continúa con el siguiente.`
          );
          continue;
        }
      }

      console.log("[V14.3] FULL BOOK APP QUEUE END");
    } finally {
      setIsLoading(false);
      globalGenLockRef.current = false;
    }
  }, [activeProjectId, anyGenerating, generateSectionCore]);'''

once(old_queue, new_queue, 'replace App full-book queue')

anchor = '''  }, [activeProjectId, anyGenerating, generateSectionCore]);

  const handleEditSection = useCallback(async (payload: any) => {'''

replacement = '''  }, [activeProjectId, anyGenerating, generateSectionCore]);

  useEffect(() => {
    const pendingProjectId = fullBookAutostartRef.current;

    if (!pendingProjectId || pendingProjectId !== activeProjectId) return;

    // Consumir el marker antes de arrancar evita duplicados por rerender.
    fullBookAutostartRef.current = null;

    const timer = window.setTimeout(() => {
      void handleGenerateRemaining();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeProjectId, handleGenerateRemaining]);

  const handleEditSection = useCallback(async (payload: any) => {'''

once(anchor, replacement, 'full-book autostart effect')

required = [
    marker,
    'fullBookAutostartRef.current = updatedWithMaster.id',
    'FULL BOOK APP QUEUE START',
    'getChapterNumbers',
    'Object.keys(progress)',
    'la cola continúa con el siguiente',
    'void handleGenerateRemaining();',
]

for token in required:
    if token not in s:
        raise RuntimeError(f'missing contract token: {token}')

if s == original:
    raise RuntimeError('no source change')

path.write_text(s, encoding='utf-8')
print('GENELIBROS_V14_3_FULL_BOOK_AUTOSTART_PASS')

// Preferencias del usuario (hoy: palabras por capítulo por defecto).
// Se cargan de user_settings cuando el usuario tiene sesión y acceso aprobado.

import { useCallback, useEffect, useState } from "react";
import { getUserSettings, upsertUserSettings } from "../data/repo";
import { normalizeError } from "../lib/editor";

type UseUserSettingsOptions = {
  /** Solo se cargan con sesión iniciada y acceso aprobado. */
  enabled: boolean;
  /** Usuario actual: al cambiar de cuenta se vuelven a cargar. */
  userId?: string | null;
  setError: (message: string | null) => void;
};

export function useUserSettings({ enabled, userId, setError }: UseUserSettingsOptions) {
  const [defaultChapterWords, setDefaultChapterWords] = useState<number>(3000);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      try {
        const s = await getUserSettings();
        const v = Number((s as any)?.default_chapter_words ?? 3000) || 3000;
        setDefaultChapterWords(Math.max(500, Math.min(20000, v)));
      } catch {
        setDefaultChapterWords(3000);
      }
    })();
  }, [enabled, userId]);

  const saveSettings = useCallback(async () => {
    try {
      setSavingSettings(true);
      const v = await upsertUserSettings(defaultChapterWords);
      setDefaultChapterWords(v);
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setSavingSettings(false);
    }
  }, [defaultChapterWords, setError]);

  return { defaultChapterWords, setDefaultChapterWords, savingSettings, saveSettings };
}

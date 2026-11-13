// Consumo del plan gratis del usuario: palabras usadas y tope configurado.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export const FREE_PLAN_FALLBACK_MAX_WORDS = 5000;

export type FreePlanUsage = { used: number; max: number; loaded: boolean; refresh: () => void };

export function useFreePlanUsage(enabled: boolean): FreePlanUsage {
  const [used, setUsed] = useState(0);
  const [max, setMax] = useState(FREE_PLAN_FALLBACK_MAX_WORDS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: plan }, { data: usage }] = await Promise.all([
      supabase.from("pricing_catalog").select("limits").eq("code", "FREE_PLAN").maybeSingle(),
      supabase.from("free_plan_usage").select("words_used").eq("user_id", u.user.id).maybeSingle(),
    ]);
    setMax(Number((plan?.limits as any)?.max_words) || FREE_PLAN_FALLBACK_MAX_WORDS);
    setUsed(Number(usage?.words_used) || 0);
    setLoaded(true);
  }, [enabled]);

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
  }, [refresh]);

  return { used, max, loaded, refresh: () => void refresh().catch(() => undefined) };
}

/** Errores del servidor que piden pasar a un plan de pago. */
export function isUpgradeError(error: unknown): boolean {
  const code = (error as any)?.code;
  return code === "FREE_PLAN_UPGRADE" || code === "FREE_PLAN_LIMIT" || code === "ACCESS_NOT_APPROVED";
}

// Plan gratis: los usuarios sin plan de pago solo pueden generar el
// expediente con el título y los títulos de los capítulos, hasta el tope
// de palabras configurado en pricing_catalog (FREE_PLAN.limits.max_words).

import { createClient } from "@supabase/supabase-js";

/** Acciones del compositor incluidas en el plan gratis. */
export const FREE_PLAN_ACTIONS = new Set(["BUILD_FULL_DOSSIER"]);

export const FREE_PLAN_DEFAULT_MAX_WORDS = 5000;

function httpError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const UPGRADE_MESSAGE = "Esta función es de los planes de pago. Elige un plan para continuar con tu libro.";

/** Cuenta las palabras de todos los textos de un objeto (expediente, índice…). */
export function countWordsDeep(value: unknown, depth = 0): number {
  if (depth > 12 || value == null) return 0;
  if (typeof value === "string") return (value.trim().match(/\S+/g) || []).length;
  if (Array.isArray(value)) return value.reduce((n, v) => n + countWordsDeep(v, depth + 1), 0);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).reduce<number>((n, v) => n + countWordsDeep(v, depth + 1), 0);
  return 0;
}

/**
 * Comprueba que un usuario del plan gratis puede ejecutar la acción.
 * Lanza 402 FREE_PLAN_UPGRADE si la acción no está incluida y
 * 402 FREE_PLAN_LIMIT si ya agotó sus palabras.
 */
export async function assertFreePlanAllows(userId: string, action: string): Promise<{ maxWords: number; used: number }> {
  if (!FREE_PLAN_ACTIONS.has(action)) throw httpError(UPGRADE_MESSAGE, 402, "FREE_PLAN_UPGRADE");
  const db = admin();
  if (!db) throw httpError("El plan gratis no está disponible ahora mismo.", 503, "FREE_PLAN_UNAVAILABLE");

  const [{ data: plan }, { data: usage }] = await Promise.all([
    db.from("pricing_catalog").select("active, limits").eq("code", "FREE_PLAN").maybeSingle(),
    db.from("free_plan_usage").select("words_used").eq("user_id", userId).maybeSingle(),
  ]);
  if (!plan || plan.active === false) throw httpError(UPGRADE_MESSAGE, 402, "FREE_PLAN_UPGRADE");
  const maxWords = Number((plan.limits as any)?.max_words) || FREE_PLAN_DEFAULT_MAX_WORDS;
  const used = Number(usage?.words_used) || 0;
  if (used >= maxWords) {
    throw httpError(
      `Usaste las ${maxWords.toLocaleString("es-DO")} palabras de tu plan gratis. Elige un plan para seguir creando.`,
      402,
      "FREE_PLAN_LIMIT"
    );
  }
  return { maxWords, used };
}

/** Suma las palabras generadas al consumo del usuario. No interrumpe si falla. */
export async function recordFreePlanUsage(userId: string, words: number): Promise<void> {
  const db = admin();
  if (!db) return;
  const { error } = await db.rpc("free_plan_record", { p_user_id: userId, p_words: Math.max(0, Math.round(words)) });
  if (error) console.error("[free-plan] no se pudo registrar el consumo", error.message);
}

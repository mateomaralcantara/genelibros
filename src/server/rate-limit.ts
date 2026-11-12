import { createClient } from "@supabase/supabase-js";
import type { RequestPrincipal } from "./request-auth";

/**
 * Límite de uso por usuario para endpoints que cuestan dinero.
 *
 * Cuenta las llamadas en Supabase (función consume_api_quota, migración
 * supabase/migrations/20261112_api_rate_limits.sql) por hora y por día.
 * Los workers internos (x-worker-secret) no tienen límite.
 *
 * Límites configurables con variables de entorno, p. ej.:
 *   RATE_LIMIT_COMPOSER_HOURLY=60   RATE_LIMIT_COMPOSER_DAILY=300
 *   RATE_LIMIT_OS4_HOURLY=60        RATE_LIMIT_OS4_DAILY=300
 *   RATE_LIMIT_RESEARCH_HOURLY=20   RATE_LIMIT_RESEARCH_DAILY=100
 * Un valor 0 desactiva esa ventana.
 *
 * Si la base de datos no responde (p. ej. falta la migración), por defecto
 * deja pasar la petición y lo registra en los logs, para no tumbar la app.
 * Con RATE_LIMIT_FAIL_CLOSED=true la rechaza (503).
 */

export type QuotaBucket = "composer" | "os4" | "research";

const DEFAULT_LIMITS: Record<QuotaBucket, { hourly: number; daily: number }> = {
  composer: { hourly: 60, daily: 300 },
  os4: { hourly: 60, daily: 300 },
  research: { hourly: 20, daily: 100 },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function envLimit(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function quotaLimits(bucket: QuotaBucket) {
  const prefix = `RATE_LIMIT_${bucket.toUpperCase()}`;
  const defaults = DEFAULT_LIMITS[bucket];
  return {
    hourly: envLimit(`${prefix}_HOURLY`, defaults.hourly),
    daily: envLimit(`${prefix}_DAILY`, defaults.daily),
  };
}

export class QuotaExceededError extends Error {
  statusCode = 429;
  constructor(
    public scope: "hour" | "day",
    public limit: number,
    public retryAfterSeconds: number
  ) {
    super(
      scope === "hour"
        ? `Has alcanzado el límite de ${limit} solicitudes por hora. Inténtalo de nuevo en ${Math.ceil(retryAfterSeconds / 60)} min.`
        : `Has alcanzado el límite de ${limit} solicitudes por día. Se renueva a medianoche (UTC).`
    );
    this.name = "QuotaExceededError";
  }
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function infraFailure(reason: string, detail?: unknown) {
  console.error(`[rate-limit] ${reason}`, detail ?? "");
  if (String(process.env.RATE_LIMIT_FAIL_CLOSED || "").toLowerCase() === "true") {
    throw Object.assign(new Error("Servicio de cuotas no disponible. Inténtalo más tarde."), { statusCode: 503 });
  }
}

/** Consume una unidad de cuota del usuario. Lanza QuotaExceededError (429) si no quedan. */
export async function enforceQuota(principal: RequestPrincipal, bucket: QuotaBucket): Promise<void> {
  if (principal.kind !== "user") return;
  if (!UUID_RE.test(principal.userId)) return;

  const { hourly, daily } = quotaLimits(bucket);
  if (hourly <= 0 && daily <= 0) return;

  const client = adminClient();
  if (!client) {
    infraFailure("Falta SUPABASE_SERVICE_ROLE_KEY: no se aplica el límite de uso.");
    return;
  }

  const { data, error } = await client.rpc("consume_api_quota", {
    p_user_id: principal.userId,
    p_bucket: bucket,
    p_hourly_limit: hourly,
    p_daily_limit: daily,
  });

  if (error) {
    infraFailure("consume_api_quota falló (¿migración aplicada?)", error.message);
    return;
  }

  if (data && data.allowed === false) {
    throw new QuotaExceededError(
      data.scope === "day" ? "day" : "hour",
      Number(data.limit) || 0,
      Number(data.retry_after_seconds) || 60
    );
  }
}

/** Añade la cabecera Retry-After si el error es de cuota. */
export function applyRetryAfter(res: any, error: unknown) {
  if (error instanceof QuotaExceededError) {
    res.setHeader?.("Retry-After", String(error.retryAfterSeconds));
  }
}

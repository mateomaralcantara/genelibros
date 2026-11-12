import { createClient } from "@supabase/supabase-js";
import type { RequestPrincipal } from "./request-auth.js";
import { enforceQuota, type QuotaBucket } from "./rate-limit.js";

/**
 * Guardia para endpoints que gastan dinero o encolan trabajo caro.
 *
 * 1. Acceso aprobado: el usuario debe tener profiles.has_access = true
 *    (lo aprueba un administrador). Antes solo lo comprobaba la interfaz,
 *    así que un usuario registrado pero no aprobado podía llamar a la API.
 * 2. Límite de uso por usuario (rate-limit.ts).
 *
 * Los workers internos (x-worker-secret) pasan sin comprobaciones.
 *
 * ACCESS_GATE_DISABLED=true desactiva el punto 1 (emergencias).
 * Si la base de datos no responde, por defecto deja pasar y lo registra
 * (el límite de uso sigue aplicando). ACCESS_GATE_FAIL_CLOSED=true lo rechaza.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function flag(name: string): boolean {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function infraFailure(reason: string, detail?: unknown) {
  console.error(`[access-gate] ${reason}`, detail ?? "");
  if (flag("ACCESS_GATE_FAIL_CLOSED")) {
    throw Object.assign(new Error("No se pudo verificar tu acceso. Inténtalo más tarde."), { statusCode: 503 });
  }
}

export async function requireApprovedAccess(principal: RequestPrincipal): Promise<void> {
  if (principal.kind !== "user") return;
  if (flag("ACCESS_GATE_DISABLED")) return;
  if (!UUID_RE.test(principal.userId)) return;

  const client = adminClient();
  if (!client) {
    infraFailure("Falta SUPABASE_SERVICE_ROLE_KEY: no se verifica has_access.");
    return;
  }

  const { data, error } = await client
    .from("profiles")
    .select("has_access")
    .eq("user_id", principal.userId)
    .maybeSingle();

  if (error) {
    infraFailure("No se pudo leer profiles.has_access", error.message);
    return;
  }

  if (!data || data.has_access !== true) {
    throw Object.assign(
      new Error("Tu cuenta aún no tiene acceso aprobado. Espera la aprobación del administrador."),
      { statusCode: 403, code: "ACCESS_NOT_APPROVED" }
    );
  }
}

/** Acceso aprobado + límite de uso. Lanza errores con statusCode 403/429/503. */
export async function guardPaidRequest(principal: RequestPrincipal, bucket: QuotaBucket): Promise<void> {
  await requireApprovedAccess(principal);
  await enforceQuota(principal, bucket);
}

/** Respuesta JSON uniforme para errores de la guardia; devuelve true si respondió. */
export function respondGuardError(res: any, error: any): boolean {
  const status = Number(error?.statusCode);
  if (![403, 429, 503].includes(status)) return false;
  if (status === 429 && error?.retryAfterSeconds) {
    res.setHeader?.("Retry-After", String(error.retryAfterSeconds));
  }
  res.status(status).json({
    ok: false,
    error: String(error?.message || "Solicitud rechazada"),
    code: error?.code || (status === 429 ? "USER_QUOTA_EXCEEDED" : status === 403 ? "ACCESS_NOT_APPROVED" : "SERVICE_UNAVAILABLE"),
  });
  return true;
}

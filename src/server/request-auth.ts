import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

/**
 * Autenticación compartida para endpoints que consumen cuota (Gemini, fetch externo).
 *
 * Acepta:
 *  1. Un usuario de Supabase: `Authorization: Bearer <access_token>`.
 *  2. Una llamada servidor-a-servidor (workers): `x-worker-secret: <OS4_WORKER_SECRET>`.
 *  3. Compatibilidad: `x-composer-secret: <COMPOSER_SHARED_SECRET>` si está configurado.
 *
 * Nunca deja pasar una petición anónima: si falta configuración, responde 500 en vez de abrir el endpoint.
 */

export type RequestPrincipal =
  | { kind: "user"; userId: string }
  | { kind: "worker" };

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function header(req: any, name: string): string {
  const value = req?.headers?.[name];
  return String(Array.isArray(value) ? value[0] : value ?? "").trim();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function matchesSecret(got: string, ...envNames: string[]): boolean {
  if (!got) return false;
  return envNames.some((name) => {
    const expected = String(process.env[name] || "").trim();
    return expected.length > 0 && safeEqual(got, expected);
  });
}

export async function requireUserOrWorker(req: any): Promise<RequestPrincipal> {
  if (matchesSecret(header(req, "x-worker-secret"), "OS4_WORKER_SECRET", "REFINERY_WORKER_SECRET", "DEEP_WORKER_SECRET")) {
    return { kind: "worker" };
  }
  if (matchesSecret(header(req, "x-composer-secret"), "COMPOSER_SHARED_SECRET")) {
    return { kind: "worker" };
  }

  const token = header(req, "authorization").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token) throw httpError("Unauthorized", 401);

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !anon) throw httpError("Configuración de autenticación incompleta en el servidor.", 500);

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw httpError("Invalid session", 401);

  return { kind: "user", userId: data.user.id };
}

import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

function envUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
function anonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
}
function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
}
function bearer(req: any) {
  const match = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || "").trim();
}
async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
async function authenticate(req: any) {
  const url = envUrl();
  const anon = anonKey();
  if (!url || !anon) throw Object.assign(new Error("Faltan SUPABASE_URL/SUPABASE_ANON_KEY."), { statusCode: 500 });
  const token = bearer(req);
  if (!token) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
  return data.user;
}
function adminClient() {
  const url = envUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error("Faltan credenciales server-side de Supabase.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req: any, res: any) {
  if (String(req.method || "").toUpperCase() !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const user = await authenticate(req);
    const admin = adminClient();
    const body = await readBody(req);
    const action = String(body?.action || "").toLowerCase();

    if (action === "apply") {
      const versionId = String(body?.version_id || "").trim();
      if (!versionId) return res.status(400).json({ ok: false, error: "version_id requerido" });
      const { data, error } = await admin.rpc("refinery_apply_chapter_version", {
        p_version_id: versionId,
        p_user_id: user.id,
      });
      if (error) throw error;
      const ok = Boolean(data?.ok);
      return res.status(ok ? 200 : 409).json(data || { ok: false, reason: "unknown" });
    }

    if (action === "rollback") {
      const applyId = String(body?.apply_id || "").trim();
      if (!applyId) return res.status(400).json({ ok: false, error: "apply_id requerido" });
      const { data, error } = await admin.rpc("refinery_rollback_chapter_apply", {
        p_apply_id: applyId,
        p_user_id: user.id,
      });
      if (error) throw error;
      const ok = Boolean(data?.ok);
      return res.status(ok ? 200 : 409).json(data || { ok: false, reason: "unknown" });
    }

    return res.status(400).json({ ok: false, error: "action debe ser apply o rollback" });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500) || 500;
    return res.status(status).json({ ok: false, error: String(error?.message || error) });
  }
}

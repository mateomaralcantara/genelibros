import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

function envUrl() { return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""; }
function anonKey() { return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""; }
function serviceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""; }
function bearer(req: any) { return String(String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "").trim(); }
async function authenticate(req: any) {
  const url = envUrl(); const anon = anonKey();
  if (!url || !anon) throw Object.assign(new Error("Faltan SUPABASE_URL/SUPABASE_ANON_KEY."), { statusCode: 500 });
  const token = bearer(req); if (!token) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
  return data.user;
}
function adminClient() {
  const url = envUrl(); const key = serviceKey();
  if (!url || !key) throw new Error("Faltan credenciales server-side de Supabase.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function readBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim(); return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: any, res: any) {
  if (String(req.method || "").toUpperCase() !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const user = await authenticate(req);
    const admin = adminClient();
    const body = await readBody(req);
    const action = String(body?.action || "apply").toLowerCase();
    const projectId = String(body?.project_id || "").trim();
    if (!projectId) return res.status(400).json({ ok: false, error: "project_id requerido" });
    const { data: project, error: projectError } = await admin.from("projects").select("id").eq("id", projectId).eq("user_id", user.id).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return res.status(404).json({ ok: false, error: "Proyecto no encontrado o sin permisos." });

    if (action === "apply") {
      const jobId = String(body?.job_id || "").trim();
      if (!jobId) return res.status(400).json({ ok: false, error: "job_id requerido" });
      const { data, error } = await admin.rpc("deep_apply_chapter_candidate", { p_user_id: user.id, p_project_id: projectId, p_job_id: jobId });
      if (error) throw error;
      return res.status(200).json({ ok: true, action: "apply", history_id: data });
    }
    if (action === "rollback") {
      const historyId = String(body?.history_id || "").trim();
      if (!historyId) return res.status(400).json({ ok: false, error: "history_id requerido" });
      const { data, error } = await admin.rpc("deep_rollback_chapter_candidate", { p_user_id: user.id, p_project_id: projectId, p_history_id: historyId });
      if (error) throw error;
      return res.status(200).json({ ok: true, action: "rollback", rolled_back: Boolean(data) });
    }
    return res.status(400).json({ ok: false, error: "action inválida" });
  } catch (error: any) {
    return res.status(Number(error?.statusCode || 500)).json({ ok: false, error: String(error?.message || error) });
  }
}

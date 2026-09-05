import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;
type AnyRow = Record<string, any>;

function envUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
function anonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
}
function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
}
function bearer(req: any): string {
  const auth = String(req.headers?.authorization || "");
  return String(auth.match(/^Bearer\s+(.+)$/i)?.[1] || "").trim();
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
async function readBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
async function assertProject(admin: ReturnType<typeof adminClient>, userId: string, projectId: string) {
  const { data, error } = await admin
    .from("projects")
    .select("id,user_id,title")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Proyecto no encontrado o sin permisos."), { statusCode: 404 });
  return data;
}
async function findSection(admin: ReturnType<typeof adminClient>, projectId: string, chapterNumber: number) {
  const { data, error } = await admin
    .from("sections")
    .select("id,chapter_number,title,content,type")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .eq("chapter_number", chapterNumber)
    .maybeSingle();
  if (error) throw error;
  return data as AnyRow | null;
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") return res.status(204).end();
  const method = String(req.method || "").toUpperCase();
  if (!["GET", "POST"].includes(method)) return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const user = await authenticate(req);
    const admin = adminClient();

    if (method === "GET") {
      const projectId = String(req.query?.project_id || "").trim();
      if (projectId) await assertProject(admin, user.id, projectId);
      let query = admin
        .from("deep_work_jobs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(25);
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true, jobs: data || [] });
    }

    const body = await readBody(req);
    const action = String(body?.action || "enqueue").toLowerCase();
    const projectId = String(body?.project_id || body?.projectId || "").trim();
    if (!projectId) return res.status(400).json({ ok: false, error: "project_id requerido" });
    const project = await assertProject(admin, user.id, projectId);

    if (["cancel", "resume"].includes(action)) {
      const jobId = String(body?.job_id || "").trim();
      if (!jobId) return res.status(400).json({ ok: false, error: "job_id requerido" });
      if (action === "cancel") {
        const { data, error } = await admin
          .from("deep_work_jobs")
          .update({ status: "CANCELLED", locked_by: null, locked_at: null, heartbeat_at: null, lease_expires_at: null, updated_at: new Date().toISOString() })
          .eq("id", jobId).eq("project_id", projectId).eq("user_id", user.id)
          .select("*").maybeSingle();
        if (error) throw error;
        return res.status(200).json({ ok: true, job: data || null });
      }
      const { data, error } = await admin
        .from("deep_work_jobs")
        .update({ status: "QUEUED", attempts: 0, error: null, last_error: null, dead_letter_at: null, next_retry_at: new Date().toISOString(), locked_by: null, locked_at: null, heartbeat_at: null, lease_expires_at: null, updated_at: new Date().toISOString() })
        .eq("id", jobId).eq("project_id", projectId).eq("user_id", user.id)
        .in("status", ["FAILED", "RETRYING", "DEAD_LETTER"])
        .select("*").maybeSingle();
      if (error) throw error;
      return res.status(200).json({ ok: true, job: data || null });
    }

    if (action !== "enqueue") return res.status(400).json({ ok: false, error: "action inválida" });

    const chapterNumber = Math.max(1, Math.floor(Number(body?.chapter_number || 0)));
    if (!chapterNumber) return res.status(400).json({ ok: false, error: "chapter_number requerido" });
    const objective = String(body?.objective || "Mejorar profundamente este capítulo sin inventar información.").trim();
    const depthRaw = String(body?.depth || "DEEP").toUpperCase();
    const depth = ["FAST", "DEEP", "SUPREME", "ULTRA"].includes(depthRaw) ? depthRaw : "DEEP";
    const operationRaw = String(body?.operation || "IMPROVE").toUpperCase();
    const operation = ["IMPROVE", "REWRITE", "GENERATE"].includes(operationRaw) ? operationRaw : "IMPROVE";
    const targetWords = Math.max(500, Math.min(12000, Math.floor(Number(body?.target_words || 3000) || 3000)));
    const section = await findSection(admin, projectId, chapterNumber);
    if (!section && operation !== "GENERATE") {
      return res.status(404).json({ ok: false, error: "Capítulo no encontrado para IMPROVE/REWRITE." });
    }

    const { data: active, error: activeError } = await admin
      .from("deep_work_jobs")
      .select("*")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .eq("chapter_number", chapterNumber)
      .in("status", ["QUEUED", "RUNNING", "RETRYING"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (activeError) throw activeError;
    if (active?.[0]) return res.status(200).json({ ok: true, reused: true, job: active[0] });

    const creditGuardEnabled = !["0", "false", "off"].includes(
      String(process.env.DEEP_CREDIT_GUARD || "1").trim().toLowerCase(),
    );
    const policyByDepth: Record<string, AnyRow> = {
      FAST: { maxRepairAttempts: 0, threshold: 8.6 },
      DEEP: { maxRepairAttempts: 1, threshold: 9.0 },
      SUPREME: {
        maxRepairAttempts: creditGuardEnabled ? 1 : 2,
        threshold: 9.3,
        draftCount: creditGuardEnabled ? 2 : 3,
        maxLlmCalls: Math.max(1, Number(process.env.DEEP_MAX_LLM_CALLS || 9)),
        creditGuard: creditGuardEnabled,
      },
      ULTRA: { maxRepairAttempts: 3, threshold: 9.5 },
    };

    const { data: job, error } = await admin
      .from("deep_work_jobs")
      .insert({
        user_id: user.id,
        project_id: projectId,
        target_type: "CHAPTER",
        operation,
        depth,
        chapter_number: chapterNumber,
        section_id: section?.id || null,
        objective,
        target_words: targetWords,
        status: "QUEUED",
        progress: 0,
        checkpoint: { version: "11C", step: "INIT", draft_index: 0 },
        result: {
          version: "deep-work-11c-1.0.0",
          projectId,
          projectTitle: project.title,
          targetType: "CHAPTER",
          operation,
          chapterNumber,
          sectionId: section?.id || null,
          depth,
          objective,
          targetWords,
          drafts: [],
          repairAttempts: 0,
          artifactIds: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
          budgetGuard: depth === "SUPREME" && creditGuardEnabled
            ? {
                enabled: true,
                maxCalls: Math.max(1, Number(process.env.DEEP_MAX_LLM_CALLS || 9)),
                maxRepairAttempts: 1,
                draftCount: 2,
                threshold: 9.3,
              }
            : { enabled: false },
        },
        policy: policyByDepth[depth],
        attempts: 0,
        max_attempts: 6,
        next_retry_at: new Date().toISOString(),
        workflow_version: "deep-work-11c-1.0.0",
      })
      .select("*")
      .single();
    if (error) throw error;
    return res.status(202).json({ ok: true, reused: false, job });
  } catch (error: any) {
    return res.status(Number(error?.statusCode || 500)).json({ ok: false, error: String(error?.message || error) });
  }
}

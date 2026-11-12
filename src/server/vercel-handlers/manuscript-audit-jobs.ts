import { createClient } from "@supabase/supabase-js";
import { guardPaidRequest, respondGuardError } from "../request-guard.js";

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
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || "").trim();
}

async function authenticate(req: any) {
  const url = envUrl();
  const anon = anonKey();

  if (!url || !anon) {
    throw Object.assign(
      new Error("Faltan SUPABASE_URL/SUPABASE_ANON_KEY."),
      { statusCode: 500 },
    );
  }

  const token = bearer(req);
  if (!token) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user) {
    throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
  }

  return data.user;
}

function adminClient() {
  const url = envUrl();
  const key = serviceKey();

  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function assertOwnership(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  projectId: string,
) {
  const { data, error } = await admin
    .from("projects")
    .select("id,user_id,title")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw Object.assign(
      new Error("Proyecto no encontrado o sin permisos."),
      { statusCode: 404 },
    );
  }

  return data;
}

async function latestJobs(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  projectId?: string,
) {
  let query = admin
    .from("manuscript_audit_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!["GET", "POST"].includes(String(req.method || "").toUpperCase())) {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const user = await authenticate(req);
    const admin = adminClient();

    if (req.method === "GET") {
      const projectId = String(req.query?.project_id || "").trim();

      if (projectId) {
        await assertOwnership(admin, user.id, projectId);
      }

      const jobs = await latestJobs(
        admin,
        user.id,
        projectId || undefined,
      );

      return res.status(200).json({
        ok: true,
        jobs,
      });
    }

    const body = await readBody(req);
    const action = String(body?.action || "enqueue").trim().toLowerCase();
    const projectId = String(
      body?.project_id || body?.projectId || "",
    ).trim();

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error: "project_id requerido",
      });
    }

    const project = await assertOwnership(admin, user.id, projectId);

    if (action === "cancel") {
      const jobId = String(body?.job_id || "").trim();

      if (!jobId) {
        return res.status(400).json({
          ok: false,
          error: "job_id requerido",
        });
      }

      const { data, error } = await admin
        .from("manuscript_audit_jobs")
        .update({
          status: "CANCELLED",
          locked_by: null,
          locked_at: null,
          lease_expires_at: null,
          heartbeat_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        job: data || null,
      });
    }

    if (action === "resume") {
      const jobId = String(body?.job_id || "").trim();

      if (!jobId) {
        return res.status(400).json({
          ok: false,
          error: "job_id requerido",
        });
      }

      const { data, error } = await admin
        .from("manuscript_audit_jobs")
        .update({
          status: "QUEUED",
          last_error: null,
          error: null,
          next_retry_at: new Date().toISOString(),
          locked_by: null,
          locked_at: null,
          lease_expires_at: null,
          heartbeat_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .in("status", ["FAILED", "RETRYING", "DEAD_LETTER"])
        .select("*")
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        job: data || null,
      });
    }

    if (action !== "enqueue") {
      return res.status(400).json({
        ok: false,
        error: "action inválida",
      });
    }

    const { data: active, error: activeError } = await admin
      .from("manuscript_audit_jobs")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .in("status", ["QUEUED", "RUNNING", "RETRYING"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (activeError) throw activeError;

    if (active?.[0]) {
      return res.status(200).json({
        ok: true,
        reused: true,
        job: active[0],
      });
    }

    try {
      await guardPaidRequest({ kind: "user", userId: String(user.id) }, "jobs");
    } catch (guardError: any) {
      if (respondGuardError(res, guardError)) return;
      throw guardError;
    }

    const mode =
      String(body?.mode || "").toUpperCase() === "SUPREME"
        ? "SUPREME"
        : "DEEP";

    const { data: job, error } = await admin
      .from("manuscript_audit_jobs")
      .insert({
        user_id: user.id,
        project_id: projectId,
        mode,
        status: "QUEUED",
        priority: 1,
        progress: 0,
        result: {
          requested_title: project.title,
          requested_at: new Date().toISOString(),
          warnings: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            calls: 0,
          },
        },
        checkpoint: {
          version: "11B.2",
          step: "INIT",
          chapter_index: 0,
        },
        attempts: 0,
        max_attempts: 5,
        next_retry_at: new Date().toISOString(),
        workflow_version: "refinery-11b2-durable-1.0.0",
      })
      .select("*")
      .single();

    if (error) throw error;

    return res.status(202).json({
      ok: true,
      reused: false,
      job,
      message:
        "Auditoría durable encolada. El worker procesará un capítulo por tick.",
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500) || 500;

    return res.status(status).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}

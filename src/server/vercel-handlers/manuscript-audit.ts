import { createClient } from "@supabase/supabase-js";
import { auditManuscript } from "../../server/refinery-runtime.js";
import type {
  ManuscriptAuditMode,
  ManuscriptChapterInput,
} from "../../lib/refinery/types";
import { guardPaidRequest, respondGuardError } from "../request-guard.js";

export const maxDuration = 300;

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

async function loadChapters(
  supabase: ReturnType<typeof adminClient>,
  projectId: string,
): Promise<ManuscriptChapterInput[]> {
  const { data: sections, error } = await supabase
    .from("sections")
    .select("id,chapter_number,title,content,status")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .order("chapter_number", { ascending: true });

  if (error) throw error;

  const chapters = (sections || [])
    .filter((x: AnyRow) => String(x?.content || "").trim())
    .map((x: AnyRow, index: number) => ({
      id: String(x.id || ""),
      chapterNumber: Math.max(1, Number(x.chapter_number || index + 1) || index + 1),
      title: String(x.title || `Capítulo ${index + 1}`),
      content: String(x.content || ""),
    }));

  if (chapters.length) return chapters;

  const { data: masters, error: masterError } = await supabase
    .from("master_documents")
    .select("content")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);

  if (masterError) throw masterError;

  const master = String(masters?.[0]?.content || "").trim();
  if (!master) return [];

  const pieces = master
    .split(/\n(?=##\s+)/u)
    .map((x: string) => x.trim())
    .filter(Boolean);

  return pieces
    .map((piece: string, index: number) => {
      const titleMatch = piece.match(/^##\s+(.+)$/mu);
      const title = String(titleMatch?.[1] || `Capítulo ${index + 1}`).trim();
      const content = piece.replace(/^##\s+.+$/mu, "").trim();
      return {
        chapterNumber: index + 1,
        title,
        content,
      };
    })
    .filter((x: ManuscriptChapterInput) => x.content);
}

async function persistAudit(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  projectId: string,
  result: Awaited<ReturnType<typeof auditManuscript>>,
) {
  const row = {
    user_id: userId,
    project_id: projectId,
    audit_version: result.version,
    mode: result.mode,
    status: "COMPLETED",
    overall_score: result.global.overallScore,
    current_words: result.currentWords,
    recommended_words: result.recommendedWords,
    recommended_reduction_percent: result.recommendedReductionPercent,
    model: result.model,
    result,
    completed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("manuscript_evaluations")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

export default async function handler(req: any, res: any) {
  try {
    if (String(req.method || "GET").toUpperCase() !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const user = await authenticate(req);

    try {
      await guardPaidRequest({ kind: "user", userId: String(user.id) }, "audit");
    } catch (guardError: any) {
      if (respondGuardError(res, guardError)) return;
      throw guardError;
    }
    const body = await readBody(req);
    const projectId = String(body?.project_id || body?.projectId || "").trim();

    if (!projectId) {
      return res.status(400).json({ error: "project_id requerido." });
    }

    const mode: ManuscriptAuditMode =
      String(body?.mode || "").toUpperCase() === "SUPREME"
        ? "SUPREME"
        : "DEEP";

    const persist = body?.persist !== false;
    const supabase = adminClient();

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: "Proyecto no encontrado." });
    }

    if (String(project.user_id || "") !== String(user.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const chapters = await loadChapters(supabase, projectId);

    if (!chapters.length) {
      return res.status(422).json({
        error: "El proyecto no contiene capítulos ni master document auditables.",
      });
    }

    const result = await auditManuscript({
      project,
      chapters,
      mode,
    });

    let evaluationId: string | null = null;
    let persistenceWarning: string | null = null;

    if (persist) {
      try {
        evaluationId = await persistAudit(
          supabase,
          String(user.id),
          projectId,
          result,
        );
      } catch (error: any) {
        persistenceWarning =
          "La auditoría terminó, pero no pudo persistirse. Ejecuta sql/refinery-11b-schema.sql.";
      }
    }

    return res.status(200).json({
      ok: true,
      evaluation_id: evaluationId,
      persistence_warning: persistenceWarning,
      result,
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    return res.status(status).json({
      error: String(error?.message || "Book Refinery audit failed."),
    });
  }
}

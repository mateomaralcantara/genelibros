import { createClient } from "@supabase/supabase-js";
import {
  auditGlobalManuscriptStep,
  auditSingleChapterStep,
} from "../src/server/refinery-runtime";
import { manuscriptDeterministicMetrics, wordCount } from "../src/lib/refinery/metrics";
import type {
  ManuscriptAuditMode,
  ManuscriptChapterAudit,
  ManuscriptChapterInput,
} from "../src/lib/refinery/types";

export const maxDuration = 300;

type AnyRow = Record<string, any>;

type DurableCheckpoint = {
  version: string;
  step: "INIT" | "CHAPTER" | "GLOBAL" | "PERSIST";
  chapter_index: number;
};

const WORKER_VERSION = "refinery-11b2-durable-1.0.0";
const DEFAULT_LEASE_SECONDS = 600;

function serviceClient() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    "";

  if (!url || !key) {
    throw new Error(
      "Refinery worker: faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function workerSecret(req: any): string {
  const direct = String(
    req.headers?.["x-os4-worker-secret"] ||
      req.headers?.["x-refinery-worker-secret"] ||
      "",
  ).trim();

  if (direct) return direct;

  const auth = String(req.headers?.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);

  return String(match?.[1] || "").trim();
}

function authorize(req: any) {
  const expected = String(
    process.env.REFINERY_WORKER_SECRET ||
      process.env.OS4_WORKER_SECRET ||
      "",
  ).trim();

  if (!expected) {
    throw Object.assign(
      new Error(
        "Configura REFINERY_WORKER_SECRET u OS4_WORKER_SECRET.",
      ),
      { statusCode: 500 },
    );
  }

  if (workerSecret(req) !== expected) {
    throw Object.assign(
      new Error("Unauthorized"),
      { statusCode: 401 },
    );
  }
}

function checkpointOf(job: AnyRow): DurableCheckpoint {
  const raw =
    job?.checkpoint && typeof job.checkpoint === "object"
      ? job.checkpoint
      : {};

  const step = String(raw.step || "INIT").toUpperCase();

  return {
    version: String(raw.version || "11B.2"),
    step: (
      ["INIT", "CHAPTER", "GLOBAL", "PERSIST"].includes(step)
        ? step
        : "INIT"
    ) as DurableCheckpoint["step"],
    chapter_index: Math.max(
      0,
      Number(raw.chapter_index || 0) || 0,
    ),
  };
}

function usageOf(result: AnyRow) {
  const raw =
    result?.usage && typeof result.usage === "object"
      ? result.usage
      : {};

  return {
    inputTokens: Math.max(
      0,
      Number(raw.inputTokens || 0) || 0,
    ),
    outputTokens: Math.max(
      0,
      Number(raw.outputTokens || 0) || 0,
    ),
    totalTokens: Math.max(
      0,
      Number(raw.totalTokens || 0) || 0,
    ),
    calls: Math.max(
      0,
      Number(raw.calls || 0) || 0,
    ),
  };
}

function mergeUsage(base: AnyRow, extra: AnyRow) {
  const a = usageOf({ usage: base });
  const b = usageOf({ usage: extra });

  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    calls: a.calls + 1,
  };
}

async function heartbeat(
  supabase: ReturnType<typeof serviceClient>,
  jobId: string,
  workerId: string,
) {
  const { data, error } = await supabase.rpc(
    "refinery_heartbeat_audit_job",
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_lease_seconds: DEFAULT_LEASE_SECONDS,
    },
  );

  if (error) throw error;

  if (!data) {
    throw new Error(
      "Refinery worker: lease perdido.",
    );
  }
}

async function release(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  checkpoint: DurableCheckpoint,
  result: AnyRow,
  progress: number,
) {
  const { data, error } = await supabase.rpc(
    "refinery_release_audit_job",
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_checkpoint: checkpoint,
      p_result: result,
      p_progress: Math.max(
        0,
        Math.min(100, progress),
      ),
    },
  );

  if (error) throw error;

  if (!data) {
    throw new Error(
      "Refinery worker: no pudo liberar el job.",
    );
  }
}

async function finish(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  result: AnyRow,
) {
  const { data, error } = await supabase.rpc(
    "refinery_complete_audit_job",
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_result: result,
    },
  );

  if (error) throw error;

  if (!data) {
    throw new Error(
      "Refinery worker: no pudo completar el job.",
    );
  }
}

async function fail(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  error: unknown,
) {
  const message = String(
    (error as any)?.message || error,
  ).slice(0, 6000);

  const { data, error: rpcError } = await supabase.rpc(
    "refinery_fail_audit_job",
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error: message,
    },
  );

  if (rpcError) throw rpcError;

  return data;
}

async function loadProject(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !data) {
    throw error || new Error("Proyecto no encontrado.");
  }

  return data;
}

function splitMaster(master: string): ManuscriptChapterInput[] {
  const pieces = clean(master)
    .split(/\n(?=##\s+)/u)
    .map((x) => x.trim())
    .filter(Boolean);

  return pieces
    .map((piece, index) => {
      const titleMatch = piece.match(/^##\s+(.+)$/mu);
      const title = clean(
        titleMatch?.[1] || `Capítulo ${index + 1}`,
      );
      const content = piece
        .replace(/^##\s+.+$/mu, "")
        .trim();

      return {
        chapterNumber: index + 1,
        title,
        content,
      };
    })
    .filter((x) => clean(x.content));
}

async function loadAllChapters(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
): Promise<ManuscriptChapterInput[]> {
  const { data: sections, error } = await supabase
    .from("sections")
    .select(
      "id,chapter_number,title,content,status",
    )
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .order("chapter_number", {
      ascending: true,
    });

  if (error) throw error;

  const chapters = (sections || [])
    .filter((x: AnyRow) => clean(x.content))
    .map((x: AnyRow, index: number) => ({
      id: clean(x.id),
      chapterNumber: Math.max(
        1,
        Number(x.chapter_number || index + 1) ||
          index + 1,
      ),
      title:
        clean(x.title) ||
        `Capítulo ${index + 1}`,
      content: String(x.content || ""),
    }));

  if (chapters.length) return chapters;

  const { data: masters, error: masterError } =
    await supabase
      .from("master_documents")
      .select("content")
      .eq("project_id", projectId)
      .order("version", {
        ascending: false,
      })
      .limit(1);

  if (masterError) throw masterError;

  return splitMaster(
    String(masters?.[0]?.content || ""),
  );
}

async function loadSingleChapter(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
  chapterNumber: number,
): Promise<ManuscriptChapterInput | null> {
  const { data, error } = await supabase
    .from("sections")
    .select(
      "id,chapter_number,title,content,status",
    )
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .eq("chapter_number", chapterNumber)
    .limit(1);

  if (error) throw error;

  if (data?.[0] && clean(data[0].content)) {
    return {
      id: clean(data[0].id),
      chapterNumber,
      title:
        clean(data[0].title) ||
        `Capítulo ${chapterNumber}`,
      content: String(data[0].content || ""),
    };
  }

  const chapters = await loadAllChapters(
    supabase,
    projectId,
  );

  return (
    chapters.find(
      (x) => x.chapterNumber === chapterNumber,
    ) || null
  );
}

function baseResult(job: AnyRow): AnyRow {
  return {
    ...(job?.result &&
    typeof job.result === "object"
      ? job.result
      : {}),
  };
}

async function processInit(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  const project = await loadProject(
    supabase,
    job.project_id,
  );

  const chapters = await loadAllChapters(
    supabase,
    job.project_id,
  );

  if (!chapters.length) {
    throw new Error(
      "El proyecto no contiene capítulos auditables.",
    );
  }

  const deterministic =
    manuscriptDeterministicMetrics(chapters);

  const currentWords = chapters.reduce(
    (sum, chapter) =>
      sum + wordCount(chapter.content),
    0,
  );

  const result = {
    ...baseResult(job),
    version: WORKER_VERSION,
    mode:
      String(job.mode || "").toUpperCase() ===
      "SUPREME"
        ? "SUPREME"
        : "DEEP",
    projectId: clean(project.id),
    projectTitle: clean(project.title),
    createdAt:
      job.created_at || new Date().toISOString(),
    chapterCount: chapters.length,
    currentWords,
    deterministic,
    chapter_manifest: chapters.map((x) => ({
      id: x.id || null,
      chapterNumber: x.chapterNumber,
      title: x.title,
    })),
    chapters: [],
    warnings: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
    },
  };

  await release(
    supabase,
    job,
    workerId,
    {
      version: "11B.2",
      step: "CHAPTER",
      chapter_index: 0,
    },
    result,
    2,
  );
}

async function processChapter(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  const cp = checkpointOf(job);
  const result = baseResult(job);

  const manifest = Array.isArray(
    result.chapter_manifest,
  )
    ? result.chapter_manifest
    : [];

  if (!manifest.length) {
    throw new Error(
      "Checkpoint durable inválido: chapter_manifest vacío.",
    );
  }

  if (cp.chapter_index >= manifest.length) {
    await release(
      supabase,
      job,
      workerId,
      {
        version: "11B.2",
        step: "GLOBAL",
        chapter_index: cp.chapter_index,
      },
      result,
      90,
    );
    return;
  }

  const item = manifest[cp.chapter_index];
  const chapterNumber = Math.max(
    1,
    Number(item.chapterNumber) || 1,
  );

  const chapter = await loadSingleChapter(
    supabase,
    job.project_id,
    chapterNumber,
  );

  if (!chapter) {
    throw new Error(
      `No pude cargar el capítulo ${chapterNumber}.`,
    );
  }

  const project = await loadProject(
    supabase,
    job.project_id,
  );

  const mode: ManuscriptAuditMode =
    String(job.mode || "").toUpperCase() ===
    "SUPREME"
      ? "SUPREME"
      : "DEEP";

  const step = await auditSingleChapterStep({
    project,
    chapter,
    mode,
  });

  const previousAudits = Array.isArray(
    result.chapters,
  )
    ? result.chapters
    : [];

  const withoutSame = previousAudits.filter(
    (x: AnyRow) =>
      Number(x.chapterNumber) !== chapterNumber,
  );

  const audits = [
    ...withoutSame,
    step.audit,
  ].sort(
    (a: AnyRow, b: AnyRow) =>
      Number(a.chapterNumber) -
      Number(b.chapterNumber),
  );

  const warnings = Array.isArray(result.warnings)
    ? [...result.warnings]
    : [];

  if (
    step.warning &&
    !warnings.includes(step.warning)
  ) {
    warnings.push(step.warning);
  }

  const usage = mergeUsage(
    result.usage,
    step.usage,
  );

  const nextIndex = cp.chapter_index + 1;
  const done = nextIndex >= manifest.length;

  const progress = done
    ? 90
    : 5 +
      Math.round(
        (nextIndex / manifest.length) * 82,
      );

  await release(
    supabase,
    job,
    workerId,
    {
      version: "11B.2",
      step: done ? "GLOBAL" : "CHAPTER",
      chapter_index: nextIndex,
    },
    {
      ...result,
      model: step.model,
      chapters: audits,
      warnings,
      usage,
      last_completed_chapter: chapterNumber,
      updatedAt: new Date().toISOString(),
    },
    progress,
  );
}

async function processGlobal(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  const result = baseResult(job);
  const project = await loadProject(
    supabase,
    job.project_id,
  );
  const chapters = await loadAllChapters(
    supabase,
    job.project_id,
  );

  const audits = (
    Array.isArray(result.chapters)
      ? result.chapters
      : []
  ) as ManuscriptChapterAudit[];

  if (audits.length !== chapters.length) {
    throw new Error(
      `Auditoría incompleta: ${audits.length}/${chapters.length} capítulos.`,
    );
  }

  const deterministic =
    result.deterministic ||
    manuscriptDeterministicMetrics(chapters);

  const mode: ManuscriptAuditMode =
    String(job.mode || "").toUpperCase() ===
    "SUPREME"
      ? "SUPREME"
      : "DEEP";

  const step =
    await auditGlobalManuscriptStep({
      project,
      chapters,
      audits,
      deterministic,
      mode,
    });

  const usage = mergeUsage(
    result.usage,
    step.usage,
  );

  await release(
    supabase,
    job,
    workerId,
    {
      version: "11B.2",
      step: "PERSIST",
      chapter_index: chapters.length,
    },
    {
      ...result,
      model: step.model,
      currentWords: step.currentWords,
      recommendedWords:
        step.global.recommendedWordCount,
      recommendedReductionPercent:
        step.global.recommendedReductionPercent,
      global: step.global,
      usage,
      updatedAt: new Date().toISOString(),
    },
    97,
  );
}

async function persistEvaluation(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  result: AnyRow,
) {
  const { data: existing, error: existingError } =
    await supabase
      .from("manuscript_evaluations")
      .select("id")
      .eq("job_id", job.id)
      .limit(1);

  if (existingError) throw existingError;

  if (existing?.[0]?.id) {
    return String(existing[0].id);
  }

  const row = {
    job_id: job.id,
    user_id: job.user_id,
    project_id: job.project_id,
    audit_version:
      result.version || WORKER_VERSION,
    mode:
      String(job.mode || "DEEP").toUpperCase() ===
      "SUPREME"
        ? "SUPREME"
        : "DEEP",
    status: "COMPLETED",
    overall_score: Number(
      result?.global?.overallScore || 0,
    ),
    current_words: Number(
      result.currentWords || 0,
    ),
    recommended_words: Number(
      result.recommendedWords || 0,
    ),
    recommended_reduction_percent:
      Number(
        result.recommendedReductionPercent || 0,
      ),
    model: clean(result.model),
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

async function processPersist(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  const result = baseResult(job);

  if (!result.global) {
    throw new Error(
      "No existe auditoría global para persistir.",
    );
  }

  const evaluationId = await persistEvaluation(
    supabase,
    job,
    result,
  );

  await finish(
    supabase,
    job,
    workerId,
    {
      ...result,
      evaluation_id: evaluationId,
      completedAt: new Date().toISOString(),
    },
  );
}

async function processClaimedJob(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  await heartbeat(
    supabase,
    job.id,
    workerId,
  );

  const cp = checkpointOf(job);

  if (cp.step === "INIT") {
    await processInit(
      supabase,
      job,
      workerId,
    );
    return;
  }

  if (cp.step === "CHAPTER") {
    await processChapter(
      supabase,
      job,
      workerId,
    );
    return;
  }

  if (cp.step === "GLOBAL") {
    await processGlobal(
      supabase,
      job,
      workerId,
    );
    return;
  }

  if (cp.step === "PERSIST") {
    await processPersist(
      supabase,
      job,
      workerId,
    );
    return;
  }

  throw new Error(
    `Checkpoint no soportado: ${cp.step}`,
  );
}

async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk,
    );
  }

  const raw = Buffer.concat(chunks)
    .toString("utf8")
    .trim();

  return raw ? JSON.parse(raw) : {};
}

export default async function handler(
  req: any,
  res: any,
) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (
    !["GET", "POST"].includes(
      String(req.method || "").toUpperCase(),
    )
  ) {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  const started = Date.now();
  let claimed: AnyRow | null = null;
  let workerId = "";

  try {
    authorize(req);

    const body =
      req.method === "POST"
        ? await readBody(req).catch(() => ({}))
        : {};

    const supabase = serviceClient();

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        worker_version: WORKER_VERSION,
        durable: true,
        step_granularity:
          "one durable audit step per invocation",
        supports: [
          "atomic_lease",
          "heartbeat",
          "one_chapter_per_tick",
          "checkpoint_resume",
          "retry_backoff",
          "dead_letter",
          "idempotent_final_persist",
        ],
      });
    }

    workerId =
      String(body?.worker_id || "").trim() ||
      `refinery-${process.env.VERCEL_REGION || "local"}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    try {
      await supabase.rpc(
        "refinery_sweep_audit_jobs",
      );
    } catch {}

    const { data, error } = await supabase.rpc(
      "refinery_claim_audit_job",
      {
        p_worker_id: workerId,
        p_lease_seconds:
          DEFAULT_LEASE_SECONDS,
      },
    );

    if (error) throw error;

    claimed = Array.isArray(data)
      ? data[0] || null
      : data || null;

    if (!claimed) {
      return res.status(200).json({
        ok: true,
        worker_version: WORKER_VERSION,
        claimed: false,
        message:
          "No hay auditorías disponibles.",
        latency_ms: Date.now() - started,
      });
    }

    try {
      await processClaimedJob(
        supabase,
        claimed,
        workerId,
      );
    } catch (error) {
      await fail(
        supabase,
        claimed,
        workerId,
        error,
      ).catch(() => {});
      throw error;
    }

    const { data: current } = await supabase
      .from("manuscript_audit_jobs")
      .select(
        "id,status,progress,checkpoint,attempts,max_attempts,last_error,result",
      )
      .eq("id", claimed.id)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      worker_version: WORKER_VERSION,
      claimed: true,
      job_id: claimed.id,
      job: current || null,
      latency_ms: Date.now() - started,
    });
  } catch (error: any) {
    const statusCode =
      Number(error?.statusCode || 500) || 500;

    return res.status(statusCode).json({
      ok: false,
      error: String(
        error?.message || error,
      ),
      worker_version: WORKER_VERSION,
      job_id: claimed?.id || null,
      worker_id: workerId || null,
      latency_ms: Date.now() - started,
    });
  }
}

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { manuscriptDeterministicMetrics } from "../../lib/refinery/metrics";
import type {
  ManuscriptChapterAudit,
  ManuscriptChapterInput,
} from "../../lib/refinery/types";
import type {
  RefinementJobResult,
  RefinementPlanItem,
} from "../../lib/refinery-execution/types";
import {
  auditGlobalManuscriptStep,
  auditSingleChapterStep,
} from "../../server/refinery-runtime";
import {
  buildRefinementPlan,
  evaluateEditorialDelta,
  refineChapterStep,
} from "../../server/refinery-execution-runtime";

export const maxDuration = 300;

type AnyRow = Record<string, any>;
type Checkpoint = {
  version: string;
  step: "INIT" | "REFINE" | "DELTA" | "FINAL_GLOBAL";
  item_index: number;
};

const WORKER_VERSION = "refinery-11b3-execution-1.0.0";
const LEASE_SECONDS = 600;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw new Error("11B.3 worker: faltan credenciales server-side de Supabase.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function workerSecret(req: any): string {
  const direct = clean(
    req.headers?.["x-refinery-worker-secret"] || req.headers?.["x-os4-worker-secret"],
  );
  if (direct) return direct;
  const match = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  return clean(match?.[1]);
}

function authorize(req: any) {
  const expected = clean(process.env.REFINERY_WORKER_SECRET || process.env.OS4_WORKER_SECRET);
  if (!expected) {
    throw Object.assign(new Error("Configura REFINERY_WORKER_SECRET u OS4_WORKER_SECRET."), {
      statusCode: 500,
    });
  }
  if (workerSecret(req) !== expected) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}

function checkpointOf(job: AnyRow): Checkpoint {
  const raw = job?.checkpoint && typeof job.checkpoint === "object" ? job.checkpoint : {};
  const step = clean(raw.step || "INIT").toUpperCase();
  return {
    version: clean(raw.version || "11B.3"),
    step: (["INIT", "REFINE", "DELTA", "FINAL_GLOBAL"].includes(step)
      ? step
      : "INIT") as Checkpoint["step"],
    item_index: Math.max(0, Number(raw.item_index || 0) || 0),
  };
}

function usageOf(result: AnyRow) {
  const u = result?.usage && typeof result.usage === "object" ? result.usage : {};
  return {
    inputTokens: Math.max(0, Number(u.inputTokens || 0) || 0),
    outputTokens: Math.max(0, Number(u.outputTokens || 0) || 0),
    totalTokens: Math.max(0, Number(u.totalTokens || 0) || 0),
    calls: Math.max(0, Number(u.calls || 0) || 0),
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

function hash(content: string) {
  return crypto.createHash("sha256").update(String(content || ""), "utf8").digest("hex");
}

async function heartbeat(supabase: ReturnType<typeof serviceClient>, jobId: string, workerId: string) {
  const { data, error } = await supabase.rpc("refinery_heartbeat_refinement_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;
  if (!data) throw new Error("11B.3 worker: lease perdido.");
}

async function release(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  checkpoint: Checkpoint,
  result: AnyRow,
  progress: number,
) {
  const { data, error } = await supabase.rpc("refinery_release_refinement_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_checkpoint: checkpoint,
    p_result: result,
    p_progress: Math.max(0, Math.min(100, progress)),
  });
  if (error) throw error;
  if (!data) throw new Error("11B.3 worker: no pudo liberar el job.");
}

async function finish(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  result: AnyRow,
) {
  const { data, error } = await supabase.rpc("refinery_complete_refinement_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_result: result,
  });
  if (error) throw error;
  if (!data) throw new Error("11B.3 worker: no pudo completar el job.");
}

async function fail(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  error: unknown,
) {
  const message = String((error as any)?.message || error).slice(0, 6000);
  const { data, error: rpcError } = await supabase.rpc("refinery_fail_refinement_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: message,
  });
  if (rpcError) throw rpcError;
  return data;
}

async function loadProject(supabase: ReturnType<typeof serviceClient>, projectId: string) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (error || !data) throw error || new Error("Proyecto no encontrado.");
  return data;
}

function splitMaster(master: string): ManuscriptChapterInput[] {
  return clean(master)
    .split(/\n(?=##\s+)/u)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((piece, index) => {
      const titleMatch = piece.match(/^##\s+(.+)$/mu);
      return {
        chapterNumber: index + 1,
        title: clean(titleMatch?.[1] || `Capítulo ${index + 1}`),
        content: piece.replace(/^##\s+.+$/mu, "").trim(),
      };
    })
    .filter((x) => clean(x.content));
}

async function loadChapters(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
): Promise<ManuscriptChapterInput[]> {
  const { data, error } = await supabase
    .from("sections")
    .select("id,chapter_number,title,content,status")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .order("chapter_number", { ascending: true });
  if (error) throw error;

  const chapters = (data || [])
    .filter((x: AnyRow) => clean(x.content))
    .map((x: AnyRow, index: number) => ({
      id: clean(x.id),
      chapterNumber: Math.max(1, Number(x.chapter_number || index + 1) || index + 1),
      title: clean(x.title) || `Capítulo ${index + 1}`,
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
  return splitMaster(String(masters?.[0]?.content || ""));
}

async function loadEvaluation(
  supabase: ReturnType<typeof serviceClient>,
  evaluationId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("manuscript_evaluations")
    .select("*")
    .eq("id", evaluationId)
    .eq("project_id", projectId)
    .single();
  if (error || !data) throw error || new Error("Evaluación no encontrada.");
  if (!data.result?.global || !Array.isArray(data.result?.chapters)) {
    throw new Error("Evaluación sin result.global/result.chapters.");
  }
  return data;
}

function resultOf(job: AnyRow): RefinementJobResult & AnyRow {
  return {
    ...(job?.result && typeof job.result === "object" ? job.result : {}),
    plan: Array.isArray(job?.result?.plan) ? job.result.plan : [],
    researchGaps: Array.isArray(job?.result?.researchGaps) ? job.result.researchGaps : [],
    structuralPlan: Array.isArray(job?.result?.structuralPlan) ? job.result.structuralPlan : [],
    approvedVersionIds: Array.isArray(job?.result?.approvedVersionIds) ? job.result.approvedVersionIds : [],
    rejectedVersionIds: Array.isArray(job?.result?.rejectedVersionIds) ? job.result.rejectedVersionIds : [],
    usage: usageOf(job?.result || {}),
  } as RefinementJobResult & AnyRow;
}

function nextProgress(index: number, total: number, half = 0) {
  if (!total) return 90;
  return Number((5 + ((index + half) / total) * 82).toFixed(2));
}

async function createVersion(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  chapter: ManuscriptChapterInput,
  audit: ManuscriptChapterAudit,
  plan: RefinementPlanItem,
  candidate: AnyRow,
) {
  const { data, error } = await supabase.rpc("refinery_create_chapter_version", {
    p_user_id: job.user_id,
    p_project_id: job.project_id,
    p_job_id: job.id,
    p_evaluation_id: job.evaluation_id,
    p_section_id: chapter.id || null,
    p_chapter_number: chapter.chapterNumber,
    p_title: chapter.title,
    p_action: plan.action,
    p_source_content_hash: hash(chapter.content),
    p_content: candidate.content,
    p_agent_chain: candidate.agentChain || [],
    p_before_audit: audit,
    p_candidate_meta: {
      summary: candidate.summary,
      changes: candidate.changes,
      removedIdeas: candidate.removedIdeas,
      addedIdeas: candidate.addedIdeas,
    },
    p_research_gaps: candidate.researchNeeds || [],
  });
  if (error) throw error;
  return String(data || "");
}

async function processInit(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  const project = await loadProject(supabase, job.project_id);
  const chapters = await loadChapters(supabase, job.project_id);
  const evaluation = await loadEvaluation(supabase, job.evaluation_id, job.project_id);
  if (!chapters.length) throw new Error("No hay capítulos refinables.");

  const built = buildRefinementPlan({
    chapters,
    chapterAudits: evaluation.result.chapters,
    global: evaluation.result.global,
  });

  const result = resultOf(job);
  result.version = WORKER_VERSION;
  result.projectId = job.project_id;
  result.projectTitle = clean(project.title);
  result.evaluationId = job.evaluation_id;
  result.baselineOverallScore = Number(evaluation.result.global.overallScore || 0);
  result.chapterCount = chapters.length;
  result.plan = built.plan;
  result.researchGaps = built.researchGaps;
  result.structuralPlan = built.structuralPlan;
  result.approvedVersionIds = [];
  result.rejectedVersionIds = [];
  result.repairContext = {};

  await release(
    supabase,
    job,
    workerId,
    { version: "11B.3", step: "REFINE", item_index: 0 },
    result,
    5,
  );

  return { step: "INIT", chapterCount: chapters.length, planned: built.plan.length };
}

async function advanceSkipped(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  result: RefinementJobResult & AnyRow,
  index: number,
) {
  const next = index + 1;
  const total = result.plan.length;
  const step: Checkpoint["step"] = next >= total ? "FINAL_GLOBAL" : "REFINE";
  await release(
    supabase,
    job,
    workerId,
    { version: "11B.3", step, item_index: next },
    result,
    step === "FINAL_GLOBAL" ? 90 : nextProgress(next, total),
  );
}

async function processRefine(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  cp: Checkpoint,
) {
  const result = resultOf(job);
  const plan = result.plan[cp.item_index];
  if (!plan) {
    await release(
      supabase,
      job,
      workerId,
      { version: "11B.3", step: "FINAL_GLOBAL", item_index: cp.item_index },
      result,
      90,
    );
    return { step: "REFINE", skipped: true, reason: "plan_complete" };
  }

  if (["PRESERVED", "NEEDS_RESEARCH", "STRUCTURAL_PLAN", "APPROVED", "REJECTED"].includes(plan.status)) {
    await advanceSkipped(supabase, job, workerId, result, cp.item_index);
    return { step: "REFINE", chapter: plan.chapterNumber, skipped: true, status: plan.status };
  }

  const [project, chapters, evaluation] = await Promise.all([
    loadProject(supabase, job.project_id),
    loadChapters(supabase, job.project_id),
    loadEvaluation(supabase, job.evaluation_id, job.project_id),
  ]);
  const chapter = chapters.find((x) => x.chapterNumber === plan.chapterNumber);
  const audit = evaluation.result.chapters.find((x: AnyRow) => Number(x.chapterNumber) === plan.chapterNumber);
  if (!chapter || !audit) throw new Error(`Capítulo/auditoría ${plan.chapterNumber} no encontrado.`);

  await heartbeat(supabase, job.id, workerId);
  const refined = await refineChapterStep({
    project,
    chapter,
    audit,
    plan,
    mode: job.mode,
    repairContext: result.repairContext?.[String(plan.chapterNumber)] || null,
  });
  result.usage = mergeUsage(result.usage, refined.usage);

  if (refined.candidate.status === "NEEDS_RESEARCH") {
    plan.status = "NEEDS_RESEARCH";
    plan.reason = refined.candidate.researchNeeds.join(" | ") || "El agente determinó que la mejora requiere investigación.";
    result.researchGaps.push({
      chapterNumber: plan.chapterNumber,
      severity: "HIGH",
      reason: plan.reason,
      unsupportedClaims: audit.unsupportedClaims || [],
      requestedEvidence: refined.candidate.researchNeeds,
      blocksActions: [plan.action],
    });
    await advanceSkipped(supabase, job, workerId, result, cp.item_index);
    return { step: "REFINE", chapter: plan.chapterNumber, status: "NEEDS_RESEARCH" };
  }

  const versionId = await createVersion(supabase, job, chapter, audit, plan, refined.candidate);
  if (!versionId) throw new Error("No se creó version_id.");
  plan.versionId = versionId;
  plan.status = "CANDIDATE";

  await release(
    supabase,
    job,
    workerId,
    { version: "11B.3", step: "DELTA", item_index: cp.item_index },
    result,
    nextProgress(cp.item_index, result.plan.length, 0.5),
  );
  return { step: "REFINE", chapter: plan.chapterNumber, versionId };
}

async function processDelta(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  cp: Checkpoint,
) {
  const result = resultOf(job);
  const plan = result.plan[cp.item_index];
  if (!plan?.versionId) throw new Error("DELTA sin versionId.");

  const { data: version, error: versionError } = await supabase
    .from("manuscript_chapter_versions")
    .select("*")
    .eq("id", plan.versionId)
    .eq("job_id", job.id)
    .single();
  if (versionError || !version) throw versionError || new Error("Versión candidata no encontrada.");

  const [project, chapters, evaluation] = await Promise.all([
    loadProject(supabase, job.project_id),
    loadChapters(supabase, job.project_id),
    loadEvaluation(supabase, job.evaluation_id, job.project_id),
  ]);
  const chapter = chapters.find((x) => x.chapterNumber === plan.chapterNumber);
  const before = evaluation.result.chapters.find((x: AnyRow) => Number(x.chapterNumber) === plan.chapterNumber);
  if (!chapter || !before) throw new Error(`Capítulo/auditoría ${plan.chapterNumber} no encontrado.`);

  await heartbeat(supabase, job.id, workerId);
  const audited = await auditSingleChapterStep({
    project,
    chapter: { ...chapter, content: String(version.content || "") },
    mode: job.mode,
  });
  result.usage = mergeUsage(result.usage, audited.usage);

  const editorialDelta = evaluateEditorialDelta({
    action: plan.action,
    before,
    after: audited.audit,
    beforeContent: chapter.content,
    afterContent: String(version.content || ""),
  });

  const maxRepairAttempts = Math.max(0, Number(job.policy?.maxRepairAttempts ?? 1) || 1);
  const canRepair =
    !editorialDelta.accepted &&
    plan.repairAttempts < maxRepairAttempts &&
    !editorialDelta.hardGateFailures.some((x) =>
      ["factuality_regressed", "evidence_regressed", "unsupported_claims_increased"].includes(x),
    );

  const finalStatus = editorialDelta.accepted ? "APPROVED" : "REJECTED";
  const { error: updateError } = await supabase
    .from("manuscript_chapter_versions")
    .update({
      status: finalStatus,
      after_audit: audited.audit,
      editorial_delta: editorialDelta,
      decided_at: new Date().toISOString(),
    })
    .eq("id", version.id)
    .eq("job_id", job.id);
  if (updateError) throw updateError;

  if (editorialDelta.accepted) {
    plan.status = "APPROVED";
    result.approvedVersionIds = Array.from(new Set([...result.approvedVersionIds, version.id]));
  } else if (canRepair) {
    plan.status = "PENDING";
    plan.repairAttempts += 1;
    plan.versionId = undefined;
    result.repairContext ||= {};
    result.repairContext[String(plan.chapterNumber)] = {
      previousDelta: editorialDelta,
      previousAfterAudit: audited.audit,
      instruction: "Repara únicamente las regresiones detectadas; no agregues hechos.",
    };
    result.rejectedVersionIds = Array.from(new Set([...result.rejectedVersionIds, version.id]));
    await release(
      supabase,
      job,
      workerId,
      { version: "11B.3", step: "REFINE", item_index: cp.item_index },
      result,
      nextProgress(cp.item_index, result.plan.length, 0.25),
    );
    return { step: "DELTA", chapter: plan.chapterNumber, accepted: false, repair: true };
  } else {
    plan.status = "REJECTED";
    result.rejectedVersionIds = Array.from(new Set([...result.rejectedVersionIds, version.id]));
  }

  await advanceSkipped(supabase, job, workerId, result, cp.item_index);
  return {
    step: "DELTA",
    chapter: plan.chapterNumber,
    accepted: editorialDelta.accepted,
    delta: editorialDelta.overallDelta,
  };
}

async function processFinalGlobal(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
) {
  const result = resultOf(job);
  const [project, originalChapters, evaluation] = await Promise.all([
    loadProject(supabase, job.project_id),
    loadChapters(supabase, job.project_id),
    loadEvaluation(supabase, job.evaluation_id, job.project_id),
  ]);

  const { data: approved, error } = await supabase
    .from("manuscript_chapter_versions")
    .select("id,chapter_number,content,after_audit,status")
    .eq("job_id", job.id)
    .eq("status", "APPROVED")
    .order("chapter_number", { ascending: true });
  if (error) throw error;

  const byChapter = new Map<number, AnyRow>();
  for (const row of approved || []) byChapter.set(Number(row.chapter_number), row);

  const projectedChapters = originalChapters.map((chapter) => {
    const version = byChapter.get(chapter.chapterNumber);
    return version ? { ...chapter, content: String(version.content || chapter.content) } : chapter;
  });

  const projectedAudits: ManuscriptChapterAudit[] = originalChapters.map((chapter) => {
    const version = byChapter.get(chapter.chapterNumber);
    if (version?.after_audit) return version.after_audit as ManuscriptChapterAudit;
    return evaluation.result.chapters.find(
      (x: AnyRow) => Number(x.chapterNumber) === chapter.chapterNumber,
    ) as ManuscriptChapterAudit;
  });

  const deterministic = manuscriptDeterministicMetrics(projectedChapters);
  await heartbeat(supabase, job.id, workerId);
  const globalAfter = await auditGlobalManuscriptStep({
    project,
    chapters: projectedChapters,
    audits: projectedAudits,
    deterministic,
    mode: job.mode,
  });
  result.usage = mergeUsage(result.usage, globalAfter.usage);

  const before = evaluation.result.global;
  const after = globalAfter.global;
  const overallDelta = Number((Number(after.overallScore || 0) - Number(before.overallScore || 0)).toFixed(2));
  const factualityDelta = Number((Number(after.scores?.factuality || 0) - Number(before.scores?.factuality || 0)).toFixed(2));
  const evidenceDelta = Number((Number(after.scores?.evidence || 0) - Number(before.scores?.evidence || 0)).toFixed(2));
  const hardGateFailures: string[] = [];
  if (factualityDelta < -0.15) hardGateFailures.push("global_factuality_regressed");
  if (evidenceDelta < -0.15) hardGateFailures.push("global_evidence_regressed");
  if (overallDelta < -0.05) hardGateFailures.push("global_score_regressed");

  result.projectedOverallScore = Number(after.overallScore || 0);
  result.projectedVerdict = clean(after.verdict);
  result.masterCandidateApproved = hardGateFailures.length === 0 && overallDelta >= 0.1;
  result.globalDelta = {
    beforeScore: Number(before.overallScore || 0),
    afterScore: Number(after.overallScore || 0),
    overallDelta,
    factualityDelta,
    evidenceDelta,
    hardGateFailures,
    beforeVerdict: before.verdict,
    afterVerdict: after.verdict,
  };
  result.projectedGlobal = after;
  result.summary = {
    preserved: result.plan.filter((x) => x.status === "PRESERVED").length,
    needsResearch: result.plan.filter((x) => x.status === "NEEDS_RESEARCH").length,
    structuralPlan: result.plan.filter((x) => x.status === "STRUCTURAL_PLAN").length,
    approved: result.plan.filter((x) => x.status === "APPROVED").length,
    rejected: result.plan.filter((x) => x.status === "REJECTED").length,
  };
  result.finishedAt = new Date().toISOString();

  await finish(supabase, job, workerId, result);
  return {
    step: "FINAL_GLOBAL",
    completed: true,
    baseline: result.baselineOverallScore,
    projected: result.projectedOverallScore,
    masterCandidateApproved: result.masterCandidateApproved,
  };
}

async function claimJob(supabase: ReturnType<typeof serviceClient>, workerId: string) {
  const { data, error } = await supabase.rpc("refinery_claim_refinement_job", {
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export default async function handler(req: any, res: any) {
  if (String(req.method || "").toUpperCase() !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    authorize(req);
    const supabase = serviceClient();
    const workerId = clean(req.body?.worker_id || `refinery-11b3-${crypto.randomUUID()}`);
    const job = await claimJob(supabase, workerId);
    if (!job) return res.status(200).json({ ok: true, idle: true, message: "No hay refinamientos disponibles." });

    const cp = checkpointOf(job);
    try {
      let outcome: AnyRow;
      if (cp.step === "INIT") outcome = await processInit(supabase, job, workerId);
      else if (cp.step === "REFINE") outcome = await processRefine(supabase, job, workerId, cp);
      else if (cp.step === "DELTA") outcome = await processDelta(supabase, job, workerId, cp);
      else outcome = await processFinalGlobal(supabase, job, workerId);

      return res.status(200).json({ ok: true, job_id: job.id, checkpoint: cp, outcome });
    } catch (error) {
      const retry = await fail(supabase, job, workerId, error);
      return res.status(500).json({
        ok: false,
        job_id: job.id,
        error: String((error as any)?.message || error),
        retry,
      });
    }
  } catch (error: any) {
    return res.status(Number(error?.statusCode || 500) || 500).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}

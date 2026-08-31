import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { DeepWorkDepth, DeepWorkResult, DeepWorkStep } from "../../lib/deep-work/types.js";
import {
  criticCouncilStep,
  deepContextStep,
  deepDraftStep,
  deepModePolicy,
  deepPlanStep,
  deepQualityStep,
  repairStep,
  synthesisStep,
} from "../../server/deep-work-runtime.js";

export const maxDuration = 300;
type AnyRow = Record<string, any>;
type Checkpoint = { version: string; step: DeepWorkStep; draft_index?: number };
const WORKER_VERSION = "deep-work-11c-1.0.0";
const LEASE_SECONDS = 600;

function clean(value: unknown) { return String(value ?? "").trim(); }
function hash(content: string) { return crypto.createHash("sha256").update(String(content || ""), "utf8").digest("hex"); }
function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw new Error("11C worker: faltan credenciales server-side de Supabase.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function requestSecret(req: any) {
  return clean(req.headers?.["x-deep-worker-secret"] || req.headers?.["x-refinery-worker-secret"] || req.headers?.["x-os4-worker-secret"]);
}
function expectedSecret() {
  return clean(process.env.DEEP_WORKER_SECRET || process.env.REFINERY_WORKER_SECRET || process.env.OS4_WORKER_SECRET);
}
function addUsage(base: AnyRow, next: AnyRow) {
  const a = base || {};
  const b = next || {};
  return {
    inputTokens: Number(a.inputTokens || 0) + Number(b.inputTokens || 0),
    outputTokens: Number(a.outputTokens || 0) + Number(b.outputTokens || 0),
    totalTokens: Number(a.totalTokens || 0) + Number(b.totalTokens || 0),
    calls: Number(a.calls || 0) + Number(b.calls || 1),
  };
}
function resultOf(job: AnyRow): DeepWorkResult & AnyRow {
  return {
    ...(job.result && typeof job.result === "object" ? job.result : {}),
    version: WORKER_VERSION,
    drafts: Array.isArray(job.result?.drafts) ? job.result.drafts : [],
    artifactIds: Array.isArray(job.result?.artifactIds) ? job.result.artifactIds : [],
    repairAttempts: Number(job.result?.repairAttempts || 0),
    usage: job.result?.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
  } as DeepWorkResult & AnyRow;
}
async function heartbeat(s: ReturnType<typeof serviceClient>, id: string, worker: string) {
  const { data, error } = await s.rpc("deep_heartbeat_work_job", { p_job_id: id, p_worker_id: worker, p_lease_seconds: LEASE_SECONDS });
  if (error) throw error;
  if (!data) throw new Error("11C worker: lease perdido.");
}
async function release(s: ReturnType<typeof serviceClient>, job: AnyRow, worker: string, cp: Checkpoint, result: AnyRow, progress: number) {
  const { data, error } = await s.rpc("deep_release_work_job", { p_job_id: job.id, p_worker_id: worker, p_checkpoint: cp, p_result: result, p_progress: Math.max(0, Math.min(100, progress)) });
  if (error) throw error;
  if (!data) throw new Error("11C worker: no pudo liberar job.");
}
async function finish(s: ReturnType<typeof serviceClient>, job: AnyRow, worker: string, result: AnyRow) {
  const { data, error } = await s.rpc("deep_complete_work_job", { p_job_id: job.id, p_worker_id: worker, p_result: result });
  if (error) throw error;
  if (!data) throw new Error("11C worker: no pudo completar job.");
}
async function fail(s: ReturnType<typeof serviceClient>, job: AnyRow, worker: string, error: unknown) {
  const message = String((error as any)?.message || error).slice(0, 6000);
  const { data, error: rpcError } = await s.rpc("deep_fail_work_job", { p_job_id: job.id, p_worker_id: worker, p_error: message });
  if (rpcError) throw rpcError;
  return data;
}
async function artifact(s: ReturnType<typeof serviceClient>, job: AnyRow, type: string, label: string | null, content: string | null, payload: AnyRow, model: string | null) {
  const { data, error } = await s.rpc("deep_create_artifact", {
    p_user_id: job.user_id,
    p_project_id: job.project_id,
    p_job_id: job.id,
    p_section_id: job.section_id || null,
    p_chapter_number: job.chapter_number,
    p_artifact_type: type,
    p_label: label,
    p_content: content,
    p_payload: payload || {},
    p_content_hash: content ? hash(content) : null,
    p_model: model,
  });
  if (error) throw error;
  return String(data || "");
}
async function loadProject(s: ReturnType<typeof serviceClient>, projectId: string) {
  const { data, error } = await s.from("projects").select("*").eq("id", projectId).single();
  if (error || !data) throw error || new Error("Proyecto no encontrado.");
  return data;
}
async function loadTarget(s: ReturnType<typeof serviceClient>, job: AnyRow) {
  if (!job.section_id) return { id: null, title: `Capítulo ${job.chapter_number}`, content: "" };
  const { data, error } = await s.from("sections").select("id,title,content,chapter_number,type").eq("id", job.section_id).eq("project_id", job.project_id).single();
  if (error || !data) throw error || new Error("Capítulo target no encontrado.");
  return data;
}
async function loadNeighbor(s: ReturnType<typeof serviceClient>, projectId: string, chapterNumber: number) {
  const { data, error } = await s.from("sections").select("title,content,chapter_number").eq("project_id", projectId).eq("type", "CHAPTER").eq("chapter_number", chapterNumber).maybeSingle();
  if (error) throw error;
  return data || null;
}
function assertSourceUnchanged(result: AnyRow, target: AnyRow, operation: string) {
  if (operation === "GENERATE" || !target?.id) return;
  if (result.sourceHash && hash(String(target.content || "")) !== result.sourceHash) {
    throw new Error("SOURCE_CHANGED: el capítulo cambió durante Deep Work; no se continuará sobre una base obsoleta.");
  }
}

async function processJob(s: ReturnType<typeof serviceClient>, job: AnyRow, worker: string) {
  const cp = (job.checkpoint || { version: "11C", step: "INIT", draft_index: 0 }) as Checkpoint;
  const step = cp.step || "INIT";
  const result = resultOf(job);
  const depth = String(job.depth || "DEEP").toUpperCase() as DeepWorkDepth;
  const policy = deepModePolicy(depth);
  const project = await loadProject(s, job.project_id);
  const target = await loadTarget(s, job);

  if (step !== "INIT") assertSourceUnchanged(result, target, job.operation);
  await heartbeat(s, job.id, worker);

  if (step === "INIT") {
    result.projectId = job.project_id;
    result.projectTitle = clean(project.title);
    result.targetType = "CHAPTER";
    result.operation = job.operation;
    result.chapterNumber = job.chapter_number;
    result.sectionId = job.section_id || undefined;
    result.sourceHash = hash(String(target.content || ""));
    result.depth = depth;
    result.objective = job.objective;
    result.targetWords = job.target_words;
    result.title = clean(target.title) || `Capítulo ${job.chapter_number}`;
    result.drafts = [];
    result.artifactIds = [];
    result.repairAttempts = 0;
    await release(s, job, worker, { version: "11C", step: "PLAN", draft_index: 0 }, result, 2);
    return { step, next: "PLAN", progress: 2 };
  }

  if (step === "PLAN") {
    const out = await deepPlanStep({ depth, operation: job.operation, objective: job.objective, targetWords: job.target_words, title: result.title, sourceContent: String(target.content || "") });
    result.plan = out.plan;
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), plan: out.model };
    const id = await artifact(s, job, "PLAN", "DEEP_PLANNER", null, out.plan as any, out.model);
    if (id) result.artifactIds.push(id);
    const next: DeepWorkStep = policy.useContext ? "CONTEXT" : "DRAFT";
    await release(s, job, worker, { version: "11C", step: next, draft_index: 0 }, result, 8);
    return { step, next, progress: 8 };
  }

  if (step === "CONTEXT") {
    const prior = await loadNeighbor(s, job.project_id, job.chapter_number - 1);
    const nextChapter = await loadNeighbor(s, job.project_id, job.chapter_number + 1);
    const out = await deepContextStep({
      depth,
      title: result.title,
      sourceContent: String(target.content || ""),
      priorContext: prior ? `${prior.title}\n${prior.content}` : "",
      nextContext: nextChapter ? `${nextChapter.title}\n${nextChapter.content}` : "",
      projectContext: { title: project.title, genre: project.genre, audience: project.target_audience, description: project.description },
      plan: result.plan,
    });
    result.context = out.context;
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), context: out.model };
    const id = await artifact(s, job, "CONTEXT", "LONG_CONTEXT_ANALYST", null, out.context as any, out.model);
    if (id) result.artifactIds.push(id);
    await release(s, job, worker, { version: "11C", step: "DRAFT", draft_index: 0 }, result, 14);
    return { step, next: "DRAFT", progress: 14 };
  }

  if (step === "DRAFT") {
    const index = Math.max(0, Number(cp.draft_index || 0));
    const labels = ["A", "B", "C"] as const;
    const label = labels[Math.min(index, 2)];
    const out = await deepDraftStep({ depth, label, operation: job.operation, title: result.title, sourceContent: String(target.content || ""), targetWords: job.target_words, plan: result.plan, context: result.context });
    result.drafts = [...result.drafts.filter((d: AnyRow) => d.label !== label), out.draft];
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), [`draft_${label}`]: out.model };
    const id = await artifact(s, job, "DRAFT", label, out.draft.content, { rationale: out.draft.rationale, strengths: out.draft.strengths, risks: out.draft.risks }, out.model);
    if (id) result.artifactIds.push(id);
    if (index + 1 < policy.draftCount) {
      const progress = 20 + (index + 1) * 10;
      await release(s, job, worker, { version: "11C", step: "DRAFT", draft_index: index + 1 }, result, progress);
      return { step, next: "DRAFT", progress };
    }
    if (!policy.useCouncil) {
      result.finalCandidate = out.draft;
      await release(s, job, worker, { version: "11C", step: "QUALITY", draft_index: index }, result, 62);
      return { step, next: "QUALITY", progress: 62 };
    }
    await release(s, job, worker, { version: "11C", step: "CRITIC", draft_index: index }, result, 50);
    return { step, next: "CRITIC", progress: 50 };
  }

  if (step === "CRITIC") {
    const out = await criticCouncilStep({ depth, title: result.title, sourceContent: String(target.content || ""), plan: result.plan, context: result.context, drafts: result.drafts });
    result.council = out.council;
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), critic: out.model };
    const id = await artifact(s, job, "CRITIC", "CRITIC_COUNCIL", null, out.council as any, out.model);
    if (id) result.artifactIds.push(id);
    await release(s, job, worker, { version: "11C", step: "SYNTHESIS" }, result, 60);
    return { step, next: "SYNTHESIS", progress: 60 };
  }

  if (step === "SYNTHESIS") {
    const out = await synthesisStep({ depth, title: result.title, sourceContent: String(target.content || ""), targetWords: job.target_words, plan: result.plan, context: result.context, drafts: result.drafts, council: result.council });
    result.finalCandidate = out.draft;
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), synthesis: out.model };
    const id = await artifact(s, job, "SYNTHESIS", "SYNTHESIS_EDITOR", out.draft.content, { rationale: out.draft.rationale, strengths: out.draft.strengths, risks: out.draft.risks }, out.model);
    if (id) result.artifactIds.push(id);
    await release(s, job, worker, { version: "11C", step: "QUALITY" }, result, 72);
    return { step, next: "QUALITY", progress: 72 };
  }

  if (step === "REPAIR") {
    const out = await repairStep({ depth, title: result.title, sourceContent: String(target.content || ""), candidate: result.finalCandidate, quality: result.quality, targetWords: job.target_words });
    result.finalCandidate = out.draft;
    result.repairAttempts = Number(result.repairAttempts || 0) + 1;
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), [`repair_${result.repairAttempts}`]: out.model };
    const id = await artifact(s, job, "REPAIR", `REPAIR_${result.repairAttempts}`, out.draft.content, { rationale: out.draft.rationale }, out.model);
    if (id) result.artifactIds.push(id);
    await release(s, job, worker, { version: "11C", step: "QUALITY" }, result, 82);
    return { step, next: "QUALITY", progress: 82 };
  }

  if (step === "QUALITY") {
    if (!result.finalCandidate?.content) throw new Error("11C worker: falta finalCandidate.");
    const out = await deepQualityStep({ depth, title: result.title, sourceContent: String(target.content || ""), candidate: result.finalCandidate, context: result.context });
    let quality = out.quality;
    if (quality.unsupportedNewClaims.length) quality = { ...quality, verdict: "REPAIR" };
    if (quality.overallScore < policy.threshold && quality.verdict === "APPROVED") quality = { ...quality, verdict: "REPAIR" };
    const canRepair = quality.verdict === "REPAIR" && Number(result.repairAttempts || 0) < policy.maxRepairAttempts;
    if (!canRepair && quality.verdict === "REPAIR") quality = { ...quality, verdict: "REJECTED" };
    result.quality = quality;
    result.usage = addUsage(result.usage, out.usage);
    result.models = { ...(result.models || {}), quality: out.model };
    const id = await artifact(s, job, "QUALITY", "DEEP_QUALITY_JUDGE", null, quality as any, out.model);
    if (id) result.artifactIds.push(id);
    const next: DeepWorkStep = canRepair ? "REPAIR" : "PERSIST";
    await release(s, job, worker, { version: "11C", step: next }, result, canRepair ? 78 : 96);
    return { step, next, progress: canRepair ? 78 : 96, quality: quality.overallScore, verdict: quality.verdict };
  }

  if (step === "PERSIST") {
    result.completedAt = new Date().toISOString();
    result.applyAllowed = Boolean(result.quality?.verdict === "APPROVED" && result.sectionId && result.operation !== "GENERATE");
    await finish(s, job, worker, result);
    return { step, next: "COMPLETED", progress: 100, quality: result.quality?.overallScore, verdict: result.quality?.verdict };
  }

  throw new Error(`11C worker: checkpoint desconocido ${step}`);
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (String(req.method || "").toUpperCase() !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const expected = expectedSecret();
    if (!expected) return res.status(500).json({ ok: false, error: "Falta DEEP_WORKER_SECRET/REFINERY_WORKER_SECRET/OS4_WORKER_SECRET." });
    if (!requestSecret(req) || requestSecret(req) !== expected) return res.status(401).json({ ok: false, error: "Worker secret inválido." });
    const s = serviceClient();
    const worker = `deep-local-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: job, error } = await s.rpc("deep_claim_work_job", { p_worker_id: worker, p_lease_seconds: LEASE_SECONDS });
    if (error) throw error;
    if (!job?.id) return res.status(200).json({ ok: true, idle: true, message: "No hay Deep Work jobs activos." });
    try {
      const info = await processJob(s, job, worker);
      return res.status(200).json({ ok: true, idle: false, job_id: job.id, status: "QUEUED", ...info });
    } catch (error) {
      const failed = await fail(s, job, worker, error);
      return res.status(500).json({ ok: false, job_id: job.id, status: failed?.status || "RETRYING", error: String((error as any)?.message || error) });
    }
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

import { supabase } from "../supabase";
import type {
  Os4AgentResponse,
  Os4Mode,
  Os4PipelineEvent,
  Os4Profile,
  Os4QualityReport,
  Os4Stage,
  Os4Status,
} from "./types";

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const uid = data.session?.user?.id;
  if (!uid) throw new Error("OS4: usuario no autenticado.");
  return uid;
}

export async function getOs4Profile(projectId: string): Promise<Os4Profile | null> {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("os4_profiles")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as Os4Profile | null;
}

export async function ensureOs4Profile(
  projectId: string,
  mode: Os4Mode
): Promise<Os4Profile> {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("os4_profiles")
    .upsert(
      {
        project_id: projectId,
        user_id: uid,
        mode,
        current_stage: "MARKET",
        status: "IDLE",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as Os4Profile;
}

export async function patchOs4Profile(
  projectId: string,
  patch: Partial<Os4Profile>
): Promise<void> {
  const uid = await requireUserId();

  const { error } = await supabase
    .from("os4_profiles")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("project_id", projectId)
    .eq("user_id", uid);

  if (error) throw error;
}

export async function setOs4Stage(
  projectId: string,
  stage: Os4Stage,
  status: Os4Status,
  score?: number
) {
  await patchOs4Profile(projectId, {
    current_stage: stage,
    status,
    ...(Number.isFinite(score) ? { overall_score: Number(score) } : {}),
  });
}

export async function insertOs4Event(
  projectId: string,
  event: Os4PipelineEvent
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from("os4_events").insert({
    user_id: uid,
    project_id: projectId,
    stage: event.stage,
    status: event.status,
    message: event.message,
    score: event.score ?? null,
    metadata: event.metadata || {},
  });
  if (error) throw error;
}

export async function insertOs4AgentRun(
  projectId: string,
  action: string,
  response: Os4AgentResponse<any>,
  inputSummary: string
): Promise<void> {
  const uid = await requireUserId();
  const out: any = response.output || {};

  const { error } = await supabase.from("os4_agent_runs").insert({
    user_id: uid,
    project_id: projectId,
    trace_id: response.trace_id,
    agent: response.agent,
    action,
    status: "COMPLETED",
    model: response.model,
    input_summary: inputSummary.slice(0, 4000),
    output: response.output || {},
    score: Number(out?.global_score ?? out?.score ?? out?.market_score ?? out?.blueprint_score ?? null),
    latency_ms: response.latency_ms,
    input_tokens: Number(response.usage?.input_tokens ?? 0),
    output_tokens: Number(response.usage?.output_tokens ?? 0),
    estimated_cost_usd: Number(response.usage?.estimated_cost_usd ?? 0),
    metadata: {},
  });

  if (error) throw error;
}

export async function insertOs4FailedAgentRun(args: {
  projectId: string;
  agent: string;
  action: string;
  traceId: string;
  error: string;
}) {
  const uid = await requireUserId();
  const { error } = await supabase.from("os4_agent_runs").insert({
    user_id: uid,
    project_id: args.projectId,
    trace_id: args.traceId,
    agent: args.agent,
    action: args.action,
    status: "FAILED",
    error: args.error.slice(0, 4000),
    metadata: {},
  });
  if (error) throw error;
}

export async function insertOs4QualityReport(
  projectId: string,
  report: Os4QualityReport
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from("os4_quality_reports").insert({
    user_id: uid,
    project_id: projectId,
    chapter_number: report.chapter_number,
    global_score: report.global_score,
    status: report.status,
    dimensions: report.dimensions,
    deterministic: report.deterministic,
    council: report.council,
    blocking_issues: report.blocking_issues,
    rewrite_instructions: report.rewrite_instructions,
    iteration: report.iteration,
  });
  if (error) throw error;
}

export async function saveOs4Approval(args: {
  projectId: string;
  stage: Os4Stage;
  decision: "APPROVED" | "REJECTED";
  note?: string;
}) {
  const uid = await requireUserId();
  const { error } = await supabase.from("os4_approvals").insert({
    user_id: uid,
    project_id: args.projectId,
    stage: args.stage,
    decision: args.decision,
    note: args.note || null,
  });
  if (error) throw error;
}

export async function listOs4QualityReports(projectId: string) {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from("os4_quality_reports")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}


export async function replaceOs4Claims(
  projectId: string,
  chapterNumber: number,
  claims: Array<Record<string, any>>
): Promise<void> {
  const uid = await requireUserId();

  const { error: deleteError } = await supabase
    .from("os4_claims")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", uid)
    .eq("chapter_number", chapterNumber);

  if (deleteError) throw deleteError;

  const rows = (Array.isArray(claims) ? claims : [])
    .filter((claim) => String(claim?.claim || "").trim())
    .slice(0, 150)
    .map((claim) => ({
      user_id: uid,
      project_id: projectId,
      chapter_number: chapterNumber,
      claim: String(claim.claim).trim(),
      status: ["VERIFIED", "PARTIAL", "DISPUTED", "UNVERIFIED", "REJECTED"].includes(
        String(claim?.status || "").toUpperCase()
      )
        ? String(claim.status).toUpperCase()
        : "UNVERIFIED",
      confidence: Math.max(0, Math.min(1, Number(claim?.confidence ?? 0) || 0)),
      evidence: Array.isArray(claim?.evidence) ? claim.evidence : [],
      source_urls: Array.isArray(claim?.source_urls)
        ? claim.source_urls
        : Array.isArray(claim?.evidence_source_urls)
          ? claim.evidence_source_urls
          : [],
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return;

  const { error } = await supabase.from("os4_claims").insert(rows);
  if (error) throw error;
}

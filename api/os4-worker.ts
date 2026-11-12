import { createClient } from "@supabase/supabase-js";
import {
  runOs4ServerAgent,
  writeOs4Chapter,
  type Os4RuntimeResponse,
  type Os4ServerAgent,
} from "../src/server/os4-runtime.js";

export const maxDuration = 300;

type AnyRow = Record<string, any>;

type DurableCheckpoint = {
  version: string;
  step: string;
  chapter_number: number;
  repair_iteration: number;
  research_index: number;
};

const WORKER_VERSION = "os4-10b-durable-1.0.0";
const DEFAULT_LEASE_SECONDS = 600;
const QUALITY_MIN = 9.2;
const FACTUALITY_MIN = 9.4;
const CONTINUITY_MIN = 9.0;
const MAX_REPAIRS = 3;

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "OS4 worker: faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function workerSecret(req: any): string {
  const direct = String(req.headers?.["x-os4-worker-secret"] || "").trim();
  if (direct) return direct;
  const auth = String(req.headers?.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || "").trim();
}

function authorize(req: any) {
  const expected = String(process.env.OS4_WORKER_SECRET || "").trim();
  if (!expected) {
    throw Object.assign(
      new Error("OS4_WORKER_SECRET no configurado."),
      { statusCode: 500 }
    );
  }
  if (workerSecret(req) !== expected) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}

function checkpointOf(job: AnyRow): DurableCheckpoint {
  const raw = job?.checkpoint && typeof job.checkpoint === "object"
    ? job.checkpoint
    : {};
  return {
    version: String(raw.version || "10B"),
    step: String(raw.step || "MARKET"),
    chapter_number: Math.max(1, Number(raw.chapter_number || 1) || 1),
    repair_iteration: Math.max(0, Number(raw.repair_iteration || 0) || 0),
    research_index: Math.max(0, Number(raw.research_index || 0) || 0),
  };
}

function traceId(jobId: string, step: string, agent: string, suffix = "") {
  return [
    "os4d",
    jobId,
    step,
    agent,
    suffix || "0",
  ].join(":");
}

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function score(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 100) / 100));
}

function wordCount(text: string): number {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function headingCount(text: string): number {
  return String(text || "").split(/\r?\n/).filter((line) => /^#{2,4}\s+\S/.test(line.trim())).length;
}

function repetitionPenalty(text: string): number {
  const paragraphs = String(text || "")
    .split(/\n\s*\n/)
    .map((x) => x.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((x) => x.length > 80);
  if (!paragraphs.length) return 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const p of paragraphs) {
    const key = p.slice(0, 220);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return Math.round((duplicates / paragraphs.length) * 1000) / 100;
}

function publicBaseUrl(): string {
  const explicit = String(process.env.OS4_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = String(process.env.VERCEL_URL || "").trim().replace(/^https?:\/\//i, "");
  if (vercel) return `https://${vercel}`;
  return "";
}

async function heartbeat(
  supabase: ReturnType<typeof serviceClient>,
  jobId: string,
  workerId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS
) {
  const { data, error } = await supabase.rpc("os4_heartbeat_generation_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  if (data === false) throw new Error("OS4 worker: lease perdido.");
}

async function release(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  checkpoint: Partial<DurableCheckpoint>,
  resultPatch: AnyRow = {}
) {
  const current = checkpointOf(job);
  const next = { ...current, ...checkpoint, version: "10B" };
  const nextResult = {
    ...(job.result && typeof job.result === "object" ? job.result : {}),
    ...resultPatch,
    worker_version: WORKER_VERSION,
    last_step_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.rpc("os4_release_generation_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_checkpoint: next,
    p_result: nextResult,
  });

  if (error) throw error;
  if (!data) throw new Error("OS4 worker: no se pudo liberar job.");
}

async function finish(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  resultPatch: AnyRow
) {
  const result = {
    ...(job.result && typeof job.result === "object" ? job.result : {}),
    ...resultPatch,
    worker_version: WORKER_VERSION,
    completed_by: workerId,
    completed_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.rpc("os4_complete_generation_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_result: result,
  });
  if (error) throw error;
  if (!data) throw new Error("OS4 worker: no se pudo completar job.");
}

async function fail(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string,
  error: unknown
) {
  const message = String((error as any)?.message || error).slice(0, 6000);
  const { data, error: rpcError } = await supabase.rpc("os4_fail_generation_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: message,
  });
  if (rpcError) throw rpcError;
  return data;
}

async function ensureProfile(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  project: AnyRow
) {
  const mode = String(job?.payload?.mode || "AUTONOMOUS").toUpperCase();
  const { error } = await supabase
    .from("os4_profiles")
    .upsert(
      {
        project_id: project.id,
        user_id: job.user_id,
        mode: ["AUTONOMOUS", "SUPERVISED", "EDITORIAL"].includes(mode)
          ? mode
          : "AUTONOMOUS",
        status: "RUNNING",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );
  if (error) throw error;
}

async function patchProfile(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
  patch: AnyRow
) {
  const { error } = await supabase
    .from("os4_profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("project_id", projectId);
  if (error) throw error;
}

async function getProfile(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string
): Promise<AnyRow> {
  const { data, error } = await supabase
    .from("os4_profiles")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

async function event(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  stage: string,
  status: string,
  message: string,
  scoreValue?: number,
  metadata: AnyRow = {}
) {
  if (!job.project_id || !job.user_id) return;
  const { error } = await supabase.from("os4_events").insert({
    user_id: job.user_id,
    project_id: job.project_id,
    stage,
    status,
    message,
    score: Number.isFinite(scoreValue) ? scoreValue : null,
    metadata: { ...metadata, durable_job_id: job.id, worker_version: WORKER_VERSION },
  });
  if (error) throw error;
}

async function cachedAgent<T = any>(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  args: {
    agent: Os4ServerAgent;
    action: string;
    payload: AnyRow;
    trace: string;
    inputSummary: string;
  }
): Promise<T> {
  const { data: previous, error: previousError } = await supabase
    .from("os4_agent_runs")
    .select("*")
    .eq("trace_id", args.trace)
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(1);

  if (previousError) throw previousError;
  if (previous?.[0]) return previous[0].output as T;

  const response = await runOs4ServerAgent<T>({
    agent: args.agent,
    action: args.action,
    payload: args.payload,
    traceId: args.trace,
    userId: job.user_id,
  });

  await insertAgentRun(supabase, job, response, args.action, args.inputSummary);
  return response.output;
}

async function insertAgentRun(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  response: Os4RuntimeResponse<any>,
  action: string,
  inputSummary: string
) {
  const out = response.output || {};
  const { error } = await supabase.from("os4_agent_runs").insert({
    user_id: job.user_id,
    project_id: job.project_id,
    trace_id: response.trace_id,
    agent: response.agent,
    action,
    status: "COMPLETED",
    model: response.model,
    input_summary: inputSummary.slice(0, 4000),
    output: response.output || {},
    score: Number(
      out?.global_score ??
      out?.score ??
      out?.market_score ??
      out?.blueprint_score ??
      null
    ),
    latency_ms: response.latency_ms,
    input_tokens: Number(response.usage?.input_tokens || 0),
    output_tokens: Number(response.usage?.output_tokens || 0),
    estimated_cost_usd: Number(response.usage?.estimated_cost_usd || 0),
    metadata: {
      durable: true,
      job_id: job.id,
      worker_version: WORKER_VERSION,
    },
  });
  if (error) throw error;
}

async function cachedWriter(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  args: {
    trace: string;
    title: string;
    topic: string;
    chapterNumber: number;
    chapterPlan: AnyRow;
    researchContext: string;
    authorDna: unknown;
    knowledgeGraph: unknown;
    previousChapters: AnyRow[];
    targetWords: number;
  }
): Promise<string> {
  const { data: previous, error } = await supabase
    .from("os4_agent_runs")
    .select("*")
    .eq("trace_id", args.trace)
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (previous?.[0]?.output?.text) return String(previous[0].output.text);

  const response = await writeOs4Chapter({
    traceId: args.trace,
    userId: job.user_id,
    title: args.title,
    topic: args.topic,
    chapterNumber: args.chapterNumber,
    chapterPlan: args.chapterPlan,
    researchContext: args.researchContext,
    authorDna: args.authorDna,
    knowledgeGraph: args.knowledgeGraph,
    previousChapters: args.previousChapters,
    targetWords: args.targetWords,
  });

  await insertAgentRun(
    supabase,
    job,
    response,
    "WRITE_CHAPTER",
    `Durable writer chapter ${args.chapterNumber}`
  );
  return String(response.output.text || "");
}

function outlineFromBlueprint(blueprint: AnyRow) {
  const chapters = Array.isArray(blueprint?.chapters) ? blueprint.chapters : [];
  return chapters.map((chapter: AnyRow, index: number) => ({
    id: `outline_${String(Number(chapter?.chapter_number || index + 1)).padStart(2, "0")}`,
    chapter_number: Number(chapter?.chapter_number || index + 1),
    chapter_title: cleanText(chapter?.chapter_title) || `Capítulo ${index + 1}`,
    objective: cleanText(chapter?.objective),
    key_points: Array.isArray(chapter?.key_points) ? chapter.key_points : [],
    subheads_h2: Array.isArray(chapter?.subheads_h2) ? chapter.subheads_h2 : [],
    tools_frameworks: [],
    exercises: [],
    deliverable: "",
    transition_to_next: cleanText(chapter?.transition_to_next),
    status: "PENDING",
    target_words: Math.max(800, Number(chapter?.target_words || 3000) || 3000),
    os4: {
      chapter_thesis: cleanText(chapter?.chapter_thesis),
      required_facts: Array.isArray(chapter?.required_facts) ? chapter.required_facts : [],
      source_needs: Array.isArray(chapter?.source_needs) ? chapter.source_needs : [],
      contradiction_checks: Array.isArray(chapter?.contradiction_checks)
        ? chapter.contradiction_checks
        : [],
    },
  }));
}

async function upsertSection(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
  chapterNumber: number,
  title: string,
  content: string,
  status: "PENDING" | "COMPLETED"
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("sections")
    .select("id")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .eq("chapter_number", chapterNumber)
    .limit(1);
  if (selectError) throw selectError;

  if (existing?.[0]?.id) {
    const id = existing[0].id;
    const { error } = await supabase
      .from("sections")
      .update({
        title,
        content,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
    return id;
  }

  const { data, error } = await supabase
    .from("sections")
    .insert({
      project_id: projectId,
      type: "CHAPTER",
      chapter_number: chapterNumber,
      title,
      content,
      status,
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

async function versionSection(
  supabase: ReturnType<typeof serviceClient>,
  sectionId: string,
  content: string
) {
  const { data: latest, error: latestError } = await supabase
    .from("section_versions")
    .select("content")
    .eq("section_id", sectionId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (latestError) throw latestError;
  if (String(latest?.[0]?.content || "") === content) return;

  const { error } = await supabase
    .from("section_versions")
    .insert({ section_id: sectionId, content });
  if (error) throw error;
}

async function getSection(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
  chapterNumber: number
): Promise<AnyRow | null> {
  const { data, error } = await supabase
    .from("sections")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .eq("chapter_number", chapterNumber)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function completedChapters(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string
): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("sections")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .eq("status", "COMPLETED")
    .order("chapter_number", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function previousChapterContext(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
  chapterNumber: number
): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("sections")
    .select("chapter_number,title,content")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .lt("chapter_number", chapterNumber)
    .order("chapter_number", { ascending: false })
    .limit(3);
  if (error) throw error;
  return (data || []).reverse().map((x: AnyRow) => ({
    chapter_number: x.chapter_number,
    title: x.title,
    tail: String(x.content || "").slice(-3500),
  }));
}

async function buildAndPersistMaster(
  supabase: ReturnType<typeof serviceClient>,
  project: AnyRow
): Promise<string> {
  const chapters = await completedChapters(supabase, project.id);
  const parts = [`# ${project.title}`];
  for (const chapter of chapters) {
    const n = Number(chapter.chapter_number || 0);
    const title = cleanText(chapter.title) || `Capítulo ${n}`;
    const body = cleanText(chapter.content)
      .replace(/^\s*#{1,3}\s*cap[ií]tulo\b[^\n]*\n+/i, "")
      .trim();
    if (body) parts.push(`## ${title}\n\n${body}`);
  }
  const master = parts.join("\n\n---\n\n").trim() + "\n";

  const { data: latest, error: latestError } = await supabase
    .from("master_documents")
    .select("version,content")
    .eq("project_id", project.id)
    .order("version", { ascending: false })
    .limit(1);
  if (latestError) throw latestError;

  if (String(latest?.[0]?.content || "") !== master) {
    const nextVersion = Number(latest?.[0]?.version || 0) + 1;
    const { error } = await supabase.from("master_documents").insert({
      project_id: project.id,
      title: project.title,
      content: master,
      version: nextVersion,
    });
    if (error) throw error;
  }
  return master;
}

async function latestMaster(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("master_documents")
    .select("content")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw error;
  return String(data?.[0]?.content || "");
}

async function persistClaims(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  chapterNumber: number,
  claims: AnyRow[]
) {
  const { error: delError } = await supabase
    .from("os4_claims")
    .delete()
    .eq("project_id", job.project_id)
    .eq("chapter_number", chapterNumber);
  if (delError) throw delError;

  const rows = (Array.isArray(claims) ? claims : [])
    .filter((x) => cleanText(x?.claim))
    .slice(0, 150)
    .map((x) => ({
      user_id: job.user_id,
      project_id: job.project_id,
      chapter_number: chapterNumber,
      claim: cleanText(x.claim),
      status: ["VERIFIED", "PARTIAL", "DISPUTED", "UNVERIFIED", "REJECTED"].includes(
        String(x?.status || "").toUpperCase()
      )
        ? String(x.status).toUpperCase()
        : "UNVERIFIED",
      confidence: Math.max(0, Math.min(1, Number(x?.confidence || 0))),
      evidence: Array.isArray(x?.evidence) ? x.evidence : [],
      source_urls: Array.isArray(x?.source_urls)
        ? x.source_urls
        : Array.isArray(x?.evidence_source_urls)
          ? x.evidence_source_urls
          : [],
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return;
  const { error } = await supabase.from("os4_claims").insert(rows);
  if (error) throw error;
}

async function qualityReportExists(
  supabase: ReturnType<typeof serviceClient>,
  projectId: string,
  chapterNumber: number,
  iteration: number
) {
  const { data, error } = await supabase
    .from("os4_quality_reports")
    .select("*")
    .eq("project_id", projectId)
    .eq("chapter_number", chapterNumber)
    .eq("iteration", iteration)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function persistQuality(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  chapterNumber: number,
  iteration: number,
  text: string,
  reviews: AnyRow[],
  judge: AnyRow
) {
  const existing = await qualityReportExists(
    supabase,
    job.project_id,
    chapterNumber,
    iteration
  );
  if (existing) return existing;

  const dimensions = judge?.dimensions && typeof judge.dimensions === "object"
    ? judge.dimensions
    : {};
  const blockingIssues = Array.isArray(judge?.blocking_issues)
    ? judge.blocking_issues
    : [];
  const decision = String(judge?.decision || "").toUpperCase();
  const factuality = score(dimensions?.factuality);
  const continuity = score(dimensions?.continuity);
  const globalScore = score(judge?.global_score);
  const anyBlocking = reviews.some((x) => Boolean(x?.blocking)) || blockingIssues.length > 0;

  let status = "REWRITE_REQUIRED";
  if (
    decision === "APPROVE" &&
    globalScore >= QUALITY_MIN &&
    factuality >= FACTUALITY_MIN &&
    continuity >= CONTINUITY_MIN &&
    !anyBlocking
  ) {
    status = "APPROVED";
  } else if (decision === "BLOCK" || anyBlocking) {
    status = "BLOCKED";
  }

  const deterministic = {
    words: wordCount(text),
    paragraph_count: String(text || "").split(/\n\s*\n/).filter(Boolean).length,
    heading_count: headingCount(text),
    repetition_penalty: repetitionPenalty(text),
    generic_phrase_penalty: 0,
  };

  const row = {
    user_id: job.user_id,
    project_id: job.project_id,
    chapter_number: chapterNumber,
    global_score: globalScore,
    status,
    dimensions,
    deterministic,
    council: reviews,
    blocking_issues: blockingIssues,
    rewrite_instructions: Array.isArray(judge?.rewrite_instructions)
      ? judge.rewrite_instructions
      : [],
    iteration,
  };

  const { data, error } = await supabase
    .from("os4_quality_reports")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function runResearchQuery(
  query: string,
  urls: string[],
  maxSources: number
): Promise<AnyRow> {
  const base = publicBaseUrl();
  if (!base) {
    return {
      sources: [],
      facts: [],
      research_context: `INVESTIGACIÓN PENDIENTE: ${query}\nNo existe OS4_PUBLIC_BASE_URL/VERCEL_URL.`,
    };
  }

  const response = await fetch(`${base}/api/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": String(process.env.OS4_WORKER_SECRET || "").trim(),
    },
    body: JSON.stringify({ query, urls, maxSources }),
  });

  const raw = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Research API inválida (${response.status}): ${raw.slice(0, 400)}`);
  }
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Research HTTP ${response.status}`);
  }
  return data;
}

function mergeResearchBundle(bundle: AnyRow, part: AnyRow, plan: AnyRow) {
  const sources = [
    ...(Array.isArray(bundle?.sources) ? bundle.sources : []),
    ...(Array.isArray(part?.sources) ? part.sources : []),
  ];
  const uniqueSources = Array.from(
    new Map(
      sources.map((s: AnyRow) => [
        String(s?.url || s?.title || JSON.stringify(s)),
        s,
      ])
    ).values()
  );

  const facts = [
    ...(Array.isArray(bundle?.facts) ? bundle.facts : []),
    ...(Array.isArray(part?.facts) ? part.facts : []),
  ].slice(0, 250);

  const contexts = [
    cleanText(bundle?.compiled_context),
    cleanText(part?.research_context),
  ].filter(Boolean);

  const queryCount = Math.max(
    1,
    Array.isArray(plan?.queries) ? plan.queries.length : 1
  );
  const coverage = Math.min(10, (uniqueSources.length / Math.max(1, queryCount * 2)) * 10);

  return {
    plan,
    sources: uniqueSources,
    facts,
    compiled_context: contexts.join("\n\n---\n\n").slice(0, 65000),
    coverage_score: Math.round(coverage * 100) / 100,
  };
}

async function processHealthcheck(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string
) {
  await finish(supabase, job, workerId, {
    healthcheck: true,
    probe_token: job?.payload?.probe_token || null,
    scheduler_verified: true,
    lease_claimed: true,
    processed_at: new Date().toISOString(),
  });
}

async function processBookJob(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string
) {
  const cp = checkpointOf(job);
  await heartbeat(supabase, job.id, workerId);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", job.project_id)
    .single();
  if (projectError || !project) throw projectError || new Error("Proyecto no encontrado.");

  await ensureProfile(supabase, job, project);
  const profile = await getProfile(supabase, project.id);
  const payload = job.payload || {};
  const targetChapterWords = Math.max(
    800,
    Math.min(12000, Number(payload.target_chapter_words || 3000) || 3000)
  );

  if (cp.step === "MARKET") {
    await event(supabase, job, "MARKET", "RUNNING", "Durable worker: Market Intelligence.");
    const market = await cachedAgent(supabase, job, {
      agent: "MARKET_STRATEGIST",
      action: "ANALYZE_MARKET",
      trace: traceId(job.id, cp.step, "MARKET_STRATEGIST"),
      payload: {
        title: project.title,
        topic: project.topic || "",
        audience: project.audience || "",
        current_outline: project.outline_12 || [],
      },
      inputSummary: project.title,
    });
    await patchProfile(supabase, project.id, {
      market,
      current_stage: "MARKET",
      status: "RUNNING",
    });
    await release(supabase, job, workerId, { step: "CONCEPT" }, {
      last_stage: "MARKET",
    });
    return;
  }

  if (cp.step === "CONCEPT") {
    const current = await getProfile(supabase, project.id);
    const concept = await cachedAgent(supabase, job, {
      agent: "CONCEPT_ARENA",
      action: "BATTLE_CONCEPTS",
      trace: traceId(job.id, cp.step, "CONCEPT_ARENA"),
      payload: { market: current.market, project },
      inputSummary: `Concept battle: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      concept_battle: concept,
      current_stage: "CONCEPT_BATTLE",
    });
    await release(supabase, job, workerId, {
      step: cleanText(payload.author_samples) ? "AUTHOR_DNA" : "BLUEPRINT",
    }, { last_stage: "CONCEPT_BATTLE" });
    return;
  }

  if (cp.step === "AUTHOR_DNA") {
    const dna = await cachedAgent(supabase, job, {
      agent: "AUTHOR_DNA_ANALYST",
      action: "ANALYZE_AUTHOR_DNA",
      trace: traceId(job.id, cp.step, "AUTHOR_DNA_ANALYST"),
      payload: { samples: cleanText(payload.author_samples).slice(0, 28000) },
      inputSummary: "Author DNA samples",
    });
    await patchProfile(supabase, project.id, {
      author_dna: dna,
      current_stage: "AUTHOR_DNA",
    });
    await release(supabase, job, workerId, { step: "BLUEPRINT" }, {
      last_stage: "AUTHOR_DNA",
    });
    return;
  }

  if (cp.step === "BLUEPRINT") {
    const current = await getProfile(supabase, project.id);
    const blueprint: AnyRow = await cachedAgent(supabase, job, {
      agent: "BOOK_ARCHITECT",
      action: "BUILD_SUPREME_BLUEPRINT",
      trace: traceId(job.id, cp.step, "BOOK_ARCHITECT"),
      payload: {
        market: current.market,
        concept_battle: current.concept_battle,
        author_dna: current.author_dna,
        original_project: project,
        target_chapter_words: targetChapterWords,
      },
      inputSummary: `Blueprint: ${project.title}`,
    });

    const outline = outlineFromBlueprint(blueprint);
    const nextTitle = cleanText(blueprint?.selected_title) || project.title;
    const dossier = {
      ...(project.dossier || {}),
      book_subtitle: blueprint?.selected_subtitle || "",
      os4_market: current.market || {},
      os4_blueprint: blueprint,
    };
    const continuity = {
      ...(project.continuity_pack || {}),
      os4_version: "4.0.0-supreme",
      chapter_count: outline.length,
      book_subtitle: blueprint?.selected_subtitle || "",
      central_thesis: blueprint?.central_thesis || "",
    };

    const { error } = await supabase
      .from("projects")
      .update({
        title: nextTitle,
        audience: blueprint?.audience || project.audience,
        tone_style: blueprint?.tone_style || project.tone_style,
        dossier,
        outline_12: outline,
        continuity_pack: continuity,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    if (error) throw error;

    await patchProfile(supabase, project.id, {
      blueprint,
      current_stage: "BLUEPRINT",
      status: "RUNNING",
    });
    await release(supabase, job, workerId, { step: "RESEARCH_PLAN" }, {
      last_stage: "BLUEPRINT",
      blueprint_score: score(blueprint?.blueprint_score),
    });
    return;
  }

  if (cp.step === "RESEARCH_PLAN") {
    const current = await getProfile(supabase, project.id);
    const plan: AnyRow = await cachedAgent(supabase, job, {
      agent: "RESEARCH_DIRECTOR",
      action: "BUILD_RESEARCH_PLAN",
      trace: traceId(job.id, cp.step, "RESEARCH_DIRECTOR"),
      payload: { blueprint: current.blueprint, market: current.market },
      inputSummary: `Research plan: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      research_bundle: {
        plan,
        sources: [],
        facts: [],
        compiled_context: "",
        coverage_score: 0,
      },
      current_stage: "RESEARCH",
    });
    await release(supabase, job, workerId, {
      step: "RESEARCH_FETCH",
      research_index: 0,
    }, { last_stage: "RESEARCH_PLAN" });
    return;
  }

  if (cp.step === "RESEARCH_FETCH") {
    const current = await getProfile(supabase, project.id);
    const plan = current?.research_bundle?.plan || {};
    const queries = Array.isArray(plan?.queries)
      ? plan.queries.slice(0, Math.max(1, Number(payload.max_research_queries || 6)))
      : [];

    if (!queries.length || cp.research_index >= queries.length) {
      await release(supabase, job, workerId, {
        step: "KNOWLEDGE",
        research_index: 0,
      }, { last_stage: "RESEARCH" });
      return;
    }

    const q = String(queries[cp.research_index]?.query || "").trim();
    let part: AnyRow;
    try {
      part = await runResearchQuery(
        q,
        cp.research_index === 0 && Array.isArray(payload.research_urls)
          ? payload.research_urls.slice(0, 15)
          : [],
        5
      );
    } catch (error: any) {
      part = {
        sources: [],
        facts: [],
        research_context:
          `INVESTIGACIÓN PENDIENTE: ${q}\nMotivo: ${String(error?.message || error)}`,
      };
    }

    const merged = mergeResearchBundle(current.research_bundle || {}, part, plan);
    await patchProfile(supabase, project.id, {
      research_bundle: merged,
      current_stage: "RESEARCH",
    });

    await release(supabase, job, workerId, {
      step: "RESEARCH_FETCH",
      research_index: cp.research_index + 1,
    }, {
      last_stage: "RESEARCH",
      research_query_index: cp.research_index + 1,
      research_query_total: queries.length,
      research_coverage_score: merged.coverage_score,
    });
    return;
  }

  if (cp.step === "KNOWLEDGE") {
    const current = await getProfile(supabase, project.id);
    const graph = await cachedAgent(supabase, job, {
      agent: "KNOWLEDGE_ENGINEER",
      action: "BUILD_KNOWLEDGE_GRAPH",
      trace: traceId(job.id, cp.step, "KNOWLEDGE_ENGINEER"),
      payload: {
        blueprint: current.blueprint,
        research_plan: current?.research_bundle?.plan,
        research_context: cleanText(current?.research_bundle?.compiled_context).slice(0, 55000),
        facts: Array.isArray(current?.research_bundle?.facts)
          ? current.research_bundle.facts.slice(0, 120)
          : [],
      },
      inputSummary: `Knowledge graph: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      knowledge_graph: graph,
      current_stage: "KNOWLEDGE_GRAPH",
    });
    await release(supabase, job, workerId, { step: "SIMULATION" }, {
      last_stage: "KNOWLEDGE_GRAPH",
    });
    return;
  }

  if (cp.step === "SIMULATION") {
    const current = await getProfile(supabase, project.id);
    const simulation = await cachedAgent(supabase, job, {
      agent: "BOOK_SIMULATOR",
      action: "SIMULATE_BOOK",
      trace: traceId(job.id, cp.step, "BOOK_SIMULATOR"),
      payload: {
        blueprint: current.blueprint,
        market: current.market,
        research_coverage_score: current?.research_bundle?.coverage_score || 0,
        knowledge_graph: current.knowledge_graph,
      },
      inputSummary: `Simulation: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      simulation,
      current_stage: "SIMULATION",
    });
    await release(supabase, job, workerId, { step: "CHIEF" }, {
      last_stage: "SIMULATION",
    });
    return;
  }

  if (cp.step === "CHIEF") {
    const current = await getProfile(supabase, project.id);
    const chief: AnyRow = await cachedAgent(supabase, job, {
      agent: "CHIEF_EDITOR",
      action: "APPROVE_PREPRODUCTION",
      trace: traceId(job.id, cp.step, "CHIEF_EDITOR"),
      payload: {
        market: current.market,
        concept_battle: current.concept_battle,
        blueprint: current.blueprint,
        research_coverage_score: current?.research_bundle?.coverage_score || 0,
        knowledge_graph: current.knowledge_graph,
        simulation: current.simulation,
      },
      inputSummary: `Chief approval: ${project.title}`,
    });

    const mode = String(payload.mode || "AUTONOMOUS").toUpperCase();
    const chiefScore = score(chief?.score ?? chief?.global_score);
    await patchProfile(supabase, project.id, {
      chief_approval: chief,
      current_stage: "CHIEF_APPROVAL",
      overall_score: chiefScore,
      status: mode === "EDITORIAL" ? "WAITING_APPROVAL" : "RUNNING",
    });

    if (mode === "EDITORIAL") {
      const { error } = await supabase
        .from("generation_jobs")
        .update({
          status: "WAITING_APPROVAL",
          checkpoint: { ...cp, step: "CHAPTER_WRITE" },
          result: {
            ...(job.result || {}),
            last_stage: "CHIEF_APPROVAL",
            worker_version: WORKER_VERSION,
          },
          locked_by: null,
          locked_at: null,
          lease_expires_at: null,
          heartbeat_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("locked_by", workerId);
      if (error) throw error;
      return;
    }

    await release(supabase, job, workerId, {
      step: "CHAPTER_WRITE",
      chapter_number: 1,
      repair_iteration: 0,
    }, { last_stage: "CHIEF_APPROVAL" });
    return;
  }

  if (cp.step === "CHAPTER_WRITE") {
    const { data: freshProject, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project.id)
      .single();
    if (error) throw error;

    const outline = Array.isArray(freshProject.outline_12)
      ? freshProject.outline_12
      : [];
    const chapterPlan = outline.find(
      (x: AnyRow) => Number(x?.chapter_number || 0) === cp.chapter_number
    );

    if (!chapterPlan) {
      await release(supabase, job, workerId, { step: "MASTER" }, {
        last_stage: "WRITING",
      });
      return;
    }

    const { data: approved } = await supabase
      .from("os4_quality_reports")
      .select("id")
      .eq("project_id", project.id)
      .eq("chapter_number", cp.chapter_number)
      .eq("status", "APPROVED")
      .limit(1);

    const existing = await getSection(supabase, project.id, cp.chapter_number);
    if (approved?.length && cleanText(existing?.content)) {
      await release(supabase, job, workerId, {
        step: "CHAPTER_WRITE",
        chapter_number: cp.chapter_number + 1,
        repair_iteration: 0,
      }, {
        last_stage: "WRITING",
        last_approved_chapter: cp.chapter_number,
      });
      return;
    }

    const current = await getProfile(supabase, project.id);
    const previous = await previousChapterContext(
      supabase,
      project.id,
      cp.chapter_number
    );
    const targetWords =
      Math.max(800, Number(chapterPlan?.target_words || 0) || targetChapterWords);

    const text = await cachedWriter(supabase, job, {
      trace: traceId(
        job.id,
        cp.step,
        "WRITER",
        `${cp.chapter_number}:0`
      ),
      title: freshProject.title,
      topic: freshProject.topic || "",
      chapterNumber: cp.chapter_number,
      chapterPlan,
      researchContext: cleanText(current?.research_bundle?.compiled_context),
      authorDna: current.author_dna,
      knowledgeGraph: current.knowledge_graph,
      previousChapters: previous,
      targetWords,
    });

    await upsertSection(
      supabase,
      project.id,
      cp.chapter_number,
      cleanText(chapterPlan?.chapter_title) || `Capítulo ${cp.chapter_number}`,
      text,
      "PENDING"
    );

    await patchProfile(supabase, project.id, {
      current_stage: "WRITING",
      status: "RUNNING",
    });

    await release(supabase, job, workerId, {
      step: "CHAPTER_COUNCIL",
      repair_iteration: 0,
    }, {
      last_stage: "WRITING",
      current_chapter: cp.chapter_number,
      chapter_words: wordCount(text),
    });
    return;
  }

  if (cp.step === "CHAPTER_COUNCIL") {
    const section = await getSection(supabase, project.id, cp.chapter_number);
    const text = cleanText(section?.content);
    if (!text) throw new Error(`Capítulo ${cp.chapter_number} sin borrador.`);

    const current = await getProfile(supabase, project.id);
    const { data: freshProject, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project.id)
      .single();
    if (error) throw error;

    const chapterPlan = (Array.isArray(freshProject.outline_12)
      ? freshProject.outline_12
      : []
    ).find((x: AnyRow) => Number(x?.chapter_number || 0) === cp.chapter_number);

    const previous = await previousChapterContext(
      supabase,
      project.id,
      cp.chapter_number
    );
    const shared = {
      book_title: freshProject.title,
      chapter_number: cp.chapter_number,
      chapter_plan: chapterPlan,
      chapter_text: text.slice(0, 42000),
      previous_chapters: previous,
      author_dna: current.author_dna,
      knowledge_graph: current.knowledge_graph,
      research_context: cleanText(current?.research_bundle?.compiled_context).slice(0, 28000),
    };

    await heartbeat(supabase, job.id, workerId);

    const [fact, continuity, style, adversarial] = await Promise.all([
      cachedAgent<AnyRow>(supabase, job, {
        agent: "FACT_CHECKER",
        action: "REVIEW_CHAPTER",
        trace: traceId(job.id, cp.step, "FACT_CHECKER", `${cp.chapter_number}:${cp.repair_iteration}`),
        payload: shared,
        inputSummary: `Fact check chapter ${cp.chapter_number}`,
      }),
      cachedAgent<AnyRow>(supabase, job, {
        agent: "CONTINUITY_EDITOR",
        action: "REVIEW_CHAPTER",
        trace: traceId(job.id, cp.step, "CONTINUITY_EDITOR", `${cp.chapter_number}:${cp.repair_iteration}`),
        payload: shared,
        inputSummary: `Continuity chapter ${cp.chapter_number}`,
      }),
      cachedAgent<AnyRow>(supabase, job, {
        agent: "STYLE_EDITOR",
        action: "REVIEW_CHAPTER",
        trace: traceId(job.id, cp.step, "STYLE_EDITOR", `${cp.chapter_number}:${cp.repair_iteration}`),
        payload: shared,
        inputSummary: `Style chapter ${cp.chapter_number}`,
      }),
      cachedAgent<AnyRow>(supabase, job, {
        agent: "ADVERSARIAL_CRITIC",
        action: "ATTACK_CHAPTER",
        trace: traceId(job.id, cp.step, "ADVERSARIAL_CRITIC", `${cp.chapter_number}:${cp.repair_iteration}`),
        payload: shared,
        inputSummary: `Adversarial chapter ${cp.chapter_number}`,
      }),
    ]);

    await persistClaims(
      supabase,
      job,
      cp.chapter_number,
      Array.isArray(fact?.claims) ? fact.claims : []
    );

    const reviews = [
      { agent: "FACT_CHECKER", ...fact },
      { agent: "CONTINUITY_EDITOR", ...continuity },
      { agent: "STYLE_EDITOR", ...style },
      { agent: "ADVERSARIAL_CRITIC", ...adversarial },
    ];

    const judge: AnyRow = await cachedAgent(supabase, job, {
      agent: "QUALITY_JUDGE",
      action: "JUDGE_COUNCIL",
      trace: traceId(job.id, cp.step, "QUALITY_JUDGE", `${cp.chapter_number}:${cp.repair_iteration}`),
      payload: {
        ...shared,
        council: reviews,
        iteration: cp.repair_iteration,
      },
      inputSummary: `Quality judge chapter ${cp.chapter_number}`,
    });

    const report = await persistQuality(
      supabase,
      job,
      cp.chapter_number,
      cp.repair_iteration,
      text,
      reviews,
      judge
    );

    const globalScore = score(report?.global_score);
    await patchProfile(supabase, project.id, {
      current_stage: "QUALITY_COUNCIL",
      status: report?.status === "APPROVED" ? "RUNNING" : "RUNNING",
      overall_score: globalScore,
    });

    if (report?.status === "APPROVED") {
      const sectionId = await upsertSection(
        supabase,
        project.id,
        cp.chapter_number,
        cleanText(section?.title) || `Capítulo ${cp.chapter_number}`,
        text,
        "COMPLETED"
      );
      await versionSection(supabase, sectionId, text);
      await buildAndPersistMaster(supabase, freshProject);

      await release(supabase, job, workerId, {
        step: "CHAPTER_WRITE",
        chapter_number: cp.chapter_number + 1,
        repair_iteration: 0,
      }, {
        last_stage: "QUALITY_COUNCIL",
        last_approved_chapter: cp.chapter_number,
        last_quality_score: globalScore,
      });
      return;
    }

    if (cp.repair_iteration >= MAX_REPAIRS || report?.status === "BLOCKED") {
      await patchProfile(supabase, project.id, {
        current_stage: "QUALITY_COUNCIL",
        status: "BLOCKED",
        overall_score: globalScore,
      });
      const { error: blockError } = await supabase
        .from("generation_jobs")
        .update({
          status: "BLOCKED",
          error: `Capítulo ${cp.chapter_number} bloqueado por Quality Gate.`,
          last_error: `Quality Gate ${globalScore}/10`,
          locked_by: null,
          locked_at: null,
          lease_expires_at: null,
          heartbeat_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("locked_by", workerId);
      if (blockError) throw blockError;
      return;
    }

    await release(supabase, job, workerId, {
      step: "CHAPTER_REWRITE",
    }, {
      last_stage: "QUALITY_COUNCIL",
      last_quality_score: globalScore,
    });
    return;
  }

  if (cp.step === "CHAPTER_REWRITE") {
    const section = await getSection(supabase, project.id, cp.chapter_number);
    const text = cleanText(section?.content);
    if (!text) throw new Error(`Capítulo ${cp.chapter_number} sin texto para reescribir.`);

    const current = await getProfile(supabase, project.id);
    const report = await qualityReportExists(
      supabase,
      project.id,
      cp.chapter_number,
      cp.repair_iteration
    );
    if (!report) throw new Error("No existe Quality Report para reescritura.");

    const rewrite: AnyRow = await cachedAgent(supabase, job, {
      agent: "REWRITE_EDITOR",
      action: "REWRITE_CHAPTER",
      trace: traceId(job.id, cp.step, "REWRITE_EDITOR", `${cp.chapter_number}:${cp.repair_iteration}`),
      payload: {
        book_title: project.title,
        chapter_number: cp.chapter_number,
        original_text: text.slice(0, 48000),
        quality_report: report,
        research_context: cleanText(current?.research_bundle?.compiled_context).slice(0, 26000),
        author_dna: current.author_dna,
        instruction:
          "Reescribe preservando hechos respaldados. Corrige defectos exactos. No inventes datos.",
      },
      inputSummary: `Rewrite chapter ${cp.chapter_number}, iteration ${cp.repair_iteration + 1}`,
    });

    const rewritten = cleanText(rewrite?.text);
    if (wordCount(rewritten) < 300) {
      throw new Error(`Reescritura demasiado corta en capítulo ${cp.chapter_number}.`);
    }

    await upsertSection(
      supabase,
      project.id,
      cp.chapter_number,
      cleanText(section?.title) || `Capítulo ${cp.chapter_number}`,
      rewritten,
      "PENDING"
    );

    await release(supabase, job, workerId, {
      step: "CHAPTER_COUNCIL",
      repair_iteration: cp.repair_iteration + 1,
    }, {
      last_stage: "CHAPTER_REWRITE",
      current_chapter: cp.chapter_number,
    });
    return;
  }

  if (cp.step === "MASTER") {
    const masterText = await buildAndPersistMaster(supabase, project);
    const current = await getProfile(supabase, project.id);
    const audit: AnyRow = await cachedAgent(supabase, job, {
      agent: "MASTER_EDITOR",
      action: "AUDIT_MASTER",
      trace: traceId(job.id, cp.step, "MASTER_EDITOR"),
      payload: {
        title: project.title,
        blueprint: current.blueprint,
        master_text: masterText.slice(0, 90000),
        quality_history_note:
          "Evalúa estructura global, continuidad, repetición, factualidad y readiness editorial.",
      },
      inputSummary: `Master audit: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      master_audit: audit,
      current_stage: "MASTER_EDIT",
      status: "RUNNING",
      overall_score: score(audit?.global_score),
    });
    await release(supabase, job, workerId, { step: "PUBLISHING" }, {
      last_stage: "MASTER_EDIT",
      master_score: score(audit?.global_score),
    });
    return;
  }

  if (cp.step === "PUBLISHING") {
    const current = await getProfile(supabase, project.id);
    const masterText = await latestMaster(supabase, project.id);
    const publishing: AnyRow = await cachedAgent(supabase, job, {
      agent: "PUBLISHING_DIRECTOR",
      action: "BUILD_PUBLISHING_PACKAGE",
      trace: traceId(job.id, cp.step, "PUBLISHING_DIRECTOR"),
      payload: {
        title: project.title,
        blueprint: current.blueprint,
        master_audit: current.master_audit,
        master_excerpt: masterText.slice(0, 70000),
        requested_formats: ["DOCX", "PDF", "EPUB"],
        instruction:
          "Genera especificación operativa y checklist. No afirmes que un binario fue generado si no lo fue.",
      },
      inputSummary: `Publishing Director: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      publishing_plan: publishing,
      current_stage: "PUBLISHING",
      status: "RUNNING",
    });
    await release(supabase, job, workerId, { step: "LAUNCH" }, {
      last_stage: "PUBLISHING",
      publishing_score: score(publishing?.score),
    });
    return;
  }

  if (cp.step === "LAUNCH") {
    const current = await getProfile(supabase, project.id);
    const masterText = await latestMaster(supabase, project.id);
    const launch = await cachedAgent(supabase, job, {
      agent: "LAUNCH_STRATEGIST",
      action: "BUILD_LAUNCH_SYSTEM",
      trace: traceId(job.id, cp.step, "LAUNCH_STRATEGIST"),
      payload: {
        title: project.title,
        market: current.market,
        blueprint: current.blueprint,
        master_excerpt: masterText.slice(0, 32000),
      },
      inputSummary: `Launch: ${project.title}`,
    });
    await patchProfile(supabase, project.id, {
      launch_plan: launch,
      current_stage: "LAUNCH",
      status: "RUNNING",
    });
    await release(supabase, job, workerId, { step: "PORTFOLIO" }, {
      last_stage: "LAUNCH",
    });
    return;
  }

  if (cp.step === "PORTFOLIO") {
    const current = await getProfile(supabase, project.id);
    const { data: costRows, error } = await supabase
      .from("os4_agent_runs")
      .select("estimated_cost_usd,input_tokens,output_tokens,agent,status")
      .eq("project_id", project.id);
    if (error) throw error;

    const totalCost = (costRows || []).reduce(
      (sum: number, row: AnyRow) => sum + Number(row?.estimated_cost_usd || 0),
      0
    );
    const portfolio = await cachedAgent(supabase, job, {
      agent: "PORTFOLIO_ANALYST",
      action: "ANALYZE_BOOK_RUN",
      trace: traceId(job.id, cp.step, "PORTFOLIO_ANALYST"),
      payload: {
        title: project.title,
        market: current.market,
        blueprint: current.blueprint,
        master_audit: current.master_audit,
        publishing_plan: current.publishing_plan,
        usage: {
          estimated_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
          agent_runs: (costRows || []).length,
        },
      },
      inputSummary: `Portfolio analysis: ${project.title}`,
    });

    await patchProfile(supabase, project.id, {
      portfolio_insights: portfolio,
      current_stage: "LEARNING",
      status: "COMPLETED",
      overall_score: score(current?.master_audit?.global_score || current?.overall_score),
    });

    await finish(supabase, job, workerId, {
      durable_book_completed: true,
      project_id: project.id,
      title: project.title,
      last_stage: "LEARNING",
      estimated_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
      portfolio_score: score((portfolio as AnyRow)?.score),
    });
    return;
  }

  throw new Error(`OS4 durable: step desconocido ${cp.step}`);
}

async function processClaimedJob(
  supabase: ReturnType<typeof serviceClient>,
  job: AnyRow,
  workerId: string
) {
  if (job.job_type === "OS4_HEALTHCHECK") {
    await processHealthcheck(supabase, job, workerId);
    return;
  }
  if (job.job_type !== "OS4_FULL_BOOK") {
    throw new Error(`Job type no soportado: ${job.job_type}`);
  }
  if (!job.project_id || !job.user_id) {
    throw new Error("OS4_FULL_BOOK requiere project_id y user_id.");
  }
  await processBookJob(supabase, job, workerId);
}

async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", resolve);
    req.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const started = Date.now();
  let claimed: AnyRow | null = null;
  let workerId = "";

  try {
    authorize(req);
    const body = req.method === "POST" ? await readBody(req).catch(() => ({})) : {};
    const supabase = serviceClient();

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        worker_version: WORKER_VERSION,
        durable: true,
        supports: [
          "atomic_lease",
          "heartbeat",
          "idempotent_agent_cache",
          "retry_backoff",
          "dead_letter",
          "checkpoint_resume",
          "supabase_cron",
        ],
      });
    }

    workerId =
      String(body?.worker_id || "").trim() ||
      `vercel-${process.env.VERCEL_REGION || "local"}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    try {
      await supabase.rpc("os4_sweep_generation_jobs");
    } catch {}

    const { data, error } = await supabase.rpc("os4_claim_generation_job", {
      p_worker_id: workerId,
      p_lease_seconds: DEFAULT_LEASE_SECONDS,
    });
    if (error) throw error;

    claimed = Array.isArray(data) ? data[0] || null : data || null;

    if (!claimed) {
      return res.status(200).json({
        ok: true,
        worker_version: WORKER_VERSION,
        claimed: false,
        message: "No hay jobs disponibles.",
        latency_ms: Date.now() - started,
      });
    }

    try {
      await processClaimedJob(supabase, claimed, workerId);
    } catch (error) {
      await fail(supabase, claimed, workerId, error).catch(() => {});
      throw error;
    }

    return res.status(200).json({
      ok: true,
      worker_version: WORKER_VERSION,
      claimed: true,
      job_id: claimed.id,
      job_type: claimed.job_type,
      checkpoint: checkpointOf(claimed),
      latency_ms: Date.now() - started,
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 500) || 500;
    return res.status(statusCode).json({
      ok: false,
      error: String(error?.message || error),
      worker_version: WORKER_VERSION,
      job_id: claimed?.id || null,
      worker_id: workerId || null,
      latency_ms: Date.now() - started,
    });
  }
}

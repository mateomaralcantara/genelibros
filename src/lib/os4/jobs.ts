import { supabase } from "../supabase";

export type Os4DurableJob = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  job_type: string;
  status: string;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  last_error?: string | null;
  attempts: number;
  max_attempts: number;
  checkpoint?: {
    version?: string;
    step?: string;
    chapter_number?: number;
    repair_iteration?: number;
    research_index?: number;
  };
  locked_at?: string | null;
  locked_by?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
  next_retry_at?: string | null;
  dead_letter_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

async function token(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const value = data.session?.access_token;
  if (!value) throw new Error("OS4 durable: sesión no autenticada.");
  return value;
}

async function api(path: string, init: RequestInit = {}) {
  const accessToken = await token();
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`OS4 Jobs respuesta inválida (${response.status}): ${raw.slice(0, 500)}`);
  }
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `OS4 Jobs HTTP ${response.status}`);
  }
  return data;
}

export async function enqueueOs4DurableBook(args: {
  projectId: string;
  mode: "AUTONOMOUS" | "SUPERVISED" | "EDITORIAL";
  targetChapterWords: number;
  authorSamples?: string;
  researchUrls?: string[];
  maxResearchQueries?: number;
}): Promise<Os4DurableJob> {
  const data = await api("/api/os4-jobs", {
    method: "POST",
    body: JSON.stringify({
      action: "enqueue",
      project_id: args.projectId,
      mode: args.mode,
      target_chapter_words: args.targetChapterWords,
      author_samples: args.authorSamples || "",
      research_urls: args.researchUrls || [],
      max_research_queries: args.maxResearchQueries || 6,
    }),
  });
  return data.job as Os4DurableJob;
}

export async function listOs4DurableJobs(projectId: string): Promise<Os4DurableJob[]> {
  const data = await api(`/api/os4-jobs?project_id=${encodeURIComponent(projectId)}`, {
    method: "GET",
  });
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export async function latestOs4DurableJob(projectId: string): Promise<Os4DurableJob | null> {
  const jobs = await listOs4DurableJobs(projectId);
  return jobs[0] || null;
}

export async function cancelOs4DurableJob(
  projectId: string,
  jobId: string
): Promise<Os4DurableJob | null> {
  const data = await api("/api/os4-jobs", {
    method: "POST",
    body: JSON.stringify({
      action: "cancel",
      project_id: projectId,
      job_id: jobId,
    }),
  });
  return data.job || null;
}

export async function resumeOs4DurableJob(
  projectId: string,
  jobId: string
): Promise<Os4DurableJob | null> {
  const data = await api("/api/os4-jobs", {
    method: "POST",
    body: JSON.stringify({
      action: "resume",
      project_id: projectId,
      job_id: jobId,
    }),
  });
  return data.job || null;
}

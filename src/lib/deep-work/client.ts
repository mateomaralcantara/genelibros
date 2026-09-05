import { supabase } from "../supabase";
import type { DeepWorkDepth, DeepWorkOperation } from "./types";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No hay sesión activa.");
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

export async function enqueueDeepWork(input: {
  projectId: string;
  chapterNumber: number;
  objective: string;
  operation?: DeepWorkOperation;
  depth?: DeepWorkDepth;
  targetWords?: number;
}) {
  const response = await fetch("/api/deep-work-jobs", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      action: "enqueue",
      project_id: input.projectId,
      chapter_number: input.chapterNumber,
      objective: input.objective,
      operation: input.operation || "IMPROVE",
      depth: input.depth || "DEEP",
      target_words: input.targetWords,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || "No se pudo encolar Deep Work.");
  return body;
}

export async function listDeepWorkJobs(projectId: string) {
  const response = await fetch(`/api/deep-work-jobs?project_id=${encodeURIComponent(projectId)}`, {
    headers: await authHeaders(),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || "No se pudieron consultar los jobs Deep Work.");
  return body;
}

export async function applyDeepWorkCandidate(input: { projectId: string; jobId: string }) {
  const response = await fetch("/api/deep-work-apply", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "apply", project_id: input.projectId, job_id: input.jobId }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || "No se pudo aplicar el candidato Deep Work.");
  return body;
}

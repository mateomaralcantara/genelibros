import { supabase } from "../supabase";
import type { RefinementMode } from "./types";

async function accessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("No hay sesión activa.");
  return token;
}

async function request(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }

  return body;
}

export async function enqueueRefinement(args: {
  projectId: string;
  evaluationId: string;
  mode?: RefinementMode;
}) {
  return request("/api/refinement-jobs", {
    method: "POST",
    body: JSON.stringify({
      action: "enqueue",
      project_id: args.projectId,
      evaluation_id: args.evaluationId,
      mode: args.mode || "DEEP",
    }),
  });
}

export async function getRefinementJobs(projectId: string) {
  return request(
    `/api/refinement-jobs?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function applyRefinementVersion(versionId: string) {
  return request("/api/refinement-apply", {
    method: "POST",
    body: JSON.stringify({ action: "apply", version_id: versionId }),
  });
}

export async function rollbackRefinementApply(applyId: string) {
  return request("/api/refinement-apply", {
    method: "POST",
    body: JSON.stringify({ action: "rollback", apply_id: applyId }),
  });
}

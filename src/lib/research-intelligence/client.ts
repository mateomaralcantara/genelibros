import { supabase } from "../supabase";
import type { EnqueueResearchInput } from "./types";

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("No hay sesión Supabase activa.");
  return session.access_token;
}

export async function enqueueResearch(input: EnqueueResearchInput) {
  const bearer = await token();
  const response = await fetch("/api/research-jobs", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ action: "enqueue", ...input }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

export async function listResearchJobs(projectId: string) {
  const bearer = await token();
  const response = await fetch(`/api/research-jobs?project_id=${encodeURIComponent(projectId)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

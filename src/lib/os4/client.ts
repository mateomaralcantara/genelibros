import { authHeaders, supabase } from "../supabase";
import type {
  Os4AgentName,
  Os4AgentResponse,
  Os4ResearchBundle,
  Os4ResearchSource,
} from "./types";

export async function callOs4Agent<T = any>(args: {
  agent: Os4AgentName;
  action: string;
  payload: Record<string, unknown>;
  model?: string;
  traceId?: string;
}): Promise<Os4AgentResponse<T>> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) throw new Error("OS4: sesión no autenticada.");

  const response = await fetch("/api/os4", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      agent: args.agent,
      action: args.action,
      payload: args.payload,
      model: args.model,
      trace_id: args.traceId,
    }),
  });

  const raw = await response.text();
  let dataOut: any = null;

  try {
    dataOut = JSON.parse(raw);
  } catch {
    throw new Error(`OS4 devolvió respuesta inválida (${response.status}): ${raw.slice(0, 600)}`);
  }

  if (!response.ok || !dataOut?.ok) {
    throw new Error(dataOut?.error || `OS4 HTTP ${response.status}`);
  }

  return dataOut as Os4AgentResponse<T>;
}

export async function runOs4Research(args: {
  query: string;
  urls?: string[];
  maxSources?: number;
}): Promise<{
  sources: Os4ResearchSource[];
  facts: Array<Record<string, unknown>>;
  research_context: string;
  needs_input?: unknown;
}> {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      query: args.query,
      urls: args.urls || [],
      maxSources: Math.max(1, Math.min(10, args.maxSources || 5)),
    }),
  });

  const raw = await response.text();
  let data: any;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Research API devolvió respuesta inválida: ${raw.slice(0, 600)}`);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Research HTTP ${response.status}`);
  }

  return {
    sources: Array.isArray(data.sources) ? data.sources : [],
    facts: Array.isArray(data.facts) ? data.facts : [],
    research_context: String(data.research_context || ""),
    needs_input: data.needs_input,
  };
}

export function mergeResearchContexts(parts: string[], maxChars = 65000): string {
  const clean = parts.map((x) => String(x || "").trim()).filter(Boolean);
  return clean.join("\n\n---\n\n").slice(0, maxChars);
}

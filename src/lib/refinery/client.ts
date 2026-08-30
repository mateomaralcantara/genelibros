import { supabase } from "../supabase";
import type {
  ManuscriptAuditMode,
  ManuscriptAuditResult,
} from "./types";

export async function auditProjectManuscript(args: {
  projectId: string;
  mode?: ManuscriptAuditMode;
  persist?: boolean;
}): Promise<{
  evaluationId: string | null;
  persistenceWarning: string | null;
  result: ManuscriptAuditResult;
}> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) throw new Error("Debes iniciar sesión para auditar un libro.");

  const response = await fetch("/api/manuscript-audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      project_id: args.projectId,
      mode: args.mode || "DEEP",
      persist: args.persist !== false,
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.error || `Manuscript audit HTTP ${response.status}`);
  }

  return {
    evaluationId: body?.evaluation_id || null,
    persistenceWarning: body?.persistence_warning || null,
    result: body.result as ManuscriptAuditResult,
  };
}

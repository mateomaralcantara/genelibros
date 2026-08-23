import { supabase } from "./supabase";
import type { CreateChapterJobInput, GenerationJob } from "./jobTypes";

export async function createChapterGenerationJob(input: CreateChapterJobInput): Promise<GenerationJob> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData.user?.id;
  if (!userId) throw new Error("Usuario no autenticado.");

  const { data: active, error: activeErr } = await supabase
    .from("generation_jobs")
    .select("id,status,chapter_number")
    .eq("project_id", input.projectId)
    .in("status", ["QUEUED", "GENERATING", "ASSEMBLING"])
    .limit(1);

  if (activeErr) throw activeErr;
  if (active?.length) throw new Error(`Ya hay un job activo: capítulo ${active[0].chapter_number ?? "?"} (${active[0].status}).`);

  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: userId,
      project_id: input.projectId,
      job_type: "GENERATE_CHAPTER",
      chapter_number: input.chapterNumber,
      target_words: Math.max(800, Math.floor(input.targetWords || 3000)),
      model: input.model || "gemini-2.5-flash",
      status: "QUEUED",
      progress_percent: 0,
      current_step: "En cola",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as GenerationJob;
}

export async function getProjectJobs(projectId: string): Promise<GenerationJob[]> {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as GenerationJob[];
}

export async function cancelJob(jobId: string): Promise<void> {
  const { error } = await supabase
    .from("generation_jobs")
    .update({ status: "CANCELLED", current_step: "Cancelado", finished_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["QUEUED", "GENERATING", "ASSEMBLING"]);
  if (error) throw error;
}

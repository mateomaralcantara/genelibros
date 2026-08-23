export type EliteGenerationJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RETRYING";

export type EliteGenerationJobType =
  | "BLUEPRINT"
  | "RESEARCH"
  | "DOSSIER"
  | "OUTLINE"
  | "PROPOSAL"
  | "INTRODUCTION"
  | "CHAPTER"
  | "FACT_CHECK"
  | "REWRITE"
  | "EXPORT";

export type EliteGenerationJob = {
  id?: string;
  user_id?: string;
  project_id?: string;
  job_type: EliteGenerationJobType;
  status: EliteGenerationJobStatus;
  priority: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  max_attempts: number;
};

export const ELITE_PIPELINE_STAGES = [
  "Blueprint",
  "Investigación",
  "Outline",
  "Writing",
  "Fact-check",
  "Revisión",
  "Export",
] as const;

export function createGenerationJob(args: {
  user_id?: string;
  project_id?: string;
  job_type: EliteGenerationJobType;
  payload?: Record<string, unknown>;
  priority?: number;
}): EliteGenerationJob {
  return {
    user_id: args.user_id,
    project_id: args.project_id,
    job_type: args.job_type,
    status: "QUEUED",
    priority: Number(args.priority || 5),
    payload: args.payload || {},
    attempts: 0,
    max_attempts: 3,
  };
}

export function shouldRetryJob(job: EliteGenerationJob): boolean {
  return (
    job.status === "FAILED" &&
    Number(job.attempts || 0) < Number(job.max_attempts || 3)
  );
}

export function nextPipelineStage(current: string): string | null {
  const index = ELITE_PIPELINE_STAGES.findIndex(
    (stage) => stage.toLowerCase() === String(current || "").toLowerCase()
  );

  if (index < 0) return ELITE_PIPELINE_STAGES[0];
  return ELITE_PIPELINE_STAGES[index + 1] || null;
}

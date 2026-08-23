export type GenerationJobStatus =
  | "QUEUED"
  | "GENERATING"
  | "ASSEMBLING"
  | "COMPLETED"
  | "ERROR"
  | "CANCELLED";

export type GenerationJob = {
  id: string;
  user_id: string;
  project_id: string;
  job_type: "GENERATE_CHAPTER" | "GENERATE_PROPOSAL" | "GENERATE_INTRODUCTION";
  chapter_number?: number | null;
  status: GenerationJobStatus;
  target_words: number;
  model: string;
  progress_percent: number;
  current_step?: string | null;
  result_text?: string | null;
  error_message?: string | null;
  retry_count: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type CreateChapterJobInput = {
  projectId: string;
  chapterNumber: number;
  targetWords: number;
  model?: string;
};

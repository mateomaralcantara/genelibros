// src/lib/types.local.ts
export type ComposerTask = {
  action:
    | "BUILD_FULL_DOSSIER"
    | "GENERATE_PROPOSAL"
    | "GENERATE_INTRODUCTION"
    | "GENERATE_CHAPTER"
    | "REVISE_SECTION"
    | "REBUILD_MASTER";
  chapter_number?: number;
  target_length_words?: number;
  active_view?: "MASTER" | "DOSSIER" | "OUTLINE" | "PROPOSAL" | "INTRODUCTION" | "CHAPTER";
};

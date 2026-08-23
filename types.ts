
export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
}

export interface MenuItem {
  id: string;
  label: string;
  type: 'DOSSIER' | 'OUTLINE' | 'PROPOSAL' | 'INTRODUCTION' | 'CHAPTER' | 'MASTER';
  order: number;
}

export interface GlossaryItem {
  term: string;
  definition: string;
}

export interface Dossier {
  one_liner: string;
  promise: string;
  positioning: string;
  reader_outcomes: string[];
  glossary: GlossaryItem[];
  style_guide: string;
  canon_rules: string[];
  progress_rules: string[];
}

export interface OutlineChapter {
  chapter_number: number;
  chapter_title: string;
  objective: string;
  key_points: string[];
  subheads_h2: string[];
  tools_frameworks: string[];
  exercises: string[];
  deliverable: string;
  transition_to_next: string;
  status: 'PENDING' | 'DRAFTED' | 'COMPLETED';
  target_words: number;
}

export interface TextSection {
  id: string;
  text: string;
  status: 'PENDING' | 'COMPLETED';
  words: number;
}

export interface ChapterSection extends TextSection {
  chapter_number: number;
  title: string;
}

export interface ContinuityPack {
  style_guide: string;
  canon: string;
  outline_progress: string;
  open_loops: string[];
  chapter_summaries: string[];
  next_chapter_plan: string[];
}

export interface ProjectState {
  project_id: string;
  book_title: string;
  book_topic: string;
  audience: string;
  tone_style: string;
  dossier: Dossier;
  outline_12: OutlineChapter[];
  proposal: TextSection;
  introduction: TextSection;
  chapters: ChapterSection[];
  continuity_pack: ContinuityPack;
  master_document: { title: string; text: string };
}

export interface MasterDocumentChunk {
  index: number;
  total: number;
  text: string;
}

export interface DashboardData {
  project_id: string;
  book_title: string;
  active_view: 'MASTER' | 'DOSSIER' | 'OUTLINE' | 'PROPOSAL' | 'INTRODUCTION' | 'CHAPTER';
  active_section_id: string;
  menu_items: MenuItem[];
  progress: {
    proposal_words: number;
    introduction_words: number;
    chapters_words: { chapter_number: number; words: number; status: string }[];
    total_words: number;
    completion_percent_est: number;
  };
  render_hints: {
    recommended_layout: string;
    show_full_master_by_default: boolean;
    enable_scroll: boolean;
    enable_search: boolean;
  };
}

export interface Project {
  id: string;
  title: string;
  state: ProjectState;
  master_document: {
    title: string;
    text: string;
    chunks: MasterDocumentChunk[];
  };
  generation_progress: Record<string, 'pending' | 'generating' | 'completed' | 'error'>;
  dashboard?: DashboardData;
}

/**
 * Missing interfaces used by utility parsers and display components
 */
export interface ChapterSummary {
  title: string;
  points: string[];
}

export interface BookProposal {
  summary: string;
  titleOptions: string[];
  subtitleOptions: string[];
  targetAudience: string;
  mainGoal: string;
  toneAndStyle: string;
  config: {
    chapterCount: string;
    introWords: string;
    chapterWords: string;
  };
  introductionPoints: string[];
  chapters: ChapterSummary[];
  suggestedCommands: {
    introduction: string;
    chapters: Record<number, string>;
  };
}

export interface Chapter {
  id: string;
  chapter_number: number;
  title: string;
  text: string;
}

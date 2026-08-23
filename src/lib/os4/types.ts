export type Os4Mode = "AUTONOMOUS" | "SUPERVISED" | "EDITORIAL";

export type Os4Stage =
  | "MARKET"
  | "CONCEPT_BATTLE"
  | "AUTHOR_DNA"
  | "BLUEPRINT"
  | "RESEARCH"
  | "KNOWLEDGE_GRAPH"
  | "SIMULATION"
  | "CHIEF_APPROVAL"
  | "WRITING"
  | "FACT_CHECK"
  | "QUALITY_COUNCIL"
  | "MASTER_EDIT"
  | "PUBLISHING"
  | "LAUNCH"
  | "LEARNING";

export type Os4Status =
  | "IDLE"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export type Os4AgentName =
  | "MARKET_STRATEGIST"
  | "CONCEPT_ARENA"
  | "AUTHOR_DNA_ANALYST"
  | "BOOK_ARCHITECT"
  | "RESEARCH_DIRECTOR"
  | "KNOWLEDGE_ENGINEER"
  | "BOOK_SIMULATOR"
  | "CHIEF_EDITOR"
  | "FACT_CHECKER"
  | "CONTINUITY_EDITOR"
  | "STYLE_EDITOR"
  | "ADVERSARIAL_CRITIC"
  | "QUALITY_JUDGE"
  | "REWRITE_EDITOR"
  | "MASTER_EDITOR"
  | "PUBLISHING_DIRECTOR"
  | "LAUNCH_STRATEGIST"
  | "PORTFOLIO_ANALYST";

export type Os4RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";

export interface Os4Score {
  score: number;
  rationale?: string;
}

export interface Os4MarketIntelligence {
  market_score: number;
  demand_hypothesis: string;
  reader_problem: string;
  primary_audience: string;
  secondary_audiences: string[];
  positioning: string;
  market_gap: string;
  competing_angles: string[];
  commercial_risks: string[];
  keywords: string[];
  category_hypotheses: string[];
  differentiation_score: number;
  recommendation: "GO" | "REFINE" | "NO_GO";
}

export interface Os4ConceptCandidate {
  id: string;
  title: string;
  subtitle: string;
  angle: string;
  promise: string;
  audience: string;
  commercial_score: number;
  authority_score: number;
  originality_score: number;
  risk_score: number;
}

export interface Os4ConceptBattle {
  candidates: Os4ConceptCandidate[];
  winner_id: string;
  winner_reason: string;
  hybrid_recommendation?: string;
}

export interface Os4AuthorDNA {
  language: string;
  formality: number;
  sentence_length_preference: "SHORT" | "MIXED" | "LONG";
  vocabulary_density: number;
  emotional_intensity: number;
  analytical_depth: number;
  humor_level: number;
  metaphor_level: number;
  preferred_structure: string[];
  signature_traits: string[];
  avoid_traits: string[];
  sample_phrases_pattern: string[];
  style_directive: string;
}

export interface Os4BlueprintChapter {
  chapter_number: number;
  chapter_title: string;
  chapter_thesis: string;
  objective: string;
  key_points: string[];
  subheads_h2: string[];
  required_facts: string[];
  source_needs: string[];
  contradiction_checks: string[];
  transition_to_next: string;
  target_words: number;
}

export interface Os4Blueprint {
  selected_title: string;
  selected_subtitle: string;
  title_options: string[];
  subtitle_options: string[];
  central_thesis: string;
  editorial_promise: string;
  unique_mechanism: string;
  audience: string;
  tone_style: string;
  factual_strategy: string;
  narrative_arc: string;
  chapter_count: number;
  chapters: Os4BlueprintChapter[];
  blueprint_score: number;
  blocking_gaps: string[];
}

export interface Os4ResearchQuery {
  query: string;
  purpose: string;
  chapter_numbers: number[];
  priority: "CRITICAL" | "HIGH" | "MEDIUM";
}

export interface Os4ResearchPlan {
  queries: Os4ResearchQuery[];
  official_source_targets: string[];
  academic_source_targets: string[];
  primary_source_targets: string[];
  high_risk_claims: string[];
  chronology_requirements: string[];
  verification_rules: string[];
}

export interface Os4ResearchSource {
  title: string;
  url: string;
  reliability_score: number;
  extracted_text: string;
}

export interface Os4ResearchBundle {
  plan: Os4ResearchPlan;
  sources: Os4ResearchSource[];
  facts: Array<Record<string, unknown>>;
  compiled_context: string;
  coverage_score: number;
}

export interface Os4KnowledgeNode {
  id: string;
  type: "PERSON" | "EVENT" | "DATE" | "ORGANIZATION" | "CLAIM" | "CONCEPT" | "SOURCE" | "LOCATION" | "METRIC";
  label: string;
  attributes: Record<string, unknown>;
  confidence: number;
}

export interface Os4KnowledgeEdge {
  from: string;
  to: string;
  relation: string;
  evidence_source_urls: string[];
  confidence: number;
}

export interface Os4KnowledgeGraph {
  nodes: Os4KnowledgeNode[];
  edges: Os4KnowledgeEdge[];
  chronology: Array<{ date: string; event: string; confidence: number }>;
  contradictions: Array<{
    statement_a: string;
    statement_b: string;
    severity: Os4RiskLevel;
    resolution_needed: string;
  }>;
}

export interface Os4Simulation {
  executive_simulation: string;
  chapter_simulations: Array<{
    chapter_number: number;
    expected_value: string;
    likely_repetition: string[];
    missing_evidence: string[];
    risk: Os4RiskLevel;
  }>;
  structural_score: number;
  repetition_risk_score: number;
  recommendation: "APPROVE" | "REVISE";
  revisions: string[];
}

export interface Os4AgentResponse<T = any> {
  ok: boolean;
  trace_id: string;
  agent: Os4AgentName;
  model: string;
  latency_ms: number;
  output: T;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    estimated_cost_usd?: number;
  };
}

export interface Os4AgentReview {
  agent: Os4AgentName;
  score: number;
  blocking: boolean;
  issues: string[];
  strengths: string[];
  rewrite_instructions: string[];
  facts_to_verify?: string[];
}

export interface Os4QualityDimensions {
  factuality: number;
  depth: number;
  clarity: number;
  narrative: number;
  originality: number;
  coherence: number;
  continuity: number;
  sourcing: number;
  non_repetition: number;
  author_dna: number;
  commercial_value: number;
}

export interface Os4QualityReport {
  chapter_number: number;
  global_score: number;
  status: "APPROVED" | "REWRITE_REQUIRED" | "BLOCKED";
  dimensions: Os4QualityDimensions;
  deterministic: {
    words: number;
    paragraph_count: number;
    heading_count: number;
    repetition_penalty: number;
    generic_phrase_penalty: number;
  };
  council: Os4AgentReview[];
  blocking_issues: string[];
  rewrite_instructions: string[];
  iteration: number;
}

export interface Os4MasterAudit {
  global_score: number;
  structural_score: number;
  continuity_score: number;
  repetition_score: number;
  factual_risk_score: number;
  strongest_sections: string[];
  weakest_sections: string[];
  structural_changes: string[];
  line_edit_priorities: string[];
  publish_readiness: "READY" | "REVISE" | "BLOCKED";
}

export interface Os4LaunchPlan {
  positioning: string;
  amazon_description: string;
  back_cover: string;
  hooks: string[];
  social_posts: string[];
  short_video_scripts: string[];
  email_sequence: Array<{ subject: string; body: string }>;
  podcast_pitch: string;
  press_release: string;
  lead_magnet: string;
  launch_calendar: Array<{ day: string; action: string }>;
  metrics_to_track: string[];
}

export interface Os4Profile {
  project_id: string;
  user_id: string;
  mode: Os4Mode;
  current_stage: Os4Stage;
  status: Os4Status;
  overall_score: number | null;
  market: Os4MarketIntelligence | null;
  concept_battle: Os4ConceptBattle | null;
  author_dna: Os4AuthorDNA | null;
  blueprint: Os4Blueprint | null;
  research_bundle: Os4ResearchBundle | null;
  knowledge_graph: Os4KnowledgeGraph | null;
  simulation: Os4Simulation | null;
  chief_approval: Record<string, unknown> | null;
  master_audit: Os4MasterAudit | null;
  publishing_plan: Record<string, unknown> | null;
  launch_plan: Os4LaunchPlan | null;
  created_at?: string;
  updated_at?: string;
}

export interface Os4PipelineEvent {
  stage: Os4Stage;
  status: Os4Status;
  message: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface Os4PreproductionOptions {
  mode: Os4Mode;
  targetChapterWords: number;
  authorSamples?: string;
  researchUrls?: string[];
  maxResearchQueries?: number;
  onEvent?: (event: Os4PipelineEvent) => void;
}

export interface Os4ChapterOptions {
  targetWords: number;
  maxRepairIterations?: number;
  minimumScore?: number;
  onEvent?: (event: Os4PipelineEvent) => void;
}

export type DeepWorkDepth = "FAST" | "DEEP" | "SUPREME" | "ULTRA";
export type DeepWorkTargetType = "CHAPTER";
export type DeepWorkOperation = "IMPROVE" | "REWRITE" | "GENERATE";

export type DeepWorkStep =
  | "INIT"
  | "PLAN"
  | "CONTEXT"
  | "DRAFT"
  | "CRITIC"
  | "SYNTHESIS"
  | "REPAIR"
  | "QUALITY"
  | "PERSIST";

export interface DeepWorkPlan {
  objective: string;
  operation: DeepWorkOperation;
  targetWords: number;
  constraints: string[];
  successCriteria: string[];
  passes: string[];
  risks: string[];
  requiredContext: string[];
}

export interface DeepContextAnalysis {
  chapterPurpose: string;
  priorDependencies: string[];
  futureDependencies: string[];
  factsToPreserve: string[];
  terminology: string[];
  voiceRules: string[];
  continuityRisks: string[];
  omissions: string[];
}

export interface DeepDraft {
  label: "A" | "B" | "C" | "SYNTHESIS" | "REPAIR";
  content: string;
  rationale: string;
  strengths: string[];
  risks: string[];
}

export interface CriticReview {
  critic: "STRUCTURE" | "CLARITY" | "DEPTH" | "CONTINUITY" | "ADVERSARIAL";
  score: number;
  strengths: string[];
  problems: string[];
  requiredRepairs: string[];
}

export interface DraftCouncilResult {
  selectedDrafts: string[];
  ranking: Array<{ label: string; score: number; reason: string }>;
  reviews: CriticReview[];
  synthesisInstructions: string[];
  fatalProblems: string[];
}

export interface DeepQualityScore {
  overallScore: number;
  verdict: "APPROVED" | "REPAIR" | "REJECTED";
  scores: {
    structure: number;
    depth: number;
    clarity: number;
    continuity: number;
    style: number;
    originality: number;
    factualDiscipline: number;
    usefulness: number;
    publishability: number;
  };
  strengths: string[];
  weaknesses: string[];
  requiredRepairs: string[];
  unsupportedNewClaims: string[];
}

export interface DeepWorkUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
}

export interface DeepWorkResult {
  version: string;
  projectId: string;
  projectTitle: string;
  targetType: DeepWorkTargetType;
  operation: DeepWorkOperation;
  chapterNumber: number;
  sectionId?: string;
  sourceHash: string;
  depth: DeepWorkDepth;
  objective: string;
  targetWords: number;
  plan?: DeepWorkPlan;
  context?: DeepContextAnalysis;
  drafts: DeepDraft[];
  council?: DraftCouncilResult;
  finalCandidate?: DeepDraft;
  quality?: DeepQualityScore;
  repairAttempts: number;
  artifactIds: string[];
  usage: DeepWorkUsage;
  applied?: boolean;
}

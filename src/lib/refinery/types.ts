export type ManuscriptAuditMode = "DEEP" | "SUPREME";

export type ManuscriptAction =
  | "PRESERVE"
  | "POLISH"
  | "REDUCE"
  | "EXPAND"
  | "REWRITE"
  | "RESTRUCTURE"
  | "MERGE";

export interface ManuscriptChapterInput {
  id?: string;
  chapterNumber: number;
  title: string;
  content: string;
}

export interface DeterministicChapterMetrics {
  chapterNumber: number;
  title: string;
  words: number;
  characters: number;
  paragraphs: number;
  sentences: number;
  averageSentenceWords: number;
  repeatedParagraphs: number;
  repeatedParagraphWords: number;
  lexicalDiversity: number;
}

export interface ChapterAuditScores {
  structure: number;
  thesis: number;
  depth: number;
  clarity: number;
  redundancy: number;
  continuity: number;
  style: number;
  pacing: number;
  originality: number;
  factuality: number;
  evidence: number;
  publishability: number;
}

export interface ManuscriptChapterAudit {
  chapterNumber: number;
  title: string;
  scores: ChapterAuditScores;
  overallScore: number;
  thesis: string;
  keyIdeas: string[];
  strengths: string[];
  weaknesses: string[];
  repetitions: string[];
  unsupportedClaims: string[];
  continuityRisks: string[];
  recommendedAction: ManuscriptAction;
  targetReductionPercent: number;
  estimatedRemovableWords: number;
  estimatedExpansionWords: number;
  editorialInstructions: string[];
  confidence: number;
}

export interface ChapterOverlap {
  chapterA: number;
  chapterB: number;
  lexicalOverlap: number;
  semanticOverlap: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  repeatedIdeas: string[];
  recommendation: string;
}

export interface ManuscriptGlobalScores {
  structure: number;
  centralThesis: number;
  depth: number;
  clarity: number;
  nonRepetition: number;
  continuity: number;
  style: number;
  pacing: number;
  originality: number;
  factuality: number;
  evidence: number;
  introduction: number;
  conclusion: number;
  commercialValue: number;
  publishability: number;
}

export interface EditorialSurgeryItem {
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  scope: "BOOK" | "CHAPTER" | "SECTION";
  chapterNumber?: number;
  action: ManuscriptAction;
  problem: string;
  instruction: string;
  expectedImpact: string;
}

export interface ManuscriptGlobalAudit {
  scores: ManuscriptGlobalScores;
  overallScore: number;
  verdict:
    | "NOT_READY"
    | "NEEDS_MAJOR_EDIT"
    | "NEEDS_REFINEMENT"
    | "PUBLISHABLE"
    | "PUBLISH_READY";
  centralThesis: string;
  promiseToReader: string;
  strongestElements: string[];
  globalProblems: string[];
  missingElements: string[];
  factualRisks: string[];
  structuralRecommendations: string[];
  crossChapterOverlaps: ChapterOverlap[];
  surgeryPlan: EditorialSurgeryItem[];
  recommendedReductionPercent: number;
  recommendedWordCount: number;
  finalEditorialBrief: string;
  confidence: number;
}

export interface ManuscriptAuditResult {
  version: string;
  mode: ManuscriptAuditMode;
  projectId: string;
  projectTitle: string;
  createdAt: string;
  model: string;
  currentWords: number;
  recommendedWords: number;
  recommendedReductionPercent: number;
  chapterCount: number;
  deterministic: {
    chapterMetrics: DeterministicChapterMetrics[];
    lexicalOverlapMatrix: ChapterOverlap[];
    meanChapterWords: number;
    chapterWordStdDev: number;
    imbalanceRatio: number;
    repeatedParagraphWords: number;
  };
  chapters: ManuscriptChapterAudit[];
  global: ManuscriptGlobalAudit;
  warnings: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    calls: number;
  };
}

export interface ManuscriptAuditRequest {
  projectId: string;
  mode?: ManuscriptAuditMode;
  persist?: boolean;
}

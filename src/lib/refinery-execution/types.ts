export type RefinementMode = "DEEP" | "SUPREME";

export type RefinementAction =
  | "PRESERVE"
  | "POLISH"
  | "REDUCE"
  | "EXPAND"
  | "REWRITE"
  | "RESTRUCTURE"
  | "MERGE";

export type RefinementPlanStatus =
  | "PENDING"
  | "PRESERVED"
  | "NEEDS_RESEARCH"
  | "STRUCTURAL_PLAN"
  | "CANDIDATE"
  | "APPROVED"
  | "REJECTED";

export interface RefinementResearchGap {
  chapterNumber: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  unsupportedClaims: string[];
  requestedEvidence: string[];
  blocksActions: RefinementAction[];
}

export interface RefinementPlanItem {
  chapterNumber: number;
  title: string;
  action: RefinementAction;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  beforeScore: number;
  evidenceScore: number;
  factualityScore: number;
  targetReductionPercent: number;
  instruction: string;
  researchRequired: boolean;
  hardResearchBlock: boolean;
  status: RefinementPlanStatus;
  repairAttempts: number;
  versionId?: string;
  reason?: string;
}

export interface EditorialDelta {
  accepted: boolean;
  reason: string;
  beforeScore: number;
  afterScore: number;
  overallDelta: number;
  beforeWords: number;
  afterWords: number;
  wordDelta: number;
  wordDeltaPercent: number;
  scoreDelta: {
    structure: number;
    clarity: number;
    redundancy: number;
    continuity: number;
    style: number;
    factuality: number;
    evidence: number;
    publishability: number;
  };
  hardGateFailures: string[];
  improvements: string[];
  regressions: string[];
}

export interface RefinementCandidate {
  status: "OK" | "NEEDS_RESEARCH";
  content: string;
  summary: string;
  changes: string[];
  removedIdeas: string[];
  addedIdeas: string[];
  researchNeeds: string[];
  agentChain: string[];
}

export interface RefinementJobResult {
  version: string;
  projectId: string;
  projectTitle: string;
  evaluationId: string;
  baselineOverallScore: number;
  projectedOverallScore?: number;
  projectedVerdict?: string;
  masterCandidateApproved?: boolean;
  plan: RefinementPlanItem[];
  researchGaps: RefinementResearchGap[];
  structuralPlan: Array<Record<string, unknown>>;
  approvedVersionIds: string[];
  rejectedVersionIds: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    calls: number;
  };
  summary?: {
    preserved: number;
    needsResearch: number;
    structuralPlan: number;
    approved: number;
    rejected: number;
  };
}

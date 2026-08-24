export type AgentFamily =
  | "CORE"
  | "CREATOR"
  | "REFINERY"
  | "DEEP_WORK"
  | "RESEARCH"
  | "SERIES"
  | "EDITORIAL"
  | "PUBLISHING";

export type AgentStatus = "READY" | "PLANNED" | "DISABLED";
export type BrainModelClass = "FAST" | "DEEP" | "SUPREME";
export type BrainDepth = "FAST" | "DEEP" | "SUPREME" | "ULTRA";

export type BrainTaskIntent =
  | "CREATE_BOOK"
  | "REFINE_BOOK"
  | "DEEP_WORK"
  | "RESEARCH_NONFICTION"
  | "CREATE_SERIES"
  | "FINALIZE_BOOK";

export type BrainStepKind = "AGENT" | "TOOL" | "GATE";

export interface BrainAgentDefinition {
  id: string;
  family: AgentFamily;
  description: string;
  capabilities: string[];
  modelClass: BrainModelClass;
  status: AgentStatus;
  canRunParallel: boolean;
  requiresResearch: boolean;
  qualityThreshold: number;
  maxRepairIterations?: number;
  legacyOs4?: boolean;
}

export interface BrainTaskRequest {
  intent?: BrainTaskIntent;
  objective: string;
  projectId?: string;
  bookId?: string;
  seriesId?: string;
  existingManuscript?: boolean;
  nonfiction?: boolean;
  seriesCount?: number;
  depth?: BrainDepth;
  preserveAuthorVoice?: boolean;
  targetReductionPercent?: number;
  maxBudgetUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface BrainRoute {
  intent: BrainTaskIntent;
  families: AgentFamily[];
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  rationale: string[];
}

export interface BrainModelRoute {
  agentId: string;
  modelClass: BrainModelClass;
  model: string;
  reason: string;
}

export interface BrainQualityProfile {
  globalMinimum: number;
  factualityMinimum: number;
  continuityMinimum: number;
  originalityMinimum: number;
  nonRepetitionMinimum: number;
  seriesDifferentiationMinimum?: number;
  maxRepairIterations: number;
}

export interface BrainCostGuard {
  maxWorkflowSteps: number;
  maxDeepAgents: number;
  maxSupremeAgents: number;
  maxEstimatedTokens: number;
  maxBudgetUsd?: number;
}

export interface BrainWorkflowStep {
  id: string;
  order: number;
  kind: BrainStepKind;
  agentId?: string;
  family?: AgentFamily;
  capability?: string;
  parallelGroup?: string;
  dependsOn: string[];
  required: boolean;
  status: AgentStatus | "SYSTEM";
  model?: string;
  modelClass?: BrainModelClass;
  qualityThreshold?: number;
  notes?: string[];
}

export interface BrainWorkflowPlan {
  version: string;
  intent: BrainTaskIntent;
  depth: BrainDepth;
  route: BrainRoute;
  steps: BrainWorkflowStep[];
  executableAgentIds: string[];
  plannedAgentIds: string[];
  missingCapabilities: string[];
  quality: BrainQualityProfile;
  costGuard: BrainCostGuard;
  warnings: string[];
}

export interface BrainContextInput {
  request: BrainTaskRequest;
  bookMemory?: string;
  seriesMemory?: string;
  researchContext?: string;
  knowledgeGraph?: string;
  manuscript?: string;
  chapterContext?: string;
}

export interface BrainContextBundle {
  text: string;
  approxTokens: number;
  sectionsIncluded: string[];
  sectionsTrimmed: string[];
}

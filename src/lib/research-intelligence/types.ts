export type ResearchDepth = "DEEP" | "SUPREME";
export type ResearchStep =
  | "INIT" | "STRATEGY" | "QUERIES" | "DISCOVER" | "RANK" | "EXTRACT"
  | "EVIDENCE" | "CLAIMS" | "CONTRADICTIONS" | "VERIFY" | "CITATIONS"
  | "GAPS" | "DOSSIER" | "PERSIST" | "COMPLETED";
export type SourceClass = "A" | "B" | "C" | "D";

export interface ResearchUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  importance: "CRITICAL" | "HIGH" | "MEDIUM";
  evidenceNeeded: string[];
}

export interface ResearchQuery {
  id: string;
  query: string;
  purpose: string;
  questionIds: string[];
}

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  publisher?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  retrievedAt: string;
  sourceClass: SourceClass;
  credibilityScore: number;
  queryIds: string[];
  grounded: boolean;
  extractionStatus?: "PENDING" | "EXTRACTED" | "FAILED";
  extractionError?: string | null;
  excerpt?: string | null;
  groundingExcerpt?: string | null;
  groundingSupportCount?: number;
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  questionIds: string[];
  evidence: string;
  relevanceScore: number;
  confidenceScore: number;
  supports: string[];
  limitations: string[];
}

export interface ResearchClaim {
  id: string;
  claim: string;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "CONFLICTED" | "UNVERIFIED";
  confidenceScore: number;
  evidenceIds: string[];
  sourceIds: string[];
  contradictionIds: string[];
  citationReady: boolean;
}

export interface ResearchContradiction {
  id: string;
  topic: string;
  description: string;
  sourceIds: string[];
  resolution: string | null;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface ResearchGap {
  id: string;
  gap: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  recommendedQueries: string[];
}

export interface ResearchDossier {
  title: string;
  executiveSummary: string;
  questions: ResearchQuestion[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  claims: ResearchClaim[];
  contradictions: ResearchContradiction[];
  gaps: ResearchGap[];
  writingInstructions: string[];
  prohibitedClaims: string[];
  citationPlan: Array<{ claimId: string; sourceIds: string[]; note: string }>;
  coverageScore: number;
  evidenceScore: number;
  factualConfidenceScore: number;
  readyForWriting: boolean;
}

export interface EnqueueResearchInput {
  project_id: string;
  chapter_number?: number | null;
  topic: string;
  objective?: string;
  depth?: ResearchDepth;
  max_sources?: number;
  manual_urls?: string[];
}

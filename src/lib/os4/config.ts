import type { Os4AgentName, Os4Stage } from "./types";

export const OS4_VERSION = "4.0.0-supreme";

export const OS4_STAGE_ORDER: Os4Stage[] = [
  "MARKET",
  "CONCEPT_BATTLE",
  "AUTHOR_DNA",
  "BLUEPRINT",
  "RESEARCH",
  "KNOWLEDGE_GRAPH",
  "SIMULATION",
  "CHIEF_APPROVAL",
  "WRITING",
  "FACT_CHECK",
  "QUALITY_COUNCIL",
  "MASTER_EDIT",
  "PUBLISHING",
  "LAUNCH",
  "LEARNING",
];

export const OS4_THRESHOLDS = {
  marketGo: 8.0,
  blueprintApproval: 9.0,
  chapterApproval: 9.2,
  factualityMinimum: 9.4,
  continuityMinimum: 9.0,
  masterPublishReady: 9.2,
  maxRepairIterations: 3,
} as const;

export const OS4_AGENT_MODEL_CLASS: Record<Os4AgentName, "FAST" | "DEEP"> = {
  MARKET_STRATEGIST: "DEEP",
  CONCEPT_ARENA: "DEEP",
  AUTHOR_DNA_ANALYST: "FAST",
  BOOK_ARCHITECT: "DEEP",
  RESEARCH_DIRECTOR: "DEEP",
  KNOWLEDGE_ENGINEER: "DEEP",
  BOOK_SIMULATOR: "DEEP",
  CHIEF_EDITOR: "DEEP",
  FACT_CHECKER: "DEEP",
  CONTINUITY_EDITOR: "FAST",
  STYLE_EDITOR: "FAST",
  ADVERSARIAL_CRITIC: "DEEP",
  QUALITY_JUDGE: "DEEP",
  REWRITE_EDITOR: "DEEP",
  MASTER_EDITOR: "DEEP",
  PUBLISHING_DIRECTOR: "FAST",
  LAUNCH_STRATEGIST: "DEEP",
  PORTFOLIO_ANALYST: "DEEP",
};

export function clampScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10, Math.round(n * 100) / 100));
}

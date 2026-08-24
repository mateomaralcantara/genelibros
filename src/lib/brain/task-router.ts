import type {
  AgentFamily,
  BrainRoute,
  BrainTaskIntent,
  BrainTaskRequest,
} from "./types";

const ROUTES: Record<
  BrainTaskIntent,
  Omit<BrainRoute, "intent" | "rationale">
> = {
  CREATE_BOOK: {
    families: ["CREATOR", "RESEARCH", "EDITORIAL", "PUBLISHING"],
    requiredCapabilities: [
      "market_analysis",
      "concept_battle",
      "author_dna",
      "book_blueprint",
      "book_simulation",
      "chief_approval",
      "quality_gate",
      "master_edit",
    ],
    optionalCapabilities: [
      "research_plan",
      "knowledge_graph",
      "fact_check",
      "launch_plan",
    ],
  },
  REFINE_BOOK: {
    families: ["REFINERY", "EDITORIAL"],
    requiredCapabilities: [
      "manuscript_audit",
      "semantic_redundancy",
      "structural_edit",
      "master_refine",
      "quality_gate",
      "master_edit",
    ],
    optionalCapabilities: [
      "compression",
      "expansion",
      "clarity_edit",
      "line_edit",
      "fact_check",
    ],
  },
  DEEP_WORK: {
    families: ["DEEP_WORK", "EDITORIAL", "RESEARCH"],
    requiredCapabilities: [
      "deep_plan",
      "long_context_analysis",
      "multi_pass_writing",
      "draft_synthesis",
      "deep_quality_gate",
    ],
    optionalCapabilities: [
      "alternative_draft",
      "critic_council",
      "deep_repair",
      "fact_check",
    ],
  },
  RESEARCH_NONFICTION: {
    families: ["RESEARCH", "EDITORIAL"],
    requiredCapabilities: [
      "advanced_research_strategy",
      "advanced_queries",
      "source_discovery",
      "source_ranking",
      "evidence_analysis",
      "claim_building",
      "citation_audit",
    ],
    optionalCapabilities: [
      "web_extraction",
      "source_conflict",
      "fact_verification",
      "research_gap",
      "knowledge_graph",
    ],
  },
  CREATE_SERIES: {
    families: ["SERIES", "CREATOR", "RESEARCH", "EDITORIAL"],
    requiredCapabilities: [
      "series_architecture",
      "series_bible",
      "volume_architecture",
      "volume_differentiation",
      "series_arc",
      "cross_book_redundancy",
      "cross_book_continuity",
      "series_quality_gate",
    ],
    optionalCapabilities: [
      "series_market",
      "series_evolution",
      "market_analysis",
      "book_blueprint",
      "fact_check",
    ],
  },
  FINALIZE_BOOK: {
    families: ["EDITORIAL", "PUBLISHING"],
    requiredCapabilities: [
      "adversarial_review",
      "quality_gate",
      "master_edit",
      "publishing_plan",
    ],
    optionalCapabilities: ["launch_plan", "portfolio_analysis"],
  },
};

export function inferTaskIntent(request: BrainTaskRequest): BrainTaskIntent {
  if (request.intent) return request.intent;
  if ((request.seriesCount || 0) > 1 || request.seriesId) return "CREATE_SERIES";
  if (request.existingManuscript || request.bookId) return "REFINE_BOOK";
  if (request.nonfiction) return "CREATE_BOOK";
  return "CREATE_BOOK";
}

export function routeTask(request: BrainTaskRequest): BrainRoute {
  const intent = inferTaskIntent(request);
  const base = ROUTES[intent];
  const rationale: string[] = [`intent:${intent}`];

  const families = [...base.families];
  const requiredCapabilities = [...base.requiredCapabilities];
  const optionalCapabilities = [...base.optionalCapabilities];

  if (request.nonfiction) {
    if (!families.includes("RESEARCH")) families.push("RESEARCH");
    for (const capability of [
      "research_plan",
      "fact_check",
      "claim_verification",
    ]) {
      if (!optionalCapabilities.includes(capability)) {
        optionalCapabilities.push(capability);
      }
    }
    rationale.push("nonfiction:research-and-factuality");
  }

  if ((request.depth || "DEEP") === "SUPREME" || request.depth === "ULTRA") {
    if (!families.includes("DEEP_WORK")) families.push("DEEP_WORK");
    for (const capability of ["deep_plan", "critic_council", "deep_quality_gate"]) {
      if (!optionalCapabilities.includes(capability)) {
        optionalCapabilities.push(capability);
      }
    }
    rationale.push(`depth:${request.depth}`);
  }

  if ((request.seriesCount || 0) > 1) {
    rationale.push(`series-count:${request.seriesCount}`);
  }

  return {
    intent,
    families,
    requiredCapabilities,
    optionalCapabilities,
    rationale,
  };
}

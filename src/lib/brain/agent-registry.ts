import type {
  AgentFamily,
  BrainAgentDefinition,
  BrainModelClass,
} from "./types";

const ready = (
  id: string,
  family: AgentFamily,
  description: string,
  capabilities: string[],
  modelClass: BrainModelClass,
  options: Partial<BrainAgentDefinition> = {},
): BrainAgentDefinition => ({
  id,
  family,
  description,
  capabilities,
  modelClass,
  status: "READY",
  canRunParallel: options.canRunParallel ?? false,
  requiresResearch: options.requiresResearch ?? false,
  qualityThreshold: options.qualityThreshold ?? 9.2,
  maxRepairIterations: options.maxRepairIterations ?? 3,
  legacyOs4: options.legacyOs4 ?? true,
});

const planned = (
  id: string,
  family: AgentFamily,
  description: string,
  capabilities: string[],
  modelClass: BrainModelClass = "DEEP",
  options: Partial<BrainAgentDefinition> = {},
): BrainAgentDefinition => ({
  id,
  family,
  description,
  capabilities,
  modelClass,
  status: "PLANNED",
  canRunParallel: options.canRunParallel ?? false,
  requiresResearch: options.requiresResearch ?? false,
  qualityThreshold: options.qualityThreshold ?? 9.3,
  maxRepairIterations: options.maxRepairIterations ?? 3,
  legacyOs4: false,
});

export const READY_OS4_AGENT_IDS = [
  "MARKET_STRATEGIST",
  "CONCEPT_ARENA",
  "AUTHOR_DNA_ANALYST",
  "BOOK_ARCHITECT",
  "RESEARCH_DIRECTOR",
  "KNOWLEDGE_ENGINEER",
  "BOOK_SIMULATOR",
  "CHIEF_EDITOR",
  "FACT_CHECKER",
  "CONTINUITY_EDITOR",
  "STYLE_EDITOR",
  "ADVERSARIAL_CRITIC",
  "QUALITY_JUDGE",
  "REWRITE_EDITOR",
  "MASTER_EDITOR",
  "PUBLISHING_DIRECTOR",
  "LAUNCH_STRATEGIST",
  "PORTFOLIO_ANALYST",
] as const;

export const AGENT_CATALOG: BrainAgentDefinition[] = [
  ready(
    "MARKET_STRATEGIST",
    "CREATOR",
    "Analiza oportunidad, audiencia, posicionamiento y viabilidad editorial.",
    ["market_analysis", "audience_analysis", "positioning"],
    "DEEP",
  ),
  ready(
    "CONCEPT_ARENA",
    "CREATOR",
    "Compite conceptos editoriales y selecciona la propuesta más fuerte.",
    ["concept_battle", "concept_selection", "book_positioning"],
    "DEEP",
  ),
  ready(
    "AUTHOR_DNA_ANALYST",
    "CREATOR",
    "Construye y conserva la voz editorial del autor.",
    ["author_dna", "voice_analysis", "style_constraints"],
    "FAST",
  ),
  ready(
    "BOOK_ARCHITECT",
    "CREATOR",
    "Diseña tesis, promesa, estructura y arquitectura de capítulos.",
    ["book_blueprint", "outline", "chapter_architecture"],
    "DEEP",
  ),
  ready(
    "RESEARCH_DIRECTOR",
    "RESEARCH",
    "Diseña investigación y necesidades de fuentes.",
    ["research_plan", "source_requirements", "research_queries"],
    "DEEP",
    { requiresResearch: true },
  ),
  ready(
    "KNOWLEDGE_ENGINEER",
    "RESEARCH",
    "Convierte evidencia en grafo de conocimiento y contradicciones.",
    ["knowledge_graph", "claim_mapping", "contradiction_mapping"],
    "DEEP",
    { requiresResearch: true },
  ),
  ready(
    "BOOK_SIMULATOR",
    "CREATOR",
    "Simula el libro antes de escribir para detectar problemas estructurales.",
    ["book_simulation", "structure_risk", "repetition_risk"],
    "DEEP",
  ),
  ready(
    "CHIEF_EDITOR",
    "EDITORIAL",
    "Editor jefe con poder de veto sobre calidad y coherencia.",
    ["chief_approval", "editorial_decision", "blocking_review"],
    "DEEP",
    { qualityThreshold: 9.3 },
  ),
  ready(
    "FACT_CHECKER",
    "EDITORIAL",
    "Verifica afirmaciones y bloquea hechos no sustentados.",
    ["fact_check", "claim_verification", "factual_risk"],
    "DEEP",
    { requiresResearch: true, canRunParallel: true, qualityThreshold: 9.4 },
  ),
  ready(
    "CONTINUITY_EDITOR",
    "EDITORIAL",
    "Comprueba continuidad, cronología y consistencia interna.",
    ["continuity_check", "chronology_check", "cross_chapter_consistency"],
    "FAST",
    { canRunParallel: true },
  ),
  ready(
    "STYLE_EDITOR",
    "EDITORIAL",
    "Evalúa claridad, ritmo, voz, clichés y estilo.",
    ["style_check", "clarity", "author_voice"],
    "FAST",
    { canRunParallel: true },
  ),
  ready(
    "ADVERSARIAL_CRITIC",
    "EDITORIAL",
    "Intenta demostrar por qué el texto aún no merece publicarse.",
    ["adversarial_review", "weakness_detection", "omission_detection"],
    "DEEP",
    { canRunParallel: true, qualityThreshold: 9.0 },
  ),
  ready(
    "QUALITY_JUDGE",
    "EDITORIAL",
    "Consolida señales de calidad y decide aprobar, reparar o bloquear.",
    ["quality_gate", "quality_scoring", "repair_decision"],
    "DEEP",
    { qualityThreshold: 9.2 },
  ),
  ready(
    "REWRITE_EDITOR",
    "REFINERY",
    "Reescribe defectos detectados sin alterar hechos aprobados.",
    ["rewrite", "repair", "targeted_edit"],
    "DEEP",
    { qualityThreshold: 9.2 },
  ),
  ready(
    "MASTER_EDITOR",
    "EDITORIAL",
    "Audita y corrige la obra completa antes de publicación.",
    ["master_edit", "whole_book_review", "publish_readiness"],
    "DEEP",
    { qualityThreshold: 9.2 },
  ),
  ready(
    "PUBLISHING_DIRECTOR",
    "PUBLISHING",
    "Prepara metadatos, especificaciones y checklist de producción.",
    ["publishing_plan", "metadata", "format_spec"],
    "FAST",
  ),
  ready(
    "LAUNCH_STRATEGIST",
    "PUBLISHING",
    "Diseña posicionamiento y lanzamiento del libro.",
    ["launch_plan", "book_marketing", "sales_copy"],
    "DEEP",
  ),
  ready(
    "PORTFOLIO_ANALYST",
    "PUBLISHING",
    "Analiza patrones de portafolio y oportunidades de próximos títulos.",
    ["portfolio_analysis", "learning", "next_book_opportunity"],
    "DEEP",
  ),

  // BOOK REFINERY
  planned("MANUSCRIPT_AUDITOR", "REFINERY", "Diagnóstico global de un manuscrito terminado.", ["manuscript_audit", "book_score", "editorial_diagnosis"], "DEEP"),
  planned("STRUCTURAL_EDITOR", "REFINERY", "Reordena, fusiona y reconstruye arquitectura editorial.", ["structural_edit", "chapter_merge", "section_reorder"], "DEEP"),
  planned("REDUNDANCY_HUNTER", "REFINERY", "Detecta repetición textual y semántica global.", ["semantic_redundancy", "cross_chapter_overlap", "duplicate_ideas"], "DEEP", { canRunParallel: true }),
  planned("COMPRESSION_EDITOR", "REFINERY", "Reduce texto conservando información, voz y evidencia.", ["compression", "tighten", "word_reduction"], "DEEP"),
  planned("EXPANSION_EDITOR", "REFINERY", "Amplía huecos de profundidad sin añadir relleno.", ["expansion", "depth_repair", "missing_explanation"], "DEEP"),
  planned("CLARITY_EDITOR", "REFINERY", "Simplifica prosa compleja sin empobrecer el contenido.", ["clarity_edit", "readability", "sentence_repair"], "FAST", { canRunParallel: true }),
  planned("CONTINUITY_AUDITOR", "REFINERY", "Audita continuidad completa del manuscrito.", ["book_continuity_audit", "global_consistency"], "DEEP", { canRunParallel: true }),
  planned("STYLE_REFINER", "REFINERY", "Afina voz, ritmo y estilo global.", ["style_refine", "voice_preservation", "rhythm_edit"], "DEEP", { canRunParallel: true }),
  planned("LINE_EDITOR", "REFINERY", "Edición fina de párrafos y frases.", ["line_edit", "prose_polish"], "FAST"),
  planned("MASTER_BOOK_REFINER", "REFINERY", "Integra el plan de cirugía editorial y produce una nueva versión.", ["master_refine", "publish_ready_refine", "editorial_surgery"], "SUPREME", { qualityThreshold: 9.5 }),

  // DEEP WORK
  planned("DEEP_PLANNER", "DEEP_WORK", "Descompone trabajos extensos en fases verificables.", ["deep_plan", "long_task_decomposition"], "DEEP"),
  planned("LONG_CONTEXT_ANALYST", "DEEP_WORK", "Analiza grandes cantidades de contexto antes de escribir.", ["long_context_analysis", "cross_document_reasoning"], "SUPREME"),
  planned("MULTI_PASS_WRITER", "DEEP_WORK", "Produce borradores iterativos mejorados.", ["multi_pass_writing", "iterative_drafting"], "SUPREME"),
  planned("ALTERNATIVE_DRAFT_WRITER", "DEEP_WORK", "Genera alternativas independientes para comparación.", ["alternative_draft", "candidate_generation"], "DEEP", { canRunParallel: true }),
  planned("CRITIC_COUNCIL", "DEEP_WORK", "Consejo crítico de múltiples perspectivas.", ["critic_council", "multi_review"], "DEEP", { canRunParallel: true }),
  planned("REPAIR_AGENT", "DEEP_WORK", "Aplica reparaciones derivadas de críticas y gates.", ["deep_repair", "issue_resolution"], "DEEP"),
  planned("SYNTHESIS_EDITOR", "DEEP_WORK", "Fusiona las mejores partes de múltiples candidatos.", ["draft_synthesis", "best_of_n"], "SUPREME"),
  planned("DEEP_QUALITY_JUDGE", "DEEP_WORK", "Juez final para trabajos de máxima profundidad.", ["deep_quality_gate", "supreme_approval"], "SUPREME", { qualityThreshold: 9.6 }),

  // RESEARCH INTELLIGENCE
  planned("RESEARCH_STRATEGIST", "RESEARCH", "Convierte el tema en programa de investigación exhaustivo.", ["advanced_research_strategy", "research_questions"], "DEEP", { requiresResearch: true }),
  planned("QUERY_ARCHITECT", "RESEARCH", "Diseña consultas avanzadas y variantes de búsqueda.", ["advanced_queries", "search_strategy"], "DEEP", { requiresResearch: true }),
  planned("SOURCE_HUNTER", "RESEARCH", "Descubre fuentes primarias, oficiales y académicas.", ["source_discovery", "primary_sources"], "DEEP", { requiresResearch: true }),
  planned("WEB_EXTRACTOR", "RESEARCH", "Extrae evidencia útil de fuentes públicas permitidas.", ["web_extraction", "evidence_extraction"], "FAST", { requiresResearch: true, canRunParallel: true }),
  planned("SOURCE_RANKER", "RESEARCH", "Clasifica fuentes por autoridad, actualidad e independencia.", ["source_ranking", "source_quality"], "DEEP", { requiresResearch: true }),
  planned("EVIDENCE_ANALYST", "RESEARCH", "Separa evidencia, interpretación, opinión y controversia.", ["evidence_analysis", "evidence_classification"], "DEEP", { requiresResearch: true }),
  planned("CLAIM_BUILDER", "RESEARCH", "Construye claims trazables a evidencia.", ["claim_building", "claim_evidence_link"], "DEEP", { requiresResearch: true }),
  planned("CONTRADICTION_ENGINE", "RESEARCH", "Detecta conflictos entre fuentes y claims.", ["source_conflict", "claim_conflict"], "DEEP", { requiresResearch: true }),
  planned("FACT_VERIFIER", "RESEARCH", "Realiza verificación secundaria de datos críticos.", ["fact_verification", "high_risk_fact_check"], "SUPREME", { requiresResearch: true }),
  planned("CITATION_AUDITOR", "RESEARCH", "Valida cobertura y correspondencia de citas.", ["citation_audit", "citation_coverage"], "DEEP", { requiresResearch: true }),
  planned("RESEARCH_GAP_DETECTOR", "RESEARCH", "Detecta información ausente durante la escritura.", ["research_gap", "adaptive_research"], "DEEP", { requiresResearch: true }),

  // SERIES / SAGAS
  planned("SERIES_ARCHITECT", "SERIES", "Diseña la colección completa antes del primer volumen.", ["series_architecture", "volume_plan", "series_promise"], "SUPREME"),
  planned("SERIES_BIBLE_KEEPER", "SERIES", "Mantiene memoria, reglas y conceptos de la serie.", ["series_bible", "series_memory", "reserved_topics"], "DEEP"),
  planned("VOLUME_ARCHITECT", "SERIES", "Diseña cada volumen con identidad propia.", ["volume_architecture", "volume_scope"], "DEEP"),
  planned("VOLUME_DIFFERENTIATOR", "SERIES", "Evita que dos volúmenes sean variantes del mismo libro.", ["volume_differentiation", "topic_partition"], "DEEP"),
  planned("SERIES_REDUNDANCY_GUARD", "SERIES", "Mide repetición semántica entre libros.", ["cross_book_redundancy", "series_overlap"], "SUPREME"),
  planned("SERIES_ARC_PLANNER", "SERIES", "Diseña progresión pedagógica, narrativa o temática.", ["series_arc", "progression"], "DEEP"),
  planned("CROSS_BOOK_CONTINUITY_EDITOR", "SERIES", "Detecta contradicciones entre volúmenes.", ["cross_book_continuity", "series_consistency"], "SUPREME"),
  planned("SERIES_EVOLUTION_EDITOR", "SERIES", "Garantiza que cada volumen avance el nivel del lector.", ["series_evolution", "learning_progression"], "DEEP"),
  planned("SERIES_MARKET_STRATEGIST", "SERIES", "Evalúa tamaño, secuencia y oportunidad comercial de la colección.", ["series_market", "series_size", "series_positioning"], "DEEP"),
  planned("SERIES_CHIEF_EDITOR", "SERIES", "Aprueba cada volumen como libro y como parte de la colección.", ["series_quality_gate", "volume_approval"], "SUPREME", { qualityThreshold: 9.5 }),
];

export class AgentRegistry {
  private readonly agents = new Map<string, BrainAgentDefinition>();

  constructor(definitions: BrainAgentDefinition[] = AGENT_CATALOG) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: BrainAgentDefinition): void {
    const id = String(definition.id || "").trim().toUpperCase();
    if (!id) throw new Error("AgentRegistry: agent id vacío.");
    if (this.agents.has(id)) throw new Error(`AgentRegistry: agente duplicado ${id}.`);
    this.agents.set(id, { ...definition, id });
  }

  get(id: string): BrainAgentDefinition | undefined {
    return this.agents.get(String(id || "").trim().toUpperCase());
  }

  require(id: string): BrainAgentDefinition {
    const agent = this.get(id);
    if (!agent) throw new Error(`AgentRegistry: agente no registrado ${id}.`);
    return agent;
  }

  all(): BrainAgentDefinition[] {
    return [...this.agents.values()];
  }

  ready(): BrainAgentDefinition[] {
    return this.all().filter((agent) => agent.status === "READY");
  }

  planned(): BrainAgentDefinition[] {
    return this.all().filter((agent) => agent.status === "PLANNED");
  }

  byFamily(family: AgentFamily): BrainAgentDefinition[] {
    return this.all().filter((agent) => agent.family === family);
  }

  byCapability(capability: string, includePlanned = false): BrainAgentDefinition[] {
    const needle = String(capability || "").trim();
    return this.all().filter(
      (agent) =>
        agent.capabilities.includes(needle) &&
        (includePlanned || agent.status === "READY"),
    );
  }

  validate(): string[] {
    const issues: string[] = [];
    const ids = new Set<string>();

    for (const agent of this.all()) {
      if (ids.has(agent.id)) issues.push(`duplicate:${agent.id}`);
      ids.add(agent.id);
      if (!agent.capabilities.length) issues.push(`no-capabilities:${agent.id}`);
      if (agent.qualityThreshold < 0 || agent.qualityThreshold > 10) {
        issues.push(`bad-threshold:${agent.id}`);
      }
    }

    for (const id of READY_OS4_AGENT_IDS) {
      const agent = this.get(id);
      if (!agent) issues.push(`missing-os4:${id}`);
      else if (agent.status !== "READY") issues.push(`os4-not-ready:${id}`);
    }

    return issues;
  }
}

export const defaultAgentRegistry = new AgentRegistry();

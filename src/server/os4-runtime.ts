import { GoogleGenAI } from "@google/genai";

export type Os4ServerAgent =
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

type TokenPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

const DEEP_MODEL =
  process.env.OS4_DEEP_MODEL ||
  process.env.OS3_DEEP_MODEL ||
  "gemini-2.5-pro";

const FAST_MODEL =
  process.env.OS4_FAST_MODEL ||
  process.env.OS3_FAST_MODEL ||
  "gemini-2.5-flash";

const DEEP_AGENTS = new Set<Os4ServerAgent>([
  "MARKET_STRATEGIST",
  "CONCEPT_ARENA",
  "BOOK_ARCHITECT",
  "RESEARCH_DIRECTOR",
  "KNOWLEDGE_ENGINEER",
  "BOOK_SIMULATOR",
  "CHIEF_EDITOR",
  "FACT_CHECKER",
  "ADVERSARIAL_CRITIC",
  "QUALITY_JUDGE",
  "REWRITE_EDITOR",
  "MASTER_EDITOR",
  "LAUNCH_STRATEGIST",
  "PORTFOLIO_ANALYST",
]);

const COMMON = `
Eres parte de BESTSELLER AUTONOMOUS PUBLISHING OS 4.0 SUPREME.
Devuelve solamente JSON válido.
No inventes hechos, cifras, fechas, fuentes, citas, cargos, relaciones ni documentos.
Si falta evidencia, decláralo como gap o riesgo.
Distingue HECHO, INFERENCIA, INTERPRETACIÓN, CONTROVERSIA y NO VERIFICADO.
Critica con rigor. No infles puntuaciones.
Usa puntuaciones 0.0-10.0.
Un issue factual grave puede bloquear aunque el promedio sea alto.
`.trim();

const AGENT_PROMPTS: Record<Os4ServerAgent, string> = {
  MARKET_STRATEGIST: `${COMMON}
ROL: Director de inteligencia de mercado editorial.
SALIDA:
{"market_score":0,"demand_hypothesis":"","reader_problem":"","primary_audience":"","secondary_audiences":[],"positioning":"","market_gap":"","competing_angles":[],"commercial_risks":[],"keywords":[],"category_hypotheses":[],"differentiation_score":0,"recommendation":"GO|REFINE|NO_GO"}`,

  CONCEPT_ARENA: `${COMMON}
ROL: Arena competitiva de conceptos editoriales.
Genera y enfrenta al menos 3 conceptos.
SALIDA:
{"candidates":[{"id":"","title":"","subtitle":"","angle":"","promise":"","audience":"","commercial_score":0,"authority_score":0,"originality_score":0,"risk_score":0}],"winner_id":"","winner_reason":"","hybrid_recommendation":""}`,

  AUTHOR_DNA_ANALYST: `${COMMON}
ROL: Analista forense de estilo. Extrae patrones sin copiar pasajes extensos.
SALIDA:
{"language":"es","formality":0,"sentence_length_preference":"SHORT|MIXED|LONG","vocabulary_density":0,"emotional_intensity":0,"analytical_depth":0,"humor_level":0,"metaphor_level":0,"preferred_structure":[],"signature_traits":[],"avoid_traits":[],"sample_phrases_pattern":[],"style_directive":""}`,

  BOOK_ARCHITECT: `${COMMON}
ROL: Arquitecto jefe de libros.
Cada capítulo debe tener tesis, objetivo, 5-10 subheads_h2, hechos requeridos, source_needs y target_words.
SALIDA:
{"selected_title":"","selected_subtitle":"","title_options":[],"subtitle_options":[],"central_thesis":"","editorial_promise":"","unique_mechanism":"","audience":"","tone_style":"","factual_strategy":"","narrative_arc":"","chapter_count":0,"chapters":[{"chapter_number":1,"chapter_title":"","chapter_thesis":"","objective":"","key_points":[],"subheads_h2":[],"required_facts":[],"source_needs":[],"contradiction_checks":[],"transition_to_next":"","target_words":3000}],"blueprint_score":0,"blocking_gaps":[]}`,

  RESEARCH_DIRECTOR: `${COMMON}
ROL: Director de investigación. Diseña consultas y targets; no afirmes que buscaste internet.
SALIDA:
{"queries":[{"query":"","purpose":"","chapter_numbers":[],"priority":"CRITICAL|HIGH|MEDIUM"}],"official_source_targets":[],"academic_source_targets":[],"primary_source_targets":[],"high_risk_claims":[],"chronology_requirements":[],"verification_rules":[]}`,

  KNOWLEDGE_ENGINEER: `${COMMON}
ROL: Ingeniero de conocimiento editorial.
SALIDA:
{"nodes":[{"id":"","type":"PERSON|EVENT|DATE|ORGANIZATION|CLAIM|CONCEPT|SOURCE|LOCATION|METRIC","label":"","attributes":{},"confidence":0}],"edges":[{"from":"","to":"","relation":"","evidence_source_urls":[],"confidence":0}],"chronology":[{"date":"","event":"","confidence":0}],"contradictions":[{"statement_a":"","statement_b":"","severity":"LOW|MEDIUM|HIGH|BLOCKING","resolution_needed":""}]}`,

  BOOK_SIMULATOR: `${COMMON}
ROL: Simulador estructural del libro.
SALIDA:
{"executive_simulation":"","chapter_simulations":[{"chapter_number":1,"expected_value":"","likely_repetition":[],"missing_evidence":[],"risk":"LOW|MEDIUM|HIGH|BLOCKING"}],"structural_score":0,"repetition_risk_score":0,"recommendation":"APPROVE|REVISE","revisions":[]}`,

  CHIEF_EDITOR: `${COMMON}
ROL: Editor jefe con poder de veto.
SALIDA:
{"score":0,"decision":"APPROVE|REVISE|BLOCK","blocking_issues":[],"required_changes":[],"strengths":[]}`,

  FACT_CHECKER: `${COMMON}
ROL: Fact checker hostil. Solo VERIFIED si la evidencia aparece en el input.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[],"facts_to_verify":[],"claims":[{"claim":"","status":"VERIFIED|PARTIAL|DISPUTED|UNVERIFIED|REJECTED","confidence":0,"evidence":[],"source_urls":[]}]}`,

  CONTINUITY_EDITOR: `${COMMON}
ROL: Editor de continuidad. Busca contradicciones de tesis, cronología, nombres y cifras.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[]}`,

  STYLE_EDITOR: `${COMMON}
ROL: Editor de estilo y Author DNA. Evalúa claridad, ritmo, clichés, repetición y voz.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[]}`,

  ADVERSARIAL_CRITIC: `${COMMON}
ROL: Crítico adversarial. Intenta demostrar que el capítulo no merece publicarse.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[]}`,

  QUALITY_JUDGE: `${COMMON}
ROL: Presidente del Quality Council. No hagas promedio ciego.
SALIDA:
{"global_score":0,"dimensions":{"factuality":0,"depth":0,"clarity":0,"narrative":0,"originality":0,"coherence":0,"continuity":0,"sourcing":0,"non_repetition":0,"author_dna":0,"commercial_value":0},"blocking_issues":[],"rewrite_instructions":[],"decision":"APPROVE|REWRITE|BLOCK"}`,

  REWRITE_EDITOR: `${COMMON}
ROL: Rewriter senior. Corrige defectos exactos sin agregar hechos nuevos.
SALIDA:
{"text":"","change_log":[],"unresolved_risks":[]}`,

  MASTER_EDITOR: `${COMMON}
ROL: Editor maestro de obra completa.
SALIDA:
{"global_score":0,"structural_score":0,"continuity_score":0,"repetition_score":0,"factual_risk_score":0,"strongest_sections":[],"weakest_sections":[],"structural_changes":[],"line_edit_priorities":[],"publish_readiness":"READY|REVISE|BLOCKED"}`,

  PUBLISHING_DIRECTOR: `${COMMON}
ROL: Director de producción editorial.
SALIDA:
{"score":0,"front_matter":[],"metadata":{},"format_specs":{},"final_checklist":[],"blocking_issues":[]}`,

  LAUNCH_STRATEGIST: `${COMMON}
ROL: Director de lanzamiento de libros.
SALIDA:
{"positioning":"","amazon_description":"","back_cover":"","hooks":[],"social_posts":[],"short_video_scripts":[],"email_sequence":[{"subject":"","body":""}],"podcast_pitch":"","press_release":"","lead_magnet":"","launch_calendar":[{"day":"","action":""}],"metrics_to_track":[]}`,

  PORTFOLIO_ANALYST: `${COMMON}
ROL: Analista de portafolio editorial. No inventes ventas ni benchmarks.
SALIDA:
{"score":0,"winning_patterns":[],"weak_patterns":[],"next_book_opportunities":[],"cost_insights":[],"recommendations":[]}`,
};

const BUILTIN_PRICING: Record<string, TokenPrice> = {
  "gemini-2.5-flash": { inputPerMillionUsd: 0.30, outputPerMillionUsd: 2.50 },
  "gemini-2.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.00 },
};

function pricingTable(): Record<string, TokenPrice> {
  const raw = String(process.env.OS4_MODEL_PRICING_JSON || "").trim();
  if (!raw) return BUILTIN_PRICING;
  try {
    const parsed = JSON.parse(raw);
    return { ...BUILTIN_PRICING, ...(parsed || {}) };
  } catch {
    return BUILTIN_PRICING;
  }
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = pricingTable()[model];
  if (!price) return 0;
  const value =
    (Math.max(0, inputTokens) / 1_000_000) * Number(price.inputPerMillionUsd || 0) +
    (Math.max(0, outputTokens) / 1_000_000) * Number(price.outputPerMillionUsd || 0);
  return Math.round(value * 1_000_000) / 1_000_000;
}

function cleanJson(text: string): string {
  return String(text || "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractObject(text: string): string | null {
  const t = cleanJson(text);
  const first = t.indexOf("{");
  if (first < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = first; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(first, i + 1);
    }
  }
  return null;
}

function parseJson(text: string): any {
  const clean = cleanJson(text);
  try {
    return JSON.parse(clean);
  } catch {
    const candidate = extractObject(clean);
    if (!candidate) throw new Error("OS4 runtime: no se encontró JSON válido.");
    return JSON.parse(candidate);
  }
}

function pickModel(agent: Os4ServerAgent, requested?: string): string {
  if (requested && /^gemini-[a-z0-9.\-]+$/i.test(requested)) return requested;
  return DEEP_AGENTS.has(agent) ? DEEP_MODEL : FAST_MODEL;
}

function maxTokens(agent: Os4ServerAgent): number {
  if (agent === "REWRITE_EDITOR") return 32000;
  if (agent === "BOOK_ARCHITECT" || agent === "KNOWLEDGE_ENGINEER") return 18000;
  if (agent === "LAUNCH_STRATEGIST") return 16000;
  return 10000;
}

function temperature(agent: Os4ServerAgent): number {
  if (
    agent === "FACT_CHECKER" ||
    agent === "QUALITY_JUDGE" ||
    agent === "CONTINUITY_EDITOR" ||
    agent === "KNOWLEDGE_ENGINEER"
  ) return 0.12;
  if (agent === "CONCEPT_ARENA" || agent === "LAUNCH_STRATEGIST") return 0.55;
  return 0.28;
}

export type Os4RuntimeResponse<T = any> = {
  ok: true;
  trace_id: string;
  agent: string;
  model: string;
  latency_ms: number;
  output: T;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
};

export async function runOs4ServerAgent<T = any>(args: {
  agent: Os4ServerAgent;
  action: string;
  payload: Record<string, unknown>;
  traceId: string;
  userId?: string | null;
  model?: string;
}): Promise<Os4RuntimeResponse<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const started = Date.now();
  const model = pickModel(args.agent, args.model);
  const ai = new GoogleGenAI({ apiKey });

  const prompt = [
    `ACTION: ${args.action}`,
    "",
    "INPUT JSON:",
    JSON.stringify({
      ...args.payload,
      _runtime: {
        trace_id: args.traceId,
        authenticated_user_id: args.userId || null,
        durable_worker: true,
      },
    }),
    "",
    "Devuelve SOLO el JSON solicitado por tu rol.",
  ].join("\n");

  let response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: AGENT_PROMPTS[args.agent],
      responseMimeType: "application/json",
      maxOutputTokens: maxTokens(args.agent),
      temperature: temperature(args.agent),
    } as any,
  });

  let output: any;
  try {
    output = parseJson(response.text || "");
  } catch {
    response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: [{
        role: "user",
        parts: [{
          text: [
            "Repara el siguiente contenido a JSON válido.",
            "No agregues explicaciones.",
            String(response.text || "").slice(0, 50000),
          ].join("\n"),
        }],
      }],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: maxTokens(args.agent),
        temperature: 0,
      } as any,
    });
    output = parseJson(response.text || "");
  }

  const usage: any = (response as any)?.usageMetadata || {};
  const inputTokens = Number(usage.promptTokenCount ?? usage.inputTokenCount ?? 0) || 0;
  const outputTokens = Number(usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0) || 0;

  return {
    ok: true,
    trace_id: args.traceId,
    agent: args.agent,
    model,
    latency_ms: Date.now() - started,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: Number(usage.totalTokenCount ?? (inputTokens + outputTokens)) || 0,
      estimated_cost_usd: costUsd(model, inputTokens, outputTokens),
    },
  };
}

export async function writeOs4Chapter(args: {
  traceId: string;
  userId?: string | null;
  title: string;
  topic: string;
  chapterNumber: number;
  chapterPlan: Record<string, unknown>;
  researchContext: string;
  authorDna: unknown;
  knowledgeGraph: unknown;
  previousChapters: Array<Record<string, unknown>>;
  targetWords: number;
}): Promise<Os4RuntimeResponse<{ text: string }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const started = Date.now();
  const model = FAST_MODEL;
  const ai = new GoogleGenAI({ apiKey });
  const targetWords = Math.max(1200, Math.min(12000, Number(args.targetWords || 3000)));

  const prompt = [
    "Eres el WRITER de BESTSELLER AUTONOMOUS PUBLISHING OS.",
    "Escribe únicamente el cuerpo del capítulo, sin JSON ni bloques de código.",
    "No repitas el título del capítulo al inicio.",
    "Usa subtítulos internos naturales cuando aporten estructura.",
    "No inventes hechos, cifras, citas ni fuentes.",
    "Si la evidencia es insuficiente, usa formulaciones prudentes o evita el dato.",
    `Meta aproximada: ${targetWords} palabras.`,
    "",
    `LIBRO: ${args.title}`,
    `TEMA: ${args.topic}`,
    `CAPÍTULO: ${args.chapterNumber}`,
    "",
    "PLAN DEL CAPÍTULO:",
    JSON.stringify(args.chapterPlan),
    "",
    "AUTHOR DNA:",
    JSON.stringify(args.authorDna || {}),
    "",
    "KNOWLEDGE GRAPH:",
    JSON.stringify(args.knowledgeGraph || {}).slice(0, 28000),
    "",
    "CAPÍTULOS PREVIOS:",
    JSON.stringify(args.previousChapters || []).slice(0, 16000),
    "",
    "RESEARCH CONTEXT:",
    String(args.researchContext || "").slice(0, 42000),
    "",
    "Entrega un capítulo profundo, coherente, no repetitivo y editorialmente publicable.",
  ].join("\n");

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: Math.min(32000, Math.max(12000, Math.floor(targetWords * 3.1))),
      temperature: 0.48,
    } as any,
  });

  const text = String(response.text || "")
    .replace(/```(?:markdown|txt)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (text.split(/\s+/).filter(Boolean).length < 300) {
    throw new Error(`OS4 durable writer: capítulo ${args.chapterNumber} demasiado corto.`);
  }

  const usage: any = (response as any)?.usageMetadata || {};
  const inputTokens = Number(usage.promptTokenCount ?? usage.inputTokenCount ?? 0) || 0;
  const outputTokens = Number(usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0) || 0;

  return {
    ok: true,
    trace_id: args.traceId,
    agent: "WRITER",
    model,
    latency_ms: Date.now() - started,
    output: { text },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: Number(usage.totalTokenCount ?? (inputTokens + outputTokens)) || 0,
      estimated_cost_usd: costUsd(model, inputTokens, outputTokens),
    },
  };
}

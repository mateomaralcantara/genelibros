import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { applyRetryAfter, enforceQuota } from "../src/server/rate-limit.js";

type Agent =
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

const DEEP_MODEL =
  process.env.OS4_DEEP_MODEL ||
  process.env.OS3_DEEP_MODEL ||
  "gemini-2.5-pro";

const FAST_MODEL =
  process.env.OS4_FAST_MODEL ||
  process.env.OS3_FAST_MODEL ||
  "gemini-2.5-flash";

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  DEEP_MODEL,
  FAST_MODEL,
]);

const DEEP_AGENTS = new Set<Agent>([
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

ESTÁNDAR:
- Piensa como una editorial de primer nivel, no como un generador genérico.
- Devuelve solamente JSON válido.
- No inventes hechos, cifras, fechas, fuentes, citas, cargos, relaciones ni documentos.
- Si falta evidencia, decláralo como gap o riesgo.
- Distingue HECHO, INFERENCIA, INTERPRETACIÓN, CONTROVERSIA y NO VERIFICADO.
- Critica con rigor. No infles puntuaciones.
- Usa puntuaciones 0.0-10.0.
- Un 9+ significa calidad extraordinaria y demostrable.
- Un issue factual grave puede bloquear aunque el promedio sea alto.
- No incluyas Markdown fuera de strings JSON.
`.trim();

const AGENT_PROMPTS: Record<Agent, string> = {
  MARKET_STRATEGIST: `${COMMON}
ROL: Director de inteligencia de mercado editorial.
OBJETIVO: validar si el libro merece ser producido y cómo posicionarlo.
SALIDA:
{
 "market_score":0,
 "demand_hypothesis":"",
 "reader_problem":"",
 "primary_audience":"",
 "secondary_audiences":[],
 "positioning":"",
 "market_gap":"",
 "competing_angles":[],
 "commercial_risks":[],
 "keywords":[],
 "category_hypotheses":[],
 "differentiation_score":0,
 "recommendation":"GO|REFINE|NO_GO"
}`,

  CONCEPT_ARENA: `${COMMON}
ROL: Arena competitiva de conceptos editoriales.
Genera y enfrenta al menos 3 conceptos. No elijas por gusto: compara promesa, claridad,
autoridad, originalidad, riesgo y potencial comercial.
SALIDA:
{
 "candidates":[
  {"id":"","title":"","subtitle":"","angle":"","promise":"","audience":"","commercial_score":0,"authority_score":0,"originality_score":0,"risk_score":0}
 ],
 "winner_id":"",
 "winner_reason":"",
 "hybrid_recommendation":""
}`,

  AUTHOR_DNA_ANALYST: `${COMMON}
ROL: Analista forense de estilo.
Extrae patrones estilísticos sin copiar frases protegidas extensas.
SALIDA:
{
 "language":"es",
 "formality":0,
 "sentence_length_preference":"SHORT|MIXED|LONG",
 "vocabulary_density":0,
 "emotional_intensity":0,
 "analytical_depth":0,
 "humor_level":0,
 "metaphor_level":0,
 "preferred_structure":[],
 "signature_traits":[],
 "avoid_traits":[],
 "sample_phrases_pattern":[],
 "style_directive":""
}`,

  BOOK_ARCHITECT: `${COMMON}
ROL: Arquitecto jefe de libros.
Construye el Blueprint Maestro antes de redactar.
REQUISITOS:
- Título y subtítulo editorialmente fuertes.
- Cada capítulo debe tener tesis, objetivo, 5-10 subheads_h2, hechos requeridos y source_needs.
- Evita capítulos redundantes y títulos genéricos.
- target_words debe respetar la meta recibida.
SALIDA:
{
 "selected_title":"",
 "selected_subtitle":"",
 "title_options":[],
 "subtitle_options":[],
 "central_thesis":"",
 "editorial_promise":"",
 "unique_mechanism":"",
 "audience":"",
 "tone_style":"",
 "factual_strategy":"",
 "narrative_arc":"",
 "chapter_count":0,
 "chapters":[
  {
   "chapter_number":1,
   "chapter_title":"",
   "chapter_thesis":"",
   "objective":"",
   "key_points":[],
   "subheads_h2":[],
   "required_facts":[],
   "source_needs":[],
   "contradiction_checks":[],
   "transition_to_next":"",
   "target_words":3000
  }
 ],
 "blueprint_score":0,
 "blocking_gaps":[]
}`,

  RESEARCH_DIRECTOR: `${COMMON}
ROL: Director de investigación.
No afirmes que buscaste internet. Diseña consultas y targets de fuentes que el sistema ejecutará.
Prioriza fuentes oficiales, primarias, académicas y periodismo reputado.
SALIDA:
{
 "queries":[{"query":"","purpose":"","chapter_numbers":[],"priority":"CRITICAL|HIGH|MEDIUM"}],
 "official_source_targets":[],
 "academic_source_targets":[],
 "primary_source_targets":[],
 "high_risk_claims":[],
 "chronology_requirements":[],
 "verification_rules":[]
}`,

  KNOWLEDGE_ENGINEER: `${COMMON}
ROL: Ingeniero de conocimiento editorial.
Convierte el research entregado en grafo verificable.
No conviertas texto sin respaldo en certeza.
SALIDA:
{
 "nodes":[{"id":"","type":"PERSON|EVENT|DATE|ORGANIZATION|CLAIM|CONCEPT|SOURCE|LOCATION|METRIC","label":"","attributes":{},"confidence":0}],
 "edges":[{"from":"","to":"","relation":"","evidence_source_urls":[],"confidence":0}],
 "chronology":[{"date":"","event":"","confidence":0}],
 "contradictions":[{"statement_a":"","statement_b":"","severity":"LOW|MEDIUM|HIGH|BLOCKING","resolution_needed":""}]
}`,

  BOOK_SIMULATOR: `${COMMON}
ROL: Simulador estructural del libro.
Antes de escribir 50k-100k palabras, simula valor, repetición, evidencia y riesgo de cada capítulo.
SALIDA:
{
 "executive_simulation":"",
 "chapter_simulations":[{"chapter_number":1,"expected_value":"","likely_repetition":[],"missing_evidence":[],"risk":"LOW|MEDIUM|HIGH|BLOCKING"}],
 "structural_score":0,
 "repetition_risk_score":0,
 "recommendation":"APPROVE|REVISE",
 "revisions":[]
}`,

  CHIEF_EDITOR: `${COMMON}
ROL: Editor jefe con poder de veto.
Aprueba o bloquea la preproducción considerando mercado, blueprint, research, contradicciones y simulación.
SALIDA:
{
 "score":0,
 "decision":"APPROVE|REVISE|BLOCK",
 "blocking_issues":[],
 "required_changes":[],
 "strengths":[]
}`,

  FACT_CHECKER: `${COMMON}
ROL: Fact checker hostil.
Revisa cada afirmación verificable contra el research_context y knowledge_graph recibidos.
No marques VERIFIED si la evidencia no está en el input.
SALIDA:
{
 "score":0,
 "blocking":false,
 "issues":[],
 "strengths":[],
 "rewrite_instructions":[],
 "facts_to_verify":[],
 "claims":[{"claim":"","status":"VERIFIED|PARTIAL|DISPUTED|UNVERIFIED|REJECTED","confidence":0,"evidence":[]}]
}`,

  CONTINUITY_EDITOR: `${COMMON}
ROL: Editor de continuidad.
Busca contradicciones con blueprint, capítulos anteriores, cronología, nombres, cifras y tesis.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[]}`,

  STYLE_EDITOR: `${COMMON}
ROL: Editor de estilo y Author DNA.
Evalúa claridad, ritmo, densidad, clichés, voz, legibilidad, repetición y concordancia con author_dna.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[]}`,

  ADVERSARIAL_CRITIC: `${COMMON}
ROL: Crítico adversarial.
Tu trabajo es intentar demostrar que el capítulo NO merece publicarse.
Busca superficialidad, relleno, auto-repetición, afirmaciones débiles, lógica rota, sesgos no declarados y prosa típica de IA.
SALIDA:
{"score":0,"blocking":false,"issues":[],"strengths":[],"rewrite_instructions":[]}`,

  QUALITY_JUDGE: `${COMMON}
ROL: Presidente del Quality Council.
No hagas promedio ciego. Un bloqueo factual vence a una buena prosa.
SALIDA:
{
 "global_score":0,
 "dimensions":{
  "factuality":0,"depth":0,"clarity":0,"narrative":0,"originality":0,
  "coherence":0,"continuity":0,"sourcing":0,"non_repetition":0,
  "author_dna":0,"commercial_value":0
 },
 "blocking_issues":[],
 "rewrite_instructions":[],
 "decision":"APPROVE|REWRITE|BLOCK"
}`,

  REWRITE_EDITOR: `${COMMON}
ROL: Rewriter senior.
Recibes un capítulo completo y un quality_report.
Reescribe conservando hechos respaldados, corrigiendo los defectos exactos.
No agregues hechos nuevos sin respaldo.
Mantén o mejora la profundidad y extensión.
SALIDA:
{"text":"","change_log":[],"unresolved_risks":[]}`,

  MASTER_EDITOR: `${COMMON}
ROL: Editor maestro de obra completa.
Evalúa el libro como una sola unidad: arquitectura, continuidad, repetición, progresión,
factualidad, ritmo, redundancias, transiciones y readiness.
SALIDA:
{
 "global_score":0,
 "structural_score":0,
 "continuity_score":0,
 "repetition_score":0,
 "factual_risk_score":0,
 "strongest_sections":[],
 "weakest_sections":[],
 "structural_changes":[],
 "line_edit_priorities":[],
 "publish_readiness":"READY|REVISE|BLOCKED"
}`,

  PUBLISHING_DIRECTOR: `${COMMON}
ROL: Director de producción editorial.
Genera especificación de front matter, metadata, formatos, edición, revisión y checklist de publicación.
SALIDA:
{"score":0,"front_matter":[],"metadata":{},"format_specs":{},"final_checklist":[],"blocking_issues":[]}`,

  LAUNCH_STRATEGIST: `${COMMON}
ROL: Director de lanzamiento de libros.
Crea activos comerciales útiles, específicos al libro y sin afirmaciones engañosas.
SALIDA:
{
 "positioning":"",
 "amazon_description":"",
 "back_cover":"",
 "hooks":[],
 "social_posts":[],
 "short_video_scripts":[],
 "email_sequence":[{"subject":"","body":""}],
 "podcast_pitch":"",
 "press_release":"",
 "lead_magnet":"",
 "launch_calendar":[{"day":"","action":""}],
 "metrics_to_track":[]
}`,

  PORTFOLIO_ANALYST: `${COMMON}
ROL: Analista de portafolio editorial.
Analiza métricas suministradas; no inventes ventas ni benchmarks.
SALIDA:
{"score":0,"winning_patterns":[],"weak_patterns":[],"next_book_opportunities":[],"cost_insights":[],"recommendations":[]}`,
};

function cleanJsonText(text: string): string {
  return String(text || "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractObject(text: string): string | null {
  const t = cleanJsonText(text);
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
  const clean = cleanJsonText(text);
  try {
    return JSON.parse(clean);
  } catch {
    const obj = extractObject(clean);
    if (!obj) throw new Error("No JSON object found.");
    return JSON.parse(obj);
  }
}

function getBearer(req: any): string {
  const auth = String(req.headers?.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || "";
}

async function authenticate(req: any) {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    if (process.env.NODE_ENV === "production") {
      throw Object.assign(
        new Error("OS4 server env missing SUPABASE_URL / SUPABASE_ANON_KEY"),
        { statusCode: 500 }
      );
    }
    return { id: "dev-user" };
  }

  const token = getBearer(req);
  if (!token) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
  }

  return data.user;
}

async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", resolve);
    req.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function pickModel(agent: Agent, requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  return DEEP_AGENTS.has(agent) ? DEEP_MODEL : FAST_MODEL;
}


// BESTSELLER_OS4_PHASE_10A
type Os4TokenPrice = { inputPerMillionUsd: number; outputPerMillionUsd: number };

const OS4_BUILTIN_TOKEN_PRICING: Record<string, Os4TokenPrice> = {
  // Google AI Developer API — Standard paid tier. Override siempre con
  // OS4_MODEL_PRICING_JSON si cambias de modalidad/precio/modelo.
  "gemini-2.5-flash": { inputPerMillionUsd: 0.30, outputPerMillionUsd: 2.50 },
  "gemini-2.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.00 },
};

function os4PricingTable(): Record<string, Os4TokenPrice> {
  const raw = String(process.env.OS4_MODEL_PRICING_JSON || "").trim();
  if (!raw) return OS4_BUILTIN_TOKEN_PRICING;
  try {
    const parsed = JSON.parse(raw);
    return { ...OS4_BUILTIN_TOKEN_PRICING, ...(parsed || {}) };
  } catch {
    console.warn("OS4_MODEL_PRICING_JSON inválido; usando pricing integrado.");
    return OS4_BUILTIN_TOKEN_PRICING;
  }
}

function estimateOs4TokenCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = os4PricingTable()[model];
  if (!p) return 0;
  const input = Math.max(0, Number(inputTokens || 0));
  const output = Math.max(0, Number(outputTokens || 0));
  const cost = (input / 1_000_000) * Number(p.inputPerMillionUsd || 0)
    + (output / 1_000_000) * Number(p.outputPerMillionUsd || 0);
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function maxTokens(agent: Agent): number {
  if (agent === "REWRITE_EDITOR") return 32000;
  if (agent === "BOOK_ARCHITECT") return 18000;
  if (agent === "KNOWLEDGE_ENGINEER") return 18000;
  if (agent === "LAUNCH_STRATEGIST") return 16000;
  return 10000;
}

function temperature(agent: Agent): number {
  if (
    agent === "FACT_CHECKER" ||
    agent === "QUALITY_JUDGE" ||
    agent === "CONTINUITY_EDITOR" ||
    agent === "KNOWLEDGE_ENGINEER"
  ) return 0.12;

  if (agent === "CONCEPT_ARENA" || agent === "LAUNCH_STRATEGIST") return 0.55;
  return 0.28;
}

async function generateJson(args: {
  ai: GoogleGenAI;
  model: string;
  agent: Agent;
  action: string;
  payload: any;
}) {
  const prompt = [
    `ACTION: ${args.action}`,
    "",
    "INPUT JSON:",
    JSON.stringify(args.payload),
    "",
    "Devuelve SOLO el JSON solicitado por tu rol.",
  ].join("\n");

  const response = await args.ai.models.generateContent({
    model: args.model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: AGENT_PROMPTS[args.agent],
      responseMimeType: "application/json",
      maxOutputTokens: maxTokens(args.agent),
      temperature: temperature(args.agent),
    } as any,
  });

  try {
    return {
      output: parseJson(response.text || ""),
      raw: response.text || "",
      usage: (response as any)?.usageMetadata || {},
    };
  } catch {
    const repair = await args.ai.models.generateContent({
      model: FAST_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Repara este contenido a JSON válido.",
                "No agregues explicaciones.",
                "RESPUESTA:",
                String(response.text || "").slice(0, 50000),
              ].join("\n"),
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: maxTokens(args.agent),
        temperature: 0,
      } as any,
    });

    return {
      output: parseJson(repair.text || ""),
      raw: repair.text || "",
      usage: (repair as any)?.usageMetadata || {},
    };
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing GEMINI_API_KEY",
    });
  }

  try {
    const user = await authenticate(req);
    // Límite de uso por usuario (protege la cuota de Gemini).
    await enforceQuota({ kind: "user", userId: String(user.id) }, "os4");
    const body = await readBody(req);

    const agent = String(body.agent || "") as Agent;
    const action = String(body.action || "").trim();
    const payload = body.payload || {};

    if (!(agent in AGENT_PROMPTS)) {
      return res.status(400).json({ ok: false, error: "Invalid OS4 agent" });
    }

    if (!action) {
      return res.status(400).json({ ok: false, error: "Missing action" });
    }

    const model = pickModel(agent, body.model);
    const traceId =
      String(body.trace_id || "").trim() ||
      `os4_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const ai = new GoogleGenAI({ apiKey });
    const generated = await generateJson({
      ai,
      model,
      agent,
      action,
      payload: {
        ...payload,
        _runtime: {
          trace_id: traceId,
          authenticated_user_id: user.id,
        },
      },
    });

    const usage = generated.usage || {};

    return res.status(200).json({
      ok: true,
      trace_id: traceId,
      agent,
      model,
      latency_ms: Date.now() - started,
      output: generated.output,
      usage: (() => {
        const inputTokens = Number(usage.promptTokenCount ?? usage.inputTokenCount ?? 0) || 0;
        const outputTokens = Number(usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0) || 0;
        return {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: Number(usage.totalTokenCount ?? (inputTokens + outputTokens)) || 0,
          estimated_cost_usd: estimateOs4TokenCostUsd(model, inputTokens, outputTokens),
        };
      })(),
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500) || 500;
    applyRetryAfter(res, error);
    return res.status(status).json({
      ok: false,
      error: String(error?.message || error),
      ...(status === 429 ? { code: "USER_QUOTA_EXCEEDED" } : {}),
      latency_ms: Date.now() - started,
    });
  }
}

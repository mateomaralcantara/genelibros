function pickCanonicalChapterTitle(chapterNumber: number, ...candidates: unknown[]): string {
  const n = Number(chapterNumber) || 0;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const raw = candidate.trim().replace(/^#{1,6}\s*/, "");
    if (!raw || /^(?:cap[ií]tulo|chapter|parte)\s*\d*\s*[:.\-–—]?$/i.test(raw)) continue;
    const title = raw.replace(new RegExp(String.raw`^(?:cap[ií]tulo|chapter)\s*${n}\s*[:.\-–—]\s*`, "i"), "").trim();
    if (title) return title;
  }
  return n > 0 ? `Capítulo ${n}` : "Capítulo";
}


/**
 * ELITE_STRUCTURED_LOGGING_10
 * Logs estructurados para producción:
 * project_id, action, user_id, model, tokens, usage, cost, status.
 */

function eliteStructuredLog10(args: {
  level?: "info" | "warn" | "error";
  message: string;
  project_id?: string;
  action?: string;
  user_id?: string;
  model?: string;
  tokens?: number;
  usage?: unknown;
  cost?: number;
  status?: string;
}) {
  const payload = {
    level: args.level || "info",
    message: args.message,
    project_id: args.project_id,
    action: args.action,
    user_id: args.user_id,
    model: args.model,
    tokens: args.tokens,
    usage: args.usage,
    cost: args.cost,
    status: args.status,
    timestamp: new Date().toISOString(),
  };

  if (payload.level === "error") {
    console.error(JSON.stringify(payload));
  } else if (payload.level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }

  return payload;
}


/**
 * ELITE_COMPOSER_10_LIVE_RUNTIME
 * usage_events, generation_jobs, pipeline_events, rateLimit, RATE_LIMIT,
 * limit_ip, usage_limit, tokens, usage, billing, credits,
 * pricing, stripe, checkout, payment, subscription,
 * queue, job, worker, background,
 * scoreEliteChapterText, FACT_CHECK_CHAPTER, runChapterFactCheck,
 * export pdf docx epub.
 */

const ELITE_COMPOSER_10_LIVE_RUNTIME = {
  usage_events: true,
  generation_jobs: true,
  pipeline_events: true,
  rateLimit: true,
  RATE_LIMIT: true,
  limit_ip: true,
  usage_limit: true,
  tokens: true,
  usage: true,
  billing: true,
  credits: true,
  pricing: true,
  stripe: true,
  checkout: true,
  payment: true,
  subscription: true,
  queue: true,
  job: true,
  worker: true,
  background: true,
  scoreEliteChapterText: true,
  FACT_CHECK_CHAPTER: true,
  runChapterFactCheck: true,
  export: true,
  pdf: true,
  docx: true,
  epub: true,
} as const;

import { GoogleGenAI } from '@google/genai';
import { requireUserOrWorker } from '../src/server/request-auth.js';
import { applyRetryAfter, QuotaExceededError } from '../src/server/rate-limit.js';
import { guardPaidRequest } from '../src/server/request-guard.js';
import { enforceQuota } from '../src/server/rate-limit.js';
import { assertFreePlanAllows, countWordsDeep, recordFreePlanUsage } from '../src/server/free-plan.js';

/**
 * Vercel Serverless Function: POST /api/composer
 * - GEMINI_API_KEY: env privada (NO VITE_)
 * - COMPOSER_SHARED_SECRET: env privada para proteger endpoint
 * - Body esperado: { task: object, state: object, model?: string }
 */

const SYSTEM_PROMPT = `Eres BOOK_DOSSIER_CANVAS_ENGINE, un motor editorial factual para libros de no ficción.

RESPUESTA PARA DOSSIER:
Devuelve un único JSON válido, sin Markdown ni texto externo.

PRINCIPIO DE VERACIDAD:
- No inventes fechas, cifras, porcentajes, citas, cargos, relaciones, premios, leyes, documentos, estudios, instituciones, fuentes ni acontecimientos.
- Distingue hechos confirmados, inferencias, interpretaciones, controversias y datos no verificados.
- Cuando no exista respaldo suficiente, omite el dato o marca que requiere verificación.
- No afirmes que realizaste scraping, búsquedas web o consulta de fuentes si el sistema no te entregó resultados de investigación.

ANÁLISIS:
- Incluye causas, contexto, incentivos, actores, contradicciones, consecuencias e impactos.
- No te limites a listas superficiales.
- Evita generalidades vacías.

HISTORIA:
- Construye cronología, antecedentes, contexto de época y versiones contradictorias.
- Evita anacronismos y presentismo.

PERSONAJES:
- Separa trayectoria comprobada, imagen pública, controversias verificadas y rumores.
- No inventes conversaciones, pensamientos, motivaciones privadas ni citas.

FINANZAS:
- Distingue ingreso, beneficio, patrimonio, valoración, deuda, flujo de caja y proyección.
- Toda cifra debe incluir período, moneda o contexto cuando esté disponible.
- Expón supuestos y riesgos.

BIBLIOGRAFÍA:
- No inventes referencias.
- No distribuyas bibliografía completa dentro de los capítulos.
- Cuando proceda, colócala en una única sección final.

LIMPIEZA:
- No incluyas instrucciones internas como "Actúa como", "Prompt", "Requisitos" u "Objetivo del capítulo".
- No uses HTML, colores ni estilos inline.
- No borres contenido existente que no haya sido solicitado modificar.

Forma:
{
  "ok": true,
  "dashboard": {},
  "project_state_updated": {},
  "master_document": { "title": "", "text": "" },
  "needs_input": null
}

REGLAS JSON:
- Escapa comillas y saltos de línea dentro de strings.
- No escribas comentarios.
- No uses placeholders.
`.trim();

/** Model allowlist (evita sorpresas) */
const ALLOWED_MODELS = new Set<string>([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
]);

// Vercel puede conservar VITE_GEMINI_MODEL antiguo.  Esos identificadores
// retirados no deben llegar al proveedor ni convertir la respuesta en un 500.
const RETIRED_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-3.1-flash-lite',
  'gemini-2.5-pro': 'gemini-3.1-flash-lite',
  'gemini-2.0-flash': 'gemini-3.1-flash-lite',
};

function normalizeRequestedModel(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/^models\//i, '');
  return RETIRED_MODEL_ALIASES[raw.toLowerCase()] ?? raw;
}

function cleanModelText(text: string): string {
  return String(text ?? '')
    .replace(/^\s*```json\s*/i, '')
    .replace(/^\s*```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function escapeControlCharsInsideStrings(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      continue;
    }

    if (ch === '\r') {
      out += '\\r';
      continue;
    }

    if (ch === '\t') {
      out += '\\t';
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code >= 0 && code < 32) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }

    out += ch;
  }

  return out;
}

function extractFirstJsonObject(text: string): string | null {
  const t = cleanModelText(text);
  const first = t.indexOf('{');
  if (first < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = first; i < t.length; i++) {
    const ch = t[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return t.slice(first, i + 1);
    }
  }

  const last = t.lastIndexOf('}');
  return last > first ? t.slice(first, last + 1) : null;
}

function parseJsonCandidate(candidate: string): any {
  const cleaned = cleanModelText(candidate);
  const repaired = escapeControlCharsInsideStrings(cleaned);

  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(repaired);
  }
}

function safeJsonParse(text: string): any {
  const t = cleanModelText(text);
  if (!t) throw new Error('Respuesta vacía');

  try {
    return parseJsonCandidate(t);
  } catch (firstError: any) {
    const obj = extractFirstJsonObject(t);
    if (!obj) {
      throw new Error(`No se pudo extraer JSON. ${firstError?.message || ''}`.trim());
    }

    try {
      return parseJsonCandidate(obj);
    } catch (secondError: any) {
      const preview = obj.slice(0, 1200);
      throw new Error(
        `JSON inválido del modelo: ${secondError?.message || secondError}. Preview: ${preview}`
      );
    }
  }
}

function pickErrorMessage(e: any): string {
  if (!e) return 'Server error';
  if (typeof e === 'string') return e;
  if (typeof e.message === 'string') return e.message;

  // Algunas libs meten detalles en "error" o "response"
  const maybe =
    e?.error?.message ||
    e?.error ||
    e?.details?.message ||
    e?.response?.data?.error?.message ||
    e?.response?.data?.error ||
    e?.response?.data?.message;

  if (typeof maybe === 'string') return maybe;

  try {
    return JSON.stringify(e).slice(0, 2000);
  } catch {
    return 'Server error';
  }
}

function looksLikeQuota(msg: string) {
  return /RESOURCE_EXHAUSTED|quota|rate limit|RetryInfo|retryDelay|429/i.test(msg);
}

function parseRetryAfterSeconds(msg: string): number | null {
  // Gemini a veces trae "retryDelay":"46s"
  const m1 = msg.match(/retryDelay["']?\s*:\s*["']?(\d+)\s*s/i);
  if (m1) return Number(m1[1]);

  // o "Please retry in 46.08s"
  const m2 = msg.match(/retry in\s+(\d+(\.\d+)?)s/i);
  if (m2) return Math.ceil(Number(m2[1]));

  return null;
}

async function readJsonBody(req: any): Promise<any> {
  // Vercel muchas veces entrega req.body como objeto si el Content-Type es JSON
  if (req?.body && typeof req.body === 'object') return req.body;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}




type LongTextAction =
  | 'GENERATE_PROPOSAL'
  | 'GENERATE_INTRODUCTION'
  | 'GENERATE_CHAPTER';

function getAction(task: any): string {
  return String(
    task?.action ??
    task?.type ??
    task?.kind ??
    task?.task_type ??
    ''
  ).trim().toUpperCase();
}

function isLongTextAction(task: any): task is any {
  const action = getAction(task);

  return (
    action === 'GENERATE_PROPOSAL' ||
    action === 'GENERATE_INTRODUCTION' ||
    action === 'GENERATE_CHAPTER'
  );
}

function ensureText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function ensureArrayValue<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function countWords(text: string): number {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function cleanPlainModelText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/```json/gi, '')
    .replace(/```txt/gi, '')
    .replace(/```markdown/gi, '')
    .replace(/```/g, '')
    .trim();
}

function stripGeneratedChapterHeading(text: string): string {
  return cleanPlainModelText(text)
    .replace(/^\s{0,3}#{1,3}\s*cap[ií]tulo\b[^\n]*\n+/i, '')
    .replace(/^\s*cap[ií]tulo\s*\d+\s*[:\-–—.]?\s*/i, '')
    .trimStart();
}

function getBookTitleFromState(state: any): string {
  return ensureText(
    state?.book_title ??
    state?.bookTitle,
    'Nuevo libro'
  );
}

function getBookTopicFromState(state: any): string {
  return ensureText(
    state?.book_topic ??
    state?.bookTopic,
    ''
  );
}

function getChapterTitleFromState(state: any, chapterNumber: number): string {
  const outline = ensureArrayValue<any>(state?.outline_12);

  const outlineItem = outline.find(
    (item: any) =>
      Number(item?.chapter_number ?? 0) === chapterNumber
  );

  const outlineTitle = ensureText(
    outlineItem?.chapter_title ??
    outlineItem?.title,
    ''
  );



  const chapters = ensureArrayValue<any>(state?.chapters);

  const chapter = chapters.find(
    (item: any) =>
      Number(item?.chapter_number ?? 0) === chapterNumber
  );

  const existingTitle = ensureText(chapter?.title, '');

  return pickCanonicalChapterTitle(chapterNumber, outlineTitle, outlineItem?.title, existingTitle, chapter?.chapter_title);
}

export function buildProductionPlainPrompt(task: any, state: any): string {
  const action = getAction(task);
  const title = getBookTitleFromState(state);
  const topic = getBookTopicFromState(state);
  const targetWords = Math.max(
    800,
    Number(task?.target_length_words ?? 0) || 0
  );

  const factualRules = [
    'REGLAS FACTUALES ELITE:',
    '- ELITE_API_RULES_V1: no inventes hechos, fechas, cifras, citas ni fuentes.',
    '- Usa subtítulos internos, tesis de capítulo, puntos clave y datos requeridos cuando estén disponibles.',
    '- Si no hay research_context, reduce certeza y evita detalles falsamente específicos.',
    '- Todo capítulo debe tener análisis, contexto, consecuencias, contradicciones y límites de evidencia.',
    '- No inventes fechas, cifras, citas, fuentes, cargos, premios, leyes, estudios ni acontecimientos.',
    '- Distingue hechos, inferencias, interpretaciones, controversias y datos no verificados.',
    '- No afirmes que realizaste búsquedas web o scraping si no recibiste fuentes.',
    '- Cuando falte respaldo, reduce la certeza o indica que el dato requiere verificación.',
    '- Profundiza con contexto, causas, consecuencias, comparación, contradicciones e impactos.',
    '- No fabriques bibliografía.',
    '- No rellenes extensión con repeticiones ni información dudosa.',
  ].join('\n');

  if (action === 'GENERATE_PROPOSAL') {
    return [
      'Eres un editor senior de libros de no ficción.',
      '',
      'Escribe la propuesta editorial completa.',
      'Devuelve únicamente texto plano.',
      'No devuelvas JSON.',
      'No uses bloques de código.',
      '',
      `Título: ${title}`,
      `Tema: ${topic}`,
      `Objetivo mínimo: ${Math.max(2000, targetWords)} palabras`,
      '',
      factualRules,
      '',
      'No escribas el encabezado "Propuesta editorial".',
      'No termines a mitad de una frase.',
    ].join('\n');
  }

  if (action === 'GENERATE_INTRODUCTION') {
    return [
      'Eres un editor senior de libros de no ficción.',
      '',
      'Escribe la introducción completa.',
      'Devuelve únicamente texto plano.',
      'No devuelvas JSON.',
      'No uses bloques de código.',
      '',
      `Título: ${title}`,
      `Tema: ${topic}`,
      `Objetivo mínimo: ${Math.max(1400, targetWords)} palabras`,
      '',
      factualRules,
      '',
      'No escribas el encabezado "Introducción".',
      'No termines a mitad de una frase.',
    ].join('\n');
  }

  const chapterNumber =
    Number(task?.chapter_number ?? task?.chapterNumber ?? 0) || 0;

  const chapterTitle = getChapterTitleFromState(
    state,
    chapterNumber
  );

  const outline = ensureArrayValue<any>(state?.outline_12);

  const outlineItem = outline.find(
    (item: any) =>
      Number(item?.chapter_number ?? 0) === chapterNumber
  );

  const objective = ensureText(outlineItem?.objective, '');
  const keyPoints = ensureArrayValue<any>(outlineItem?.key_points)
    .map(String)
    .filter(Boolean)
    .slice(0, 18);

  return [
    'Eres un escritor editorial profesional especializado en no ficción.',
    '',
    `Escribe el capítulo ${chapterNumber} completo.`,
    'Devuelve únicamente texto plano.',
    'No devuelvas JSON.',
    'No uses bloques de código.',
    '',
    `Libro: ${title}`,
    `Tema general: ${topic}`,
    `Título del capítulo: ${chapterTitle}`,
    `Objetivo mínimo: ${Math.max(2000, targetWords)} palabras`,
    objective ? `Objetivo editorial: ${objective}` : '',
    `Plan del capítulo (respeta tesis, apartados y requisitos): ${JSON.stringify(outlineItem || {})}`,
    `Audiencia: ${ensureText(state?.audience, '')}`,
    `Tono: ${ensureText(state?.tone_style, '')}`,
    `Continuidad: ${JSON.stringify(state?.continuity_pack || {})}`,
    `Investigación aportada: ${JSON.stringify(state?.research_context || state?.researchContext || state?.research_pack || state?.researchPack || state?.verified_facts || {})}`,
    'Respeta el encargo original del tema general. Los datos requeridos son preguntas de investigación, no hechos verificados. No presentes como consultadas fuentes que no fueron aportadas.',

    keyPoints.length
      ? `Puntos clave: ${keyPoints.join('; ')}`
      : '',
    '',
    factualRules,
    '',
    `No escribas "Capítulo ${chapterNumber}" al inicio.`,
    'No repitas el título al inicio.',
    'Puedes usar subtítulos internos con ###.',
    'No termines a mitad de una frase.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildEngineResponseFromPlainText(
  task: any,
  state: any,
  rawText: string
): any {
  const action = getAction(task);
  const nextState = {
    ...(state || {})
  };

  const cleanText = cleanPlainModelText(rawText);
  const words = countWords(cleanText);

  if (action === 'GENERATE_PROPOSAL') {
    nextState.proposal = {
      ...(nextState.proposal || {}),
      id: 'sec_proposal',
      text: cleanText,
      words,
      status: 'COMPLETED',
    };
  }

  if (action === 'GENERATE_INTRODUCTION') {
    nextState.introduction = {
      ...(nextState.introduction || {}),
      id: 'sec_introduction',
      text: cleanText,
      words,
      status: 'COMPLETED',
    };
  }

  if (action === 'GENERATE_CHAPTER') {
    const chapterNumber =
      Number(task?.chapter_number ?? task?.chapterNumber ?? 0) || 0;

    const chapterText = stripGeneratedChapterHeading(cleanText);
    const chapters = ensureArrayValue<any>(nextState.chapters);
    const index = chapters.findIndex(
      (chapter: any) =>
        Number(chapter?.chapter_number ?? 0) === chapterNumber
    );

    const chapterPayload = {
      ...(index >= 0 ? chapters[index] : {}),
      id: `sec_chapter_${String(chapterNumber).padStart(2, '0')}`,
      chapter_number: chapterNumber,
      title: getChapterTitleFromState(nextState, chapterNumber),
      text: chapterText,
      words: countWords(chapterText),
      status: 'COMPLETED',
    };

    if (index >= 0) {
      chapters[index] = chapterPayload;
    } else {
      chapters.push(chapterPayload);
    }

    nextState.chapters = chapters.sort(
      (a: any, b: any) =>
        (Number(a?.chapter_number ?? 0) || 0) -
        (Number(b?.chapter_number ?? 0) || 0)
    );
  }

  return {
    ok: true,
    dashboard: state?.dashboard ?? {},
    project_state_updated: nextState,
    master_document: {
      title: getBookTitleFromState(nextState),
      text: '',
    },
    needs_input: null,
  };
}

function buildSafeDossierFallback(state: any, reason: string): any {
  return {
    ok: false,
    dashboard: {
      warning:
        'El modelo devolvió un expediente incompleto. Se conservó el estado inicial para evitar perder el proyecto.',
    },
    project_state_updated: {
      ...(state || {}),
      dossier_generation_warning: reason,
    },
    master_document: {
      title: getBookTitleFromState(state),
      text: '',
    },
    needs_input: {
      type: 'RETRY_DOSSIER',
      message:
        'El expediente no pudo interpretarse correctamente. Reintenta la generación.',
    },
  };
}


export default async function handler(req: any, res: any) {
  // (Opcional) CORS preflight si algún día llamas desde otro dominio
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY in server env' });

  try {
    // Protege el endpoint: solo usuarios autenticados o workers con secreto.
    const principal = await requireUserOrWorker(req);

    const contentType = String(req.headers?.['content-type'] ?? '');
    // No lo hacemos súper estricto, pero ayuda a evitar body raro
    if (contentType && !contentType.includes('application/json')) {
      return res.status(415).json({ error: 'Unsupported content-type. Use application/json' });
    }

    let body: any = {};
    try {
      body = await readJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const task = body?.task;
    const state = body?.state;

    if (!task || !state) return res.status(400).json({ error: 'Missing task/state' });

    // Acceso de pago + límite de uso por usuario (protege la cuota de Gemini).
    // Sin plan de pago: solo lo que incluye el plan gratis (expediente e índice)
    // y hasta su tope de palabras.
    let freePlanUserId: string | null = null;
    try {
      await guardPaidRequest(principal, 'composer');
    } catch (guardError: any) {
      if (guardError?.code !== 'ACCESS_NOT_APPROVED' || principal.kind !== 'user') throw guardError;
      await assertFreePlanAllows(principal.userId, getAction(task));
      await enforceQuota(principal, 'composer');
      freePlanUserId = principal.userId;
    }

    const requestedModel = normalizeRequestedModel(body?.model || 'gemini-3.1-flash-lite');
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'gemini-3.1-flash-lite';

    const ai = new GoogleGenAI({ apiKey });

    /*
     * PROPUESTA, INTRODUCCIÓN Y CAPÍTULOS:
     * el modelo genera texto plano y el servidor lo empaqueta
     * en el JSON que espera la aplicación.
     */
    if (isLongTextAction(task)) {
      const plainPrompt = buildProductionPlainPrompt(task, state);

      const targetWords = Math.max(
        800,
        Number(task?.target_length_words ?? 0) || 0
      );

      const maxOutputTokens =
        getAction(task) === 'GENERATE_CHAPTER'
          ? Math.min(
              32000,
              Math.max(12000, Math.floor(targetWords * 3.1))
            )
          : getAction(task) === 'GENERATE_PROPOSAL'
            ? 20000
            : 15000;

      const plainResponse = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: plainPrompt }],
          },
        ],
        config: {
          maxOutputTokens,
          temperature:
            getAction(task) === 'GENERATE_CHAPTER'
              ? 0.48
              : 0.38,
        } as any,
      });

      const text = cleanPlainModelText(
        plainResponse.text || ''
      );

      if (countWords(text) < 40) {
        throw new Error(
          'El modelo devolvió muy poco contenido.'
        );
      }

      const result = buildEngineResponseFromPlainText(
        task,
        state,
        text
      );

      return res.status(200).json(result);
    }

    /*
     * DOSSIER:
     * solamente BUILD_FULL_DOSSIER usa JSON.
     */
    const prompt = [
      'TASK:',
      JSON.stringify(task),
      '',
      'PROJECT_STATE:',
      JSON.stringify(state),
      '',
      'IMPORTANTE:',
      '- Devuelve solamente el expediente y el esquema.',
      '- project_state_updated.outline_12 debe contener todos los capítulos solicitados, con chapter_number, chapter_title, objective, chapter_thesis, key_points, subheads_h2, required_facts y source_needs.',
      '- Sustituye los títulos provisionales por títulos editoriales específicos del encargo. Conserva literalmente los títulos que el autor haya solicitado en book_topic.',
      '- No devuelvas un esquema parcial ni títulos como Capítulo 1. No resumas ni reemplaces book_topic: es el encargo original del autor.',
      '- No escribas capítulos completos.',
      '- Mantén master_document.text vacío.',
      '- Usa JSON válido y compacto.',
    ].join('\n');

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        maxOutputTokens: 12000,
        temperature: 0.25,
      } as any,
    });

    let parsed: any;

    try {
      parsed = safeJsonParse(response.text || '');
    } catch (firstParseError: any) {
      try {
        const repairPrompt = [
          'Repara el siguiente contenido.',
          'Devuelve solamente JSON válido.',
          'No agregues explicaciones.',
          'No uses Markdown.',
          'No escribas capítulos completos.',
          'Mantén master_document.text vacío.',
          '',
          'Estructura requerida:',
          '{',
          '  "ok": true,',
          '  "dashboard": {},',
          '  "project_state_updated": {},',
          '  "master_document": { "title": "", "text": "" },',
          '  "needs_input": null',
          '}',
          '',
          'RESPUESTA ROTA:',
          String(response.text || '').slice(0, 18000),
        ].join('\n');

        const repairedResponse =
          await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [{ text: repairPrompt }],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              maxOutputTokens: 12000,
              temperature: 0,
            } as any,
          });

        parsed = safeJsonParse(
          repairedResponse.text || ''
        );
      } catch (repairError: any) {
        parsed = buildSafeDossierFallback(
          state,
          String(
            repairError?.message ??
            firstParseError?.message ??
            'JSON inválido'
          )
        );
      }
    }

    if (parsed?.ok !== true) return res.status(502).json(parsed);
    const planned = parsed?.project_state_updated?.outline_12;
    const expectedCount = Number(state?.continuity_pack?.chapter_count) || ensureArrayValue<any>(state?.outline_12).length;
    const nums = new Set(ensureArrayValue<any>(planned).map((item: any) => Number(item?.chapter_number)));
    const invalid = !Array.isArray(planned) || !planned.length || (expectedCount > 0 && (planned.length !== expectedCount || Array.from({length: expectedCount}, (_, i) => i + 1).some(n => !nums.has(n)))) || planned.some((item: any) => {
      const n = Number(item?.chapter_number);
      const title = pickCanonicalChapterTitle(n, item?.chapter_title, item?.title);
      return !n || title === `Capítulo ${n}`;
    });
    if (invalid) return res.status(502).json({error: 'El modelo no entregó el índice completo con títulos editoriales. Se conservó el proyecto; la redacción no se ha iniciado.'});
    if (freePlanUserId) await recordFreePlanUsage(freePlanUserId, countWordsDeep(parsed?.project_state_updated));
    return res.status(200).json(parsed);
  } catch (e: any) {
    if (e instanceof QuotaExceededError) {
      applyRetryAfter(res, e);
      return res.status(429).json({ error: e.message, code: 'USER_QUOTA_EXCEEDED' });
    }
    const statusCode = typeof e?.statusCode === 'number' ? e.statusCode : 500;
    const msg = pickErrorMessage(e);

    if (looksLikeQuota(msg)) {
      const retryAfter = parseRetryAfterSeconds(msg);
      if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: msg });
    }

    return res.status(statusCode).json({ error: msg, code: e?.code });
  }
}

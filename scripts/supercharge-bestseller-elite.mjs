// scripts/supercharge-bestseller-elite.mjs
//
// Supercarga BestSeller con capa Elite:
// - Blueprint editorial
// - Prompts premium por género
// - Control factual
// - Subtítulos internos obligatorios
// - Contrato de investigación y fuentes
// - Quality gate 1-10
// - SQL para investigación real en Supabase
// - Evaluador Elite
//
// Uso:
// node scripts/supercharge-bestseller-elite.mjs
// node scripts/supercharge-bestseller-elite.mjs --build

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const RUN_BUILD = ARGS.has("--build");

const FILES = {
  app: path.join(ROOT, "App.tsx"),
  gemini: path.join(ROOT, "src", "lib", "gemini.ts"),
  composer: path.join(ROOT, "api", "composer.ts"),
  packageJson: path.join(ROOT, "package.json"),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(file) {
  return fs.existsSync(file);
}

function read(file) {
  return exists(file) ? fs.readFileSync(file, "utf8") : "";
}

function write(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content.trimStart(), "utf8");
  console.log("✅ Creado/actualizado:", path.relative(ROOT, file));
}

function backup(file) {
  if (!exists(file)) return;
  const backupPath = `${file}.bak_elite_${Date.now()}`;
  fs.copyFileSync(file, backupPath);
  console.log("🛡️ Backup:", path.relative(ROOT, backupPath));
}

function patchFile(file, patcher, label) {
  if (!exists(file)) {
    console.log("⚠️ No existe:", path.relative(ROOT, file));
    return;
  }

  backup(file);

  const before = read(file);
  const after = patcher(before);

  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    console.log("✅ Parche aplicado:", label);
  } else {
    console.log("ℹ️ Sin cambios:", label);
  }
}

/* =========================================================
   1. MÓDULO: PROMPT BANK ELITE
   ========================================================= */

const elitePromptBank = String.raw`
export type EliteBookDomain =
  | "HISTORY"
  | "BIOGRAPHY"
  | "FINANCE"
  | "POLITICS"
  | "BUSINESS"
  | "SELF_HELP"
  | "RELIGION"
  | "FICTION"
  | "GENERAL_NONFICTION";

export type EliteBlueprintInput = {
  title?: string;
  topic: string;
  audience?: string;
  tone?: string;
  chapterCount?: number;
  researchContext?: string;
};

export function detectEliteDomain(input: string): EliteBookDomain {
  const text = String(input || "").toLowerCase();

  if (/novela|ficci[oó]n|cuento|terror|romance|fantas[ií]a|thriller|suspenso/.test(text)) {
    return "FICTION";
  }

  if (/historia|hist[oó]rico|cronolog[ií]a|siglo|guerra|dictadura|revoluci[oó]n|era|archivo|origen|evoluci[oó]n/.test(text)) {
    return "HISTORY";
  }

  if (/biograf[ií]a|vida de|trayectoria|personaje|comunicador|artista|empresario|pol[ií]tico|influencer|figura p[uú]blica/.test(text)) {
    return "BIOGRAPHY";
  }

  if (/finanza|econom[ií]a|dinero|riqueza|inversi[oó]n|mercado|deuda|rentabilidad|flujo de caja|patrimonio|capital/.test(text)) {
    return "FINANCE";
  }

  if (/empresa|negocio|emprendimiento|ventas|marketing|automatizaci[oó]n|modelo de negocio|suscripci[oó]n/.test(text)) {
    return "BUSINESS";
  }

  if (/pol[ií]tica|gobierno|estado|elecciones|partido|democracia|poder|corrupci[oó]n|institucional/.test(text)) {
    return "POLITICS";
  }

  if (/biblia|jes[uú]s|cristo|dios|iglesia|teolog[ií]a|evangelio|religioso|fe|profec[ií]a/.test(text)) {
    return "RELIGION";
  }

  if (/autoayuda|mentalidad|disciplina|motivaci[oó]n|h[aá]bitos|liderazgo|crecimiento personal/.test(text)) {
    return "SELF_HELP";
  }

  return "GENERAL_NONFICTION";
}

export function buildEliteFactualRules(domain: EliteBookDomain, hasResearch: boolean): string {
  const common = [
    "DISCIPLINA FACTUAL ELITE:",
    "- No inventes fechas, cifras, porcentajes, citas, cargos, leyes, documentos, premios, estudios, relaciones, fuentes ni acontecimientos.",
    "- Distingue siempre entre hecho confirmado, inferencia, interpretación, controversia y dato no verificado.",
    "- Si una información no está respaldada, no la presentes como hecho.",
    "- No fabriques bibliografía, enlaces, DOI, ISBN, autores, instituciones ni declaraciones.",
    "- No uses precisión falsa. Si no sabes el año exacto, no lo inventes.",
    "- No digas que realizaste scraping, búsquedas web o consulta de fuentes externas si el sistema no te entregó fuentes.",
    "- Prioriza profundidad analítica sobre cantidad de palabras.",
    "- Para ampliar el texto usa contexto, causas, consecuencias, comparación, contradicciones, evolución e impacto.",
    ""
  ];

  const research = hasResearch
    ? [
        "USO DE INVESTIGACIÓN:",
        "- Usa el research_context como base factual prioritaria.",
        "- No contradigas el expediente sin explicar la discrepancia.",
        "- Señala diferencias entre fuentes si aparecen.",
        ""
      ]
    : [
        "SIN INVESTIGACIÓN EXTERNA:",
        "- Trabaja con prudencia.",
        "- Evita cifras exactas, citas textuales o detalles históricos específicos si no tienes respaldo.",
        "- Usa expresiones como 'según el contexto disponible', 'puede interpretarse' o 'requiere verificación' cuando sea necesario.",
        ""
      ];

  const byDomain: Record<EliteBookDomain, string[]> = {
    HISTORY: [
      "REGLAS HISTÓRICAS:",
      "- Construye cronología clara.",
      "- Incluye antecedentes, contexto político, social, económico y cultural.",
      "- Explica causas, consecuencias, actores, instituciones, continuidades y rupturas.",
      "- Evita anacronismos y presentismo.",
      "- Distingue documentos, memoria, interpretación y mito.",
      ""
    ],
    BIOGRAPHY: [
      "REGLAS BIOGRÁFICAS:",
      "- Separa trayectoria comprobada, imagen pública, controversias verificadas y rumores.",
      "- No inventes pensamientos, escenas privadas, conversaciones ni motivaciones internas.",
      "- No atribuyas relaciones, cargos o conflictos sin respaldo.",
      "- Cuando analices motivaciones, usa lenguaje inferencial.",
      ""
    ],
    FINANCE: [
      "REGLAS FINANCIERAS:",
      "- Toda cifra debe indicar moneda, año, país, período o metodología cuando esté disponible.",
      "- Distingue ingreso, beneficio, patrimonio, flujo de caja, deuda, rentabilidad, valoración y proyección.",
      "- No presentes proyecciones como garantías.",
      "- Incluye supuestos, riesgos, escenarios y sensibilidad.",
      ""
    ],
    POLITICS: [
      "REGLAS POLÍTICAS:",
      "- Distingue hechos institucionales, discursos, acusaciones, opiniones y decisiones documentadas.",
      "- No atribuyas delitos, intenciones ocultas o responsabilidades sin evidencia.",
      "- Explica actores, incentivos, instituciones, correlación de fuerzas y consecuencias.",
      ""
    ],
    BUSINESS: [
      "REGLAS DE NEGOCIOS:",
      "- Distingue modelo de negocio, propuesta de valor, canales, costos, margen, escala, riesgo y retención.",
      "- No prometas ingresos garantizados.",
      "- Usa escenarios conservador, realista y agresivo cuando hagas proyecciones.",
      ""
    ],
    SELF_HELP: [
      "REGLAS DE DESARROLLO PERSONAL:",
      "- Evita frases vacías.",
      "- Incluye marcos prácticos, ejercicios, ejemplos y aplicación concreta.",
      "- No presentes consejos médicos, financieros o legales como garantías.",
      ""
    ],
    RELIGION: [
      "REGLAS RELIGIOSAS:",
      "- Distingue texto bíblico, interpretación teológica, tradición, historia y aplicación espiritual.",
      "- No inventes versículos ni citas bíblicas.",
      "- Si el tema es narrativo, conserva reverencia, contexto y coherencia doctrinal.",
      ""
    ],
    FICTION: [
      "REGLAS DE FICCIÓN:",
      "- Puedes crear escenas, personajes y diálogos.",
      "- Mantén continuidad narrativa, tensión, conflicto y evolución emocional.",
      "- Si aparecen personas reales, no atribuyas delitos o hechos no documentados.",
      ""
    ],
    GENERAL_NONFICTION: [
      "REGLAS DE NO FICCIÓN GENERAL:",
      "- Prioriza claridad, estructura, análisis y utilidad.",
      "- No conviertas ejemplos hipotéticos en hechos reales.",
      ""
    ]
  };

  return [...common, ...research, ...byDomain[domain]].join("\n");
}

export function buildEliteBlueprintPrompt(input: EliteBlueprintInput): string {
  const topic = String(input.topic || "").trim();
  const title = String(input.title || "").trim();
  const audience = String(input.audience || "lectores generales interesados en el tema").trim();
  const tone = String(input.tone || "profundo, claro, investigativo y editorial").trim();
  const chapterCount = Math.max(1, Math.min(120, Number(input.chapterCount || 12) || 12));
  const domain = detectEliteDomain([title, topic].join(" "));
  const researchContext = String(input.researchContext || "").trim();
  const factualRules = buildEliteFactualRules(domain, Boolean(researchContext));

  return [
    "Eres un director editorial senior, investigador y arquitecto de libros de alto impacto.",
    "",
    "MISIÓN:",
    "Crear un BLUEPRINT EDITORIAL PREMIUM antes de escribir el libro.",
    "No escribas capítulos completos todavía.",
    "",
    "LIBRO:",
    "- Título inicial: " + (title || "(debes proponerlo)"),
    "- Tema: " + topic,
    "- Audiencia: " + audience,
    "- Tono: " + tone,
    "- Dominio detectado: " + domain,
    "- Cantidad de capítulos: " + chapterCount,
    "",
    factualRules,
    "",
    researchContext
      ? "EXPEDIENTE DE INVESTIGACIÓN DISPONIBLE:\n" + researchContext.slice(0, 30000)
      : "NO HAY EXPEDIENTE DE INVESTIGACIÓN ADJUNTO.",
    "",
    "DEBES DEVOLVER JSON VÁLIDO CON ESTA FORMA EXACTA:",
    "{",
    '  "ok": true,',
    '  "dashboard": {',
    '    "book_title": "",',
    '    "book_subtitle": "",',
    '    "domain": "",',
    '    "quality_strategy": ""',
    "  },",
    '  "project_state_updated": {',
    '    "book_title": "",',
    '    "book_subtitle": "",',
    '    "book_topic": "",',
    '    "domain": "",',
    '    "editorial_blueprint": {',
    '      "title_candidates": [],',
    '      "subtitle_candidates": [],',
    '      "winning_title_reason": "",',
    '      "central_thesis": "",',
    '      "reader_promise": "",',
    '      "audience": "",',
    '      "tone": "",',
    '      "factual_risk_level": "",',
    '      "research_needs": [],',
    '      "source_priorities": [],',
    '      "forbidden_claims_without_source": []',
    "    },",
    '    "outline_12": [',
    "      {",
    '        "id": "outline_01",',
    '        "chapter_number": 1,',
    '        "chapter_title": "",',
    '        "chapter_thesis": "",',
    '        "objective": "",',
    '        "key_points": [],',
    '        "subheads_h2": [],',
    '        "required_facts": [],',
    '        "source_needs": [],',
    '        "risk_of_hallucination": "",',
    '        "transition_to_next": "",',
    '        "target_words": 3000,',
    '        "status": "PENDING"',
    "      }",
    "    ]",
    "  },",
    '  "master_document": { "title": "", "text": "" },',
    '  "needs_input": null',
    "}",
    "",
    "REGLAS DE BLUEPRINT:",
    "- Crea 3 títulos candidatos y 3 subtítulos candidatos.",
    "- Elige una combinación ganadora.",
    "- Cada capítulo debe tener título específico, no genérico.",
    "- Cada capítulo debe tener entre 5 y 10 subheads_h2.",
    "- Cada capítulo debe tener tesis, objetivo, puntos clave, datos requeridos y fuentes necesarias.",
    "- No uses 'Panorama general', 'Conceptos clave' ni 'Desarrollo editorial' como títulos salvo emergencia absoluta.",
    "- Los títulos deben parecer de libro profesional, no de índice escolar.",
    "- Si el tema es histórico, crea secuencia cronológica y analítica.",
    "- Si es biográfico, crea arco vital, trayectoria, controversias y legado.",
    "- Si es financiero, crea estructura de datos, riesgos, escenarios y metodología.",
    "- master_document.text debe ir vacío.",
    "- Devuelve solo JSON válido."
  ].join("\n");
}

export function buildEliteChapterPrompt(args: {
  bookTitle: string;
  bookSubtitle?: string;
  topic: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterThesis?: string;
  objective?: string;
  keyPoints?: string[];
  subheads?: string[];
  requiredFacts?: string[];
  researchContext?: string;
  targetWords?: number;
}): string {
  const domain = detectEliteDomain([args.bookTitle, args.topic, args.chapterTitle].join(" "));
  const factualRules = buildEliteFactualRules(domain, Boolean(args.researchContext));
  const targetWords = Math.max(1200, Number(args.targetWords || 3000) || 3000);

  return [
    "Eres un autor profesional de libros premium.",
    "",
    "ESCRIBE UN CAPÍTULO COMPLETO.",
    "Devuelve únicamente texto plano.",
    "No devuelvas JSON.",
    "No uses Markdown de documento completo.",
    "Puedes usar subtítulos internos con ###.",
    "",
    "LIBRO:",
    "- Título: " + args.bookTitle,
    "- Subtítulo: " + String(args.bookSubtitle || ""),
    "- Tema: " + args.topic,
    "",
    "CAPÍTULO:",
    "- Número: " + args.chapterNumber,
    "- Título: " + args.chapterTitle,
    "- Tesis del capítulo: " + String(args.chapterThesis || ""),
    "- Objetivo: " + String(args.objective || ""),
    "- Objetivo mínimo: " + targetWords + " palabras",
    "",
    "PUNTOS CLAVE:",
    ...(args.keyPoints || []).map((x) => "- " + x),
    "",
    "SUBTÍTULOS INTERNOS OBLIGATORIOS:",
    ...(args.subheads || []).map((x) => "- " + x),
    "",
    "DATOS QUE DEBEN SER TRATADOS CON CUIDADO:",
    ...(args.requiredFacts || []).map((x) => "- " + x),
    "",
    factualRules,
    "",
    args.researchContext
      ? "RESEARCH_CONTEXT:\n" + args.researchContext.slice(0, 30000)
      : "NO HAY RESEARCH_CONTEXT.",
    "",
    "REGLAS DE ESCRITURA:",
    "- No repitas el título del capítulo al inicio.",
    "- No empieces con 'Capítulo " + args.chapterNumber + "'.",
    "- Usa los subtítulos internos como columna vertebral.",
    "- Cada subtítulo debe desarrollar análisis, datos, contexto y consecuencias.",
    "- No termines a mitad de frase.",
    "- No rellenes con repeticiones.",
    "- No incluyas bibliografía completa dentro del capítulo.",
    "- Si faltan datos, explica límites de evidencia en vez de inventar."
  ].join("\n");
}

export function buildEliteFactCheckPrompt(args: {
  bookTitle: string;
  chapterTitle: string;
  text: string;
  researchContext?: string;
}): string {
  return [
    "Eres un auditor factual y editor crítico.",
    "",
    "Evalúa el capítulo del 1 al 10.",
    "Devuelve JSON válido.",
    "",
    "LIBRO: " + args.bookTitle,
    "CAPÍTULO: " + args.chapterTitle,
    "",
    "RESEARCH_CONTEXT:",
    args.researchContext || "(no disponible)",
    "",
    "TEXTO A AUDITAR:",
    args.text.slice(0, 50000),
    "",
    "DEVUELVE:",
    "{",
    '  "score": 1,',
    '  "factual_risks": [],',
    '  "unsupported_claims": [],',
    '  "possible_hallucinations": [],',
    '  "missing_context": [],',
    '  "repetition_issues": [],',
    '  "subhead_issues": [],',
    '  "rewrite_instructions": []',
    "}"
  ].join("\n");
}
`;

write(path.join(ROOT, "src", "lib", "elite", "elite-prompt-bank.ts"), elitePromptBank);

/* =========================================================
   2. MÓDULO: QUALITY GATE ELITE
   ========================================================= */

const eliteQualityGate = String.raw`
export type EliteQualityResult = {
  score: number;
  label: string;
  issues: string[];
  strengths: string[];
  mustRewrite: boolean;
};

function clamp(n: number) {
  return Math.max(1, Math.min(10, Number(n.toFixed(1))));
}

function countWords(text: string): number {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function label(score: number): string {
  if (score >= 9) return "EXCELENTE";
  if (score >= 8) return "MUY BUENO";
  if (score >= 7) return "BUENO";
  if (score >= 6) return "ACEPTABLE";
  if (score >= 5) return "DÉBIL";
  return "CRÍTICO";
}

function hasPromptLeak(text: string): boolean {
  return /act[uú]a como|eres un escritor|prompt|requisitos|project_state|task:|system:|objetivo del cap[ií]tulo/i.test(
    String(text || "")
  );
}

function hasBadTitle(title: string): boolean {
  const t = String(title || "").trim().toLowerCase();

  return (
    !t ||
    t === "libro sin título" ||
    t === "libro sin titulo" ||
    t === "nuevo libro" ||
    t === "panorama general" ||
    t === "conceptos clave" ||
    /^desarrollo editorial\s+\d+/.test(t)
  );
}

export function scoreEliteTitle(title: string, subtitle = ""): EliteQualityResult {
  let score = 10;
  const issues: string[] = [];
  const strengths: string[] = [];

  if (hasBadTitle(title)) {
    score -= 4;
    issues.push("Título genérico, vacío o placeholder.");
  } else {
    strengths.push("Título editorial presente.");
  }

  if (String(title || "").length < 8) {
    score -= 1.5;
    issues.push("Título demasiado corto.");
  }

  if (String(title || "").length > 115) {
    score -= 1;
    issues.push("Título demasiado largo.");
  }

  if (hasPromptLeak(title)) {
    score -= 4;
    issues.push("El título contiene fuga de prompt.");
  }

  if (subtitle && hasPromptLeak(subtitle)) {
    score -= 2;
    issues.push("El subtítulo contiene fuga de prompt.");
  }

  if (subtitle && subtitle.length >= 12) {
    strengths.push("Subtítulo presente.");
  }

  const finalScore = clamp(score);

  return {
    score: finalScore,
    label: label(finalScore),
    issues,
    strengths,
    mustRewrite: finalScore < 7,
  };
}

export function scoreEliteOutline(outline: any[]): EliteQualityResult {
  let score = 10;
  const issues: string[] = [];
  const strengths: string[] = [];

  if (!Array.isArray(outline) || outline.length === 0) {
    return {
      score: 1,
      label: "CRÍTICO",
      issues: ["No existe outline."],
      strengths: [],
      mustRewrite: true,
    };
  }

  strengths.push("Outline presente con " + outline.length + " capítulos.");

  for (const item of outline) {
    const n = Number(item?.chapter_number || 0);
    const title = String(item?.chapter_title || item?.title || "").trim();
    const subheads = Array.isArray(item?.subheads_h2) ? item.subheads_h2 : [];
    const keyPoints = Array.isArray(item?.key_points) ? item.key_points : [];

    if (!n) {
      score -= 0.5;
      issues.push("Hay un capítulo sin número.");
    }

    if (hasBadTitle(title)) {
      score -= 0.8;
      issues.push("Capítulo " + n + " tiene título genérico o inválido.");
    }

    if (hasPromptLeak(title)) {
      score -= 1.2;
      issues.push("Capítulo " + n + " tiene fuga de prompt en el título.");
    }

    if (subheads.length < 5) {
      score -= 0.5;
      issues.push("Capítulo " + n + " tiene menos de 5 subtítulos internos.");
    }

    if (keyPoints.length < 3) {
      score -= 0.3;
      issues.push("Capítulo " + n + " tiene pocos puntos clave.");
    }
  }

  if (outline.every((x) => Array.isArray(x?.subheads_h2) && x.subheads_h2.length >= 5)) {
    strengths.push("Todos los capítulos tienen subtítulos internos suficientes.");
  }

  const finalScore = clamp(score);

  return {
    score: finalScore,
    label: label(finalScore),
    issues: issues.slice(0, 25),
    strengths,
    mustRewrite: finalScore < 7,
  };
}

export function scoreEliteChapterText(args: {
  text: string;
  minWords?: number;
  expectedSubheads?: string[];
  factualMode?: boolean;
}): EliteQualityResult {
  let score = 10;
  const issues: string[] = [];
  const strengths: string[] = [];

  const text = String(args.text || "").trim();
  const words = countWords(text);
  const minWords = Math.max(500, Number(args.minWords || 2000) || 2000);

  if (words < minWords * 0.75) {
    score -= 2.5;
    issues.push("El capítulo está por debajo del 75% de la longitud mínima.");
  } else {
    strengths.push("Longitud aceptable.");
  }

  if (hasPromptLeak(text)) {
    score -= 3;
    issues.push("El capítulo contiene instrucciones internas o fuga de prompt.");
  }

  const h3Count = (text.match(/^###\s+/gm) || []).length;

  if ((args.expectedSubheads || []).length >= 5 && h3Count < 3) {
    score -= 1.5;
    issues.push("El capítulo no usa suficientes subtítulos internos.");
  } else if (h3Count >= 3) {
    strengths.push("Usa subtítulos internos.");
  }

  if (/bibliograf[ií]a|referencias|fuentes consultadas/i.test(text)) {
    score -= 0.8;
    issues.push("Incluye bibliografía dentro del capítulo.");
  }

  if (args.factualMode) {
    const suspicious = [
      /\b\d{1,2}\.\d{1,2}%\b/g,
      /\bseg[uú]n estudios\b/gi,
      /\bexpertos aseguran\b/gi,
      /\bse dice que\b/gi,
      /\bfue demostrado\b/gi,
    ];

    let suspiciousCount = 0;

    for (const re of suspicious) {
      suspiciousCount += (text.match(re) || []).length;
    }

    if (suspiciousCount >= 3) {
      score -= 1.5;
      issues.push("Hay varias afirmaciones con riesgo de falsa precisión o falta de fuente.");
    }
  }

  const repeatedParagraphs = new Map<string, number>();

  for (const paragraph of text.split(/\n{2,}/)) {
    const key = paragraph.replace(/\s+/g, " ").trim().slice(0, 160);

    if (key.length < 80) continue;

    repeatedParagraphs.set(key, (repeatedParagraphs.get(key) || 0) + 1);
  }

  const duplicates = [...repeatedParagraphs.values()].filter((x) => x > 1).length;

  if (duplicates > 0) {
    score -= Math.min(2, duplicates * 0.5);
    issues.push("Hay párrafos repetidos o muy similares.");
  }

  const finalScore = clamp(score);

  return {
    score: finalScore,
    label: label(finalScore),
    issues,
    strengths,
    mustRewrite: finalScore < 7.5,
  };
}

export function scoreEliteProject(project: any): EliteQualityResult {
  const state = project?.state || project || {};
  const titleResult = scoreEliteTitle(
    state.book_title || state.bookTitle || project?.title || "",
    state.book_subtitle || state.bookSubtitle || ""
  );

  const outlineResult = scoreEliteOutline(
    Array.isArray(state.outline_12) ? state.outline_12 : []
  );

  const score = clamp((titleResult.score * 0.35) + (outlineResult.score * 0.65));

  return {
    score,
    label: label(score),
    issues: [...titleResult.issues, ...outlineResult.issues],
    strengths: [...titleResult.strengths, ...outlineResult.strengths],
    mustRewrite: score < 7.5,
  };
}
`;

write(path.join(ROOT, "src", "lib", "elite", "elite-quality-gate.ts"), eliteQualityGate);

/* =========================================================
   3. MÓDULO: RESEARCH CONTRACT ELITE
   ========================================================= */

const eliteResearchContract = String.raw`
export type EliteResearchSource = {
  id?: string;
  title?: string;
  url?: string;
  author?: string;
  publisher?: string;
  published_at?: string;
  source_type?: string;
  reliability_score?: number;
  extracted_text?: string;
};

export type EliteResearchFact = {
  claim: string;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "DISPUTED" | "UNVERIFIED" | "REJECTED";
  confidence?: number;
  source_titles?: string[];
  notes?: string;
};

export function compactResearchForPrompt(args: {
  sources?: EliteResearchSource[];
  facts?: EliteResearchFact[];
  maxChars?: number;
}): string {
  const maxChars = Math.max(5000, Number(args.maxChars || 30000) || 30000);
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const facts = Array.isArray(args.facts) ? args.facts : [];

  const lines: string[] = [];

  lines.push("EXPEDIENTE DE INVESTIGACIÓN ELITE");
  lines.push("");

  if (sources.length) {
    lines.push("FUENTES:");
    for (const source of sources.slice(0, 30)) {
      lines.push("- " + [
        source.title || "Sin título",
        source.publisher ? "Entidad: " + source.publisher : "",
        source.author ? "Autor: " + source.author : "",
        source.published_at ? "Fecha: " + source.published_at : "",
        source.source_type ? "Tipo: " + source.source_type : "",
        typeof source.reliability_score === "number" ? "Confiabilidad: " + source.reliability_score + "/10" : "",
        source.url ? "URL: " + source.url : "",
      ].filter(Boolean).join(" | "));
    }
    lines.push("");
  }

  if (facts.length) {
    lines.push("HECHOS Y AFIRMACIONES:");
    for (const fact of facts.slice(0, 80)) {
      lines.push("- [" + fact.status + "] " + fact.claim);
      if (typeof fact.confidence === "number") {
        lines.push("  Confianza: " + fact.confidence);
      }
      if (fact.source_titles?.length) {
        lines.push("  Fuentes: " + fact.source_titles.join("; "));
      }
      if (fact.notes) {
        lines.push("  Notas: " + fact.notes);
      }
    }
    lines.push("");
  }

  if (!sources.length && !facts.length) {
    lines.push("No hay fuentes ni hechos verificados adjuntos.");
    lines.push("El modelo debe trabajar con prudencia y no inventar datos.");
  }

  return lines.join("\n").slice(0, maxChars);
}

export const ELITE_RESEARCH_STATUS = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "DISPUTED",
  "UNVERIFIED",
  "REJECTED",
] as const;

export function sourceReliabilityHint(source: EliteResearchSource): string {
  const type = String(source.source_type || "").toLowerCase();

  if (/official|oficial|government|gobierno|ley|sentencia|court|statistics|estad[ií]stica/.test(type)) {
    return "Alta prioridad: fuente primaria u oficial.";
  }

  if (/academic|paper|journal|universidad|research|libro/.test(type)) {
    return "Alta prioridad: fuente académica o bibliográfica.";
  }

  if (/news|period[ií]stico|media|periódico|prensa/.test(type)) {
    return "Media prioridad: fuente periodística.";
  }

  if (/blog|social|youtube|facebook|instagram|tiktok/.test(type)) {
    return "Baja prioridad factual: útil para percepción pública, no como prueba principal.";
  }

  return "Prioridad pendiente de clasificación.";
}
`;

write(path.join(ROOT, "src", "lib", "elite", "elite-research-contract.ts"), eliteResearchContract);

/* =========================================================
   4. MÓDULO: BLUEPRINT NORMALIZER
   ========================================================= */

const eliteBlueprintNormalizer = String.raw`
function asText(value: unknown, fallback = ""): string {
  const out = String(value ?? "").replace(/\s+/g, " ").trim();
  return out || fallback;
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function cleanTitle(value: unknown, fallback: string): string {
  let out = asText(value, fallback)
    .replace(/^cap[ií]tulo\s+\d+\s*[:\-–—.]?\s*/i, "")
    .replace(/\b(act[uú]a como|eres un escritor|prompt|requisitos|objetivo general)\b[\s\S]*$/i, "")
    .trim();

  if (!out) out = fallback;

  if (out.length > 120) {
    out = out.slice(0, 117).replace(/\s+\S*$/, "").trim() + "...";
  }

  return out;
}

export function normalizeEliteBlueprint(raw: any, fallback: {
  title: string;
  topic: string;
  chapterCount: number;
  targetWords: number;
}) {
  const state = raw?.project_state_updated || raw?.state || raw || {};
  const dashboard = raw?.dashboard || {};

  const title = cleanTitle(
    state.book_title || dashboard.book_title || fallback.title,
    fallback.title || "Nuevo libro"
  );

  const subtitle = cleanTitle(
    state.book_subtitle || dashboard.book_subtitle || "",
    ""
  );

  const blueprint = state.editorial_blueprint || {};

  const outlineInput = asArray<any>(state.outline_12);
  const count = Math.max(1, Math.min(120, Number(fallback.chapterCount || outlineInput.length || 12) || 12));

  const outline = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const found = outlineInput.find((x) => Number(x?.chapter_number || 0) === n) || outlineInput[index] || {};

    return {
      id: asText(found.id, "outline_" + String(n).padStart(2, "0")),
      chapter_number: n,
      chapter_title: cleanTitle(found.chapter_title || found.title, "Capítulo " + n),
      chapter_thesis: asText(found.chapter_thesis || found.thesis, ""),
      objective: asText(found.objective, ""),
      key_points: asArray(found.key_points).map(String).filter(Boolean).slice(0, 12),
      subheads_h2: asArray(found.subheads_h2).map(String).filter(Boolean).slice(0, 10),
      required_facts: asArray(found.required_facts).map(String).filter(Boolean).slice(0, 12),
      source_needs: asArray(found.source_needs).map(String).filter(Boolean).slice(0, 12),
      risk_of_hallucination: asText(found.risk_of_hallucination, ""),
      transition_to_next: asText(found.transition_to_next, ""),
      target_words: Math.max(800, Number(found.target_words || fallback.targetWords || 3000) || 3000),
      status: asText(found.status, "PENDING"),
    };
  });

  return {
    ok: true,
    dashboard: {
      ...dashboard,
      book_title: title,
      book_subtitle: subtitle,
      domain: asText(dashboard.domain || state.domain, ""),
    },
    project_state_updated: {
      ...state,
      book_title: title,
      bookTitle: title,
      book_subtitle: subtitle,
      bookSubtitle: subtitle,
      book_topic: asText(state.book_topic || fallback.topic, fallback.topic),
      editorial_blueprint: {
        title_candidates: asArray(blueprint.title_candidates).map(String).filter(Boolean).slice(0, 5),
        subtitle_candidates: asArray(blueprint.subtitle_candidates).map(String).filter(Boolean).slice(0, 5),
        winning_title_reason: asText(blueprint.winning_title_reason, ""),
        central_thesis: asText(blueprint.central_thesis, ""),
        reader_promise: asText(blueprint.reader_promise, ""),
        audience: asText(blueprint.audience, ""),
        tone: asText(blueprint.tone, ""),
        factual_risk_level: asText(blueprint.factual_risk_level, ""),
        research_needs: asArray(blueprint.research_needs).map(String).filter(Boolean).slice(0, 20),
        source_priorities: asArray(blueprint.source_priorities).map(String).filter(Boolean).slice(0, 20),
        forbidden_claims_without_source: asArray(blueprint.forbidden_claims_without_source).map(String).filter(Boolean).slice(0, 20),
      },
      outline_12: outline,
    },
    master_document: {
      title,
      text: "",
    },
    needs_input: null,
  };
}
`;

write(path.join(ROOT, "src", "lib", "elite", "elite-blueprint-normalizer.ts"), eliteBlueprintNormalizer);

/* =========================================================
   5. SQL: RESEARCH SCHEMA
   ========================================================= */

const eliteResearchSql = String.raw`
-- sql/elite-research-schema.sql
-- Capa Elite para investigación real, fuentes, hechos y quality gate.

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text,
  url text,
  author text,
  publisher text,
  source_type text,
  published_at timestamptz,
  extracted_text text,
  summary text,
  reliability_score numeric check (reliability_score is null or (reliability_score >= 1 and reliability_score <= 10)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.research_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  claim text not null,
  status text not null default 'UNVERIFIED' check (
    status in ('VERIFIED', 'PARTIALLY_VERIFIED', 'DISPUTED', 'UNVERIFIED', 'REJECTED')
  ),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.chapter_quality_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  score numeric not null check (score >= 1 and score <= 10),
  status text not null default 'PENDING_REVIEW',
  factual_risks jsonb not null default '[]'::jsonb,
  unsupported_claims jsonb not null default '[]'::jsonb,
  rewrite_instructions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_sources_project_id
on public.research_sources(project_id);

create index if not exists idx_research_facts_project_id
on public.research_facts(project_id);

create index if not exists idx_chapter_quality_project_chapter
on public.chapter_quality_reports(project_id, chapter_number);

alter table public.research_sources enable row level security;
alter table public.research_facts enable row level security;
alter table public.chapter_quality_reports enable row level security;

drop policy if exists "research_sources_select_own" on public.research_sources;
create policy "research_sources_select_own"
on public.research_sources
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = research_sources.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "research_facts_select_own" on public.research_facts;
create policy "research_facts_select_own"
on public.research_facts
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = research_facts.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "chapter_quality_reports_select_own" on public.chapter_quality_reports;
create policy "chapter_quality_reports_select_own"
on public.chapter_quality_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = chapter_quality_reports.project_id
      and p.user_id = auth.uid()
  )
);
`;

write(path.join(ROOT, "sql", "elite-research-schema.sql"), eliteResearchSql);

/* =========================================================
   6. EVALUADOR ELITE
   ========================================================= */

const eliteEvaluator = String.raw`
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const files = {
  app: "App.tsx",
  gemini: "src/lib/gemini.ts",
  composer: "api/composer.ts",
  promptBank: "src/lib/elite/elite-prompt-bank.ts",
  qualityGate: "src/lib/elite/elite-quality-gate.ts",
  research: "src/lib/elite/elite-research-contract.ts",
  normalizer: "src/lib/elite/elite-blueprint-normalizer.ts",
  sql: "sql/elite-research-schema.sql",
};

function read(file) {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function has(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

function scoreItem(pass, points) {
  return pass ? points : 0;
}

const content = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)])
);

const all = Object.values(content).join("\n");

const areas = [
  {
    name: "Blueprint editorial",
    score:
      1 +
      scoreItem(has(all, "buildEliteBlueprintPrompt"), 2) +
      scoreItem(has(all, "editorial_blueprint"), 2) +
      scoreItem(has(all, "title_candidates"), 1.5) +
      scoreItem(has(all, "subtitle_candidates"), 1.5) +
      scoreItem(has(all, "subheads_h2"), 1) +
      scoreItem(has(all, "required_facts"), 1),
  },
  {
    name: "Control factual",
    score:
      1 +
      scoreItem(has(all, "buildEliteFactualRules"), 2) +
      scoreItem(has(all, "No inventes"), 1.5) +
      scoreItem(has(all, "VERIFIED"), 1.5) +
      scoreItem(has(all, "unsupported_claims"), 1.5) +
      scoreItem(has(all, "possible_hallucinations"), 1.5),
  },
  {
    name: "Investigación real",
    score:
      1 +
      scoreItem(has(all, "research_sources"), 2) +
      scoreItem(has(all, "research_facts"), 2) +
      scoreItem(has(all, "reliability_score"), 1.5) +
      scoreItem(has(all, "compactResearchForPrompt"), 1.5) +
      scoreItem(has(all, "source_type"), 1),
  },
  {
    name: "Quality gate",
    score:
      1 +
      scoreItem(has(all, "scoreEliteTitle"), 2) +
      scoreItem(has(all, "scoreEliteOutline"), 2) +
      scoreItem(has(all, "scoreEliteChapterText"), 2) +
      scoreItem(has(all, "mustRewrite"), 1.5) +
      scoreItem(has(all, "scoreEliteProject"), 1.5),
  },
  {
    name: "Prompts por género",
    score:
      1 +
      scoreItem(has(all, "detectEliteDomain"), 2) +
      scoreItem(has(all, "HISTORY"), 1) +
      scoreItem(has(all, "BIOGRAPHY"), 1) +
      scoreItem(has(all, "FINANCE"), 1) +
      scoreItem(has(all, "POLITICS"), 1) +
      scoreItem(has(all, "RELIGION"), 1) +
      scoreItem(has(all, "FICTION"), 1),
  },
];

for (const area of areas) {
  area.score = Math.max(1, Math.min(10, Number(area.score.toFixed(1))));
}

const overall = Number(
  (
    areas.reduce((sum, area) => sum + area.score, 0) /
    areas.length
  ).toFixed(1)
);

const label =
  overall >= 9 ? "EXCELENTE" :
  overall >= 8 ? "MUY BUENO" :
  overall >= 7 ? "BUENO" :
  overall >= 6 ? "ACEPTABLE" :
  overall >= 5 ? "DÉBIL" :
  "CRÍTICO";

console.log("");
console.log("==============================================");
console.log("EVALUACIÓN ELITE BESTSELLER");
console.log("==============================================");
console.log("Puntuación:", overall + "/10", "-", label);
console.log("");

for (const area of areas) {
  console.log(area.name + ":", area.score + "/10");
}

console.log("");
console.log("Dictamen:");
if (overall >= 8.5) {
  console.log("La capa Elite está instalada. El próximo salto es integrar investigación web real y fact-check automático en el flujo vivo.");
} else {
  console.log("La capa Elite existe parcialmente. Revisa los módulos faltantes y conecta la capa con App.tsx/gemini.ts/composer.ts.");
}
console.log("");
`;

write(path.join(ROOT, "scripts", "evaluate-elite-system.mjs"), eliteEvaluator);

/* =========================================================
   7. PATCH PACKAGE.JSON
   ========================================================= */

if (exists(FILES.packageJson)) {
  backup(FILES.packageJson);

  const pkg = JSON.parse(read(FILES.packageJson));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts["elite:evaluate"] = "node scripts/evaluate-elite-system.mjs";
  pkg.scripts["elite:build"] = "node scripts/evaluate-elite-system.mjs && npm run build";

  fs.writeFileSync(FILES.packageJson, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log("✅ package.json actualizado con scripts Elite.");
}

/* =========================================================
   8. PATCH APP PROMPT
   ========================================================= */

patchFile(
  FILES.app,
  (code) => {
    if (code.includes("ELITE_BLUEPRINT_SYSTEM_V1")) return code;

    const needle = '  "CALIDAD:",';

    const injection = [
      '  "ELITE_BLUEPRINT_SYSTEM_V1:",',
      '  "- Antes de redactar, exige título, subtítulo, tesis central, promesa editorial, audiencia, género y estrategia factual.",',
      '  "- Cada capítulo debe tener chapter_title, chapter_thesis, objective, key_points, subheads_h2, required_facts, source_needs y transition_to_next.",',
      '  "- Los subtítulos internos subheads_h2 son obligatorios: mínimo 5 y máximo 10 por capítulo.",',
      '  "- Prohibido usar títulos genéricos como Panorama general, Conceptos clave o Desarrollo editorial salvo emergencia absoluta.",',
      '  "- En historia, biografía, finanzas y política, prioriza precisión, contexto y límites de evidencia sobre espectacularidad.",',
      '  "",',
    ].join("\n");

    if (code.includes(needle)) {
      return code.replace(needle, injection + "\n" + needle);
    }

    return code + "\n\n// ELITE_BLUEPRINT_SYSTEM_V1 pendiente de integración manual.\n";
  },
  "App.tsx prompt Elite"
);

/* =========================================================
   9. PATCH GEMINI PROMPTS
   ========================================================= */

patchFile(
  FILES.gemini,
  (code) => {
    if (code.includes("ELITE_GENERATION_RULES_V1")) return code;

    let next = code;

    const phrase = "- No termines a mitad de frase.";

    if (next.includes(phrase)) {
      next = next.split(phrase).join(
        [
          phrase,
          "- ELITE_GENERATION_RULES_V1: usa subtítulos internos cuando existan en subheads_h2.",
          "- Cada sección debe aportar análisis, contexto, datos prudentes, consecuencias y profundidad.",
          "- No inventes datos para llenar palabras.",
          "- Si falta evidencia, explica los límites de la evidencia.",
          "- Evita títulos genéricos, repeticiones y relleno."
        ].join("\n")
      );
    } else {
      next += "\n\n// ELITE_GENERATION_RULES_V1 pendiente de integración manual.\n";
    }

    return next;
  },
  "src/lib/gemini.ts reglas Elite"
);

/* =========================================================
   10. PATCH COMPOSER PROMPT
   ========================================================= */

patchFile(
  FILES.composer,
  (code) => {
    if (code.includes("ELITE_API_RULES_V1")) return code;

    let next = code;

    const factualNeedle = "'REGLAS FACTUALES:',";

    if (next.includes(factualNeedle)) {
      next = next.replace(
        factualNeedle,
        [
          "'REGLAS FACTUALES ELITE:',",
          "'- ELITE_API_RULES_V1: no inventes hechos, fechas, cifras, citas ni fuentes.',",
          "'- Usa subtítulos internos, tesis de capítulo, puntos clave y datos requeridos cuando estén disponibles.',",
          "'- Si no hay research_context, reduce certeza y evita detalles falsamente específicos.',",
          "'- Todo capítulo debe tener análisis, contexto, consecuencias, contradicciones y límites de evidencia.',"
        ].join("\n    ")
      );
    } else {
      const marker = "Forma:";

      if (next.includes(marker)) {
        next = next.replace(
          marker,
          [
            "ELITE_API_RULES_V1:",
            "- Exige blueprint editorial con título, subtítulo, tesis, capítulos, subtítulos internos y datos requeridos.",
            "- No inventes fuentes ni datos.",
            "- No escribas capítulos completos dentro del dossier.",
            "",
            marker
          ].join("\n")
        );
      } else {
        next += "\n\n// ELITE_API_RULES_V1 pendiente de integración manual.\n";
      }
    }

    return next;
  },
  "api/composer.ts reglas Elite"
);

/* =========================================================
   11. RESULTADO
   ========================================================= */

console.log("");
console.log("==============================================");
console.log("✅ BESTSELLER ELITE INSTALADO");
console.log("==============================================");
console.log("");
console.log("Módulos creados:");
console.log("- src/lib/elite/elite-prompt-bank.ts");
console.log("- src/lib/elite/elite-quality-gate.ts");
console.log("- src/lib/elite/elite-research-contract.ts");
console.log("- src/lib/elite/elite-blueprint-normalizer.ts");
console.log("- sql/elite-research-schema.sql");
console.log("- scripts/evaluate-elite-system.mjs");
console.log("");
console.log("Comandos sugeridos:");
console.log("npm run elite:evaluate");
console.log("npm run build");
console.log("");

if (RUN_BUILD) {
  console.log("Ejecutando build...");
  try {
    const out = execSync("npm run build", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 120000,
    });

    console.log(out);
    console.log("✅ Build completado.");
  } catch (error) {
    console.error("❌ Build falló.");
    console.error(String(error?.stdout || ""));
    console.error(String(error?.stderr || ""));
    process.exit(1);
  }
}
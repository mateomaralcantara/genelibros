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

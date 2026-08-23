// scripts/upgrade-factual-prompts.mjs
//
// Refuerza los prompts para:
// - historia;
// - biografías y personajes;
// - finanzas y economía;
// - política y sociedad;
// - reducción de datos inventados;
// - separación entre hechos, inferencias y controversias;
// - uso de research_context cuando exista.
//
// Modifica:
// - App.tsx
// - src/lib/gemini.ts
// - api/composer.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = {
  app: path.join(ROOT, "App.tsx"),
  gemini: path.join(ROOT, "src", "lib", "gemini.ts"),
  composer: path.join(ROOT, "api", "composer.ts"),
};

function assertFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`No existe el archivo: ${file}`);
  }
}

function backup(file) {
  const target = `${file}.bak_factual_prompts`;
  fs.copyFileSync(file, target);
  console.log(`✅ Backup: ${target}`);
}

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);

  if (start < 0) {
    throw new Error(`No encontré el marcador inicial: ${startMarker}`);
  }

  const end = source.indexOf(endMarker, start);

  if (end < 0) {
    throw new Error(`No encontré el marcador final: ${endMarker}`);
  }

  return (
    source.slice(0, start) +
    replacement +
    source.slice(end + endMarker.length)
  );
}

function patchApp() {
  const file = FILES.app;
  assertFile(file);
  backup(file);

  let code = fs.readFileSync(file, "utf8");

  const prompt = `const DEV_SYSTEM_PROMPT = [
  "Eres BOOK_DOSSIER_CANVAS_ENGINE (BestSeller), un motor editorial especializado en libros de no ficción rigurosos.",
  "",
  "IDIOMA: Español neutro.",
  "OBJETIVO: Crear y editar libros profundos, coherentes, analíticos y factualizados.",
  "",
  "PRINCIPIO DE VERACIDAD:",
  "- Nunca presentes como hecho una información no respaldada por el contexto disponible.",
  "- No inventes fechas, cifras, porcentajes, cargos, relaciones, premios, leyes, instituciones, estudios, citas, declaraciones, documentos, fuentes ni acontecimientos.",
  "- Si un dato no está respaldado, omítelo, exprésalo como hipótesis o indícalo como pendiente de verificación.",
  "- No uses una cifra exacta cuando solo dispones de una estimación.",
  "- No conviertas rumores, publicaciones virales o versiones interesadas en hechos confirmados.",
  "",
  "CLASIFICACIÓN INTERNA DE INFORMACIÓN:",
  "- HECHO CONFIRMADO: respaldado por fuentes o contexto proporcionado.",
  "- INFERENCIA: conclusión razonable derivada de hechos conocidos.",
  "- INTERPRETACIÓN: lectura analítica del autor.",
  "- CONTROVERSIA: existen versiones contradictorias.",
  "- NO VERIFICADO: no debe presentarse como hecho.",
  "",
  "JERARQUÍA DE FUENTES:",
  "- Prioriza documentos oficiales, registros públicos, leyes, sentencias, estadísticas institucionales, archivos históricos, publicaciones académicas, entrevistas directas y medios reconocidos.",
  "- Usa redes sociales, videos y blogs solo como evidencia de discurso público o percepción, no como comprobación automática.",
  "",
  "LIBROS HISTÓRICOS:",
  "- Incluye cronología, antecedentes, contexto político, económico, social y cultural.",
  "- Explica causas, actores, consecuencias, cambios y controversias historiográficas.",
  "- Evita anacronismos y presentismo.",
  "- Distingue los hechos documentados de las interpretaciones posteriores.",
  "",
  "LIBROS SOBRE PERSONAJES:",
  "- Distingue trayectoria comprobada, imagen pública, controversias verificadas y rumores.",
  "- No inventes pensamientos, conversaciones, emociones, motivaciones privadas ni escenas no documentadas.",
  "- No fabriques citas textuales.",
  "- Usa fórmulas como 'los hechos sugieren', 'puede interpretarse' o 'según sus declaraciones públicas' cuando hagas inferencias.",
  "",
  "FINANZAS Y ECONOMÍA:",
  "- Toda cifra debe indicar, cuando sea posible: año, moneda, país, período y naturaleza de la cifra.",
  "- Distingue ingreso, beneficio, patrimonio, valoración, deuda, flujo de caja, rentabilidad y proyección.",
  "- No presentes proyecciones como garantías.",
  "- Expón supuestos, riesgos, escenarios y límites metodológicos.",
  "",
  "ANÁLISIS:",
  "- No te limites a enumerar hechos.",
  "- Analiza causas, incentivos, intereses, relaciones de poder, contradicciones, consecuencias, impactos y escenarios.",
  "- Cada capítulo debe explicar qué ocurrió, por qué, quiénes participaron, qué evidencia existe y qué permanece discutido.",
  "",
  "CONTROL DE ALUCINACIONES:",
  "- No rellenes vacíos con información inventada para alcanzar una cantidad de palabras.",
  "- Para aumentar profundidad usa contexto, comparación, antecedentes, explicación conceptual, consecuencias y escenarios.",
  "- Elimina afirmaciones dudosas o no respaldadas.",
  "- No inventes bibliografía ni enlaces.",
  "",
  "SALIDA PARA BUILD_FULL_DOSSIER:",
  "- Responde únicamente con un objeto JSON válido.",
  "- Prohibido Markdown fuera del JSON, bloques de código, comentarios o texto adicional.",
  "",
  "FORMA MÍNIMA:",
  '{ "ok": true, "dashboard": {}, "project_state_updated": {}, "master_document": { "title": "", "text": "" } }',
  "",
  "REGLAS EDITORIALES:",
  "- No insertes instrucciones internas: 'Actúa como', 'Eres un escritor', 'Objetivo del capítulo', 'Requisitos', 'Prompt' ni similares.",
  "- Los encabezados deben ser naturales: 'Capítulo 1. Título del capítulo'.",
  "- La aplicación imprime los títulos; no los repitas al inicio del contenido.",
  "- No uses HTML, colores, estilos inline ni marcas visuales.",
  "- No uses placeholders como TBD o puntos suspensivos para fingir contenido.",
  "",
  "BIBLIOGRAFÍA:",
  "- No coloques bibliografía completa dentro de cada capítulo.",
  "- La bibliografía solo se incluye cuando el usuario la pide o el libro es histórico, académico, investigativo, biográfico o documental.",
  "- Cuando corresponda, debe reunirse en una sola sección final.",
  "- No fabriques autores, títulos, editoriales, fechas, DOI, ISBN ni enlaces.",
  "",
  "PATCH SEGURO:",
  "- GENERATE_CHAPTER actualiza solamente el capítulo solicitado.",
  "- GENERATE_PROPOSAL actualiza solamente proposal.",
  "- GENERATE_INTRODUCTION actualiza solamente introduction.",
  "- No borres contenido de otras secciones.",
  "",
  "CAPÍTULOS:",
  "- Respeta el número total de capítulos solicitado.",
  "- Conserva títulos explícitos proporcionados por el usuario.",
  "- Los títulos deben ser breves, claros y editoriales.",
  "",
  "CALIDAD:",
  "- Contenido denso, concreto, ordenado y narrativamente legible.",
  "- Termina con frases completas.",
  "- Prioriza precisión sobre espectacularidad.",
].join("\\n");`;

  code = replaceBetween(
    code,
    "const DEV_SYSTEM_PROMPT = [",
    '].join("\\n");',
    prompt
  );

  fs.writeFileSync(file, code, "utf8");
  console.log("✅ App.tsx: prompt maestro actualizado.");
}

function patchGemini() {
  const file = FILES.gemini;
  assertFile(file);
  backup(file);

  let code = fs.readFileSync(file, "utf8");

  const helperMarker = "function detectEditorialDomain";

  const helpers = `
type EditorialDomain =
  | "HISTORY"
  | "BIOGRAPHY"
  | "FINANCE"
  | "POLITICS"
  | "GENERAL_NONFICTION"
  | "FICTION";

function detectEditorialDomain(state: any): EditorialDomain {
  const raw = [
    state?.book_title,
    state?.bookTitle,
    state?.book_topic,
    state?.bookTopic,
    state?.category,
    state?.genre,
    state?.tone_style,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/novela|ficci[oó]n|cuento|thriller|romance|terror|fantas[ií]a/.test(raw)) {
    return "FICTION";
  }

  if (/historia|hist[oó]rico|cronolog[ií]a|archivo|origen|evoluci[oó]n|siglo|guerra|dictadura/.test(raw)) {
    return "HISTORY";
  }

  if (/biograf[ií]a|trayectoria|personaje|comunicador|artista|pol[ií]tico|empresario|vida de/.test(raw)) {
    return "BIOGRAPHY";
  }

  if (/finanzas|econom[ií]a|inversi[oó]n|dinero|riqueza|mercado|empresa|deuda|rentabilidad|patrimonio/.test(raw)) {
    return "FINANCE";
  }

  if (/pol[ií]tica|gobierno|estado|elecciones|poder|partido|sociedad|institucional/.test(raw)) {
    return "POLITICS";
  }

  return "GENERAL_NONFICTION";
}

function getResearchContext(state: any): string {
  const candidates = [
    state?.research_context,
    state?.researchContext,
    state?.research_pack,
    state?.researchPack,
    state?.verified_facts,
    state?.verifiedFacts,
    state?.sources_summary,
    state?.sourcesSummary,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 30000);
    }

    if (value && typeof value === "object") {
      try {
        const serialized = JSON.stringify(value);
        if (serialized.length > 2) return serialized.slice(0, 30000);
      } catch {
        // Ignorar contexto no serializable.
      }
    }
  }

  return "";
}

function buildFactualRules(state: any): string {
  const domain = detectEditorialDomain(state);
  const researchContext = getResearchContext(state);

  const common = [
    "DISCIPLINA FACTUAL:",
    "- No inventes fechas, cifras, porcentajes, citas, cargos, premios, instituciones, leyes, estudios, fuentes ni acontecimientos.",
    "- Distingue hechos confirmados, inferencias, interpretaciones, controversias y datos no verificados.",
    "- Si no puedes respaldar un dato, omítelo o preséntalo explícitamente como hipótesis.",
    "- No fabriques citas textuales ni bibliografía.",
    "- No uses precisión falsa.",
    "- No rellenes extensión con repeticiones ni datos dudosos.",
    "- Profundiza mediante causas, contexto, comparación, consecuencias, contradicciones e impactos.",
  ];

  const domainRules: Record<EditorialDomain, string[]> = {
    HISTORY: [
      "REGLAS PARA HISTORIA:",
      "- Construye cronología, antecedentes, causas, actores, consecuencias y contexto de época.",
      "- Evita anacronismos y presentismo.",
      "- Señala versiones contradictorias cuando existan.",
      "- No conviertas una interpretación histórica en hecho incontrovertible.",
    ],
    BIOGRAPHY: [
      "REGLAS PARA PERSONAJES:",
      "- Separa trayectoria comprobada, imagen pública, controversias verificadas y rumores.",
      "- No inventes pensamientos, escenas privadas, conversaciones ni motivaciones internas.",
      "- No atribuyas relaciones, trabajos o polémicas sin respaldo.",
      "- Usa lenguaje de inferencia cuando analices motivaciones.",
    ],
    FINANCE: [
      "REGLAS PARA FINANZAS:",
      "- Toda cifra debe indicar año, moneda, país o período cuando esté disponible.",
      "- Distingue ingreso, beneficio, patrimonio, valoración, deuda, flujo de caja y proyección.",
      "- Expón supuestos, riesgos, límites y escenarios.",
      "- No presentes rendimientos futuros como garantías.",
    ],
    POLITICS: [
      "REGLAS PARA POLÍTICA Y SOCIEDAD:",
      "- Diferencia hechos institucionales, discursos, acusaciones y opiniones.",
      "- Explica actores, intereses, incentivos, correlaciones de fuerza y consecuencias.",
      "- No atribuyas delitos, intenciones o responsabilidades sin respaldo.",
    ],
    GENERAL_NONFICTION: [
      "REGLAS PARA NO FICCIÓN:",
      "- Prioriza precisión, explicación, ejemplos plausibles y análisis.",
      "- No conviertas ejemplos hipotéticos en sucesos reales.",
    ],
    FICTION: [
      "REGLAS PARA FICCIÓN:",
      "- La creatividad está permitida, pero no presentes elementos ficticios como hechos reales.",
      "- Si usas personajes reales, evita atribuirles delitos, pensamientos o actos no documentados.",
    ],
  };

  const research = researchContext
    ? [
        "",
        "EXPEDIENTE DE INVESTIGACIÓN DISPONIBLE:",
        researchContext,
        "",
        "Usa el expediente anterior como base factual prioritaria.",
        "No contradigas ese expediente sin explicar la discrepancia.",
      ]
    : [
        "",
        "NO HAY EXPEDIENTE DE INVESTIGACIÓN ADJUNTO.",
        "No afirmes que realizaste búsquedas web, scraping o consulta de fuentes externas.",
        "Reduce el nivel de certeza cuando falte respaldo.",
      ];

  return [...common, "", ...domainRules[domain], ...research].join("\\n");
}
`;

  if (!code.includes(helperMarker)) {
    const marker = "function buildPlainPrompt";

    const index = code.indexOf(marker);

    if (index < 0) {
      throw new Error("No encontré function buildPlainPrompt en gemini.ts");
    }

    code = code.slice(0, index) + helpers + "\\n" + code.slice(index);
  }

  const targetLine =
    '  const targetWords = Math.max(800, Math.floor(Number((task as any)?.target_length_words ?? 0) || 0));';

  if (!code.includes("const factualRules = buildFactualRules(state);")) {
    if (!code.includes(targetLine)) {
      throw new Error("No encontré targetWords dentro de buildPlainPrompt");
    }

    code = code.replace(
      targetLine,
      `${targetLine}
  const factualRules = buildFactualRules(state);`
    );
  }

  const anchors = [
    `- No escribas "Propuesta editorial" como encabezado.
`,
    `- No escribas "Introducción" como encabezado.
`,
    `- No termines a mitad de frase.
`.trim(),
  ];

  code = code.replace(
    `- No escribas "Propuesta editorial" como encabezado.
`.trim(),
    `- No escribas "Propuesta editorial" como encabezado.

\${factualRules}`.trim()
  );

  code = code.replace(
    `- No escribas "Introducción" como encabezado.
`.trim(),
    `- No escribas "Introducción" como encabezado.

\${factualRules}`.trim()
  );

  const chapterNeedle = `- Nada de placeholders.
- No termines a mitad de frase.
`.trim();

  const chapterReplacement = `- Nada de placeholders.
- No termines a mitad de frase.
- No incluyas bloques de bibliografía dentro del capítulo.
- Cuando menciones cifras o hechos específicos, contextualízalos.
- Separa claramente hechos, inferencias e interpretación.

\${factualRules}`.trim();

  const lastIndex = code.lastIndexOf(chapterNeedle);

  if (lastIndex >= 0) {
    code =
      code.slice(0, lastIndex) +
      chapterReplacement +
      code.slice(lastIndex + chapterNeedle.length);
  }

  // Reduce temperatura en libros factuales.
  code = code.replace(
    `temperature: action === "GENERATE_CHAPTER" ? 0.82 : 0.68,`,
    `temperature:
      detectEditorialDomain(opts.state) === "FICTION"
        ? action === "GENERATE_CHAPTER" ? 0.82 : 0.68
        : action === "GENERATE_CHAPTER" ? 0.48 : 0.38,`
  );

  code = code.replace(
    `temperature: action === "GENERATE_CHAPTER" ? 0.82 : 0.68,`,
    `temperature:
      detectEditorialDomain(opts.state) === "FICTION"
        ? action === "GENERATE_CHAPTER" ? 0.82 : 0.68
        : action === "GENERATE_CHAPTER" ? 0.48 : 0.38,`
  );

  fs.writeFileSync(file, code, "utf8");
  console.log("✅ src/lib/gemini.ts: prompts factuales y reglas por género agregados.");
}

function patchComposer() {
  const file = FILES.composer;
  assertFile(file);
  backup(file);

  let code = fs.readFileSync(file, "utf8");

  const systemPrompt = `const SYSTEM_PROMPT = \`Eres BOOK_DOSSIER_CANVAS_ENGINE, un motor editorial factual para libros de no ficción.

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
\`.trim();`;

  code = replaceBetween(
    code,
    "const SYSTEM_PROMPT = `",
    "`.trim();",
    systemPrompt
  );

  fs.writeFileSync(file, code, "utf8");
  console.log("✅ api/composer.ts: prompt factual actualizado.");
}

try {
  patchApp();
  patchGemini();
  patchComposer();

  console.log("");
  console.log("✅ Prompts actualizados.");
  console.log("Ahora ejecuta:");
  console.log("npm run build");
} catch (error) {
  console.error("");
  console.error("❌ No se completó el parche:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
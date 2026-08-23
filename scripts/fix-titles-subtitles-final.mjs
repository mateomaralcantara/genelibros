// scripts/fix-titles-subtitles-final.mjs
//
// Corrige definitivamente:
// 1. El título "Nuevo libro" o "Libro sin título".
// 2. La pérdida de títulos de capítulos.
// 3. La pérdida de subtítulos explícitos escritos por el usuario.
// 4. El uso incorrecto de cleanOutlineContext como fuente del esquema.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "App.tsx");

if (!fs.existsSync(FILE)) {
  console.error("❌ No existe App.tsx en:", ROOT);
  process.exit(1);
}

const BACKUP = `${FILE}.bak_titles_subtitles_final`;
fs.copyFileSync(FILE, BACKUP);

let code = fs.readFileSync(FILE, "utf8");
let changes = 0;

/* =========================================================
   1. CORREGIR cleanSeedForOutlineContext
   ========================================================= */

const oldPlaceholderCheck = `  const titled = extractBookTitleFromIdea(seed);
  if (titled !== "Libro sin título") return titled;`;

const newPlaceholderCheck = `  const titled = extractBookTitleFromIdea(seed);

  const normalizedTitle = String(titled ?? "")
    .trim()
    .toLowerCase();

  const isPlaceholderTitle =
    !normalizedTitle ||
    normalizedTitle === "libro sin título" ||
    normalizedTitle === "libro sin titulo" ||
    normalizedTitle === "nuevo libro" ||
    normalizedTitle === "nuevo libro sin título" ||
    normalizedTitle === "nuevo libro sin titulo";

  if (!isPlaceholderTitle) return titled;`;

if (code.includes(oldPlaceholderCheck)) {
  code = code.replace(oldPlaceholderCheck, newPlaceholderCheck);
  changes++;
  console.log("✅ Placeholder de título corregido.");
} else {
  console.log(
    "⚠️ No encontré el bloque exacto de cleanSeedForOutlineContext."
  );
}

/* =========================================================
   2. USAR LA IDEA ORIGINAL PARA EXTRAER TÍTULOS DE CAPÍTULOS
   ========================================================= */

const oldOutlineCall = `      const seedOutline = buildFallbackOutline(
        desiredChapterCount,
        cleanOutlineContext,
        defaultChapterWords
      );`;

const newOutlineCall = `      const seedOutline = buildFallbackOutline(
        desiredChapterCount,
        idea,
        defaultChapterWords
      );`;

if (code.includes(oldOutlineCall)) {
  code = code.replace(oldOutlineCall, newOutlineCall);
  changes++;
  console.log(
    "✅ buildFallbackOutline ahora recibe la idea original."
  );
} else {
  console.log(
    "⚠️ No encontré la llamada exacta a buildFallbackOutline."
  );
}

/* =========================================================
   3. USAR LA IDEA ORIGINAL AL NORMALIZAR EL ESQUEMA
   ========================================================= */

const oldEnsureOutlineCall = `      updated = ensureOutlineForProject(
        updated,
        desiredChapterCount,
        cleanOutlineContext,
        defaultChapterWords
      );`;

const newEnsureOutlineCall = `      updated = ensureOutlineForProject(
        updated,
        desiredChapterCount,
        idea,
        defaultChapterWords
      );`;

if (code.includes(oldEnsureOutlineCall)) {
  code = code.replace(
    oldEnsureOutlineCall,
    newEnsureOutlineCall
  );

  changes++;
  console.log(
    "✅ ensureOutlineForProject ahora conserva títulos explícitos."
  );
} else {
  console.log(
    "⚠️ No encontré la llamada exacta a ensureOutlineForProject."
  );
}

/* =========================================================
   4. MEJORAR LOS TÍTULOS FALLBACK DE CAPÍTULOS
   ========================================================= */

const oldFallbackFunction = `function pickFallbackChapterTitle(index: number): string {
  if (index < FALLBACK_CHAPTER_TITLES.length) return FALLBACK_CHAPTER_TITLES[index];
  return \`Desarrollo editorial \${index + 1}\`;
}`;

const newFallbackFunction = `function pickFallbackChapterTitle(
  index: number,
  context = ""
): string {
  const topic = String(context ?? "")
    .replace(/\\s+/g, " ")
    .trim();

  const base =
    index < FALLBACK_CHAPTER_TITLES.length
      ? FALLBACK_CHAPTER_TITLES[index]
      : \`Desarrollo editorial \${index + 1}\`;

  if (!topic) return base;

  const shortTopic =
    topic.length > 65
      ? topic.slice(0, 65).replace(/\\s+\\S*$/, "").trim()
      : topic;

  const domainText = shortTopic.toLowerCase();

  const historicalTitles = [
    \`Orígenes y contexto de \${shortTopic}\`,
    \`Evolución histórica de \${shortTopic}\`,
    \`Actores y acontecimientos determinantes\`,
    \`Transformaciones políticas y sociales\`,
    \`Momentos decisivos y puntos de ruptura\`,
    \`Conflictos, debates y versiones contrapuestas\`,
    \`Consecuencias históricas y sociales\`,
    \`Instituciones, poder y relaciones de fuerza\`,
    \`Interpretaciones, mitos y controversias\`,
    \`El legado de \${shortTopic}\`,
    \`Continuidades y cambios en el presente\`,
    \`Conclusiones y perspectiva histórica\`,
  ];

  const biographyTitles = [
    \`Orígenes y entorno familiar\`,
    \`Formación y primeras influencias\`,
    \`Los primeros pasos de su trayectoria\`,
    \`La construcción de una identidad pública\`,
    \`Ascenso, oportunidades y desafíos\`,
    \`Colaboradores, aliados y círculos de influencia\`,
    \`Conflictos, polémicas y momentos críticos\`,
    \`Aportes profesionales y sociales\`,
    \`Imagen pública, discurso y percepción social\`,
    \`Contradicciones y límites de su trayectoria\`,
    \`Legado, influencia y proyección\`,
    \`Balance biográfico y perspectivas futuras\`,
  ];

  const financeTitles = [
    \`Fundamentos económicos de \${shortTopic}\`,
    \`Origen y evolución del modelo financiero\`,
    \`Ingresos, costos y flujo de efectivo\`,
    \`Capital, deuda y estructura financiera\`,
    \`Rentabilidad, riesgo y rendimiento\`,
    \`Mercado, competencia y posicionamiento\`,
    \`Datos históricos y ciclos económicos\`,
    \`Estrategias de crecimiento y expansión\`,
    \`Errores financieros y decisiones críticas\`,
    \`Escenarios, proyecciones y sensibilidad\`,
    \`Riesgos futuros y oportunidades\`,
    \`Conclusiones y plan financiero\`,
  ];

  const generalTitles = [
    \`El contexto general de \${shortTopic}\`,
    \`Origen y evolución de \${shortTopic}\`,
    \`Conceptos fundamentales para comprender el tema\`,
    \`Actores, instituciones y dinámicas principales\`,
    \`Procesos y mecanismos determinantes\`,
    \`Casos, experiencias y ejemplos relevantes\`,
    \`Impactos sociales, económicos y culturales\`,
    \`Problemas, contradicciones y desafíos\`,
    \`Mitos, errores y debates frecuentes\`,
    \`Riesgos, ética y responsabilidades\`,
    \`Tendencias y escenarios futuros\`,
    \`Conclusiones y propuestas de acción\`,
  ];

  let collection = generalTitles;

  if (
    /historia|histórico|histórica|origen|evolución|guerra|dictadura|siglo/.test(
      domainText
    )
  ) {
    collection = historicalTitles;
  } else if (
    /biografía|biografico|biográfico|trayectoria|vida de|personaje|comunicador|artista|empresario|político/.test(
      domainText
    )
  ) {
    collection = biographyTitles;
  } else if (
    /finanza|economía|dinero|riqueza|inversión|empresa|mercado|rentabilidad|deuda/.test(
      domainText
    )
  ) {
    collection = financeTitles;
  }

  return collection[index] || base;
}`;

if (code.includes(oldFallbackFunction)) {
  code = code.replace(
    oldFallbackFunction,
    newFallbackFunction
  );

  changes++;
  console.log(
    "✅ Títulos de respaldo mejorados por tipo de libro."
  );
} else {
  console.log(
    "⚠️ No encontré pickFallbackChapterTitle exacto."
  );
}

/* =========================================================
   5. PASAR CONTEXTO AL FALLBACK DENTRO DE buildFallbackOutline
   ========================================================= */

const oldFallbackTitleLine = `    const fallbackTitle = pickFallbackChapterTitle(i);`;

const newFallbackTitleLine = `    const fallbackTitle = pickFallbackChapterTitle(
      i,
      safeContext
    );`;

if (code.includes(oldFallbackTitleLine)) {
  code = code.replace(
    oldFallbackTitleLine,
    newFallbackTitleLine
  );

  changes++;
  console.log(
    "✅ Los capítulos fallback ahora usan el tema del libro."
  );
}

/* =========================================================
   6. AJUSTAR isGenericFallbackTitle PARA NUEVA FIRMA
   ========================================================= */

const oldGenericFallbackLine = `  const fallback = pickFallbackChapterTitle(chapterNumber - 1).toLowerCase();`;

const newGenericFallbackLine = `  const fallback = pickFallbackChapterTitle(
    chapterNumber - 1,
    ""
  ).toLowerCase();`;

if (code.includes(oldGenericFallbackLine)) {
  code = code.replace(
    oldGenericFallbackLine,
    newGenericFallbackLine
  );

  changes++;
}

/* =========================================================
   7. AJUSTAR normalizeOutlineTitles
   ========================================================= */

const oldNormalizeFallbackLine = `      const fallback = pickFallbackChapterTitle(n - 1);`;

const newNormalizeFallbackLine = `      const fallback = pickFallbackChapterTitle(
        n - 1,
        safeFallback
      );`;

if (code.includes(oldNormalizeFallbackLine)) {
  code = code.replace(
    oldNormalizeFallbackLine,
    newNormalizeFallbackLine
  );

  changes++;
  console.log(
    "✅ normalizeOutlineTitles usa títulos relacionados con el tema."
  );
}

/* =========================================================
   GUARDAR
   ========================================================= */

if (changes === 0) {
  console.error("");
  console.error("❌ No se aplicó ningún cambio.");
  console.error("El archivo actual no coincide con la estructura esperada.");
  console.error("Backup:", BACKUP);
  process.exit(1);
}

fs.writeFileSync(FILE, code, "utf8");

console.log("");
console.log("==========================================");
console.log("✅ REPARACIÓN TERMINADA");
console.log("==========================================");
console.log("Cambios aplicados:", changes);
console.log("Archivo:", FILE);
console.log("Backup:", BACKUP);
console.log("");
console.log("Ahora ejecuta:");
console.log("npm run build");
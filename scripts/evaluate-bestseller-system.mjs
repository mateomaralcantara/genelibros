// scripts/evaluate-bestseller-system.mjs
//
// Evaluador profesional del sistema BestSeller.
// Da puntuación de 1 a 10 por áreas:
//
// 1. Títulos y subtítulos
// 2. Prompts editoriales
// 3. Control factual
// 4. Investigación / scraping real
// 5. JSON vs texto plano
// 6. Coherencia de capítulos
// 7. Estado limpio entre libros
// 8. Persistencia Supabase
// 9. Seguridad API
// 10. Robustez de producción
//
// Uso:
// node scripts/evaluate-bestseller-system.mjs
// node scripts/evaluate-bestseller-system.mjs --build
// node scripts/evaluate-bestseller-system.mjs --json

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

const ARGS = new Set(process.argv.slice(2));
const SHOULD_RUN_BUILD = ARGS.has("--build");
const JSON_OUTPUT = ARGS.has("--json");

const FILES = {
  app: "App.tsx",
  gemini: "src/lib/gemini.ts",
  composer: "api/composer.ts",
  editor: "src/lib/editor.ts",
  repo: "src/data/repo.ts",
  types: "types.ts",
  typesLocal: "src/lib/types.local.ts",
  packageJson: "package.json",
};

function abs(file) {
  return path.join(ROOT, file);
}

function exists(file) {
  return fs.existsSync(abs(file));
}

function read(file) {
  if (!exists(file)) return "";
  return fs.readFileSync(abs(file), "utf8");
}

function has(text, pattern) {
  if (!text) return false;

  if (pattern instanceof RegExp) {
    return pattern.test(text);
  }

  return text.includes(pattern);
}

function countMatches(text, pattern) {
  if (!text) return 0;

  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : pattern.flags + "g";

  const re = new RegExp(pattern.source, flags);
  return [...text.matchAll(re)].length;
}

function clampScore(value) {
  return Math.max(1, Math.min(10, Number(value.toFixed(1))));
}

function gradeLabel(score) {
  if (score >= 9) return "EXCELENTE";
  if (score >= 8) return "MUY BUENO";
  if (score >= 7) return "BUENO";
  if (score >= 6) return "ACEPTABLE";
  if (score >= 5) return "DÉBIL";
  return "CRÍTICO";
}

function addPoints(checks) {
  let score = 1;
  const passed = [];
  const failed = [];

  for (const check of checks) {
    if (check.pass) {
      score += check.points;
      passed.push(check.label);
    } else {
      failed.push(check.label);
    }
  }

  return {
    score: clampScore(score),
    passed,
    failed,
  };
}

function section(name, weight, result, recommendations = []) {
  return {
    name,
    weight,
    score: result.score,
    label: gradeLabel(result.score),
    passed: result.passed,
    failed: result.failed,
    recommendations,
  };
}

function evaluateTitlesAndSubtitles(ctx) {
  const { app, gemini } = ctx;

  const result = addPoints([
    {
      label: "Tiene extractor de título principal",
      pass: has(app, "function extractBookTitleFromIdea"),
      points: 1.2,
    },
    {
      label: "Detecta TÍTULO DEL LIBRO / TITLE / NOMBRE DEL LIBRO",
      pass:
        has(app, "T[IÍ]TULO DEL LIBRO") &&
        has(app, "NOMBRE DEL LIBRO") &&
        has(app, "BOOK TITLE"),
      points: 1.1,
    },
    {
      label: "Tiene limpieza contra prompt-leak en títulos",
      pass: has(app, "hasPromptLeak") && has(app, "truncateEditorialTitle"),
      points: 1.0,
    },
    {
      label: "Extrae títulos explícitos de capítulos",
      pass: has(app, "function extractChapterTitlesFromIdea"),
      points: 1.2,
    },
    {
      label: "Usa subheads_h2 para subtítulos internos",
      pass: has(app, "subheads_h2") && has(gemini, "subheads"),
      points: 1.1,
    },
    {
      label: "Genera outline variable por cantidad de capítulos",
      pass:
        has(app, "extractDesiredChapterCountSafe") &&
        has(app, "buildFallbackOutline"),
      points: 1.0,
    },
    {
      label: "Evita títulos genéricos como única salida",
      pass:
        !has(app, 'return "Libro sin título";') &&
        countMatches(app, /Libro sin título/g) <= 2,
      points: 0.9,
    },
    {
      label: "Tiene fallback temático para capítulos",
      pass:
        has(app, "pickFallbackChapterTitle") &&
        (
          has(app, "historicalTitles") ||
          has(app, "biographyTitles") ||
          has(app, "financeTitles")
        ),
      points: 1.2,
    },
    {
      label: "El capítulo recibe título desde outline",
      pass: has(gemini, "getChapterTitle") && has(gemini, "outline_12"),
      points: 1.2,
    },
  ]);

  return section("Títulos, capítulos y subtítulos", 1.15, result, [
    "Crear una fase BLUEPRINT_EDITORIAL antes de guardar el proyecto.",
    "Generar 3 títulos candidatos y elegir uno por fuerza comercial, claridad y precisión.",
    "Obligar a cada capítulo a tener entre 5 y 10 subtítulos internos.",
  ]);
}

function evaluateEditorialPrompts(ctx) {
  const { app, gemini, composer } = ctx;
  const all = app + "\n" + gemini + "\n" + composer;

  const result = addPoints([
    {
      label: "Prompt maestro editorial existe",
      pass: has(app, "DEV_SYSTEM_PROMPT") || has(composer, "SYSTEM_PROMPT"),
      points: 1.0,
    },
    {
      label: "Reglas contra instrucciones internas",
      pass:
        has(all, "Actúa como") &&
        has(all, "Prompt") &&
        has(all, "Requisitos"),
      points: 1.0,
    },
    {
      label: "Reglas de no inventar datos",
      pass:
        has(all, "No inventes") ||
        has(all, "no inventes") ||
        has(all, "factual"),
      points: 1.3,
    },
    {
      label: "Reglas específicas para historia",
      pass:
        has(all, "HISTORIA") ||
        has(all, "LIBROS HISTÓRICOS") ||
        has(all, "cronología"),
      points: 1.1,
    },
    {
      label: "Reglas específicas para personajes / biografía",
      pass:
        has(all, "PERSONAJES") ||
        has(all, "BIOGRAPHY") ||
        has(all, "biografía"),
      points: 1.1,
    },
    {
      label: "Reglas específicas para finanzas",
      pass:
        has(all, "FINANZAS") ||
        has(all, "FINANCE") ||
        has(all, "moneda"),
      points: 1.1,
    },
    {
      label: "Reglas de análisis profundo",
      pass:
        has(all, "causas") &&
        has(all, "consecuencias") &&
        has(all, "contradicciones"),
      points: 1.0,
    },
    {
      label: "Reglas de bibliografía no inventada",
      pass:
        has(all, "bibliografía") &&
        (
          has(all, "No inventes") ||
          has(all, "No fabriques")
        ),
      points: 0.9,
    },
    {
      label: "Temperatura reducida para no ficción",
      pass:
        has(gemini, "detectEditorialDomain") &&
        has(gemini, "FICTION") &&
        has(gemini, "0.48"),
      points: 1.4,
    },
  ]);

  return section("Prompts editoriales", 1.1, result, [
    "Dividir prompts en: investigación, blueprint, dossier, capítulo, revisión factual y reescritura.",
    "Usar temperatura baja para historia, biografía, finanzas y política.",
    "Crear prompts distintos por género editorial.",
  ]);
}

function evaluateFactualControl(ctx) {
  const { gemini, composer, app } = ctx;
  const all = app + "\n" + gemini + "\n" + composer;

  const result = addPoints([
    {
      label: "Clasifica dominio editorial",
      pass: has(gemini, "detectEditorialDomain"),
      points: 1.2,
    },
    {
      label: "Construye reglas factuales por dominio",
      pass: has(gemini, "buildFactualRules"),
      points: 1.2,
    },
    {
      label: "Lee research_context o verified_facts",
      pass:
        has(gemini, "research_context") ||
        has(gemini, "verified_facts") ||
        has(gemini, "research_pack"),
      points: 1.1,
    },
    {
      label: "Distingue hechos, inferencias y controversias",
      pass:
        has(all, "hechos") &&
        has(all, "inferencias") &&
        has(all, "controversias"),
      points: 1.1,
    },
    {
      label: "Prohíbe citas inventadas",
      pass:
        has(all, "citas") &&
        (
          has(all, "No inventes") ||
          has(all, "No fabriques")
        ),
      points: 1.0,
    },
    {
      label: "Prohíbe cifras falsas o sin contexto",
      pass:
        has(all, "cifras") &&
        (
          has(all, "moneda") ||
          has(all, "período") ||
          has(all, "año")
        ),
      points: 1.0,
    },
    {
      label: "No afirma scraping si no hay fuentes",
      pass:
        has(all, "No afirmes que realizaste") ||
        has(all, "scraping"),
      points: 0.9,
    },
    {
      label: "Tiene sanitización editorial posterior",
      pass: has(gemini, "sanitizeEditorialChapterText"),
      points: 1.0,
    },
    {
      label: "Tiene fact-check de capítulo separado",
      pass:
        has(all, "FACT_CHECK_CHAPTER") ||
        has(all, "VERIFY_FACTS") ||
        has(all, "fact_check"),
      points: 1.5,
    },
  ]);

  return section("Control factual y anti-invención", 1.25, result, [
    "Agregar tarea FACT_CHECK_CHAPTER después de cada capítulo.",
    "Guardar afirmaciones importantes como claims verificables.",
    "Bloquear cifras exactas si no hay fuente o contexto.",
  ]);
}

function evaluateResearchScraping(ctx) {
  const { app, gemini, composer, repo } = ctx;
  const all = app + "\n" + gemini + "\n" + composer + "\n" + repo;

  const result = addPoints([
    {
      label: "Existe concepto de research_context",
      pass:
        has(all, "research_context") ||
        has(all, "research_pack") ||
        has(all, "sources_summary"),
      points: 1.0,
    },
    {
      label: "Existen tablas o funciones research_sources",
      pass: has(all, "research_sources"),
      points: 1.3,
    },
    {
      label: "Existen tablas o funciones research_facts",
      pass: has(all, "research_facts"),
      points: 1.3,
    },
    {
      label: "Existe tarea COLLECT_SOURCES",
      pass: has(all, "COLLECT_SOURCES"),
      points: 1.1,
    },
    {
      label: "Existe tarea EXTRACT_FACTS",
      pass: has(all, "EXTRACT_FACTS"),
      points: 1.1,
    },
    {
      label: "Existe tarea VERIFY_FACTS",
      pass: has(all, "VERIFY_FACTS"),
      points: 1.1,
    },
    {
      label: "Hay fetch real desde backend",
      pass:
        has(all, /fetch\s*\(/) &&
        (
          has(composer, "fetch(") ||
          has(repo, "fetch(")
        ),
      points: 1.0,
    },
    {
      label: "Hay extracción HTML o parsing de páginas",
      pass:
        has(all, "cheerio") ||
        has(all, "JSDOM") ||
        has(all, "Readability") ||
        has(all, "DOMParser"),
      points: 1.0,
    },
    {
      label: "Hay scoring de confiabilidad de fuentes",
      pass:
        has(all, "reliability_score") ||
        has(all, "source_type") ||
        has(all, "confidence"),
      points: 1.1,
    },
  ]);

  return section("Investigación, scraping y fuentes reales", 1.35, result, [
    "Este es el punto más importante si quieres libros históricos o financieros serios.",
    "Crear tablas research_sources y research_facts en Supabase.",
    "Crear endpoint /api/research que busque, extraiga y resuma fuentes.",
    "Pasar research_context real a Gemini antes de generar capítulos.",
  ]);
}

function evaluateJsonRouting(ctx) {
  const { gemini, composer } = ctx;
  const all = gemini + "\n" + composer;

  const result = addPoints([
    {
      label: "Distingue acciones largas de texto",
      pass:
        has(gemini, "LongAction") ||
        has(composer, "LongTextAction") ||
        has(composer, "isLongTextAction"),
      points: 1.2,
    },
    {
      label: "Propuesta se genera como texto plano",
      pass:
        has(all, "GENERATE_PROPOSAL") &&
        has(all, "texto plano"),
      points: 1.1,
    },
    {
      label: "Introducción se genera como texto plano",
      pass:
        has(all, "GENERATE_INTRODUCTION") &&
        has(all, "texto plano"),
      points: 1.1,
    },
    {
      label: "Capítulos se generan como texto plano",
      pass:
        has(all, "GENERATE_CHAPTER") &&
        has(all, "texto plano"),
      points: 1.1,
    },
    {
      label: "Dossier conserva JSON",
      pass:
        has(all, "BUILD_FULL_DOSSIER") &&
        has(all, "application/json"),
      points: 1.0,
    },
    {
      label: "Tiene safeJsonParse",
      pass: has(all, "safeJsonParse"),
      points: 1.0,
    },
    {
      label: "Tiene reparación de JSON",
      pass:
        has(all, "repair") ||
        has(all, "Repara") ||
        has(all, "repairDossierJsonWithGemini"),
      points: 1.1,
    },
    {
      label: "Tiene fallback si JSON del dossier falla",
      pass:
        has(composer, "buildSafeDossierFallback") ||
        has(gemini, "fallback"),
      points: 1.1,
    },
    {
      label: "No fuerza JSON global para todo",
      pass:
        !(
          has(composer, "Devuelve SIEMPRE un único JSON") &&
          !has(composer, "isLongTextAction")
        ),
      points: 1.3,
    },
  ]);

  return section("Ruteo JSON / texto plano", 1.2, result, [
    "Mantener JSON solo para dossier o respuestas estructurales cortas.",
    "Nunca pedir JSON para capítulos largos.",
    "Registrar preview del modelo cuando falle el parseo.",
  ]);
}

function evaluateChapterCoherence(ctx) {
  const { app, gemini, editor } = ctx;
  const all = app + "\n" + gemini + "\n" + editor;

  const result = addPoints([
    {
      label: "Existe outline_12 como fuente de estructura",
      pass: has(all, "outline_12"),
      points: 1.0,
    },
    {
      label: "Obtiene hints del outline",
      pass: has(gemini, "getOutlineHints"),
      points: 1.1,
    },
    {
      label: "Usa puntos clave",
      pass: has(all, "key_points") || has(all, "keyPoints"),
      points: 1.0,
    },
    {
      label: "Usa subtítulos sugeridos",
      pass: has(all, "subheads_h2") || has(all, "subheads"),
      points: 1.0,
    },
    {
      label: "Tiene master_document reconstruible",
      pass:
        has(editor, "buildMasterFromState") ||
        has(gemini, "buildMasterFromState"),
      points: 1.0,
    },
    {
      label: "No repite encabezado Capítulo al inicio",
      pass:
        has(gemini, "stripChapterHeader") ||
        has(gemini, "No repitas el título"),
      points: 0.9,
    },
    {
      label: "Tiene continuación automática por palabras",
      pass: has(gemini, "ensureMinWordsByContinuing"),
      points: 1.2,
    },
    {
      label: "Evita repetir texto al continuar",
      pass: has(gemini, "appendNonRepeating"),
      points: 1.0,
    },
    {
      label: "Tiene validación de capítulos generados",
      pass:
        has(all, "FACT_CHECK_CHAPTER") ||
        has(all, "validateChapter") ||
        has(all, "chapter_quality"),
      points: 1.8,
    },
  ]);

  return section("Coherencia de capítulos", 1.1, result, [
    "Agregar validador de capítulo que compare texto contra outline.",
    "Penalizar capítulos sin subtítulos internos.",
    "Reescribir automáticamente capítulos con baja coherencia.",
  ]);
}

function evaluateStateIsolation(ctx) {
  const { app, editor } = ctx;
  const all = app + "\n" + editor;

  const result = addPoints([
    {
      label: "Crea seedState para libro nuevo",
      pass: has(app, "seedState"),
      points: 1.0,
    },
    {
      label: "Normaliza estado de proyecto",
      pass: has(all, "normalizeProjectState"),
      points: 1.0,
    },
    {
      label: "Tiene project_id en estado",
      pass: has(all, "project_id"),
      points: 0.8,
    },
    {
      label: "Evita mezclar proyectos por id",
      pass:
        has(app, "activeProjectId") &&
        has(app, "projectsRef.current"),
      points: 1.0,
    },
    {
      label: "Actualiza proyecto por id",
      pass: has(app, "updateProjectById"),
      points: 1.0,
    },
    {
      label: "Tiene lock de generación única",
      pass:
        has(app, "globalGenLockRef") ||
        has(app, "single-flight"),
      points: 1.0,
    },
    {
      label: "No parece reutilizar stateAnterior directamente",
      pass:
        !has(app, "...stateAnterior") &&
        !has(app, "...currentProject"),
      points: 1.2,
    },
    {
      label: "Limpia capítulos al crear nuevo libro",
      pass:
        has(app, "chapters: []") ||
        has(app, "outline_12: seedOutline"),
      points: 1.2,
    },
    {
      label: "Tiene función explícita createFreshBookState",
      pass: has(app, "createFreshBookState"),
      points: 1.8,
    },
  ]);

  return section("Estado limpio entre libros", 1.0, result, [
    "Crear función única createFreshBookState y usarla siempre.",
    "Nunca iniciar un nuevo libro con spread de un proyecto anterior.",
    "Loguear project_id, title y outline al crear cada libro.",
  ]);
}

function evaluatePersistence(ctx) {
  const { repo, app } = ctx;
  const all = repo + "\n" + app;

  const result = addPoints([
    {
      label: "Usa Supabase",
      pass: has(all, "supabase"),
      points: 0.9,
    },
    {
      label: "Lista proyectos",
      pass: has(all, "listProjects"),
      points: 0.8,
    },
    {
      label: "Crea proyectos",
      pass: has(all, "createProject"),
      points: 0.9,
    },
    {
      label: "Actualiza proyectos",
      pass: has(all, "updateProject"),
      points: 0.9,
    },
    {
      label: "Guarda secciones",
      pass: has(all, "upsertSection"),
      points: 1.0,
    },
    {
      label: "Guarda versiones de secciones",
      pass: has(all, "insertSectionVersion"),
      points: 1.0,
    },
    {
      label: "Guarda snapshots de master",
      pass: has(all, "insertMasterSnapshot"),
      points: 1.0,
    },
    {
      label: "Persistencia de metadata del proyecto",
      pass: has(app, "persistProjectMeta"),
      points: 1.0,
    },
    {
      label: "Persistencia de research_sources / research_facts",
      pass:
        has(all, "research_sources") &&
        has(all, "research_facts"),
      points: 2.5,
    },
  ]);

  return section("Persistencia y base de datos", 1.0, result, [
    "Agregar persistencia de investigación: sources, facts, claims y fact_checks.",
    "Guardar blueprint editorial antes de generar capítulos.",
    "Guardar scoring por capítulo.",
  ]);
}

function evaluateSecurity(ctx) {
  const { composer, app } = ctx;
  const all = composer + "\n" + app;

  const result = addPoints([
    {
      label: "Usa GEMINI_API_KEY privada en API",
      pass: has(composer, "process.env.GEMINI_API_KEY"),
      points: 1.2,
    },
    {
      label: "Tiene COMPOSER_SHARED_SECRET",
      pass: has(composer, "COMPOSER_SHARED_SECRET"),
      points: 1.2,
    },
    {
      label: "Bloquea métodos no POST",
      pass: has(composer, "req.method !== 'POST'"),
      points: 0.8,
    },
    {
      label: "Valida content-type",
      pass: has(composer, "Unsupported content-type"),
      points: 0.8,
    },
    {
      label: "Tiene allowlist de modelos",
      pass: has(composer, "ALLOWED_MODELS"),
      points: 1.0,
    },
    {
      label: "No expone GEMINI_API_KEY privada en cliente",
      pass:
        !has(app, "GEMINI_API_KEY") ||
        has(app, "VITE_GEMINI_API_KEY"),
      points: 0.8,
    },
    {
      label: "Tiene control de acceso por perfil",
      pass:
        has(app, "has_access") &&
        has(app, "profiles"),
      points: 1.0,
    },
    {
      label: "Tiene control de dispositivo / sesión",
      pass:
        has(app, "DEVICE_STORAGE_KEY") &&
        has(app, "deviceAllowed"),
      points: 1.0,
    },
    {
      label: "Tiene rate limit propio de API",
      pass:
        has(composer, "rateLimit") ||
        has(composer, "RATE_LIMIT") ||
        has(composer, "limit_ip"),
      points: 1.2,
    },
  ]);

  return section("Seguridad y control de acceso", 0.9, result, [
    "Agregar rate limiting real por usuario/IP en /api/composer.",
    "No usar VITE_GEMINI_API_KEY en producción.",
    "Registrar consumo de tokens por usuario.",
  ]);
}

function evaluateProductionRobustness(ctx) {
  const { composer, gemini, packageJson } = ctx;
  const all = composer + "\n" + gemini + "\n" + packageJson;

  let buildScore = 0;
  let buildOutput = "";

  if (SHOULD_RUN_BUILD) {
    try {
      buildOutput = execSync("npm run build", {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 120000,
      });

      if (/built in|✓ built/i.test(buildOutput)) {
        buildScore = 1.8;
      }
    } catch (error) {
      buildOutput =
        String(error?.stdout ?? "") +
        "\n" +
        String(error?.stderr ?? "") +
        "\n" +
        String(error?.message ?? "");

      buildScore = 0;
    }
  }

  const result = addPoints([
    {
      label: "Tiene retry para 429/503",
      pass: has(all, "withRetry") || has(all, "429") || has(all, "503"),
      points: 1.0,
    },
    {
      label: "Detecta cuota agotada",
      pass:
        has(gemini, "isDailyQuotaExhausted") ||
        has(gemini, "Cuota diaria"),
      points: 1.0,
    },
    {
      label: "Tiene fallback de modelos",
      pass: has(gemini, "getFallbackModels"),
      points: 1.0,
    },
    {
      label: "Tiene reparación de JSON",
      pass:
        has(all, "safeJsonParse") &&
        (
          has(all, "repair") ||
          has(all, "Repara")
        ),
      points: 1.0,
    },
    {
      label: "Tiene respuesta segura si dossier falla",
      pass:
        has(composer, "buildSafeDossierFallback") ||
        has(gemini, "fallback"),
      points: 1.0,
    },
    {
      label: "Controla maxOutputTokens",
      pass: has(all, "maxOutputTokens"),
      points: 0.8,
    },
    {
      label: "Tiene build script",
      pass: has(packageJson, '"build"'),
      points: 0.7,
    },
    {
      label: "Build ejecutado correctamente en esta evaluación",
      pass: buildScore > 0,
      points: buildScore,
    },
    {
      label: "Tiene tests automatizados",
      pass:
        has(packageJson, '"test"') &&
        !has(packageJson, '"test": "echo'),
      points: 1.5,
    },
  ]);

  const recs = [
    "Agregar npm test con pruebas de título, outline, JSON/texto plano y estado limpio.",
    "Crear healthcheck /api/health.",
    "Agregar logs estructurados por project_id y action.",
  ];

  if (!SHOULD_RUN_BUILD) {
    recs.unshift("Ejecuta el evaluador con --build para incluir compilación real en la nota.");
  }

  return {
    ...section("Robustez de producción", 1.0, result, recs),
    buildOutput: SHOULD_RUN_BUILD ? buildOutput.slice(-3000) : "",
  };
}

function calculateOverall(sections) {
  const totalWeight = sections.reduce((acc, s) => acc + s.weight, 0);
  const weighted = sections.reduce(
    (acc, s) => acc + s.score * s.weight,
    0
  );

  return clampScore(weighted / totalWeight);
}

function topWeaknesses(sections) {
  return [...sections]
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((s) => ({
      area: s.name,
      score: s.score,
      label: s.label,
      failed: s.failed.slice(0, 5),
      recommendations: s.recommendations.slice(0, 3),
    }));
}

function topStrengths(sections) {
  return [...sections]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((s) => ({
      area: s.name,
      score: s.score,
      label: s.label,
      passed: s.passed.slice(0, 5),
    }));
}

function printReport(report) {
  console.log("");
  console.log("============================================================");
  console.log("EVALUACIÓN BESTSELLER SYSTEM");
  console.log("============================================================");
  console.log(`Fecha: ${report.date}`);
  console.log(`Proyecto: ${report.root}`);
  console.log("");
  console.log(`PUNTUACIÓN GENERAL: ${report.overall}/10 — ${report.label}`);
  console.log("");

  console.log("------------------------------------------------------------");
  console.log("PUNTUACIÓN POR ÁREA");
  console.log("------------------------------------------------------------");

  for (const s of report.sections) {
    console.log("");
    console.log(`${s.name}: ${s.score}/10 — ${s.label}`);

    if (s.passed.length) {
      console.log("  ✅ Fortalezas:");
      for (const p of s.passed.slice(0, 5)) {
        console.log(`     - ${p}`);
      }
    }

    if (s.failed.length) {
      console.log("  ❌ Debilidades:");
      for (const f of s.failed.slice(0, 5)) {
        console.log(`     - ${f}`);
      }
    }

    if (s.recommendations.length) {
      console.log("  🔧 Recomendaciones:");
      for (const r of s.recommendations.slice(0, 3)) {
        console.log(`     - ${r}`);
      }
    }
  }

  console.log("");
  console.log("------------------------------------------------------------");
  console.log("ÁREAS MÁS FUERTES");
  console.log("------------------------------------------------------------");

  for (const item of report.strengths) {
    console.log(`✅ ${item.area}: ${item.score}/10 — ${item.label}`);
  }

  console.log("");
  console.log("------------------------------------------------------------");
  console.log("ÁREAS MÁS DÉBILES");
  console.log("------------------------------------------------------------");

  for (const item of report.weaknesses) {
    console.log(`❌ ${item.area}: ${item.score}/10 — ${item.label}`);
    for (const rec of item.recommendations) {
      console.log(`   - ${rec}`);
    }
  }

  console.log("");
  console.log("------------------------------------------------------------");
  console.log("DICTAMEN");
  console.log("------------------------------------------------------------");
  console.log(report.verdict);
  console.log("");

  console.log("Reporte guardado en:");
  console.log(report.reportTxtPath);
  console.log(report.reportJsonPath);
  console.log("");
}

function buildVerdict(overall, sections) {
  const research = sections.find((s) => s.name.includes("Investigación"));
  const factual = sections.find((s) => s.name.includes("Control factual"));
  const titles = sections.find((s) => s.name.includes("Títulos"));
  const json = sections.find((s) => s.name.includes("JSON"));

  const lines = [];

  if (overall >= 8.5) {
    lines.push(
      "El sistema está en nivel alto. Ya puede producir libros con estructura seria, pero debe reforzarse con investigación real para temas históricos, biográficos y financieros."
    );
  } else if (overall >= 7) {
    lines.push(
      "El sistema está funcional y con buena base editorial, pero todavía no es de nivel premium. Su mayor límite probablemente está en investigación real, validación factual y pruebas automáticas."
    );
  } else if (overall >= 5.5) {
    lines.push(
      "El sistema está en fase intermedia. Puede generar contenido, pero todavía requiere arquitectura de investigación, control factual posterior y mejor manejo de títulos/subtítulos para considerarse profesional."
    );
  } else {
    lines.push(
      "El sistema está débil para producción seria. Puede generar texto, pero hay riesgo alto de títulos genéricos, datos inventados, pérdida de coherencia o fallos de JSON."
    );
  }

  if (research && research.score < 6) {
    lines.push(
      "El punto más urgente es investigación real: scraping, fuentes, extracción de hechos y almacenamiento en Supabase."
    );
  }

  if (factual && factual.score < 7) {
    lines.push(
      "El segundo punto crítico es agregar fact-check posterior por capítulo."
    );
  }

  if (titles && titles.score < 7) {
    lines.push(
      "El tercer punto crítico es crear un Blueprint editorial antes del dossier para garantizar título, subtítulo, capítulos y subtítulos internos."
    );
  }

  if (json && json.score < 7) {
    lines.push(
      "También conviene revisar el ruteo JSON/texto plano, porque los capítulos largos no deben forzarse como JSON."
    );
  }

  return lines.join("\n");
}

function main() {
  const missing = Object.entries(FILES)
    .filter(([, file]) => !exists(file))
    .map(([key, file]) => `${key}: ${file}`);

  const ctx = {
    app: read(FILES.app),
    gemini: read(FILES.gemini),
    composer: read(FILES.composer),
    editor: read(FILES.editor),
    repo: read(FILES.repo),
    types: read(FILES.types),
    typesLocal: read(FILES.typesLocal),
    packageJson: read(FILES.packageJson),
  };

  const sections = [
    evaluateTitlesAndSubtitles(ctx),
    evaluateEditorialPrompts(ctx),
    evaluateFactualControl(ctx),
    evaluateResearchScraping(ctx),
    evaluateJsonRouting(ctx),
    evaluateChapterCoherence(ctx),
    evaluateStateIsolation(ctx),
    evaluatePersistence(ctx),
    evaluateSecurity(ctx),
    evaluateProductionRobustness(ctx),
  ];

  const overall = calculateOverall(sections);

  const report = {
    date: new Date().toISOString(),
    root: ROOT,
    missingFiles: missing,
    overall,
    label: gradeLabel(overall),
    sections,
    strengths: topStrengths(sections),
    weaknesses: topWeaknesses(sections),
    verdict: buildVerdict(overall, sections),
    runBuild: SHOULD_RUN_BUILD,
  };

  const outDir = path.join(ROOT, "reports");

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const reportJsonPath = path.join(outDir, "bestseller-system-evaluation.json");
  const reportTxtPath = path.join(outDir, "bestseller-system-evaluation.txt");

  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf8");

  const txtLines = [];

  txtLines.push("EVALUACIÓN BESTSELLER SYSTEM");
  txtLines.push(`Fecha: ${report.date}`);
  txtLines.push(`Proyecto: ${report.root}`);
  txtLines.push(`Puntuación general: ${report.overall}/10 — ${report.label}`);
  txtLines.push("");
  txtLines.push("PUNTUACIÓN POR ÁREA");

  for (const s of report.sections) {
    txtLines.push("");
    txtLines.push(`${s.name}: ${s.score}/10 — ${s.label}`);

    if (s.passed.length) {
      txtLines.push("Fortalezas:");
      for (const p of s.passed) txtLines.push(`- ${p}`);
    }

    if (s.failed.length) {
      txtLines.push("Debilidades:");
      for (const f of s.failed) txtLines.push(`- ${f}`);
    }

    if (s.recommendations.length) {
      txtLines.push("Recomendaciones:");
      for (const r of s.recommendations) txtLines.push(`- ${r}`);
    }
  }

  txtLines.push("");
  txtLines.push("DICTAMEN");
  txtLines.push(report.verdict);

  if (missing.length) {
    txtLines.push("");
    txtLines.push("ARCHIVOS NO ENCONTRADOS");
    for (const m of missing) txtLines.push(`- ${m}`);
  }

  fs.writeFileSync(reportTxtPath, txtLines.join("\n"), "utf8");

  report.reportJsonPath = reportJsonPath;
  report.reportTxtPath = reportTxtPath;

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main();
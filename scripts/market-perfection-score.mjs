// scripts/market-perfection-score.mjs
//
// Evaluador de perfeccionamiento BestSeller AI frente a las mejores apps del mercado.
// Puntuación global: 1/10 a 10/10.
//
// Evalúa:
// 1. Producto y propuesta premium
// 2. Generación editorial IA
// 3. Títulos, subtítulos y blueprint
// 4. Investigación real y fuentes
// 5. Control factual y anti-invención
// 6. Calidad de capítulos
// 7. UX/UI y flujo de usuario
// 8. Persistencia y recuperación
// 9. Seguridad y control de acceso
// 10. Escalabilidad y producción
// 11. Monetización y operación SaaS
// 12. Diferenciación frente al mercado
//
// Uso:
// node scripts/market-perfection-score.mjs
// node scripts/market-perfection-score.mjs --build
// node scripts/market-perfection-score.mjs --tsc
// node scripts/market-perfection-score.mjs --audit
// node scripts/market-perfection-score.mjs --full
// node scripts/market-perfection-score.mjs --json

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));

const RUN_BUILD = ARGS.has("--build") || ARGS.has("--full");
const RUN_TSC = ARGS.has("--tsc") || ARGS.has("--full");
const RUN_AUDIT = ARGS.has("--audit") || ARGS.has("--full");
const JSON_MODE = ARGS.has("--json");

const FILES = {
  app: "App.tsx",
  packageJson: "package.json",
  types: "types.ts",

  gemini: "src/lib/gemini.ts",
  editor: "src/lib/editor.ts",
  composer: "api/composer.ts",
  repo: "src/data/repo.ts",
  supabase: "src/lib/supabase.ts",
  typesLocal: "src/lib/types.local.ts",

  bookViewer: "components/BookViewer.tsx",
  toc: "components/TableOfContents.tsx",
  dashboard: "components/GenerationDashboard.tsx",
  chat: "components/ChatInterface.tsx",
  authGate: "components/AuthGate.tsx",

  elitePromptBank: "src/lib/elite/elite-prompt-bank.ts",
  eliteQualityGate: "src/lib/elite/elite-quality-gate.ts",
  eliteResearch: "src/lib/elite/elite-research-contract.ts",
  eliteNormalizer: "src/lib/elite/elite-blueprint-normalizer.ts",
  eliteSql: "sql/elite-research-schema.sql",
};

const MARKET_STANDARD = {
  description:
    "Benchmark interno contra plataformas premium de escritura, IA editorial, investigación, SaaS y generación de libros largos.",
  perfect10: [
    "Blueprint editorial antes de escribir.",
    "Títulos, subtítulos, capítulos y subtítulos internos creados con IA.",
    "Investigación real con fuentes verificables.",
    "Separación entre hechos, inferencias, opiniones y controversias.",
    "Generación larga en texto plano, no JSON forzado.",
    "Fact-check automático posterior por capítulo.",
    "Versionado, snapshots y recuperación.",
    "UX clara para crear, revisar, editar, aprobar y exportar libros.",
    "Seguridad SaaS con control de acceso, rate limit y uso por usuario.",
    "Escalabilidad para múltiples usuarios, costos controlados y monetización.",
    "Diferenciación clara frente a apps genéricas de IA.",
  ],
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
    pattern.lastIndex = 0;
    return pattern.test(text);
  }

  return text.includes(pattern);
}

function count(text, pattern) {
  if (!text) return 0;

  const re =
    pattern instanceof RegExp
      ? new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")
      : new RegExp(escapeRegExp(String(pattern)), "g");

  return [...text.matchAll(re)].length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(n) {
  return Math.max(1, Math.min(10, Number(n.toFixed(1))));
}

function label(score) {
  if (score >= 9.5) return "CLASE MUNDIAL / NIVEL DOMINANTE";
  if (score >= 9) return "EXCELENTE / LISTA PARA COMPETIR FUERTE";
  if (score >= 8) return "MUY BUENA / PRODUCTO PREMIUM EN FORMACIÓN";
  if (score >= 7) return "BUENA / BASE COMERCIAL SERIA";
  if (score >= 6) return "ACEPTABLE / NECESITA PROFUNDIZACIÓN";
  if (score >= 5) return "DÉBIL / TODAVÍA NO COMPITE ARRIBA";
  return "CRÍTICA / PROTOTIPO O SISTEMA INMADURO";
}

function level(score) {
  if (score >= 9.5) return "Puede aspirar a ser líder si la ejecución comercial acompaña.";
  if (score >= 9) return "Puede competir contra soluciones premium con mejoras puntuales.";
  if (score >= 8) return "Tiene base premium, pero todavía requiere automatización, investigación y QA.";
  if (score >= 7) return "Puede venderse en nicho, pero no domina el mercado.";
  if (score >= 6) return "Funciona, pero todavía se percibe como herramienta incompleta.";
  return "No debe lanzarse como producto premium sin correcciones fuertes.";
}

function runCommand(command, timeout = 180000) {
  try {
    const output = execSync(command, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout,
    });

    return {
      ok: true,
      command,
      output: output.slice(-6000),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      command,
      output: String(error?.stdout ?? "").slice(-4000),
      error: (String(error?.stderr ?? "") + "\n" + String(error?.message ?? "")).slice(-6000),
    };
  }
}

function points(checks) {
  let score = 1;
  const passed = [];
  const failed = [];
  const critical = [];

  for (const check of checks) {
    if (check.pass) {
      score += check.points;
      passed.push(check.label);
    } else {
      failed.push(check.label);
      if (check.critical) critical.push(check.label);
    }
  }

  return {
    score: clamp(score),
    passed,
    failed,
    critical,
  };
}

function area(name, weight, result, marketExpectation, recommendations) {
  return {
    name,
    weight,
    score: result.score,
    label: label(result.score),
    marketExpectation,
    passed: result.passed,
    failed: result.failed,
    critical: result.critical,
    recommendations,
  };
}

const ctx = {};
for (const [key, file] of Object.entries(FILES)) {
  ctx[key] = read(file);
}
ctx.all = Object.values(ctx).join("\n");

function evaluateProductPremium() {
  const result = points([
    {
      label: "Tiene identidad de producto clara BestSeller",
      pass: has(ctx.app, "BestSeller") || has(ctx.packageJson, "bestseller"),
      points: 0.8,
    },
    {
      label: "Tiene flujo de creación de libro nuevo",
      pass: has(ctx.app, "handleStartNewBook") && has(ctx.app, "createProject"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene área de chat o interacción editorial",
      pass: has(ctx.chat, "ChatInterface") || has(ctx.app, "messages"),
      points: 0.8,
    },
    {
      label: "Tiene vista de libro",
      pass: has(ctx.bookViewer, "BookViewer") || has(ctx.app, "BookViewer"),
      points: 0.8,
    },
    {
      label: "Tiene tabla de contenido",
      pass: has(ctx.toc, "TableOfContents") || has(ctx.app, "TableOfContents"),
      points: 0.8,
    },
    {
      label: "Tiene dashboard de generación",
      pass: has(ctx.dashboard, "GenerationDashboard") || has(ctx.app, "GenerationDashboard"),
      points: 0.8,
    },
    {
      label: "Tiene settings o configuración de palabras por capítulo",
      pass: has(ctx.app, "defaultChapterWords") || has(ctx.app, "getUserSettings"),
      points: 0.8,
    },
    {
      label: "Tiene control de aprobación / acceso",
      pass: has(ctx.app, "has_access") && has(ctx.app, "profiles"),
      points: 0.9,
    },
    {
      label: "Tiene flujo multi-proyecto",
      pass: has(ctx.app, "listProjects") && has(ctx.app, "activeProjectId"),
      points: 0.9,
    },
    {
      label: "Tiene diferenciación editorial avanzada, no solo chat genérico",
      pass:
        has(ctx.all, "editorial_blueprint") ||
        has(ctx.all, "outline_12") ||
        has(ctx.all, "BUILD_FULL_DOSSIER"),
      points: 1.4,
      critical: true,
    },
  ]);

  return area(
    "Producto y propuesta premium",
    1.1,
    result,
    "Las mejores apps no son solo chat: tienen flujo, proyectos, estructura, edición, revisión y exportación.",
    [
      "Agregar onboarding comercial: tipo de libro, audiencia, objetivo, tono, nivel de investigación y extensión.",
      "Agregar modo 'Libro Premium' con pasos visibles: Blueprint → Investigación → Dossier → Capítulos → Revisión → Exportación.",
      "Agregar pantalla de comparación de calidad por libro.",
    ]
  );
}

function evaluateAIEditorialEngine() {
  const result = points([
    {
      label: "Usa Gemini / motor IA",
      pass: has(ctx.gemini, "@google/genai") || has(ctx.composer, "@google/genai"),
      points: 0.8,
      critical: true,
    },
    {
      label: "Tiene tareas editoriales diferenciadas",
      pass:
        has(ctx.all, "GENERATE_PROPOSAL") &&
        has(ctx.all, "GENERATE_INTRODUCTION") &&
        has(ctx.all, "GENERATE_CHAPTER"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene dossier inicial",
      pass: has(ctx.all, "BUILD_FULL_DOSSIER"),
      points: 0.9,
    },
    {
      label: "Genera capítulos largos como texto plano",
      pass:
        has(ctx.all, "texto plano") ||
        has(ctx.all, "SOLO TEXTO PLANO") ||
        has(ctx.all, "isLongTextAction"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene continuación automática para alcanzar palabras",
      pass: has(ctx.gemini, "ensureMinWordsByContinuing"),
      points: 1.0,
    },
    {
      label: "Evita repetición al continuar",
      pass: has(ctx.gemini, "appendNonRepeating"),
      points: 0.8,
    },
    {
      label: "Tiene fallback de modelos",
      pass: has(ctx.gemini, "getFallbackModels"),
      points: 0.8,
    },
    {
      label: "Tiene retry para 429/503",
      pass: has(ctx.gemini, "withRetry") || has(ctx.all, "429") || has(ctx.all, "503"),
      points: 0.8,
    },
    {
      label: "Tiene prompts por dominio editorial",
      pass:
        has(ctx.all, "detectEditorialDomain") ||
        has(ctx.all, "detectEliteDomain"),
      points: 1.0,
    },
    {
      label: "Tiene capa Elite separada de prompts",
      pass: has(ctx.elitePromptBank, "buildEliteBlueprintPrompt"),
      points: 1.1,
    },
  ]);

  return area(
    "Motor IA editorial",
    1.2,
    result,
    "Las mejores apps tienen tareas separadas, memoria de proyecto, generación larga robusta, reintentos y control por tipo de contenido.",
    [
      "Conectar formalmente buildEliteBlueprintPrompt al flujo real antes de createProject.",
      "Agregar generación en cola para proyectos largos.",
      "Agregar selector de modelo según tarea: barato para outline, fuerte para capítulos y auditoría.",
    ]
  );
}

function evaluateBlueprintTitlesSubtitles() {
  const result = points([
    {
      label: "Extrae título desde idea del usuario",
      pass: has(ctx.app, "extractBookTitleFromIdea"),
      points: 0.8,
    },
    {
      label: "Extrae títulos explícitos de capítulos",
      pass: has(ctx.app, "extractChapterTitlesFromIdea"),
      points: 0.9,
    },
    {
      label: "Tiene subtítulos internos subheads_h2",
      pass: has(ctx.all, "subheads_h2"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene blueprint editorial",
      pass: has(ctx.all, "editorial_blueprint"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Genera candidatos de título",
      pass: has(ctx.all, "title_candidates"),
      points: 0.8,
    },
    {
      label: "Genera candidatos de subtítulo",
      pass: has(ctx.all, "subtitle_candidates"),
      points: 0.8,
    },
    {
      label: "Normaliza blueprint",
      pass: has(ctx.eliteNormalizer, "normalizeEliteBlueprint"),
      points: 0.8,
    },
    {
      label: "Tiene quality score para títulos",
      pass: has(ctx.eliteQualityGate, "scoreEliteTitle"),
      points: 0.8,
    },
    {
      label: "Penaliza títulos genéricos",
      pass:
        has(ctx.eliteQualityGate, "hasBadTitle") ||
        has(ctx.all, "Panorama general"),
      points: 0.8,
    },
    {
      label: "Capítulos tienen tesis, objetivo, puntos, subtítulos y datos requeridos",
      pass:
        has(ctx.all, "chapter_thesis") &&
        has(ctx.all, "required_facts") &&
        has(ctx.all, "source_needs"),
      points: 1.3,
      critical: true,
    },
  ]);

  return area(
    "Blueprint, títulos y subtítulos",
    1.25,
    result,
    "Una app de élite no improvisa el libro: primero diseña título, subtítulo, tesis, capítulos, subtítulos, fuentes y riesgos.",
    [
      "Hacer obligatorio el Blueprint antes de guardar el libro.",
      "Bloquear generación si el outline obtiene menos de 8/10.",
      "Mostrar al usuario 3 títulos y subtítulos para aprobar o regenerar.",
    ]
  );
}

function evaluateResearchSources() {
  const result = points([
    {
      label: "Tiene concepto de research_context",
      pass: has(ctx.all, "research_context") || has(ctx.all, "researchContext"),
      points: 0.8,
    },
    {
      label: "Tiene contrato de investigación",
      pass: has(ctx.eliteResearch, "EliteResearchSource"),
      points: 0.8,
    },
    {
      label: "Tiene tabla research_sources",
      pass: has(ctx.eliteSql, "research_sources") || has(ctx.all, "research_sources"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene tabla research_facts",
      pass: has(ctx.eliteSql, "research_facts") || has(ctx.all, "research_facts"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene scoring de confiabilidad",
      pass: has(ctx.all, "reliability_score"),
      points: 0.8,
    },
    {
      label: "Tiene estados VERIFIED / DISPUTED / UNVERIFIED",
      pass:
        has(ctx.all, "VERIFIED") &&
        has(ctx.all, "DISPUTED") &&
        has(ctx.all, "UNVERIFIED"),
      points: 0.8,
    },
    {
      label: "Tiene endpoint o módulo real para investigar fuentes",
      pass:
        has(ctx.all, "COLLECT_SOURCES") ||
        has(ctx.all, "EXTRACT_FACTS") ||
        has(ctx.all, "/api/research"),
      points: 1.2,
      critical: true,
    },
    {
      label: "Tiene scraping/parsing real de páginas",
      pass:
        has(ctx.all, "cheerio") ||
        has(ctx.all, "JSDOM") ||
        has(ctx.all, "Readability") ||
        has(ctx.all, "DOMParser") ||
        has(ctx.all, "extractHtml"),
      points: 1.2,
      critical: true,
    },
    {
      label: "Tiene búsqueda web o API de fuentes",
      pass:
        has(ctx.all, "search") &&
        (
          has(ctx.all, "fetch(") ||
          has(ctx.all, "serp") ||
          has(ctx.all, "brave") ||
          has(ctx.all, "tavily") ||
          has(ctx.all, "exa")
        ),
      points: 1.2,
      critical: true,
    },
    {
      label: "Compacta fuentes para el prompt",
      pass: has(ctx.eliteResearch, "compactResearchForPrompt"),
      points: 1.0,
    },
  ]);

  return area(
    "Investigación real, scraping y fuentes",
    1.45,
    result,
    "Para superar el mercado en historia, biografía y finanzas, la app necesita fuentes reales, extracción, clasificación y verificación.",
    [
      "Crear /api/research con búsqueda web, extracción de páginas y resumen de fuentes.",
      "Guardar cada fuente en research_sources y cada afirmación en research_facts.",
      "Pasar research_context por capítulo, no solo a nivel de libro.",
    ]
  );
}

function evaluateFactualQA() {
  const result = points([
    {
      label: "Reglas de no inventar datos",
      pass: has(ctx.all, "No inventes") || has(ctx.all, "no inventes"),
      points: 0.8,
    },
    {
      label: "Distingue hechos, inferencias y controversias",
      pass:
        has(ctx.all, "hechos") &&
        has(ctx.all, "inferencias") &&
        has(ctx.all, "controversias"),
      points: 0.8,
    },
    {
      label: "Tiene reglas específicas para historia",
      pass: has(ctx.all, "HISTORY") || has(ctx.all, "HISTORIA"),
      points: 0.7,
    },
    {
      label: "Tiene reglas específicas para biografía",
      pass: has(ctx.all, "BIOGRAPHY") || has(ctx.all, "BIOGRAF"),
      points: 0.7,
    },
    {
      label: "Tiene reglas específicas para finanzas",
      pass: has(ctx.all, "FINANCE") || has(ctx.all, "FINANZAS"),
      points: 0.7,
    },
    {
      label: "Tiene fact-check prompt",
      pass: has(ctx.elitePromptBank, "buildEliteFactCheckPrompt"),
      points: 1.0,
      critical: true,
    },
    {
      label: "Tiene tabla de reportes de calidad por capítulo",
      pass: has(ctx.eliteSql, "chapter_quality_reports") || has(ctx.all, "chapter_quality_reports"),
      points: 0.9,
    },
    {
      label: "Detecta unsupported_claims",
      pass: has(ctx.all, "unsupported_claims"),
      points: 0.9,
    },
    {
      label: "Detecta hallucinations",
      pass: has(ctx.all, "hallucinations") || has(ctx.all, "alucin"),
      points: 0.9,
    },
    {
      label: "Ejecuta fact-check automáticamente después de cada capítulo",
      pass:
        has(ctx.all, "FACT_CHECK_CHAPTER") ||
        has(ctx.all, "runChapterFactCheck") ||
        has(ctx.all, "buildEliteFactCheckPrompt("),
      points: 1.6,
      critical: true,
    },
  ]);

  return area(
    "Control factual y QA anti-invención",
    1.35,
    result,
    "Las mejores apps de no ficción deben verificar capítulos, no solo confiar en el prompt inicial.",
    [
      "Después de GENERATE_CHAPTER ejecutar FACT_CHECK_CHAPTER automáticamente.",
      "Si score < 8, reescribir capítulo con instrucciones del auditor.",
      "Marcar visualmente datos no verificados dentro del editor.",
    ]
  );
}

function evaluateChapterQuality() {
  const result = points([
    {
      label: "Tiene score de capítulo",
      pass: has(ctx.eliteQualityGate, "scoreEliteChapterText"),
      points: 1.0,
    },
    {
      label: "Evalúa longitud mínima",
      pass: has(ctx.eliteQualityGate, "minWords") || has(ctx.gemini, "targetWords"),
      points: 0.8,
    },
    {
      label: "Evalúa subtítulos internos",
      pass: has(ctx.eliteQualityGate, "expectedSubheads") || has(ctx.all, "subheads_h2"),
      points: 0.8,
    },
    {
      label: "Evita bibliografía dentro del capítulo",
      pass: has(ctx.all, "No incluyas bibliografía") || has(ctx.all, "bibliografía dentro del capítulo"),
      points: 0.8,
    },
    {
      label: "Sanitiza contenido editorial",
      pass: has(ctx.editor, "sanitizeEditorialChapterText") || has(ctx.gemini, "sanitizeEditorialChapterText"),
      points: 0.8,
    },
    {
      label: "Reconstruye master_document desde estado",
      pass: has(ctx.editor, "buildMasterFromState") || has(ctx.gemini, "buildMasterFromState"),
      points: 0.8,
    },
    {
      label: "Tiene recomputeGenerationProgress",
      pass: has(ctx.editor, "recomputeGenerationProgress") || has(ctx.app, "recomputeGenerationProgress"),
      points: 0.7,
    },
    {
      label: "Tiene modo de reescritura si la calidad es baja",
      pass:
        has(ctx.all, "mustRewrite") ||
        has(ctx.all, "REWRITE_CHAPTER") ||
        has(ctx.all, "rewrite_instructions"),
      points: 1.0,
    },
    {
      label: "Evalúa repetición de párrafos",
      pass: has(ctx.eliteQualityGate, "repeatedParagraphs"),
      points: 0.8,
    },
    {
      label: "Tiene quality gate conectado al flujo real de generación",
      pass:
        has(ctx.app, "scoreEliteChapterText") ||
        has(ctx.gemini, "scoreEliteChapterText") ||
        has(ctx.composer, "scoreEliteChapterText"),
      points: 1.5,
      critical: true,
    },
  ]);

  return area(
    "Calidad de capítulos y reescritura",
    1.2,
    result,
    "Un sistema superior no solo escribe; mide, corrige y reescribe hasta llegar al estándar.",
    [
      "Conectar scoreEliteChapterText después de cada capítulo.",
      "Guardar el score en chapter_quality_reports.",
      "Crear botón 'Mejorar a 10/10' por capítulo.",
    ]
  );
}

function evaluateUX() {
  const result = points([
    {
      label: "Tiene chat/interface",
      pass: Boolean(ctx.chat) || has(ctx.app, "ChatInterface"),
      points: 0.7,
    },
    {
      label: "Tiene lector de libro",
      pass: Boolean(ctx.bookViewer) || has(ctx.app, "BookViewer"),
      points: 0.7,
    },
    {
      label: "Tiene tabla de contenido",
      pass: Boolean(ctx.toc) || has(ctx.app, "TableOfContents"),
      points: 0.7,
    },
    {
      label: "Tiene dashboard de generación",
      pass: Boolean(ctx.dashboard) || has(ctx.app, "GenerationDashboard"),
      points: 0.7,
    },
    {
      label: "Tiene indicadores de progreso",
      pass: has(ctx.all, "generation_progress") || has(ctx.all, "progress"),
      points: 0.8,
    },
    {
      label: "Tiene mensajes de error al usuario",
      pass: has(ctx.app, "setError") || has(ctx.all, "normalizeError"),
      points: 0.7,
    },
    {
      label: "Tiene bloqueo mientras genera",
      pass: has(ctx.app, "isLoading") || has(ctx.app, "anyGenerating"),
      points: 0.7,
    },
    {
      label: "Tiene aprobación manual o control del flujo",
      pass: has(ctx.all, "approval") || has(ctx.all, "aprobación") || has(ctx.all, "manual"),
      points: 0.7,
    },
    {
      label: "Tiene flujo visual de Blueprint / Investigación / Revisión",
      pass:
        has(ctx.all, "Blueprint") &&
        has(ctx.all, "Investigación") &&
        has(ctx.all, "Revisión"),
      points: 1.2,
    },
    {
      label: "Tiene exportación profesional PDF/DOCX/EPUB",
      pass:
        has(ctx.all, "export") ||
        has(ctx.all, "pdf") ||
        has(ctx.all, "docx") ||
        has(ctx.all, "epub"),
      points: 1.4,
      critical: true,
    },
  ]);

  return area(
    "UX/UI y flujo profesional",
    1.0,
    result,
    "El mercado premium exige claridad: dónde estoy, qué falta, qué calidad tiene y cómo exporto.",
    [
      "Agregar pantalla de pipeline: Blueprint → Research → Outline → Writing → Fact-check → Export.",
      "Agregar botones: Regenerar título, Aprobar outline, Mejorar capítulo, Exportar.",
      "Agregar exportación DOCX, PDF y EPUB.",
    ]
  );
}

function evaluatePersistenceRecovery() {
  const result = points([
    {
      label: "Usa Supabase",
      pass: has(ctx.all, "supabase"),
      points: 0.8,
    },
    {
      label: "Crea proyectos",
      pass: has(ctx.repo, "createProject") || has(ctx.app, "createProject"),
      points: 0.8,
    },
    {
      label: "Lista proyectos",
      pass: has(ctx.repo, "listProjects") || has(ctx.app, "listProjects"),
      points: 0.8,
    },
    {
      label: "Actualiza proyectos",
      pass: has(ctx.repo, "updateProject") || has(ctx.app, "updateProject"),
      points: 0.8,
    },
    {
      label: "Guarda secciones",
      pass: has(ctx.repo, "upsertSection") || has(ctx.app, "upsertSection"),
      points: 0.8,
    },
    {
      label: "Guarda versiones",
      pass: has(ctx.repo, "insertSectionVersion") || has(ctx.all, "section_versions"),
      points: 0.8,
    },
    {
      label: "Guarda snapshots",
      pass: has(ctx.repo, "insertMasterSnapshot") || has(ctx.all, "master_snapshots"),
      points: 0.8,
    },
    {
      label: "Tiene recuperación de proyecto completo",
      pass: has(ctx.repo, "getProjectFull") || has(ctx.app, "getProjectFull"),
      points: 0.8,
    },
    {
      label: "Tiene persistencia de investigación",
      pass: has(ctx.all, "research_sources") && has(ctx.all, "research_facts"),
      points: 1.2,
    },
    {
      label: "Tiene cola o job system para generaciones largas",
      pass:
        has(ctx.all, "queue") ||
        has(ctx.all, "job") ||
        has(ctx.all, "worker") ||
        has(ctx.all, "background"),
      points: 1.4,
      critical: true,
    },
  ]);

  return area(
    "Persistencia, recuperación y trabajo largo",
    1.05,
    result,
    "Una app de libros largos debe recuperar estado, versiones, snapshots, investigación y jobs largos.",
    [
      "Agregar tabla generation_jobs para colas de capítulos.",
      "Permitir pausar/reanudar generación.",
      "Agregar historial de versiones visible por sección.",
    ]
  );
}

function evaluateSecuritySaaS() {
  const result = points([
    {
      label: "Tiene auth Supabase",
      pass: has(ctx.app, "supabase.auth") || has(ctx.authGate, "auth"),
      points: 0.8,
    },
    {
      label: "Tiene perfiles con has_access",
      pass: has(ctx.app, "has_access") && has(ctx.app, "profiles"),
      points: 0.8,
    },
    {
      label: "Tiene control de sesión/dispositivo",
      pass: has(ctx.app, "DEVICE_STORAGE_KEY") && has(ctx.app, "deviceAllowed"),
      points: 0.8,
    },
    {
      label: "API usa GEMINI_API_KEY privada",
      pass: has(ctx.composer, "process.env.GEMINI_API_KEY"),
      points: 0.9,
    },
    {
      label: "Endpoint protegido con shared secret",
      pass: has(ctx.composer, "COMPOSER_SHARED_SECRET"),
      points: 0.9,
    },
    {
      label: "Valida método POST",
      pass: has(ctx.composer, "req.method !== 'POST'"),
      points: 0.7,
    },
    {
      label: "Tiene allowlist de modelos",
      pass: has(ctx.composer, "ALLOWED_MODELS"),
      points: 0.7,
    },
    {
      label: "Tiene manejo de cuota y rate errors",
      pass: has(ctx.all, "quota") || has(ctx.all, "RESOURCE_EXHAUSTED") || has(ctx.all, "429"),
      points: 0.7,
    },
    {
      label: "Tiene rate limit propio por usuario/IP",
      pass:
        has(ctx.all, "rateLimit") ||
        has(ctx.all, "RATE_LIMIT") ||
        has(ctx.all, "limit_ip") ||
        has(ctx.all, "usage_limit"),
      points: 1.4,
      critical: true,
    },
    {
      label: "Tiene medición de consumo/costos por usuario",
      pass:
        has(ctx.all, "tokens") ||
        has(ctx.all, "usage") ||
        has(ctx.all, "billing") ||
        has(ctx.all, "credits"),
      points: 1.3,
      critical: true,
    },
  ]);

  return area(
    "Seguridad, SaaS y control de costos",
    1.1,
    result,
    "La diferencia entre prototipo y SaaS premium está en seguridad, límites, costos, usuarios y facturación.",
    [
      "Agregar tabla usage_events con tokens, modelo, costo estimado, usuario y proyecto.",
      "Agregar rate limit por usuario y por IP en /api/composer.",
      "Eliminar uso de VITE_GEMINI_API_KEY en producción.",
    ]
  );
}

function evaluateProductionScale() {
  let build = null;
  let tsc = null;
  let audit = null;

  if (RUN_BUILD) build = runCommand("npm run build");
  if (RUN_TSC) tsc = runCommand("npx tsc --noEmit");
  if (RUN_AUDIT) audit = runCommand("npm audit --audit-level=high");

  const result = points([
    {
      label: "Tiene package.json",
      pass: Boolean(ctx.packageJson),
      points: 0.6,
    },
    {
      label: "Tiene script build",
      pass: has(ctx.packageJson, '"build"'),
      points: 0.7,
    },
    {
      label: "Tiene TypeScript",
      pass: has(ctx.packageJson, "typescript") || has(ctx.packageJson, "vite"),
      points: 0.7,
    },
    {
      label: "Tiene Vite build",
      pass: has(ctx.packageJson, "vite"),
      points: 0.7,
    },
    {
      label: "Tiene validación/parsing robusto de JSON",
      pass: has(ctx.all, "safeJsonParse"),
      points: 0.8,
    },
    {
      label: "Tiene fallback si falla el dossier",
      pass: has(ctx.all, "buildSafeDossierFallback") || has(ctx.all, "fallback"),
      points: 0.8,
    },
    {
      label: "Tiene tests automatizados reales",
      pass:
        has(ctx.packageJson, '"test"') &&
        !has(ctx.packageJson, '"test": "echo'),
      points: 1.2,
      critical: true,
    },
    {
      label: "Build pasó en esta evaluación",
      pass: build ? build.ok : false,
      points: RUN_BUILD ? 1.2 : 0,
    },
    {
      label: "TypeScript pasó en esta evaluación",
      pass: tsc ? tsc.ok : false,
      points: RUN_TSC ? 1.1 : 0,
    },
    {
      label: "Audit high pasó en esta evaluación",
      pass: audit ? audit.ok : false,
      points: RUN_AUDIT ? 1.2 : 0,
    },
  ]);

  const section = area(
    "Producción, pruebas y escalabilidad técnica",
    1.1,
    result,
    "Las mejores apps tienen build limpio, tests, auditoría, logs, colas, observabilidad y despliegue estable.",
    [
      "Agregar suite de tests para títulos, outline, JSON/texto plano, estado limpio y calidad.",
      "Agregar logs estructurados por project_id, action y user_id.",
      "Agregar healthcheck y monitoreo de errores.",
    ]
  );

  section.commandResults = { build, tsc, audit };
  return section;
}

function evaluateMonetization() {
  const result = points([
    {
      label: "Tiene usuarios y acceso",
      pass: has(ctx.app, "profiles") && has(ctx.app, "has_access"),
      points: 0.8,
    },
    {
      label: "Tiene solicitudes de acceso",
      pass: has(ctx.app, "access_requests"),
      points: 0.7,
    },
    {
      label: "Tiene settings por usuario",
      pass: has(ctx.all, "user_settings") || has(ctx.app, "getUserSettings"),
      points: 0.7,
    },
    {
      label: "Tiene control de créditos o planes",
      pass:
        has(ctx.all, "credits") ||
        has(ctx.all, "plan") ||
        has(ctx.all, "subscription") ||
        has(ctx.all, "billing"),
      points: 1.3,
      critical: true,
    },
    {
      label: "Tiene límites por plan",
      pass:
        has(ctx.all, "usage_limit") ||
        has(ctx.all, "plan_limits") ||
        has(ctx.all, "max_books") ||
        has(ctx.all, "max_chapters"),
      points: 1.2,
      critical: true,
    },
    {
      label: "Tiene pricing o monetización",
      pass:
        has(ctx.all, "pricing") ||
        has(ctx.all, "stripe") ||
        has(ctx.all, "checkout") ||
        has(ctx.all, "payment"),
      points: 1.2,
      critical: true,
    },
    {
      label: "Tiene métricas de uso",
      pass: has(ctx.all, "usage") || has(ctx.all, "analytics") || has(ctx.all, "metrics"),
      points: 1.0,
    },
    {
      label: "Tiene roles admin/usuario",
      pass: has(ctx.all, "admin") || has(ctx.all, "role") || has(ctx.all, "roles"),
      points: 0.8,
    },
    {
      label: "Tiene control de dispositivo como diferencial",
      pass: has(ctx.app, "deviceAllowed") && has(ctx.app, "heartbeat"),
      points: 0.8,
    },
    {
      label: "Tiene exportación como producto vendible",
      pass:
        has(ctx.all, "export") ||
        has(ctx.all, "pdf") ||
        has(ctx.all, "docx") ||
        has(ctx.all, "epub"),
      points: 1.3,
    },
  ]);

  return area(
    "Monetización, operación y SaaS",
    1.0,
    result,
    "Para superar el mercado no basta generar texto: hay que cobrar, limitar, medir, exportar y operar.",
    [
      "Agregar planes: Básico, Pro, Agencia, Editorial.",
      "Agregar créditos por libro/capítulo y consumo de tokens.",
      "Agregar Stripe o sistema local de pagos.",
    ]
  );
}

function evaluateDifferentiation() {
  const result = points([
    {
      label: "No es solo chat: tiene estructura de libro",
      pass: has(ctx.all, "outline_12") && has(ctx.all, "chapters"),
      points: 0.9,
    },
    {
      label: "Tiene generación larga",
      pass: has(ctx.gemini, "ensureMinWordsByContinuing") || has(ctx.all, "target_length_words"),
      points: 0.9,
    },
    {
      label: "Tiene control factual",
      pass: has(ctx.all, "No inventes") && has(ctx.all, "factual"),
      points: 0.9,
    },
    {
      label: "Tiene investigación como arquitectura",
      pass: has(ctx.all, "research_sources") && has(ctx.all, "research_facts"),
      points: 1.0,
    },
    {
      label: "Tiene blueprint editorial",
      pass: has(ctx.all, "editorial_blueprint"),
      points: 1.0,
    },
    {
      label: "Tiene quality gate",
      pass: has(ctx.eliteQualityGate, "scoreEliteProject"),
      points: 1.0,
    },
    {
      label: "Tiene fact-check",
      pass: has(ctx.elitePromptBank, "buildEliteFactCheckPrompt"),
      points: 1.0,
    },
    {
      label: "Tiene enfoque por género",
      pass: has(ctx.all, "HISTORY") && has(ctx.all, "FINANCE") && has(ctx.all, "BIOGRAPHY"),
      points: 0.9,
    },
    {
      label: "Tiene flujo de revisión y aprobación",
      pass: has(ctx.all, "review") || has(ctx.all, "approval") || has(ctx.all, "aprob"),
      points: 0.8,
    },
    {
      label: "Tiene ventajas que podrían superar apps genéricas",
      pass:
        has(ctx.all, "editorial_blueprint") &&
        has(ctx.all, "research_sources") &&
        has(ctx.all, "scoreEliteChapterText") &&
        has(ctx.all, "buildEliteFactCheckPrompt"),
      points: 1.5,
      critical: true,
    },
  ]);

  return area(
    "Diferenciación frente al mercado",
    1.25,
    result,
    "La app puede ganarle a herramientas genéricas si combina libro largo + investigación + fact-check + exportación + flujo editorial.",
    [
      "Convertir la capa Elite en flujo real visible.",
      "Agregar comparador de calidad 1/10 por capítulo.",
      "Crear una promesa comercial clara: libros largos con fuentes, revisión y exportación.",
    ]
  );
}

function weightedOverall(sections) {
  const totalWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const total = sections.reduce((sum, s) => sum + s.score * s.weight, 0);
  return clamp(total / totalWeight);
}

function marketGap(overall) {
  const gap = clamp(10 - overall);
  const percent = Math.round((overall / 10) * 100);

  return {
    gapToPerfect10: gap,
    marketReadinessPercent: percent,
    summary:
      overall >= 9
        ? "Está cerca de competir al más alto nivel."
        : overall >= 8
          ? "Tiene base premium, pero necesita cerrar huecos de investigación, QA y monetización."
          : overall >= 7
            ? "Puede venderse en nicho, pero todavía no supera a las mejores del mercado."
            : "Todavía necesita trabajo fuerte antes de compararse con líderes premium.",
  };
}

function buildRoadmap(sections) {
  const sorted = [...sections].sort((a, b) => a.score - b.score);

  const roadmap = [];

  for (const section of sorted.slice(0, 5)) {
    roadmap.push({
      area: section.name,
      currentScore: section.score,
      priority:
        section.score < 6
          ? "URGENTE"
          : section.score < 8
            ? "ALTA"
            : "MEDIA",
      actions: section.recommendations.slice(0, 4),
      criticalMissing: section.critical.slice(0, 5),
    });
  }

  return roadmap;
}

function buildDictamen(overall, sections) {
  const research = sections.find((s) => s.name.includes("Investigación"));
  const qa = sections.find((s) => s.name.includes("Control factual"));
  const ux = sections.find((s) => s.name.includes("UX"));
  const monetization = sections.find((s) => s.name.includes("Monetización"));
  const production = sections.find((s) => s.name.includes("Producción"));

  const lines = [];

  lines.push(`Puntuación general: ${overall}/10 — ${label(overall)}.`);
  lines.push(level(overall));

  if (research && research.score < 8) {
    lines.push("El mayor salto competitivo vendrá de investigación real: búsqueda, scraping, fuentes, hechos y research_context por capítulo.");
  }

  if (qa && qa.score < 8) {
    lines.push("Para libros históricos, biográficos y financieros, el fact-check automático por capítulo es obligatorio.");
  }

  if (ux && ux.score < 8) {
    lines.push("La UX debe mostrar un pipeline profesional: Blueprint, Investigación, Redacción, Revisión y Exportación.");
  }

  if (monetization && monetization.score < 8) {
    lines.push("Para competir como SaaS, falta control de planes, créditos, costos, uso y pagos.");
  }

  if (production && production.score < 8) {
    lines.push("Para producción seria, faltan pruebas automáticas, monitoreo y colas de trabajos largos.");
  }

  if (overall >= 9) {
    lines.push("Con ejecución comercial, esta app puede posicionarse como producto premium especializado en libros largos.");
  } else if (overall >= 8) {
    lines.push("La base es buena, pero todavía no debe prometer ser la mejor hasta integrar investigación real y quality gate en vivo.");
  } else {
    lines.push("El enfoque correcto es seguir perfeccionando antes de venderla como la mejor del mercado.");
  }

  return lines.join("\n");
}

function saveReport(report) {
  const reportsDir = path.join(ROOT, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, "market-perfection-score.json");
  const txtPath = path.join(reportsDir, "market-perfection-score.txt");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const lines = [];

  lines.push("BESTSELLER AI — MARKET PERFECTION SCORE");
  lines.push("====================================================");
  lines.push(`Fecha: ${report.date}`);
  lines.push(`Proyecto: ${report.root}`);
  lines.push(`Puntuación general: ${report.overall}/10 — ${report.label}`);
  lines.push(`Preparación frente al mercado: ${report.marketGap.marketReadinessPercent}%`);
  lines.push(`Brecha hasta 10/10: ${report.marketGap.gapToPerfect10}`);
  lines.push("");

  lines.push("DICTAMEN");
  lines.push(report.verdict);
  lines.push("");

  lines.push("PUNTUACIÓN POR ÁREA");
  for (const s of report.sections) {
    lines.push("");
    lines.push(`${s.name}: ${s.score}/10 — ${s.label}`);
    lines.push(`Estándar de mercado: ${s.marketExpectation}`);

    if (s.passed.length) {
      lines.push("Fortalezas:");
      for (const item of s.passed) lines.push(`✅ ${item}`);
    }

    if (s.failed.length) {
      lines.push("Debilidades:");
      for (const item of s.failed) lines.push(`❌ ${item}`);
    }

    if (s.critical.length) {
      lines.push("Faltantes críticos:");
      for (const item of s.critical) lines.push(`🚨 ${item}`);
    }

    if (s.recommendations.length) {
      lines.push("Recomendaciones:");
      for (const item of s.recommendations) lines.push(`🔧 ${item}`);
    }
  }

  lines.push("");
  lines.push("ROADMAP PARA LLEGAR A 10/10");
  for (const item of report.roadmap) {
    lines.push("");
    lines.push(`${item.priority} — ${item.area} (${item.currentScore}/10)`);
    for (const action of item.actions) lines.push(`- ${action}`);
  }

  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

  report.reportJsonPath = jsonPath;
  report.reportTxtPath = txtPath;

  return report;
}

function printReport(report) {
  console.log("");
  console.log("====================================================");
  console.log("BESTSELLER AI — MARKET PERFECTION SCORE");
  console.log("====================================================");
  console.log("");
  console.log(`PUNTUACIÓN GENERAL: ${report.overall}/10`);
  console.log(report.label);
  console.log("");
  console.log(`Preparación frente al mercado: ${report.marketGap.marketReadinessPercent}%`);
  console.log(`Brecha hasta 10/10: ${report.marketGap.gapToPerfect10}`);
  console.log("");
  console.log("----------------------------------------------------");
  console.log("PUNTUACIÓN POR ÁREA");
  console.log("----------------------------------------------------");

  for (const section of report.sections) {
    console.log("");
    console.log(`${section.name}: ${section.score}/10 — ${section.label}`);

    if (section.critical.length) {
      console.log("  🚨 Críticos:");
      for (const item of section.critical.slice(0, 4)) {
        console.log(`     - ${item}`);
      }
    }

    if (section.recommendations.length) {
      console.log("  🔧 Próximo paso:");
      console.log(`     - ${section.recommendations[0]}`);
    }
  }

  console.log("");
  console.log("----------------------------------------------------");
  console.log("DICTAMEN");
  console.log("----------------------------------------------------");
  console.log(report.verdict);

  console.log("");
  console.log("----------------------------------------------------");
  console.log("ROADMAP 10/10");
  console.log("----------------------------------------------------");

  for (const item of report.roadmap) {
    console.log("");
    console.log(`${item.priority}: ${item.area} — ${item.currentScore}/10`);

    for (const action of item.actions.slice(0, 3)) {
      console.log(`  - ${action}`);
    }
  }

  console.log("");
  console.log("Reportes guardados:");
  console.log(report.reportTxtPath);
  console.log(report.reportJsonPath);
  console.log("");
}

function main() {
  const sections = [
    evaluateProductPremium(),
    evaluateAIEditorialEngine(),
    evaluateBlueprintTitlesSubtitles(),
    evaluateResearchSources(),
    evaluateFactualQA(),
    evaluateChapterQuality(),
    evaluateUX(),
    evaluatePersistenceRecovery(),
    evaluateSecuritySaaS(),
    evaluateProductionScale(),
    evaluateMonetization(),
    evaluateDifferentiation(),
  ];

  const overall = weightedOverall(sections);

  const missingFiles = Object.entries(FILES)
    .filter(([, file]) => !exists(file))
    .map(([key, file]) => ({ key, file }));

  const report = {
    date: new Date().toISOString(),
    root: ROOT,
    benchmark: MARKET_STANDARD,
    runOptions: {
      build: RUN_BUILD,
      tsc: RUN_TSC,
      audit: RUN_AUDIT,
    },
    missingFiles,
    overall,
    label: label(overall),
    marketGap: marketGap(overall),
    sections,
    roadmap: buildRoadmap(sections),
    verdict: buildDictamen(overall, sections),
  };

  saveReport(report);

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main();
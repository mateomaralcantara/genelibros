#!/usr/bin/env node
/**
 * scripts/audit-prompts.mjs
 *
 * Auditoría para encontrar dónde vive TODO el prompt del sistema.
 *
 * Qué busca:
 * - Prompts explícitos.
 * - systemInstruction.
 * - DEV_SYSTEM_PROMPT.
 * - llamadas a Gemini/OpenAI/modelos.
 * - reglas tipo "Devuelve SOLO", "No uses Markdown", "JSON válido".
 * - instrucciones de capítulos, bibliografía, target_words, outline_12.
 * - sanitizadores que limpian texto generado.
 *
 * Qué genera:
 * - .health/prompt_audit.md
 * - .health/prompt_audit.json
 *
 * No modifica archivos. Solo lee y reporta.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".health");
const OUT_MD = path.join(OUT_DIR, "prompt_audit.md");
const OUT_JSON = path.join(OUT_DIR, "prompt_audit.json");

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".vercel",
  ".turbo",
  ".cache",
  ".health",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
]);

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-[0-9A-Za-z_-]{20,}/g,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*.*/gi,
  /VITE_SUPABASE_ANON_KEY\s*=\s*.*/gi,
  /VITE_GEMINI_API_KEY\s*=\s*.*/gi,
  /GEMINI_API_KEY\s*=\s*.*/gi,
  /OPENAI_API_KEY\s*=\s*.*/gi,
  /Authorization:\s*`?Bearer\s+\$\{[^}]+\}`?/gi,
];

const SCAN_RULES = [
  {
    category: "PROMPT_BASE",
    severity: "CRITICAL",
    patterns: [
      /\bDEV_SYSTEM_PROMPT\b/g,
      /\bSYSTEM_PROMPT\b/g,
      /\bsystemPrompt\b/g,
      /\bsystem_instruction\b/gi,
      /\bsystemInstruction\b/g,
      /\bdeveloperPrompt\b/g,
      /\binstructions?\b/gi,
      /\bprompt\s*[:=]/gi,
      /\bconst\s+\w*Prompt\w*\s*=/g,
      /\bfunction\s+\w*Prompt\w*\s*\(/g,
      /\bbuild\w*Prompt\w*\s*\(/g,
    ],
  },
  {
    category: "MODEL_CALL",
    severity: "CRITICAL",
    patterns: [
      /\bGoogleGenAI\b/g,
      /\bgenerateContent\s*\(/g,
      /\bmodels\.generateContent\s*\(/g,
      /\bchat\.completions\.create\s*\(/g,
      /\bresponses\.create\s*\(/g,
      /\bOpenAI\b/g,
      /\bmodel\s*:/g,
      /\bcontents\s*:/g,
      /\bmessages\s*:/g,
    ],
  },
  {
    category: "OUTPUT_CONTROL",
    severity: "HIGH",
    patterns: [
      /Devuelve\s+SOLO/gi,
      /NO\s+JSON/gi,
      /JSON\s+v[aá]lido/gi,
      /sin\s+Markdown/gi,
      /NO\s+Markdown/gi,
      /Markdown\s+fences/gi,
      /responseMimeType\s*:/g,
      /application\/json/g,
      /maxOutputTokens\s*:/g,
      /temperature\s*:/g,
      /topP\s*:/g,
      /topK\s*:/g,
    ],
  },
  {
    category: "BOOK_GENERATION_RULES",
    severity: "HIGH",
    patterns: [
      /Cap[ií]tulo\s+\$\{/g,
      /Cap[ií]tulo\s+\d+/gi,
      /GENERATE_CHAPTER/g,
      /GENERATE_INTRODUCTION/g,
      /GENERATE_PROPOSAL/g,
      /BUILD_FULL_DOSSIER/g,
      /outline_12/g,
      /target_words/g,
      /chapter_number/g,
      /chapter_title/g,
      /minimum|mínimo|m[ií]nimo/gi,
      /palabras/gi,
    ],
  },
  {
    category: "EDITORIAL_CLEANING",
    severity: "HIGH",
    patterns: [
      /sanitizeEditorialChapterText/g,
      /cleanPlainText/g,
      /cleanPlainModelText/g,
      /stripChapterHeader/g,
      /stripLeadingChapterNoise/g,
      /bibliograf[ií]a/gi,
      /referencias/gi,
      /fuentes/gi,
      /Act[uú]a como/gi,
      /Eres un escritor/gi,
      /Objetivo del cap[ií]tulo/gi,
      /Requisitos/gi,
    ],
  },
  {
    category: "JSON_REPAIR",
    severity: "MEDIUM",
    patterns: [
      /safeJsonParse/g,
      /repairJson/gi,
      /extractFirstJsonObject/g,
      /JSON\.parse/g,
      /validateEngineResult/g,
      /project_state_updated/g,
      /master_document/g,
      /dashboard/g,
    ],
  },
  {
    category: "STATE_MUTATION",
    severity: "MEDIUM",
    patterns: [
      /mergeProjectState/g,
      /normalizeProjectState/g,
      /processEngineResult/g,
      /buildMasterFromState/g,
      /recomputeGenerationProgress/g,
      /setProjects\s*\(/g,
      /updateProjectById/g,
      /onEditSection/g,
      /saveEdit/g,
    ],
  },
];

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function shouldSkipDir(name) {
  return EXCLUDED_DIRS.has(name);
}

function shouldScanFile(filePath) {
  const ext = path.extname(filePath);
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;

  const base = path.basename(filePath).toLowerCase();

  if (base.includes(".bak")) return false;
  if (base.endsWith(".map")) return false;
  if (base === "package-lock.json") return false;
  if (base === "pnpm-lock.yaml") return false;
  if (base === "yarn.lock") return false;

  return true;
}

function walk(dir, out = []) {
  let entries = [];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) walk(abs, out);
      continue;
    }

    if (entry.isFile() && shouldScanFile(abs)) {
      out.push(abs);
    }
  }

  return out;
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function redactSecrets(text) {
  let out = String(text ?? "");

  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED_SECRET]");
  }

  return out;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replaceAll("\\", "/");
}

function lineNumberFromIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function getLine(text, lineNumber) {
  const lines = text.split(/\r?\n/);
  return lines[lineNumber - 1] ?? "";
}

function getSnippet(text, lineNumber, radius = 2) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, lineNumber - radius);
  const end = Math.min(lines.length, lineNumber + radius);
  const chunk = [];

  for (let i = start; i <= end; i++) {
    const raw = lines[i - 1] ?? "";
    chunk.push(`${String(i).padStart(5, " ")} | ${redactSecrets(raw)}`);
  }

  return chunk.join("\n");
}

function scanFile(filePath) {
  const contentRaw = readTextSafe(filePath);
  const content = redactSecrets(contentRaw);
  const hits = [];

  for (const rule of SCAN_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const line = lineNumberFromIndex(content, match.index);
        const preview = redactSecrets(getLine(content, line).trim());

        hits.push({
          file: rel(filePath),
          line,
          category: rule.category,
          severity: rule.severity,
          match: match[0],
          pattern: String(pattern),
          preview,
          snippet: getSnippet(content, line),
        });

        if (match.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
  }

  return hits;
}

function groupByFile(hits) {
  const map = new Map();

  for (const hit of hits) {
    if (!map.has(hit.file)) {
      map.set(hit.file, []);
    }

    map.get(hit.file).push(hit);
  }

  return Array.from(map.entries())
    .map(([file, fileHits]) => ({
      file,
      hits: fileHits,
      score: scoreFile(fileHits),
      categories: Array.from(new Set(fileHits.map((h) => h.category))).sort(),
      severities: countBy(fileHits, "severity"),
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

function countBy(items, key) {
  const out = {};

  for (const item of items) {
    const k = item[key] ?? "UNKNOWN";
    out[k] = (out[k] ?? 0) + 1;
  }

  return out;
}

function scoreFile(hits) {
  let score = 0;

  for (const h of hits) {
    if (h.severity === "CRITICAL") score += 10;
    else if (h.severity === "HIGH") score += 5;
    else if (h.severity === "MEDIUM") score += 2;
    else score += 1;
  }

  return score;
}

function inferMeaning(fileGroup) {
  const cats = new Set(fileGroup.categories);
  const file = fileGroup.file.toLowerCase();

  const notes = [];

  if (cats.has("PROMPT_BASE")) {
    notes.push("Define o arma prompts/instrucciones.");
  }

  if (cats.has("MODEL_CALL")) {
    notes.push("Llama directamente al modelo.");
  }

  if (cats.has("OUTPUT_CONTROL")) {
    notes.push("Controla formato de salida: JSON, Markdown, tokens o temperatura.");
  }

  if (cats.has("BOOK_GENERATION_RULES")) {
    notes.push("Controla generación de capítulos, outline o cantidad de palabras.");
  }

  if (cats.has("EDITORIAL_CLEANING")) {
    notes.push("Limpia instrucciones internas, bibliografía, fuentes o ruido editorial.");
  }

  if (cats.has("JSON_REPAIR")) {
    notes.push("Repara o valida respuestas JSON del modelo.");
  }

  if (cats.has("STATE_MUTATION")) {
    notes.push("Fusiona estado, guarda capítulos o reconstruye el documento maestro.");
  }

  if (file.includes("gemini")) {
    notes.push("Candidato principal: cerebro de generación con Gemini.");
  }

  if (file.includes("composer")) {
    notes.push("Candidato principal: endpoint/compositor del motor editorial.");
  }

  if (file.endsWith("app.tsx")) {
    notes.push("Puede contener prompt embebido, flujo de generación y estado UI.");
  }

  if (file.includes("editor")) {
    notes.push("Suele procesar, limpiar, fusionar y reconstruir contenido.");
  }

  if (file.includes("bookviewer")) {
    notes.push("Más visor/editor que prompt; revisar si altera formato o secciones.");
  }

  return notes.length ? notes.join(" ") : "Coincidencias generales relacionadas al flujo.";
}

function escapeMd(text) {
  return String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function makeMarkdown({ filesScanned, hits, groups }) {
  const byCategory = countBy(hits, "category");
  const bySeverity = countBy(hits, "severity");

  let md = "";

  md += "# Auditoría de prompts\n\n";
  md += `Generado: ${new Date().toISOString()}\n\n`;
  md += `Proyecto: \`${escapeMd(ROOT)}\`\n\n`;
  md += `Archivos escaneados: **${filesScanned}**\n\n`;
  md += `Coincidencias encontradas: **${hits.length}**\n\n`;

  md += "## Resumen ejecutivo\n\n";

  if (!hits.length) {
    md += "No se encontraron prompts ni llamadas claras al modelo con los patrones actuales.\n\n";
    return md;
  }

  md += "### Por severidad\n\n";
  md += "| Severidad | Cantidad |\n";
  md += "|---|---:|\n";
  for (const [severity, total] of Object.entries(bySeverity).sort()) {
    md += `| ${escapeMd(severity)} | ${total} |\n`;
  }

  md += "\n### Por categoría\n\n";
  md += "| Categoría | Cantidad |\n";
  md += "|---|---:|\n";
  for (const [category, total] of Object.entries(byCategory).sort()) {
    md += `| ${escapeMd(category)} | ${total} |\n`;
  }

  md += "\n## Archivos más importantes\n\n";
  md += "| Prioridad | Archivo | Score | Categorías | Qué parece hacer |\n";
  md += "|---:|---|---:|---|---|\n";

  groups.slice(0, 30).forEach((g, idx) => {
    md += `| ${idx + 1} | \`${escapeMd(g.file)}\` | ${g.score} | ${escapeMd(g.categories.join(", "))} | ${escapeMd(inferMeaning(g))} |\n`;
  });

  md += "\n## Hallazgos detallados\n\n";

  for (const g of groups) {
    md += `### ${g.file}\n\n`;
    md += `Score: **${g.score}**\n\n`;
    md += `Categorías: ${g.categories.map((c) => `\`${c}\``).join(", ")}\n\n`;
    md += `Interpretación: ${escapeMd(inferMeaning(g))}\n\n`;

    const uniqueHits = dedupeHits(g.hits).slice(0, 40);

    md += "| Línea | Severidad | Categoría | Match | Preview |\n";
    md += "|---:|---|---|---|---|\n";

    for (const h of uniqueHits) {
      md += `| ${h.line} | ${escapeMd(h.severity)} | ${escapeMd(h.category)} | \`${escapeMd(h.match)}\` | ${escapeMd(h.preview)} |\n`;
    }

    md += "\n";

    for (const h of uniqueHits.slice(0, 8)) {
      md += `#### ${g.file}:${h.line} — ${h.category}\n\n`;
      md += "```txt\n";
      md += h.snippet;
      md += "\n```\n\n";
    }
  }

  md += "## Lectura rápida del resultado\n\n";
  md += "- Si un archivo aparece con `PROMPT_BASE` y `MODEL_CALL`, ahí probablemente vive el prompt principal.\n";
  md += "- Si aparece con `OUTPUT_CONTROL`, ahí se decide si el modelo devuelve JSON, texto plano, Markdown o límites de tokens.\n";
  md += "- Si aparece con `BOOK_GENERATION_RULES`, ahí se controla capítulo, outline, target_words o instrucciones editoriales.\n";
  md += "- Si aparece con `EDITORIAL_CLEANING`, ahí se limpian frases tipo prompt, bibliografía, fuentes o ruido del modelo.\n";
  md += "- Si aparece con `STATE_MUTATION`, ese archivo puede estar borrando, fusionando o reemplazando capítulos.\n";

  return md;
}

function dedupeHits(hits) {
  const seen = new Set();
  const out = [];

  for (const h of hits) {
    const key = `${h.file}:${h.line}:${h.category}:${h.match}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }

  return out.sort((a, b) => {
    const sevScore = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    return (sevScore[b.severity] ?? 0) - (sevScore[a.severity] ?? 0) || a.line - b.line;
  });
}

function main() {
  ensureOutDir();

  const files = walk(ROOT);
  const hits = [];

  for (const file of files) {
    const fileHits = scanFile(file);
    hits.push(...fileHits);
  }

  const groups = groupByFile(hits);

  const report = {
    generated_at: new Date().toISOString(),
    root: ROOT,
    files_scanned: files.length,
    hits_total: hits.length,
    by_category: countBy(hits, "category"),
    by_severity: countBy(hits, "severity"),
    files: groups.map((g) => ({
      file: g.file,
      score: g.score,
      categories: g.categories,
      severities: g.severities,
      meaning: inferMeaning(g),
      hits: dedupeHits(g.hits).map((h) => ({
        line: h.line,
        category: h.category,
        severity: h.severity,
        match: h.match,
        preview: h.preview,
      })),
    })),
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(
    OUT_MD,
    makeMarkdown({
      filesScanned: files.length,
      hits,
      groups,
    }),
    "utf8"
  );

  console.log("");
  console.log("✅ Auditoría de prompts lista.");
  console.log(`- Markdown: ${path.relative(ROOT, OUT_MD)}`);
  console.log(`- JSON:     ${path.relative(ROOT, OUT_JSON)}`);
  console.log("");
  console.log("Abre el Markdown y revisa primero la tabla: Archivos más importantes.");
}

main();
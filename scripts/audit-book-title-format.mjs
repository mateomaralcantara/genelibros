// scripts/audit-book-title-format.mjs
// Verifica problemas de:
// 1. Título perdido o "Libro sin título"
// 2. Gemini/control del modelo pisando títulos
// 3. Markdown/HTML/links/colores azules metidos en el texto
// 4. Archivos donde debes corregir

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES_TO_SCAN = [
  "App.tsx",
  "src/lib/editor.ts",
  "src/lib/gemini.ts",
  "components/BookViewer.tsx",
  "components/GenerationDashboard.tsx",
  "components/TableOfContents.tsx",
  "api/composer.ts",
];

const BAD_TITLE_PATTERNS = [
  /Libro sin título/gi,
  /book_title/gi,
  /bookTitle/gi,
  /dashboard\.book_title/gi,
  /master_document\.title/gi,
  /title:\s*ensureString/gi,
];

const BAD_FORMAT_PATTERNS = [
  /text-blue-/gi,
  /prose/gi,
  /dangerouslySetInnerHTML/gi,
  /marked/gi,
  /markdown/gi,
  /<span/gi,
  /<font/gi,
  /style=/gi,
  /\[.+?\]\(.+?\)/g,
  /color:/gi,
  /text-indigo-/gi,
  /text-sky-/gi,
  /text-cyan-/gi,
];

const PROMPT_RISK_PATTERNS = [
  /Devuelve.*Markdown/gi,
  /Markdown/gi,
  /HTML/gi,
  /JSON válido/gi,
  /responseMimeType:\s*["']application\/json["']/gi,
  /systemInstruction/gi,
];

function readFileSafe(filePath) {
  const abs = path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function lineNumberFromIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function scanPatterns(filePath, content, patterns) {
  const results = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = lineNumberFromIndex(content, match.index);
      const lines = content.split(/\r?\n/);
      const preview = lines[line - 1]?.trim() || "";

      results.push({
        file: filePath,
        line,
        pattern: pattern.toString(),
        preview,
      });

      if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }

  return results;
}

function printSection(title) {
  console.log("");
  console.log("=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
}

function printResults(results) {
  if (!results.length) {
    console.log("✅ No se encontraron problemas en esta categoría.");
    return;
  }

  for (const r of results) {
    console.log(`❌ ${r.file}:${r.line}`);
    console.log(`   Patrón: ${r.pattern}`);
    console.log(`   Código: ${r.preview}`);
    console.log("");
  }
}

function main() {
  console.log("");
  console.log("AUDITORÍA DE TÍTULO Y FORMATO DEL LIBRO");
  console.log("Proyecto:", ROOT);

  const existingFiles = FILES_TO_SCAN.filter((f) => fs.existsSync(path.join(ROOT, f)));

  if (!existingFiles.length) {
    console.log("❌ No encontré archivos esperados. Ejecuta el script desde la raíz del proyecto.");
    process.exit(1);
  }

  const missingFiles = FILES_TO_SCAN.filter((f) => !fs.existsSync(path.join(ROOT, f)));

  if (missingFiles.length) {
    printSection("ARCHIVOS NO ENCONTRADOS");
    for (const f of missingFiles) console.log(`⚠️ ${f}`);
  }

  let titleProblems = [];
  let formatProblems = [];
  let promptRisks = [];

  for (const file of existingFiles) {
    const content = readFileSafe(file);
    if (!content) continue;

    titleProblems.push(...scanPatterns(file, content, BAD_TITLE_PATTERNS));
    formatProblems.push(...scanPatterns(file, content, BAD_FORMAT_PATTERNS));
    promptRisks.push(...scanPatterns(file, content, PROMPT_RISK_PATTERNS));
  }

  printSection("1. POSIBLES PROBLEMAS DE TÍTULO");
  printResults(titleProblems);

  printSection("2. POSIBLES PROBLEMAS DE FORMATO AZUL / HTML / MARKDOWN");
  printResults(formatProblems);

  printSection("3. RIESGOS EN PROMPTS / GEMINI");
  printResults(promptRisks);

  printSection("LECTURA RECOMENDADA");

  console.log(`
Si aparecen muchas coincidencias de "Libro sin título":
→ Debes proteger el título canónico en src/lib/editor.ts y App.tsx.

Si aparece "dashboard.book_title" o "master_document.title":
→ Gemini puede estar pisando el título real. El título oficial debe ser project.title.

Si aparece "responseMimeType: application/json":
→ Todavía estás pidiendo JSON para textos largos. Eso rompe propuesta/capítulos.

Si aparece "Markdown", "prose", "text-blue", "dangerouslySetInnerHTML":
→ Ahí puede estar naciendo la letra azul o formato deforme.

Regla correcta:
1. project.title manda.
2. state.book_title copia project.title.
3. dashboard.book_title nunca debe reemplazar project.title.
4. Gemini escribe texto.
5. Tu software decide formato.
`);

  printSection("CAMBIOS QUE DEBES HACER SEGÚN EL RESULTADO");

  console.log(`
A) Si el problema es título:
   Archivo principal:
   - src/lib/editor.ts

   Debes crear una función tipo:
   getCanonicalBookTitle(currentProject, nextState, dashboard)

B) Si el problema es formato azul:
   Archivos principales:
   - components/BookViewer.tsx
   - src/lib/gemini.ts

   Debes limpiar HTML/Markdown raro y neutralizar estilos azules.

C) Si el problema es JSON roto:
   Archivo principal:
   - src/lib/gemini.ts

   Propuesta, introducción y capítulos deben ir como texto plano.
`);

  console.log("");
  console.log("✅ Auditoría terminada.");
}

main();
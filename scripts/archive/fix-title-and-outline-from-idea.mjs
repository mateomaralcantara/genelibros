// scripts/fix-title-and-outline-from-idea.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "App.tsx");

if (!fs.existsSync(appPath)) {
  console.error("❌ No se encontró App.tsx en:", root);
  process.exit(1);
}

const backupPath = `${appPath}.bak_title_outline_exact`;
fs.copyFileSync(appPath, backupPath);

let code = fs.readFileSync(appPath, "utf8");

const oldFunction = `function extractBookTitleFromIdea(idea: string): string {
  const labeled = extractLabeledValue(idea, [
    "T[IÍ]TULO DEL LIBRO",
    "T[IÍ]TULO",
    "BOOK TITLE",
    "TITLE",
  ]);

  if (labeled && !hasPromptLeak(labeled)) {
    return truncateEditorialTitle(labeled, "Libro sin título");
  }

  const first = firstUsefulLine(idea);
  if (first && first.length <= 90 && !hasPromptLeak(first)) {
    return truncateEditorialTitle(first, "Libro sin título");
  }

  return "Libro sin título";
}`;

const newFunction = `function extractBookTitleFromIdea(idea: string): string {
  const raw = String(idea ?? "").trim();

  const labeled = extractLabeledValue(raw, [
    "T[IÍ]TULO DEL LIBRO",
    "T[IÍ]TULO",
    "NOMBRE DEL LIBRO",
    "BOOK TITLE",
    "TITLE",
  ]);

  if (labeled && !hasPromptLeak(labeled)) {
    return truncateEditorialTitle(labeled, "Nuevo libro");
  }

  const topic = extractLabeledValue(raw, [
    "TEMA PRINCIPAL",
    "TEMA DEL LIBRO",
    "TEMA",
    "ASUNTO",
  ]);

  if (topic && !hasPromptLeak(topic)) {
    return truncateEditorialTitle(topic, "Nuevo libro");
  }

  const cleaned = raw
    .replace(/\\bact[uú]a como\\b[^\\n.]*(?:[.\\n]|$)/gi, " ")
    .replace(/\\beres un(?:a)? escritor(?:a)?\\b[^\\n.]*(?:[.\\n]|$)/gi, " ")
    .replace(/\\bcomo escritor(?:a)?\\b[^\\n.]*(?:[.\\n]|$)/gi, " ")
    .replace(/\\bobjetivo general\\s*[:\\-–—]?/gi, " ")
    .replace(/\\benfoque editorial\\s*[:\\-–—]?/gi, " ")
    .replace(/\\btono del libro\\s*[:\\-–—]?/gi, " ")
    .replace(/\\brequisitos\\s*[:\\-–—]?/gi, " ")
    .replace(/\\bformato final\\s*[:\\-–—]?/gi, " ")
    .replace(/\\s+/g, " ")
    .trim();

  const sentences = cleaned
    .split(/[.!?\\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    if (
      sentence.length >= 5 &&
      !hasPromptLeak(sentence)
    ) {
      return truncateEditorialTitle(sentence, "Nuevo libro");
    }
  }

  const words = cleaned
    .split(/\\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(" ");

  if (words && !hasPromptLeak(words)) {
    return truncateEditorialTitle(words, "Nuevo libro");
  }

  return "Nuevo libro";
}`;

if (!code.includes(oldFunction)) {
  console.error("❌ No encontré exactamente la función extractBookTitleFromIdea.");
  console.error("No se aplicó ningún cambio.");
  process.exit(1);
}

code = code.replace(oldFunction, newFunction);

const oldStartBlock = `      const title = extractBookTitleFromIdea(idea);
      const desiredChapterCount = extractDesiredChapterCountSafe(idea) ?? 12;
      const seedOutline = buildFallbackOutline(desiredChapterCount, idea, defaultChapterWords);`;

const newStartBlock = `      const title = extractBookTitleFromIdea(idea);
      const desiredChapterCount = extractDesiredChapterCountSafe(idea) ?? 12;

      // Para el esquema usamos un contexto limpio, no todas las instrucciones.
      const cleanOutlineContext =
        cleanSeedForOutlineContext(idea) ||
        title;

      const seedOutline = buildFallbackOutline(
        desiredChapterCount,
        cleanOutlineContext,
        defaultChapterWords
      );`;

if (!code.includes(oldStartBlock)) {
  console.error("❌ No encontré exactamente el bloque inicial de handleStartNewBook.");
  console.error("Se restaurará el archivo original.");
  fs.copyFileSync(backupPath, appPath);
  process.exit(1);
}

code = code.replace(oldStartBlock, newStartBlock);

const oldEnsureOutline = `      updated = ensureOutlineForProject(updated, desiredChapterCount, idea, defaultChapterWords);`;

const newEnsureOutline = `      updated = ensureOutlineForProject(
        updated,
        desiredChapterCount,
        cleanOutlineContext,
        defaultChapterWords
      );`;

if (code.includes(oldEnsureOutline)) {
  code = code.replace(oldEnsureOutline, newEnsureOutline);
}

fs.writeFileSync(appPath, code, "utf8");

console.log("✅ extractBookTitleFromIdea corregida.");
console.log("✅ El esquema ya no usa el prompt completo como título o contexto.");
console.log("✅ El segundo libro nace con un contexto editorial limpio.");
console.log("✅ Backup creado:", backupPath);
console.log("");
console.log("Ejecuta ahora:");
console.log("npm run build");
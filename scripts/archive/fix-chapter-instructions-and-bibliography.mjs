// scripts/fix-chapter-instructions-and-bibliography.mjs
// Corrige dos problemas:
// 1. Elimina frases internas tipo "Actúa como escritor..." dentro del contenido.
// 2. Elimina bibliografía/fuentes/referencias dentro de capítulos,
//    salvo que el libro sea histórico/académico o el usuario lo pida explícitamente.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = [
  "src/lib/gemini.ts",
  "src/lib/editor.ts",
  "api/composer.ts",
  "App.tsx",
];

function abs(file) {
  return path.join(ROOT, file);
}

function exists(file) {
  return fs.existsSync(abs(file));
}

function read(file) {
  return fs.readFileSync(abs(file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(abs(file), content, "utf8");
}

function backup(file) {
  const src = abs(file);
  const dst = abs(`${file}.bak_no_instruction_bibliography`);
  fs.copyFileSync(src, dst);
  console.log(`✅ Backup creado: ${file}.bak_no_instruction_bibliography`);
}

function insertAfterImportsEditor(content) {
  if (content.includes("export function sanitizeEditorialChapterText")) {
    return content;
  }

  const helper = `

export function isBibliographyAllowedForProject(projectLike: any): boolean {
  const raw = [
    projectLike?.title,
    projectLike?.topic,
    projectLike?.book_topic,
    projectLike?.dossier?.book_title,
    projectLike?.dossier?.book_topic,
    projectLike?.tone_style,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /hist[oó]ric|historia|acad[eé]mic|investigaci[oó]n|tesis|bibliograf|fuentes|citas|referencias|documental|ensayo cr[ií]tico/.test(raw);
}

export function sanitizeEditorialChapterText(
  text: string,
  opts?: {
    allowBibliography?: boolean;
    allowInstructionLines?: boolean;
  }
): string {
  const allowBibliography = Boolean(opts?.allowBibliography);
  const allowInstructionLines = Boolean(opts?.allowInstructionLines);

  let out = String(text || "");

  // Quita fences y etiquetas raras.
  out = out
    .replace(/\\\`\\\`\\\`[a-zA-Z0-9_-]*\\s*/g, "")
    .replace(/\\\`\\\`\\\`/g, "");

  const lines = out.split(/\\r?\\n/);
  const cleanLines: string[] = [];

  let skippingBibliography = false;

  const instructionLineRe =
    /^\\s*(act[uú]a como|eres un|como escritor|como edit(or|ora)|instrucciones?|reglas?|objetivo del cap[ií]tulo|requisitos?|devuelve solo|no uses|no incluyas|prompt|task:|project_state:|system:)\\b/i;

  const bibliographyStartRe =
    /^\\s*(bibliograf[ií]a|referencias|fuentes consultadas|fuentes|citas|notas bibliogr[aá]ficas|obras consultadas|lecturas recomendadas)\\s*[:\\-–—]?\\s*$/i;

  const chapterHeadingRe =
    /^\\s*(cap[ií]tulo\\s+\\d+)\\s*[:\\-–—.]\\s*(.+?)\\s*$/i;

  for (const line of lines) {
    const raw = line;
    const trimmed = raw.trim();

    if (!trimmed) {
      if (!skippingBibliography) cleanLines.push(raw);
      continue;
    }

    // Normaliza encabezados tipo:
    // "Capítulo 1. Los comunicadores dominicanos. Actúa como..."
    const chMatch = trimmed.match(chapterHeadingRe);
    if (chMatch) {
      let title = chMatch[2] || "";

      title = title
        .replace(/\\b(act[uú]a como|eres un|como escritor|como editor|instrucciones?|reglas?|objetivo del cap[ií]tulo|requisitos?).*$/i, "")
        .replace(/\\s+/g, " ")
        .trim();

      title = title.replace(/[.:;,-]+$/g, "").trim();

      if (title) {
        cleanLines.push(\`\${chMatch[1]}. \${title}\`);
      } else {
        cleanLines.push(chMatch[1]);
      }

      skippingBibliography = false;
      continue;
    }

    // Quita líneas de instrucciones internas.
    if (!allowInstructionLines && instructionLineRe.test(trimmed)) {
      continue;
    }

    // Quita bibliografía dentro del capítulo si no está permitida.
    if (!allowBibliography && bibliographyStartRe.test(trimmed)) {
      skippingBibliography = true;
      continue;
    }

    // Si ya estamos saltando bibliografía, seguimos saltando hasta un nuevo capítulo o corte fuerte.
    if (skippingBibliography) {
      if (/^\\s*cap[ií]tulo\\s+\\d+/i.test(trimmed)) {
        skippingBibliography = false;
        cleanLines.push(raw);
      }
      continue;
    }

    // Quita líneas bibliográficas típicas aunque no tengan encabezado.
    if (
      !allowBibliography &&
      /^(\\-\\s*)?(autor|obra|editorial|isbn|doi|url|http|https|www\\.|fuente:|referencia:)/i.test(trimmed)
    ) {
      continue;
    }

    cleanLines.push(raw);
  }

  out = cleanLines.join("\\n");

  // Quita bloques inline típicos de bibliografía/fuentes entre párrafos.
  if (!allowBibliography) {
    out = out.replace(
      /\\n\\s*(bibliograf[ií]a|referencias|fuentes consultadas|obras consultadas|lecturas recomendadas)\\s*[:\\-–—]?[\\s\\S]*$/i,
      ""
    );
  }

  // Limpieza de exceso de líneas.
  out = out
    .replace(/[ \\t]+$/gm, "")
    .replace(/\\n{4,}/g, "\\n\\n\\n")
    .trim();

  return out;
}
`;

  // Lo ponemos antes del primer export function grande si existe.
  const marker = "export function";
  const idx = content.indexOf(marker);

  if (idx >= 0) {
    return content.slice(0, idx) + helper + "\n" + content.slice(idx);
  }

  return content + helper;
}

function patchEditor() {
  const file = "src/lib/editor.ts";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);

  let c = read(file);
  c = insertAfterImportsEditor(c);

  // Intento de sanitizar antes de construir master si existen patrones comunes.
  // No rompe si no encuentra nada.
  c = c.replaceAll(
    "text: ensureString(chapterText, \"\"),",
    "text: sanitizeEditorialChapterText(ensureString(chapterText, \"\"), { allowBibliography: isBibliographyAllowedForProject(state) }),"
  );

  c = c.replaceAll(
    "text: ensureString(ch?.text, \"\"),",
    "text: sanitizeEditorialChapterText(ensureString(ch?.text, \"\"), { allowBibliography: isBibliographyAllowedForProject(state) }),"
  );

  write(file, c);
  console.log(`✅ Corregido ${file}`);
}

function patchGemini() {
  const file = "src/lib/gemini.ts";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);

  let c = read(file);

  // Importa sanitizador si todavía no está.
  if (!c.includes("sanitizeEditorialChapterText")) {
    c = c.replace(
      "buildMasterFromState,",
      "buildMasterFromState,\n  sanitizeEditorialChapterText,\n  isBibliographyAllowedForProject,"
    );
  }

  // Refuerza prompts de texto plano.
  const hardRules = `
Reglas editoriales obligatorias:
- No escribas instrucciones internas dentro del libro.
- Prohibido incluir frases como "Actúa como", "Eres un escritor", "Como editor", "Objetivo del capítulo", "Requisitos" o similares.
- El encabezado debe ser normal: "Capítulo 1. Título del capítulo".
- No agregues bibliografía, fuentes, referencias, citas, lecturas recomendadas ni notas bibliográficas dentro del capítulo.
- Solo incluye bibliografía si el libro es histórico, académico, investigativo o si el usuario la pidió explícitamente.
- Si se requiere bibliografía, debe ir al final del libro, no dentro de cada capítulo.
- No uses HTML, colores, estilos inline ni enlaces.
- El contenido debe parecer libro publicado, no prompt ni instrucción técnica.
`;

  if (!c.includes("El encabezado debe ser normal: \"Capítulo 1. Título del capítulo\"")) {
    c = c.replaceAll(
      "Devuelve SOLO TEXTO PLANO. NO JSON. NO Markdown fences. NO explicaciones externas.",
      `Devuelve SOLO TEXTO PLANO. NO JSON. NO Markdown fences. NO explicaciones externas.\\n${hardRules}`
    );

    c = c.replaceAll(
      "Devuelve SOLO texto plano del bloque. NO JSON. NO Markdown fences.",
      `Devuelve SOLO texto plano del bloque. NO JSON. NO Markdown fences.\\n${hardRules}`
    );

    c = c.replaceAll(
      "Devuelve SOLO texto NUEVO. NO JSON. NO Markdown fences.",
      `Devuelve SOLO texto NUEVO. NO JSON. NO Markdown fences.\\n${hardRules}`
    );
  }

  // Sanitiza el texto antes de meterlo al EngineResult.
  c = c.replaceAll(
    "const cleanText = cleanPlainModelText(text);",
    "const cleanText = sanitizeEditorialChapterText(cleanPlainModelText(text), { allowBibliography: isBibliographyAllowedForProject(state) });"
  );

  c = c.replaceAll(
    "const chapterText = stripLeadingChapterNoise(cleanText);",
    "const chapterText = sanitizeEditorialChapterText(stripLeadingChapterNoise(cleanText), { allowBibliography: isBibliographyAllowedForProject(normalizedState) });"
  );

  c = c.replaceAll(
    "chapterText = (chapterText.trim() ? chapterText.trim() + \"\\n\\n\" : \"\") + add.trim();",
    "chapterText = sanitizeEditorialChapterText((chapterText.trim() ? chapterText.trim() + \"\\n\\n\" : \"\") + add.trim(), { allowBibliography: isBibliographyAllowedForProject((current as any)?.state ?? {}) });"
  );

  write(file, c);
  console.log(`✅ Corregido ${file}`);
}

function patchComposer() {
  const file = "api/composer.ts";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);

  let c = read(file);

  const composerRules = `
REGLAS DE LIMPIEZA EDITORIAL:
- Nunca incluyas instrucciones internas dentro del contenido final.
- No escribas "Actúa como", "Eres un escritor", "Objetivo del capítulo", "Requisitos", "Prompt" ni textos similares.
- Los títulos deben verse normales: "Capítulo 1. Título del capítulo".
- No incluyas bibliografía dentro de capítulos.
- La bibliografía solo se permite si el libro es histórico, académico, investigativo o si el usuario la pidió explícitamente.
- Si hay bibliografía, debe ir al final del libro en una sección única.
- No uses HTML, colores, estilos inline ni enlaces.
`;

  if (!c.includes("REGLAS DE LIMPIEZA EDITORIAL")) {
    c = c.replace(
      "No uses Markdown.",
      `No uses Markdown.\\n${composerRules}`
    );

    c = c.replace(
      "Devuelve SIEMPRE un único JSON válido, sin Markdown y sin fences.",
      `Devuelve SIEMPRE un único JSON válido, sin Markdown y sin fences.\\n${composerRules}`
    );
  }

  write(file, c);
  console.log(`✅ Corregido ${file}`);
}

function patchAppPrompt() {
  const file = "App.tsx";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);

  let c = read(file);

  const rules = `
  "- PROHIBIDO insertar instrucciones internas dentro del libro: no escribas 'Actúa como', 'Eres un escritor', 'Objetivo del capítulo', 'Requisitos', 'Prompt' ni similares.",
  "- Los encabezados deben ser naturales: 'Capítulo 1. Título del capítulo'. Nunca agregues instrucciones después del título.",
  "- PROHIBIDO agregar bibliografía, fuentes, referencias, citas o lecturas recomendadas dentro de cada capítulo.",
  "- La bibliografía solo se permite si el usuario la pide o si el libro es histórico, académico o investigativo.",
  "- Si se permite bibliografía, debe ir en una sola sección final del libro, nunca repartida entre capítulos.",
  "- No uses HTML, colores, estilos inline, enlaces ni marcas visuales dentro del contenido del libro.",
`;

  if (!c.includes("PROHIBIDO insertar instrucciones internas dentro del libro")) {
    c = c.replace(
      `"- PROHIBIDO: Markdown fuera del JSON, bloques \`\`\` , comentarios, o texto antes/después del JSON.",`,
      `"- PROHIBIDO: Markdown fuera del JSON, bloques \`\`\` , comentarios, o texto antes/después del JSON.",\n${rules}`
    );
  }

  write(file, c);
  console.log(`✅ Corregido ${file}`);
}

function main() {
  console.log("");
  console.log("=== FIX CAPÍTULOS LIMPIOS + BIBLIOGRAFÍA CONTROLADA ===");
  console.log("Proyecto:", ROOT);

  patchEditor();
  patchGemini();
  patchComposer();
  patchAppPrompt();

  console.log("");
  console.log("✅ Parche terminado.");
  console.log("");
  console.log("Ahora ejecuta:");
  console.log("npm run dev");
}

main();
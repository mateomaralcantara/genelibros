// scripts/audit-second-book-title-state.mjs
//
// Diagnostica por qué:
// 1. El primer libro recibe título.
// 2. El segundo queda como "Libro sin título".
// 3. El segundo hereda datos incoherentes del proyecto anterior.
//
// Busca:
// - Estado anterior reutilizado.
// - Formularios que no se limpian.
// - project/state/dashboard compartidos.
// - Uso de valores viejos al crear un proyecto.
// - Fallos al guardar projects.title.
// - Mutaciones directas.
// - Caché y localStorage.
// - Fallbacks peligrosos.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = [
  "App.tsx",
  "src/lib/editor.ts",
  "src/lib/gemini.ts",
  "api/composer.ts",
  "components/GenerationDashboard.tsx",
  "components/BookViewer.tsx",
  "components/TableOfContents.tsx",
];

const findings = [];

function fileExists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function readFile(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function addFinding({
  severity,
  category,
  file,
  line,
  message,
  code,
}) {
  findings.push({
    severity,
    category,
    file,
    line,
    message,
    code: String(code || "").trim(),
  });
}

function scanRegex(file, text, regex, severity, category, message) {
  regex.lastIndex = 0;

  let match;

  while ((match = regex.exec(text)) !== null) {
    const line = lineNumber(text, match.index);
    const sourceLine = text.split(/\r?\n/)[line - 1] || "";

    addFinding({
      severity,
      category,
      file,
      line,
      message,
      code: sourceLine,
    });

    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }
}

function inspectApp(file, text) {
  scanRegex(
    file,
    text,
    /Libro sin título/gi,
    "ALTA",
    "TÍTULO",
    'Existe un fallback "Libro sin título". Verifica que no se guarde antes de que Gemini devuelva el título.'
  );

  scanRegex(
    file,
    text,
    /const\s+title\s*=\s*idea\.length\s*<\s*\d+\s*\?\s*idea\.trim\(\)\s*:\s*["']Libro sin título["']/gi,
    "CRÍTICA",
    "TÍTULO",
    "La app convierte ideas largas directamente en Libro sin título. El segundo prompt suele ser largo y cae en este fallback."
  );

  scanRegex(
    file,
    text,
    /setCurrentProject\(/gi,
    "MEDIA",
    "ESTADO",
    "Revisa que setCurrentProject reciba un proyecto completamente nuevo y no una mezcla con el anterior."
  );

  scanRegex(
    file,
    text,
    /setProject\(/gi,
    "MEDIA",
    "ESTADO",
    "Revisa que el estado project se reinicie antes de generar otro libro."
  );

  scanRegex(
    file,
    text,
    /setState\(\s*\{\s*\.\.\./gi,
    "ALTA",
    "ESTADO",
    "Puede existir mezcla entre el estado anterior y el nuevo mediante spread."
  );

  scanRegex(
    file,
    text,
    /\.\.\.(currentProject|project|state|dashboard)/gi,
    "ALTA",
    "ESTADO",
    "Se están copiando datos de un objeto anterior. Comprueba que no se hereden título, capítulos o dossier."
  );

  scanRegex(
    file,
    text,
    /localStorage\.(getItem|setItem)/gi,
    "MEDIA",
    "CACHÉ",
    "Existe persistencia en localStorage. Puede estar restaurando información del libro anterior."
  );

  scanRegex(
    file,
    text,
    /sessionStorage\.(getItem|setItem)/gi,
    "MEDIA",
    "CACHÉ",
    "Existe persistencia en sessionStorage. Puede estar restaurando información anterior."
  );

  scanRegex(
    file,
    text,
    /\.insert\(\s*\{/gi,
    "MEDIA",
    "BASE DE DATOS",
    "Revisa el INSERT del proyecto y confirma que envíe title, topic y dossier del libro nuevo."
  );

  scanRegex(
    file,
    text,
    /title\s*:\s*(title|idea|project\.title|state\.book_title|dbProject\.title)/gi,
    "MEDIA",
    "BASE DE DATOS",
    "Verifica el origen exacto del título enviado a Supabase."
  );

  scanRegex(
    file,
    text,
    /normalizeProjectState\(/gi,
    "MEDIA",
    "NORMALIZACIÓN",
    "Revisa si normalizeProjectState conserva campos del proyecto anterior."
  );

  scanRegex(
    file,
    text,
    /BUILD_FULL_DOSSIER/gi,
    "MEDIA",
    "GENERACIÓN",
    "Confirma que BUILD_FULL_DOSSIER reciba un estado vacío para cada libro nuevo."
  );
}

function inspectEditor(file, text) {
  scanRegex(
    file,
    text,
    /dashboard\.book_title/gi,
    "ALTA",
    "TÍTULO",
    "dashboard.book_title puede estar sustituyendo o heredando el título del proyecto anterior."
  );

  scanRegex(
    file,
    text,
    /mergedState/gi,
    "ALTA",
    "ESTADO",
    "mergedState puede conservar datos del libro anterior si el nuevo estado no se limpia."
  );

  scanRegex(
    file,
    text,
    /Object\.assign/gi,
    "ALTA",
    "MUTACIÓN",
    "Object.assign puede mutar el estado original y contaminar el siguiente proyecto."
  );

  scanRegex(
    file,
    text,
    /\bstate\.[a-zA-Z0-9_]+\s*=/g,
    "ALTA",
    "MUTACIÓN",
    "Hay mutación directa del estado. Esto puede reutilizar datos entre generaciones."
  );

  scanRegex(
    file,
    text,
    /\bcurrentProject\.[a-zA-Z0-9_]+\s*=/g,
    "CRÍTICA",
    "MUTACIÓN",
    "Se está modificando currentProject directamente."
  );

  scanRegex(
    file,
    text,
    /ensureString\([^,]+,\s*["']Libro sin título["']\)/gi,
    "ALTA",
    "TÍTULO",
    "Este fallback puede propagarse al dossier y al documento maestro."
  );

  scanRegex(
    file,
    text,
    /getCanonicalBookTitle/gi,
    "INFO",
    "TÍTULO",
    "Existe protección de título canónico. Verifica que project.title ya tenga el título real antes de llamarla."
  );
}

function inspectGemini(file, text) {
  scanRegex(
    file,
    text,
    /getBookTitle\(/gi,
    "MEDIA",
    "TÍTULO",
    "Gemini obtiene el título desde state. Si state no se reinicia, puede devolver vacío o datos viejos."
  );

  scanRegex(
    file,
    text,
    /state\?\.book_title/gi,
    "ALTA",
    "TÍTULO",
    "El motor depende de state.book_title. Confirma que se asigne para el libro nuevo."
  );

  scanRegex(
    file,
    text,
    /JSON\.stringify\(state\)/gi,
    "ALTA",
    "PROMPT",
    "Se envía todo el estado a Gemini. Si contiene capítulos viejos, el nuevo libro perderá coherencia."
  );

  scanRegex(
    file,
    text,
    /PROJECT_STATE/gi,
    "ALTA",
    "PROMPT",
    "El PROJECT_STATE puede incluir información heredada del libro anterior."
  );

  scanRegex(
    file,
    text,
    /master_document/gi,
    "MEDIA",
    "CONTENIDO",
    "Revisa que master_document se reconstruya desde cero para cada proyecto."
  );

  scanRegex(
    file,
    text,
    /responseMimeType:\s*["']application\/json["']/gi,
    "MEDIA",
    "JSON",
    "Hay generación JSON. Confirma que solo se use para el dossier y no para capítulos largos."
  );
}

function inspectComposer(file, text) {
  scanRegex(
    file,
    text,
    /SYSTEM_PROMPT/gi,
    "INFO",
    "PROMPT",
    "Revisa que el prompt no obligue al segundo libro a reutilizar contexto previo."
  );

  scanRegex(
    file,
    text,
    /task\s*,\s*state/gi,
    "ALTA",
    "PROMPT",
    "El endpoint recibe task y state. Verifica que state pertenezca al libro recién creado."
  );

  scanRegex(
    file,
    text,
    /JSON\.stringify\((state|project|payload)/gi,
    "ALTA",
    "PROMPT",
    "Se serializa contexto completo. Puede incluir datos del proyecto anterior."
  );
}

function inspectAll() {
  for (const file of FILES) {
    if (!fileExists(file)) {
      addFinding({
        severity: "INFO",
        category: "ARCHIVO",
        file,
        line: 0,
        message: "Archivo no encontrado.",
        code: "",
      });
      continue;
    }

    const text = readFile(file);

    if (file === "App.tsx") {
      inspectApp(file, text);
    }

    if (file === "src/lib/editor.ts") {
      inspectEditor(file, text);
    }

    if (file === "src/lib/gemini.ts") {
      inspectGemini(file, text);
    }

    if (file === "api/composer.ts") {
      inspectComposer(file, text);
    }
  }
}

function inspectSpecificTitleBug() {
  const file = "App.tsx";

  if (!fileExists(file)) return;

  const text = readFile(file);

  const dangerousLine =
    /const\s+title\s*=\s*idea\.length\s*<\s*(\d+)\s*\?\s*idea\.trim\(\)\s*:\s*["']Libro sin título["']/i;

  const match = text.match(dangerousLine);

  if (match) {
    const index = text.indexOf(match[0]);

    addFinding({
      severity: "CRÍTICA",
      category: "CAUSA PROBABLE",
      file,
      line: lineNumber(text, index),
      message:
        `El título depende de que la idea tenga menos de ${match[1]} caracteres. ` +
        "Cuando el segundo libro usa una descripción larga, se guarda inmediatamente como Libro sin título.",
      code: match[0],
    });
  }
}

function printHeader(title) {
  console.log("");
  console.log("=".repeat(90));
  console.log(title);
  console.log("=".repeat(90));
}

function printFindings() {
  const severityOrder = {
    CRÍTICA: 1,
    ALTA: 2,
    MEDIA: 3,
    INFO: 4,
  };

  findings.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 99;
    const sb = severityOrder[b.severity] ?? 99;

    if (sa !== sb) return sa - sb;
    if (a.file !== b.file) return a.file.localeCompare(b.file);

    return a.line - b.line;
  });

  const groups = ["CRÍTICA", "ALTA", "MEDIA", "INFO"];

  for (const severity of groups) {
    const items = findings.filter((item) => item.severity === severity);

    if (!items.length) continue;

    printHeader(`HALLAZGOS ${severity}`);

    for (const item of items) {
      console.log(`\n[${item.category}] ${item.file}${item.line ? `:${item.line}` : ""}`);
      console.log(`Problema: ${item.message}`);

      if (item.code) {
        console.log(`Código: ${item.code}`);
      }
    }
  }
}

function printDiagnosis() {
  printHeader("DIAGNÓSTICO PRINCIPAL");

  console.log(`
La causa más probable está en App.tsx:

const title = idea.length < 70 ? idea.trim() : "Libro sin título";

Esto significa:

- Si escribes una idea corta, se usa como título.
- Si escribes una idea larga, se guarda "Libro sin título".
- El primer libro puede funcionar porque la idea era corta.
- El segundo falla porque la descripción supera el límite.
`);

  printHeader("SEGUNDO PROBLEMA PROBABLE");

  console.log(`
El sistema puede estar enviando a Gemini el estado anterior:

- capítulos del primer libro;
- dossier anterior;
- continuidad anterior;
- book_title anterior;
- master_document anterior;
- selección activa anterior.

Eso provoca que el segundo libro salga incoherente.
`);

  printHeader("REGLA CORRECTA");

  console.log(`
Al crear un nuevo libro debes construir un estado totalmente nuevo:

{
  project_id: nuevoId,
  book_title: "",
  book_topic: nuevaIdea,
  proposal: "",
  introduction: "",
  chapters: [],
  outline_12: [],
  continuity_pack: {},
  master_document: null
}

Nunca debes iniciar el segundo libro con:

{
  ...stateAnterior
}

ni con:

{
  ...currentProject
}
`);
}

function printRecommendedChecks() {
  printHeader("PRUEBA MANUAL RECOMENDADA");

  console.log(`
1. Abre la app.
2. Crea un primer libro.
3. Sin recargar la página, inicia un segundo libro.
4. Antes de llamar Gemini, imprime:

console.log("NUEVO LIBRO - IDEA:", idea);
console.log("NUEVO LIBRO - TITLE:", title);
console.log("NUEVO LIBRO - STATE:", state);
console.log("NUEVO LIBRO - PROJECT:", currentProject);

5. Confirma que el segundo state no contenga capítulos ni dossier del primero.
`);
}

function main() {
  console.log("");
  console.log("AUDITORÍA: SEGUNDO LIBRO SIN TÍTULO Y SIN COHERENCIA");
  console.log("Proyecto:", ROOT);

  inspectAll();
  inspectSpecificTitleBug();
  printFindings();
  printDiagnosis();
  printRecommendedChecks();

  console.log("");
  console.log("✅ Auditoría terminada.");
}

main();
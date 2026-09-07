import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function moduleUrl(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const editor = await import(moduleUrl(fs.readFileSync("src/lib/editor.ts", "utf8")));

const brief = `# PROMPT MAESTRO DE PRODUCCIÓN EDITORIAL

## TÍTULO DE TRABAJO

**EL OUTSIDER**

### Cómo se rompe un sistema político y si República Dominicana está preparada para hacerlo en 2028

# 1. MISIÓN GENERAL
Produzca un libro de investigación política, histórica, electoral y sociológica de alto nivel.

# 36. ARQUITECTURA PROPUESTA DEL LIBRO
### Capítulo 1
¿Que es realmente un outsider?
### Capítulo 2
Por qué nacen los outsiders
### Capítulo 3
La crisis de los partidos
`;

const normalized = editor.normalizeProjectState({
  book_title: "MISIÓN GENERAL Produzca un libro de investigación política",
  book_topic: brief,
  outline_12: [
    { chapter_number: 1, chapter_title: "Capítulo 1" },
    { chapter_number: 2, chapter_title: "Capítulo 2" },
    { chapter_number: 3, chapter_title: "Capítulo 3" },
  ],
  chapters: [],
});
assert.equal(normalized.book_title, "EL OUTSIDER");
assert.equal(normalized.outline_12[0].chapter_title, "¿Que es realmente un outsider?");
assert.equal(normalized.outline_12[1].chapter_title, "Por qué nacen los outsiders");

const legacy = editor.repairLegacyOutsiderProject({
  id: "legacy-outsider",
  title: "MISIÓN GENERAL Produzca un libro de investigación política",
  topic: brief,
  outline_12: Array.from({ length: 12 }, (_, i) => ({
    chapter_number: i + 1,
    chapter_title: `Capítulo ${i + 1}`,
  })),
});
assert.ok(legacy);
assert.equal(legacy.title, "EL OUTSIDER");
assert.equal(legacy.outline_12.length, 12);
assert.equal(legacy.outline_12[0].chapter_title, "El outsider: una ruptura que necesita definición");
assert.equal(legacy.outline_12[11].chapter_title, "Después de la victoria: gobernabilidad y límites de la ruptura");

const project = editor.mapDbFullToProject(
  {
    id: "legacy-outsider",
    title: "MISIÓN GENERAL Produzca un libro de investigación política",
    topic: brief,
    outline_12: Array.from({ length: 12 }, (_, i) => ({
      chapter_number: i + 1,
      chapter_title: `Capítulo ${i + 1}`,
    })),
    dossier: {},
  },
  [],
  null
);
assert.equal(project.title, "EL OUTSIDER");
assert.equal(project.state.outline_12.length, 12);
assert.equal(project.state.outline_12[4].chapter_title, "República Dominicana: de los partidos históricos al mapa actual");
assert.equal(project.dashboard.menu_items.length, 14);
assert.equal(project.dashboard.menu_items[13].label, "Capítulo 12: Después de la victoria: gobernabilidad y límites de la ruptura");

const master = editor.buildMasterFromState({
  book_title: "EL OUTSIDER",
  proposal: { text: "" },
  introduction: { text: "" },
  outline_12: legacy.outline_12,
  chapters: [{ chapter_number: 1, title: "Capítulo 1", text: "Texto de prueba con contexto editorial." }],
});
assert.match(master, /## Capítulo 1: El outsider: una ruptura que necesita definición/);

const dashboard = fs.readFileSync("components/GenerationDashboard.tsx", "utf8");
assert.match(dashboard, /GENELIBROS_V14_5_FULL_TITLE_WRAP/);
const titleWindow = dashboard.slice(dashboard.indexOf("GENELIBROS_V14_5_FULL_TITLE_WRAP"), dashboard.indexOf("GENELIBROS_V14_5_FULL_TITLE_WRAP") + 420);
assert.match(titleWindow, /leading-snug break-words whitespace-normal/);
assert.doesNotMatch(titleWindow, /truncate/);

const composer = fs.readFileSync("api/composer.ts", "utf8");
assert.match(composer, /RETIRED_MODEL_ALIASES/);
assert.match(composer, /gemini-2\.5-flash/);

console.log("PASS: recuperación V14.5, demo EL OUTSIDER de 12 capítulos, documento maestro, dashboard y alias de modelo.");

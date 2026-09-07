import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}

const source = fs.readFileSync('src/lib/editor.ts', 'utf8');
const editor = await import(moduleUrl(source));

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

### Capítulo 4
El voto contra “los mismos de siempre”

### Capítulo 5
Donald Trump: del espectáculo al poder

### Capítulo 6
Javier Milei: la motosierra contra la casta

### Capítulo 7
Nayib Bukele: del sistema a la ruptura del sistema

### Capítulo 8
Zelenski: cuando la ficción entró al Palacio

### Capítulo 9
Jimmy Morales y el poder de la celebridad

### Capítulo 10
Pedro Castillo: el outsider improbable

### Capítulo 11
Rodolfo Hernández: TikTok contra las estructuras

### Capítulo 12
Bolsonaro y la insurgencia desde dentro
`;

assert.equal(editor.extractBookTitleFromBrief(brief), 'EL OUTSIDER');
const titles = editor.extractChapterTitlesFromBrief(brief);
assert.equal(titles.size, 12);
assert.equal(titles.get(2), 'Por qué nacen los outsiders');
assert.equal(titles.get(12), 'Bolsonaro y la insurgencia desde dentro');

const contaminatedOutline = Array.from({ length: 12 }, (_, i) => ({
  chapter_number: i + 1,
  chapter_title:
    i === 0
      ? 'El contexto general de MISIÓN GENERAL Produzca un libro de investigación política'
      : `Capítulo ${i + 1}`,
}));

const normalized = editor.normalizeProjectState({
  book_title: 'MISIÓN GENERAL Produzca un libro de investigación política',
  book_topic: brief,
  outline_12: contaminatedOutline,
  chapters: [],
});

assert.equal(normalized.book_title, 'EL OUTSIDER');
assert.equal(normalized.outline_12.length, 12);
assert.equal(normalized.outline_12[0].chapter_title, '¿Que es realmente un outsider?');
assert.equal(normalized.outline_12[1].chapter_title, 'Por qué nacen los outsiders');
assert.equal(normalized.outline_12[11].chapter_title, 'Bolsonaro y la insurgencia desde dentro');

const project = editor.mapDbFullToProject(
  {
    id: 'legacy-outsider',
    title: 'MISIÓN GENERAL Produzca un libro de investigación política',
    topic: brief,
    outline_12: contaminatedOutline,
    dossier: {},
  },
  [],
  null
);

assert.equal(project.title, 'EL OUTSIDER');
assert.equal(project.state.book_title, 'EL OUTSIDER');
assert.equal(project.state.outline_12[0].chapter_title, '¿Que es realmente un outsider?');
assert.equal(project.state.outline_12[11].chapter_title, 'Bolsonaro y la insurgencia desde dentro');

const dashboard = fs.readFileSync('components/GenerationDashboard.tsx', 'utf8');
const marker = 'GENELIBROS_V14_5_FULL_TITLE_WRAP';
assert.match(dashboard, new RegExp(marker));
const markerIndex = dashboard.indexOf(marker);
assert.ok(markerIndex >= 0);
const chapterTitleWindow = dashboard.slice(markerIndex, markerIndex + 500);
assert.match(chapterTitleWindow, /break-words whitespace-normal/);
assert.doesNotMatch(chapterTitleWindow, /truncate/);

console.log('PASS: V14.5 recupera EL OUTSIDER y 12 títulos desde el encargo original, y el dashboard muestra títulos completos.');

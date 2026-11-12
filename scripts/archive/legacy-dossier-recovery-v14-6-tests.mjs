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

const canonicalTitles = [
  '¿Qué es realmente un outsider?',
  'Por qué nacen los outsiders',
  'La crisis de los partidos',
  'El voto contra “los mismos de siempre”',
  'Donald Trump: del espectáculo al poder',
  'Javier Milei: la motosierra contra la casta',
  'Nayib Bukele: del sistema a la ruptura del sistema',
  'Zelenski: cuando la ficción entró al Palacio',
  'Jimmy Morales y el poder de la celebridad',
  'Pedro Castillo: el outsider improbable',
  'Rodolfo Hernández: TikTok contra las estructuras',
  'Bolsonaro y la insurgencia desde dentro',
];

const contaminatedOutline = canonicalTitles.map((_, i) => ({
  chapter_number: i + 1,
  chapter_title:
    i === 0
      ? 'El contexto general de MISIÓN GENERAL Produzca un libro de investigación política'
      : `Capítulo ${i + 1}`,
}));

const dossierOutline = canonicalTitles.map((title, i) => ({
  chapter_number: i + 1,
  chapter_title: title,
  objective: `Objetivo ${i + 1}`,
}));
// Deliberately add a 13th dossier item: an existing 12-chapter project must not expand.
dossierOutline.push({ chapter_number: 13, chapter_title: 'No debe aparecer' });

const outsider = editor.mapDbFullToProject(
  {
    id: 'legacy-outsider-no-brief',
    title: 'MISIÓN GENERAL Produzca un libro de investigación política',
    topic: '',
    outline_12: contaminatedOutline,
    continuity_pack: { chapter_count: 12 },
    dossier: {
      book_title: 'EL OUTSIDER',
      editorial_blueprint: { chapters: dossierOutline },
    },
  },
  [
    {
      type: 'CHAPTER',
      chapter_number: 1,
      title: 'Capítulo 1',
      content: 'Contenido real del capítulo uno.',
      status: 'COMPLETED',
    },
  ],
  null
);

assert.equal(outsider.title, 'EL OUTSIDER');
assert.equal(outsider.state.book_title, 'EL OUTSIDER');
assert.equal(outsider.state.outline_12.length, 12);
for (let i = 0; i < 12; i += 1) {
  assert.equal(outsider.state.outline_12[i].chapter_title, canonicalTitles[i]);
}
assert.equal(outsider.state.chapters[0].title, canonicalTitles[0]);

// Generic repair: never hardcode one book's title into unrelated projects.
const cooking = editor.mapDbFullToProject(
  {
    id: 'legacy-cooking-no-brief',
    title: 'MISIÓN GENERAL Produzca un libro profesional de cocina',
    topic: '',
    outline_12: [{ chapter_number: 1, chapter_title: 'Capítulo 1' }],
    continuity_pack: { chapter_count: 1 },
    dossier: {
      book_title: 'COCINA TOTAL',
      outline_12: [{ chapter_number: 1, chapter_title: 'El fuego como herramienta' }],
    },
  },
  [],
  null
);
assert.equal(cooking.title, 'COCINA TOTAL');
assert.equal(cooking.state.outline_12[0].chapter_title, 'El fuego como herramienta');

// A valid editorial title already saved by the author beats a conflicting dossier title.
const manual = editor.mapDbFullToProject(
  {
    id: 'manual-title-priority',
    title: 'LIBRO MANUAL',
    topic: '',
    outline_12: [{ chapter_number: 1, chapter_title: 'Mi título definitivo' }],
    continuity_pack: { chapter_count: 1 },
    dossier: {
      book_title: 'LIBRO MANUAL',
      outline_12: [{ chapter_number: 1, chapter_title: 'Título anterior del dossier' }],
    },
  },
  [],
  null
);
assert.equal(manual.state.outline_12[0].chapter_title, 'Mi título definitivo');

assert.match(source, /GENELIBROS_V14_6_DOSSIER_RECOVERY/);
assert.doesNotMatch(source, /replace\(\/\^MISIÓN GENERAL\.\*\$\/i,\s*["']EL OUTSIDER["']\)/);

console.log('PASS: V14.6 recupera títulos desde dossier sin brief, mantiene 12 capítulos y elimina el hardcode de EL OUTSIDER.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
}
const editorUrl = moduleUrl(fs.readFileSync('src/lib/editor.ts','utf8'));
const {pickCanonicalChapterTitle: title, normalizeProjectState: normalize, mergeProjectState: merge, buildMasterFromState: master, processEngineResult: apply} = await import(editorUrl);
assert.equal(title(1,'Capítulo 1','Capítulo 1: Radiografía del poder'),'Radiografía del poder');
assert.equal(title(2,'  ','Capítulo 2. La deuda'),'La deuda');
assert.equal(title(3,'Capítulo 3:','La educación'),'La educación');
assert.equal(title(4,{},'Chapter 4','Un título real'),'Un título real');
const original=normalize({book_topic:'Escribe sobre educación dominicana y conserva mis requisitos.',outline_12:[{chapter_number:1,chapter_title:'La escuela'},{chapter_number:2,chapter_title:'La deuda'}],chapters:[{chapter_number:1,title:'La escuela',text:'Contenido conservado.'}]});
const next=normalize({outline_12:[{chapter_number:1,chapter_title:'Capítulo 1'}]});
const merged=merge(original,next);
assert.equal(merged.book_topic,original.book_topic);
assert.equal(merge(original,normalize({book_topic:'Tema resumido incorrecto'})).book_topic,original.book_topic);
assert.equal(merged.outline_12[0].chapter_title,'La escuela');
assert.equal(merged.outline_12.length,2);
assert.equal(merged.chapters[0].text,'Contenido conservado.');
assert.match(master(merged,'Mi libro'),/## Capítulo 1: La escuela/);
assert.equal(normalize({outline_12:[{chapter_number:1,chapter_title:'',title:'La escuela'}]}).outline_12[0].chapter_title,'La escuela');
const project={id:'test',title:'Mi libro',state:original};
assert.throws(()=>apply({ok:true,project_state_updated:{chapters:[{chapter_number:2,text:'Texto del capítulo equivocado.'}]}},project,{action:'GENERATE_CHAPTER',chapterNum:1}),/no devolvió contenido/);
const source=fs.readFileSync('api/composer.ts','utf8').replace('"../src/lib/editor"',JSON.stringify(editorUrl)).replace("import { GoogleGenAI } from '@google/genai';",'const GoogleGenAI = class {};');
const {buildProductionPlainPrompt}=await import(moduleUrl(source));
const prompt=buildProductionPlainPrompt({action:'GENERATE_CHAPTER',chapter_number:1,target_length_words:2200},{...original,research_context:'FUENTE_APORTADA',outline_12:[{chapter_number:1,chapter_title:'La escuela',subheads_h2:['APARTADO_OBLIGATORIO'],required_facts:['HECHO_POR_VERIFICAR']}],continuity_pack:{canon:'CONTINUIDAD_OBLIGATORIA'}});
for(const part of [original.book_topic,'FUENTE_APORTADA','APARTADO_OBLIGATORIO','HECHO_POR_VERIFICAR','CONTINUIDAD_OBLIGATORIA']) assert.ok(prompt.includes(part),part);
console.log('PASS: títulos, normalización, merge parcial, encargo original, documento maestro, rechazo de capítulo incorrecto y contexto de producción.');

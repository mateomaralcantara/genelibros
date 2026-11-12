// scripts/fix-composer-json-production.mjs
//
// Corrige api/composer.ts para:
// 1. Mantener JSON solo para BUILD_FULL_DOSSIER.
// 2. Generar propuesta, introducción y capítulos como texto plano.
// 3. Convertir el texto plano a la estructura JSON que espera la app.
// 4. Evitar que un JSON roto cierre toda la generación.
// 5. Mantener un fallback seguro cuando falle la reparación del dossier.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "api", "composer.ts");

if (!fs.existsSync(FILE)) {
  console.error("❌ No existe:", FILE);
  process.exit(1);
}

const BACKUP = `${FILE}.bak_prod_json_plain_fix`;
fs.copyFileSync(FILE, BACKUP);

let code = fs.readFileSync(FILE, "utf8");

const helperMarker = "function isLongTextAction";

const helpers = `

type LongTextAction =
  | 'GENERATE_PROPOSAL'
  | 'GENERATE_INTRODUCTION'
  | 'GENERATE_CHAPTER';

function getAction(task: any): string {
  return String(
    task?.action ??
    task?.type ??
    task?.kind ??
    task?.task_type ??
    ''
  ).trim().toUpperCase();
}

function isLongTextAction(task: any): task is any {
  const action = getAction(task);

  return (
    action === 'GENERATE_PROPOSAL' ||
    action === 'GENERATE_INTRODUCTION' ||
    action === 'GENERATE_CHAPTER'
  );
}

function ensureText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function ensureArrayValue<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function countWords(text: string): number {
  return String(text ?? '')
    .trim()
    .split(/\\s+/)
    .filter(Boolean)
    .length;
}

function cleanPlainModelText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\`\`\`json/gi, '')
    .replace(/\`\`\`txt/gi, '')
    .replace(/\`\`\`markdown/gi, '')
    .replace(/\`\`\`/g, '')
    .trim();
}

function stripGeneratedChapterHeading(text: string): string {
  return cleanPlainModelText(text)
    .replace(/^\\s{0,3}#{1,3}\\s*cap[ií]tulo\\b[^\\n]*\\n+/i, '')
    .replace(/^\\s*cap[ií]tulo\\s*\\d+\\s*[:\\-–—.]?\\s*/i, '')
    .trimStart();
}

function getBookTitleFromState(state: any): string {
  return ensureText(
    state?.book_title ??
    state?.bookTitle,
    'Nuevo libro'
  );
}

function getBookTopicFromState(state: any): string {
  return ensureText(
    state?.book_topic ??
    state?.bookTopic,
    ''
  );
}

function getChapterTitleFromState(state: any, chapterNumber: number): string {
  const outline = ensureArrayValue<any>(state?.outline_12);

  const outlineItem = outline.find(
    (item: any) =>
      Number(item?.chapter_number ?? 0) === chapterNumber
  );

  const outlineTitle = ensureText(
    outlineItem?.chapter_title ??
    outlineItem?.title,
    ''
  );

  if (outlineTitle) return outlineTitle;

  const chapters = ensureArrayValue<any>(state?.chapters);

  const chapter = chapters.find(
    (item: any) =>
      Number(item?.chapter_number ?? 0) === chapterNumber
  );

  const existingTitle = ensureText(chapter?.title, '');

  return existingTitle || \`Capítulo \${chapterNumber}\`;
}

function buildProductionPlainPrompt(task: any, state: any): string {
  const action = getAction(task);
  const title = getBookTitleFromState(state);
  const topic = getBookTopicFromState(state);
  const targetWords = Math.max(
    800,
    Number(task?.target_length_words ?? 0) || 0
  );

  const factualRules = [
    'REGLAS FACTUALES:',
    '- No inventes fechas, cifras, citas, fuentes, cargos, premios, leyes, estudios ni acontecimientos.',
    '- Distingue hechos, inferencias, interpretaciones, controversias y datos no verificados.',
    '- No afirmes que realizaste búsquedas web o scraping si no recibiste fuentes.',
    '- Cuando falte respaldo, reduce la certeza o indica que el dato requiere verificación.',
    '- Profundiza con contexto, causas, consecuencias, comparación, contradicciones e impactos.',
    '- No fabriques bibliografía.',
    '- No rellenes extensión con repeticiones ni información dudosa.',
  ].join('\\n');

  if (action === 'GENERATE_PROPOSAL') {
    return [
      'Eres un editor senior de libros de no ficción.',
      '',
      'Escribe la propuesta editorial completa.',
      'Devuelve únicamente texto plano.',
      'No devuelvas JSON.',
      'No uses bloques de código.',
      '',
      \`Título: \${title}\`,
      \`Tema: \${topic}\`,
      \`Objetivo mínimo: \${Math.max(2000, targetWords)} palabras\`,
      '',
      factualRules,
      '',
      'No escribas el encabezado "Propuesta editorial".',
      'No termines a mitad de una frase.',
    ].join('\\n');
  }

  if (action === 'GENERATE_INTRODUCTION') {
    return [
      'Eres un editor senior de libros de no ficción.',
      '',
      'Escribe la introducción completa.',
      'Devuelve únicamente texto plano.',
      'No devuelvas JSON.',
      'No uses bloques de código.',
      '',
      \`Título: \${title}\`,
      \`Tema: \${topic}\`,
      \`Objetivo mínimo: \${Math.max(1400, targetWords)} palabras\`,
      '',
      factualRules,
      '',
      'No escribas el encabezado "Introducción".',
      'No termines a mitad de una frase.',
    ].join('\\n');
  }

  const chapterNumber =
    Number(task?.chapter_number ?? task?.chapterNumber ?? 0) || 0;

  const chapterTitle = getChapterTitleFromState(
    state,
    chapterNumber
  );

  const outline = ensureArrayValue<any>(state?.outline_12);

  const outlineItem = outline.find(
    (item: any) =>
      Number(item?.chapter_number ?? 0) === chapterNumber
  );

  const objective = ensureText(outlineItem?.objective, '');
  const keyPoints = ensureArrayValue<any>(outlineItem?.key_points)
    .map(String)
    .filter(Boolean)
    .slice(0, 18);

  return [
    'Eres un escritor editorial profesional especializado en no ficción.',
    '',
    \`Escribe el capítulo \${chapterNumber} completo.\`,
    'Devuelve únicamente texto plano.',
    'No devuelvas JSON.',
    'No uses bloques de código.',
    '',
    \`Libro: \${title}\`,
    \`Tema general: \${topic}\`,
    \`Título del capítulo: \${chapterTitle}\`,
    \`Objetivo mínimo: \${Math.max(2000, targetWords)} palabras\`,
    objective ? \`Objetivo editorial: \${objective}\` : '',
    keyPoints.length
      ? \`Puntos clave: \${keyPoints.join('; ')}\`
      : '',
    '',
    factualRules,
    '',
    \`No escribas "Capítulo \${chapterNumber}" al inicio.\`,
    'No repitas el título al inicio.',
    'Puedes usar subtítulos internos con ###.',
    'No termines a mitad de una frase.',
  ]
    .filter(Boolean)
    .join('\\n');
}

function buildEngineResponseFromPlainText(
  task: any,
  state: any,
  rawText: string
): any {
  const action = getAction(task);
  const nextState = {
    ...(state || {})
  };

  const cleanText = cleanPlainModelText(rawText);
  const words = countWords(cleanText);

  if (action === 'GENERATE_PROPOSAL') {
    nextState.proposal = {
      ...(nextState.proposal || {}),
      id: 'sec_proposal',
      text: cleanText,
      words,
      status: 'COMPLETED',
    };
  }

  if (action === 'GENERATE_INTRODUCTION') {
    nextState.introduction = {
      ...(nextState.introduction || {}),
      id: 'sec_introduction',
      text: cleanText,
      words,
      status: 'COMPLETED',
    };
  }

  if (action === 'GENERATE_CHAPTER') {
    const chapterNumber =
      Number(task?.chapter_number ?? task?.chapterNumber ?? 0) || 0;

    const chapterText = stripGeneratedChapterHeading(cleanText);
    const chapters = ensureArrayValue<any>(nextState.chapters);
    const index = chapters.findIndex(
      (chapter: any) =>
        Number(chapter?.chapter_number ?? 0) === chapterNumber
    );

    const chapterPayload = {
      ...(index >= 0 ? chapters[index] : {}),
      id: \`sec_chapter_\${String(chapterNumber).padStart(2, '0')}\`,
      chapter_number: chapterNumber,
      title: getChapterTitleFromState(nextState, chapterNumber),
      text: chapterText,
      words: countWords(chapterText),
      status: 'COMPLETED',
    };

    if (index >= 0) {
      chapters[index] = chapterPayload;
    } else {
      chapters.push(chapterPayload);
    }

    nextState.chapters = chapters.sort(
      (a: any, b: any) =>
        (Number(a?.chapter_number ?? 0) || 0) -
        (Number(b?.chapter_number ?? 0) || 0)
    );
  }

  return {
    ok: true,
    dashboard: state?.dashboard ?? {},
    project_state_updated: nextState,
    master_document: {
      title: getBookTitleFromState(nextState),
      text: '',
    },
    needs_input: null,
  };
}

function buildSafeDossierFallback(state: any, reason: string): any {
  return {
    ok: true,
    dashboard: {
      warning:
        'El modelo devolvió un expediente incompleto. Se conservó el estado inicial para evitar perder el proyecto.',
    },
    project_state_updated: {
      ...(state || {}),
      dossier_generation_warning: reason,
    },
    master_document: {
      title: getBookTitleFromState(state),
      text: '',
    },
    needs_input: {
      type: 'RETRY_DOSSIER',
      message:
        'El expediente no pudo interpretarse correctamente. Reintenta la generación.',
    },
  };
}
`;

if (!code.includes(helperMarker)) {
  const insertBefore = "export default async function handler";

  const index = code.indexOf(insertBefore);

  if (index < 0) {
    console.error(
      "❌ No encontré export default async function handler."
    );
    process.exit(1);
  }

  code =
    code.slice(0, index) +
    helpers +
    "\n\n" +
    code.slice(index);

  console.log("✅ Funciones de texto plano agregadas.");
} else {
  console.log("ℹ️ Las funciones auxiliares ya existían.");
}

const oldGenerationStart =
  "    const prompt = `TASK:\\n${JSON.stringify(task)}\\n\\nPROJECT_STATE:\\n${JSON.stringify(state)}`;";

const generationIndex = code.indexOf(oldGenerationStart);

if (generationIndex < 0) {
  console.error(
    "❌ No encontré el bloque original de generación en api/composer.ts."
  );
  console.error("No se modificó el archivo.");

  fs.copyFileSync(BACKUP, FILE);
  process.exit(1);
}

const returnMarker = "    return res.status(200).json(parsed);";
const returnIndex = code.indexOf(returnMarker, generationIndex);

if (returnIndex < 0) {
  console.error("❌ No encontré el retorno final del bloque Gemini.");
  fs.copyFileSync(BACKUP, FILE);
  process.exit(1);
}

const oldBlockEnd = returnIndex + returnMarker.length;

const newGenerationBlock = `    const ai = new GoogleGenAI({ apiKey });

    /*
     * PROPUESTA, INTRODUCCIÓN Y CAPÍTULOS:
     * el modelo genera texto plano y el servidor lo empaqueta
     * en el JSON que espera la aplicación.
     */
    if (isLongTextAction(task)) {
      const plainPrompt = buildProductionPlainPrompt(task, state);

      const targetWords = Math.max(
        800,
        Number(task?.target_length_words ?? 0) || 0
      );

      const maxOutputTokens =
        getAction(task) === 'GENERATE_CHAPTER'
          ? Math.min(
              32000,
              Math.max(12000, Math.floor(targetWords * 3.1))
            )
          : getAction(task) === 'GENERATE_PROPOSAL'
            ? 20000
            : 15000;

      const plainResponse = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: plainPrompt }],
          },
        ],
        config: {
          maxOutputTokens,
          temperature:
            getAction(task) === 'GENERATE_CHAPTER'
              ? 0.48
              : 0.38,
        } as any,
      });

      const text = cleanPlainModelText(
        plainResponse.text || ''
      );

      if (countWords(text) < 40) {
        throw new Error(
          'El modelo devolvió muy poco contenido.'
        );
      }

      const result = buildEngineResponseFromPlainText(
        task,
        state,
        text
      );

      return res.status(200).json(result);
    }

    /*
     * DOSSIER:
     * solamente BUILD_FULL_DOSSIER usa JSON.
     */
    const prompt = [
      'TASK:',
      JSON.stringify(task),
      '',
      'PROJECT_STATE:',
      JSON.stringify(state),
      '',
      'IMPORTANTE:',
      '- Devuelve solamente el expediente y el esquema.',
      '- No escribas capítulos completos.',
      '- Mantén master_document.text vacío.',
      '- Usa JSON válido y compacto.',
    ].join('\\n');

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        maxOutputTokens: 12000,
        temperature: 0.25,
      } as any,
    });

    let parsed: any;

    try {
      parsed = safeJsonParse(response.text || '');
    } catch (firstParseError: any) {
      try {
        const repairPrompt = [
          'Repara el siguiente contenido.',
          'Devuelve solamente JSON válido.',
          'No agregues explicaciones.',
          'No uses Markdown.',
          'No escribas capítulos completos.',
          'Mantén master_document.text vacío.',
          '',
          'Estructura requerida:',
          '{',
          '  "ok": true,',
          '  "dashboard": {},',
          '  "project_state_updated": {},',
          '  "master_document": { "title": "", "text": "" },',
          '  "needs_input": null',
          '}',
          '',
          'RESPUESTA ROTA:',
          String(response.text || '').slice(0, 18000),
        ].join('\\n');

        const repairedResponse =
          await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [{ text: repairPrompt }],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              maxOutputTokens: 12000,
              temperature: 0,
            } as any,
          });

        parsed = safeJsonParse(
          repairedResponse.text || ''
        );
      } catch (repairError: any) {
        parsed = buildSafeDossierFallback(
          state,
          String(
            repairError?.message ??
            firstParseError?.message ??
            'JSON inválido'
          )
        );
      }
    }

    return res.status(200).json(parsed);`;

code =
  code.slice(0, generationIndex) +
  newGenerationBlock +
  code.slice(oldBlockEnd);

fs.writeFileSync(FILE, code, "utf8");

console.log("✅ api/composer.ts corregido.");
console.log("✅ JSON reservado para el dossier.");
console.log("✅ Capítulos, introducción y propuesta usan texto plano.");
console.log("✅ Se agregó fallback para dossier JSON roto.");
console.log("✅ Backup:", BACKUP);
console.log("");
console.log("Ejecuta:");
console.log("npm run build");
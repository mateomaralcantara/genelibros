# Parche para App.tsx

## 1. Importa el cliente de jobs

```ts
import { createChapterGenerationJob } from "./src/lib/jobsClient";
```

## 2. Dentro de `generateSectionCore`, después de calcular `targetWords` y `task`, ANTES de `callComposer`, agrega:

```ts
if (action === "GENERATE_CHAPTER") {
  const n = Number(chapterNum ?? 0) || 0;
  if (!n) throw new Error("Capítulo inválido.");

  await createChapterGenerationJob({
    projectId: proj.id,
    chapterNumber: n,
    targetWords,
    model: GEMINI_MODEL,
  });

  setSectionProgress(proj.id, sectionId, "generating");
  setError("Capítulo enviado a cola. Puedes seguir trabajando mientras se genera.");
  return true;
}
```

Resultado:
- Propuesta e introducción siguen con `callComposer`.
- Capítulos ya NO viajan como JSON.
- Capítulos pasan a worker por bloques.

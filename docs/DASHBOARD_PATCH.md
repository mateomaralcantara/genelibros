# Mostrar progreso en GenerationDashboard

Importa:

```ts
import { useGenerationJobs } from "../src/hooks/useGenerationJobs";
import JobStatusBadge from "./JobStatusBadge";
```

Dentro del componente:

```ts
const { jobs } = useGenerationJobs(project.id, 3500);

function latestJobForChapter(n: number) {
  return jobs.find((j) => j.job_type === "GENERATE_CHAPTER" && Number(j.chapter_number) === Number(n));
}
```

En cada tarjeta de capítulo:

```tsx
<JobStatusBadge job={latestJobForChapter(chapter.chapter_number)} />
```

Cuando un job esté COMPLETED, llama a tu `hydrateProject(project.id)` o refresca el proyecto desde Supabase.

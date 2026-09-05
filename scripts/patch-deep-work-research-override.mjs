import fs from "node:fs";
import path from "node:path";

const workerFile = path.resolve(process.cwd(), "src/server/vercel-handlers/deep-work-worker.ts");
let worker = fs.readFileSync(workerFile, "utf8").replace(/\r\n?/g, "\n");
let changed = false;

// DEEP_RESEARCH_EDITORIAL_OVERRIDE_V1
// Permite cargar UN dossier explícito por ID sin falsificar ready_for_writing.
// Los claims siguen filtrados a VERIFIED + citationReady y los gaps siguen visibles.

if (!worker.includes("DEEP_RESEARCH_EDITORIAL_OVERRIDE_V1_APPLIED")) {
  const signatureRe = /async function loadResearchContext\(\s*s: ReturnType<typeof serviceClient>,\s*projectId: string,\s*chapterNumber: number,\s*\) \{/m;
  if (!signatureRe.test(worker)) {
    throw new Error("DEEP_RESEARCH_OVERRIDE_PATCH_INCOMPLETE: loadResearchContext signature");
  }
  worker = worker.replace(
    signatureRe,
    `async function loadResearchContext(\n  s: ReturnType<typeof serviceClient>,\n  projectId: string,\n  chapterNumber: number,\n  dossierId?: string | null,\n) {\n  // DEEP_RESEARCH_EDITORIAL_OVERRIDE_V1_APPLIED`
  );
  changed = true;

  const queryRe = /const \{ data, error \} = await s\s*\.from\("research_dossiers"\)\s*\.select\(\s*"id,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at"\s*\)\s*\.eq\("project_id", projectId\)\s*\.eq\("chapter_number", chapterNumber\)\s*\.eq\("ready_for_writing", true\)\s*\.order\("completed_at", \{ ascending: false \}\)\s*\.limit\(1\)\s*\.maybeSingle\(\);/m;
  if (!queryRe.test(worker)) {
    throw new Error("DEEP_RESEARCH_OVERRIDE_PATCH_INCOMPLETE: research dossier query");
  }
  worker = worker.replace(
    queryRe,
    `let researchQuery = s\n    .from("research_dossiers")\n    .select("id,topic,coverage_score,evidence_score,factual_confidence_score,ready_for_writing,result,completed_at")\n    .eq("project_id", projectId)\n    .eq("chapter_number", chapterNumber);\n\n  researchQuery = dossierId\n    ? researchQuery.eq("id", dossierId)\n    : researchQuery.eq("ready_for_writing", true);\n\n  const { data, error } = await researchQuery\n    .order("completed_at", { ascending: false })\n    .limit(1)\n    .maybeSingle();`
  );

  const returnMarker = `  return {\n    dossierId: clean(data.id),`;
  if (!worker.includes(returnMarker)) {
    throw new Error("DEEP_RESEARCH_OVERRIDE_PATCH_INCOMPLETE: research return marker");
  }
  worker = worker.replace(
    returnMarker,
    `  return {\n    dossierId: clean(data.id),\n    readyForWriting: Boolean(data.ready_for_writing),\n    editorialOverride: Boolean(dossierId && data.ready_for_writing !== true),`
  );

  const initCallRe = /result\.researchContext = await loadResearchContext\(\s*s,\s*job\.project_id,\s*job\.chapter_number\s*\);/m;
  if (!initCallRe.test(worker)) {
    throw new Error("DEEP_RESEARCH_OVERRIDE_PATCH_INCOMPLETE: INIT research call");
  }
  worker = worker.replace(
    initCallRe,
    `result.researchContext = await loadResearchContext(\n      s,\n      job.project_id,\n      job.chapter_number,\n      clean(result.researchDossierId || job.policy?.researchDossierId || "") || null\n    );`
  );

  const directiveMarker = `    "RESEARCH DOSSIER CERTIFICADO: " +\n      clean(research.dossierId),`;
  if (!worker.includes(directiveMarker)) {
    throw new Error("DEEP_RESEARCH_OVERRIDE_PATCH_INCOMPLETE: directive marker");
  }
  worker = worker.replace(
    directiveMarker,
    `    "RESEARCH DOSSIER: " + clean(research.dossierId),\n\n    research.editorialOverride\n      ? "OVERRIDE EDITORIAL EXPLÍCITO: este dossier no fue marcado ready_for_writing por gaps abiertos. Úsalo únicamente bajo las reglas estrictas siguientes; NO infieras ni completes los gaps."\n      : "RESEARCH CERTIFICADO ready_for_writing.",`
  );
}

const required = [
  worker.includes("DEEP_RESEARCH_EDITORIAL_OVERRIDE_V1_APPLIED"),
  worker.includes('researchQuery.eq("id", dossierId)'),
  worker.includes("editorialOverride: Boolean"),
  worker.includes("result.researchDossierId || job.policy?.researchDossierId"),
  worker.includes("OVERRIDE EDITORIAL EXPLÍCITO"),
  worker.includes('clean(claim.status) === "VERIFIED"'),
  worker.includes("Boolean(claim.citationReady)"),
  worker.includes("GAPS ABIERTOS — NO convertirlos en afirmaciones completas"),
];
if (required.some((ok) => !ok)) {
  throw new Error("DEEP_RESEARCH_OVERRIDE_PATCH_INCOMPLETE: validation");
}

if (changed) {
  fs.writeFileSync(workerFile, worker, "utf8");
  console.log("[Genelibros] DEEP RESEARCH OVERRIDE instalado: dossier explícito permitido sin falsificar ready_for_writing.");
} else {
  console.log("[Genelibros] DEEP RESEARCH OVERRIDE ya estaba instalado.");
}

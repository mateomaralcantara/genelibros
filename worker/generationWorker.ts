import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

type GenerationJob = {
  id: string; project_id: string; job_type: string; chapter_number: number | null;
  target_words: number; model: string; retry_count: number;
};

const supabase = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", {
  auth: { persistSession: false },
});
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS || 2500);
const MAX_ACTIVE = Number(process.env.WORKER_MAX_ACTIVE || 2);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gemini-2.5-flash";
const FALLBACK_MODELS = String(process.env.FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.0-flash").split(",").map(s => s.trim()).filter(Boolean);

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function countWords(text: string) { return (String(text || "").trim().match(/\S+/g) || []).length; }
function clean(text: string) { return String(text || "").replace(/```[\w-]*/g, "").replace(/```/g, "").replace(/^\s*cap[ií]tulo\s+\d+\s*[:\-–—]?\s*/i, "").trim(); }

function trimOverlap(existing: string, addition: string): string {
  const a = String(existing || "").trim();
  const b = String(addition || "").trim();
  if (!a) return b;
  const tail = a.slice(-1800);
  for (let k = Math.min(1400, tail.length); k >= 120; k -= 40) {
    const suffix = tail.slice(-k);
    if (b.startsWith(suffix)) return b.slice(k).trimStart();
  }
  return b;
}

async function updateJob(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from("generation_jobs").update(patch).eq("id", id);
  if (error) throw error;
}

async function callGeminiPlain(prompt: string, model: string, maxOutputTokens: number, temperature = 0.75): Promise<string> {
  const models = Array.from(new Set([model || DEFAULT_MODEL, ...FALLBACK_MODELS]));
  let lastErr: any = null;
  for (const m of models) {
    try {
      const resp = await ai.models.generateContent({
        model: m,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens, temperature } as any,
      });
      const text = clean((resp as any)?.text || "");
      if (countWords(text) > 30) return text;
      throw new Error(`Respuesta muy corta de ${m}`);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || "");
      if (/429|503|quota|rate|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg)) {
        await sleep(2500);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Gemini falló.");
}

async function claimNextJob(): Promise<GenerationJob | null> {
  const { data: jobs, error } = await supabase.from("generation_jobs").select("*").eq("status", "QUEUED").order("created_at").limit(1);
  if (error) throw error;
  const job = jobs?.[0];
  if (!job) return null;

  const { data, error: claimErr } = await supabase.from("generation_jobs")
    .update({ status: "GENERATING", locked_by: WORKER_ID, locked_at: new Date().toISOString(), started_at: new Date().toISOString(), current_step: "Worker iniciado", progress_percent: 3 })
    .eq("id", job.id).eq("status", "QUEUED").select("*").single();

  if (claimErr || !data) return null;
  return data as GenerationJob;
}

async function fetchContext(projectId: string, chapterNumber: number) {
  const { data: project, error: pErr } = await supabase.from("projects").select("id,title,topic,audience,tone_style,outline_12").eq("id", projectId).single();
  if (pErr) throw pErr;

  const { data: sections, error: sErr } = await supabase.from("sections").select("type,chapter_number,title,content,status").eq("project_id", projectId).order("chapter_number");
  if (sErr) throw sErr;

  const outline = Array.isArray(project?.outline_12) ? project.outline_12 : [];
  const chapterOutline = outline.find((o: any) => Number(o?.chapter_number || 0) === chapterNumber) || {};
  const previousChapters = (sections || [])
    .filter((s: any) => s.type === "CHAPTER" && Number(s.chapter_number || 0) < chapterNumber)
    .slice(-2)
    .map((s: any) => `Capítulo ${s.chapter_number}: ${s.title}\n${String(s.content || "").slice(-2200)}`)
    .join("\n\n");

  return { project, chapterOutline, previousChapters };
}

async function saveChapter(job: GenerationJob, title: string, text: string) {
  const n = Number(job.chapter_number || 0);
  const { data: existing } = await supabase.from("sections").select("id").eq("project_id", job.project_id).eq("type", "CHAPTER").eq("chapter_number", n).maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from("sections").update({ title, content: text, status: "COMPLETED", updated_at: new Date().toISOString() }).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("sections").insert({ project_id: job.project_id, type: "CHAPTER", chapter_number: n, title, content: text, status: "COMPLETED" });
    if (error) throw error;
  }
}

async function processChapterJob(job: GenerationJob) {
  const n = Number(job.chapter_number || 0);
  const target = Math.max(800, Number(job.target_words || 3000));
  const model = job.model || DEFAULT_MODEL;
  const ctx = await fetchContext(job.project_id, n);
  const title = ctx.chapterOutline?.chapter_title || ctx.chapterOutline?.title || `Capítulo ${n}`;

  await updateJob(job.id, { current_step: "Planificando capítulo", progress_percent: 10 });

  const planPrompt = `Crea un plan breve para el capítulo ${n} del libro "${ctx.project?.title || ""}".
Tema: ${ctx.project?.topic || ""}
Título del capítulo: ${title}
Objetivo: ${ctx.chapterOutline?.objective || ""}
Puntos clave: ${Array.isArray(ctx.chapterOutline?.key_points) ? ctx.chapterOutline.key_points.join("; ") : ""}
Capítulos anteriores:
${ctx.previousChapters}
Devuelve SOLO texto plano.`;
  const plan = await callGeminiPlain(planPrompt, model, 5000, 0.55);

  const totalBlocks = target >= 5200 ? 5 : target >= 3600 ? 4 : 3;
  let chapter = "";

  for (let i = 1; i <= totalBlocks; i++) {
    await updateJob(job.id, { current_step: `Generando bloque ${i}/${totalBlocks}`, progress_percent: 12 + Math.floor((i - 1) * (60 / totalBlocks)), result_text: chapter || null });

    const blockPrompt = `Escribe el BLOQUE ${i}/${totalBlocks} del capítulo ${n}.
Libro: ${ctx.project?.title || ""}
Tema: ${ctx.project?.topic || ""}
Título del capítulo: ${title}
Meta total: ${target} palabras.
Plan:
${plan}

Texto ya generado, NO repetir:
${chapter.slice(-3500)}

Reglas:
- Devuelve SOLO texto plano.
- NO JSON.
- No repitas "Capítulo ${n}".
- Escribe contenido sustancial.
- Termina con frase completa.`;
    const block = await callGeminiPlain(blockPrompt, model, Math.min(18000, Math.max(9000, Math.floor((target / totalBlocks) * 3.2))), 0.78);
    const add = trimOverlap(chapter, block);
    if (countWords(add) > 80) chapter = (chapter.trim() ? chapter.trim() + "\n\n" : "") + add.trim();
  }

  if (countWords(chapter) < Math.floor(target * 0.88)) {
    await updateJob(job.id, { current_step: "Extendiendo capítulo", progress_percent: 78, result_text: chapter });
    const extra = await callGeminiPlain(`Continúa este capítulo hasta acercarlo a ${target} palabras. Devuelve SOLO texto nuevo. NO JSON.\n\n${chapter.slice(-5000)}`, model, 12000, 0.78);
    chapter += "\n\n" + trimOverlap(chapter, extra);
  }

  await updateJob(job.id, { status: "ASSEMBLING", current_step: "Guardando capítulo", progress_percent: 92, result_text: chapter });
  await saveChapter(job, title, chapter.trim());

  await updateJob(job.id, { status: "COMPLETED", current_step: `Completado (${countWords(chapter)} palabras)`, progress_percent: 100, result_text: chapter.trim(), finished_at: new Date().toISOString() });
}

async function processJob(job: GenerationJob) {
  try {
    if (job.job_type !== "GENERATE_CHAPTER") throw new Error(`job_type no implementado: ${job.job_type}`);
    await processChapterJob(job);
  } catch (e: any) {
    await updateJob(job.id, { status: "ERROR", current_step: "Error", error_message: String(e?.message || e).slice(0, 4000), finished_at: new Date().toISOString(), retry_count: (job.retry_count || 0) + 1 });
  }
}

let active = 0;
async function tick() {
  while (active < MAX_ACTIVE) {
    const job = await claimNextJob();
    if (!job) return;
    active++;
    processJob(job).finally(() => active--);
  }
}

async function main() {
  console.log(`[${WORKER_ID}] Worker iniciado. MAX_ACTIVE=${MAX_ACTIVE}`);
  while (true) {
    try { await tick(); } catch (e) { console.error("tick error", e); }
    await sleep(POLL_MS);
  }
}
main();

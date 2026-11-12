// scripts/backfill-outline-all.mjs
// Backfill GLOBAL: asegura projects.outline_12 para TODOS los proyectos.
// - Si outline_12 está vacío y hay CHAPTER sections => construye outline desde chapters.
// - Si outline_12 está vacío y NO hay chapters => crea outline fallback de 12 capítulos.
//
// Uso:
//   node scripts/backfill-outline-all.mjs
//   node scripts/backfill-outline-all.mjs 4000
//
// Recomendado en .env.local (solo local):
//   SUPABASE_SERVICE_ROLE_KEY=...
//   VITE_SUPABASE_URL=...

import fs from "fs";
import path from "path";

function parseEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[k] = v;
    }
    return env;
  } catch {
    return {};
  }
}

function pickKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
}

function wordCount(text) {
  const t = String(text ?? "").trim();
  if (!t) return 0;
  const m = t.match(/\S+/g);
  return m ? m.length : 0;
}

function buildFallbackOutline12(topicOrTitle, targetWords) {
  const t = (topicOrTitle || "").trim() || "Tema";
  const names = [
    "Panorama general",
    "Historia y evolución",
    "Conceptos clave",
    "Actores y dinámicas",
    "Mecanismos y procesos",
    "Casos y ejemplos",
    "Impactos y consecuencias",
    "Estrategias y herramientas",
    "Errores comunes y mitos",
    "Ética y riesgos",
    "Futuro y escenarios",
    "Plan de acción y cierre",
  ];
  return names.map((name, i) => ({
    id: `outline_${String(i + 1).padStart(2, "0")}`,
    chapter_number: i + 1,
    chapter_title: `Capítulo ${i + 1}: ${name} — ${t}`,
    status: "PENDING",
    target_words: targetWords,
    objective: "",
    key_points: [],
    subheads_h2: [],
    tools_frameworks: [],
    exercises: [],
    deliverable: "",
    transition_to_next: "",
  }));
}

async function httpJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return json;
}

(async () => {
  const ROOT = process.cwd();
  const envLocal = parseEnvFile(path.join(ROOT, ".env.local"));
  const env = { ...envLocal, ...process.env };

  const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const KEY = pickKey(env);

  if (!SUPABASE_URL) {
    console.error("❌ Falta VITE_SUPABASE_URL en .env.local");
    process.exit(1);
  }
  if (!KEY) {
    console.error("❌ Falta SUPABASE_SERVICE_ROLE_KEY (recomendado) o VITE_SUPABASE_ANON_KEY en .env.local");
    process.exit(1);
  }

  const defaultTargetWords = Math.max(500, Number(process.argv[2] || env.DEFAULT_CHAPTER_WORDS || 3000));
  const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";

  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const outDir = path.join(ROOT, ".trace");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "outline_backfill_all.md");

  const lines = [];
  lines.push(`# Outline Backfill (ALL projects)`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`defaultTargetWords: ${defaultTargetWords}`);
  lines.push("");

  // Trae hasta 1000 proyectos (ajusta si tienes más)
  const projects = await httpJson(
    `${base}/projects?select=id,title,topic,outline_12,updated_at&order=updated_at.desc&limit=1000`,
    { headers }
  );

  let updated = 0;
  let skipped = 0;
  let fromChapters = 0;
  let fromFallback = 0;

  for (const p of projects) {
    const outline = Array.isArray(p.outline_12) ? p.outline_12 : [];
    if (outline.length) {
      skipped++;
      continue;
    }

    // buscar capítulos existentes
    const chapters = await httpJson(
      `${base}/sections?select=chapter_number,title,content&type=eq.CHAPTER&project_id=eq.${p.id}&order=chapter_number.asc&limit=200`,
      { headers }
    );

    let nextOutline = [];

    if (Array.isArray(chapters) && chapters.length) {
      nextOutline = chapters
        .filter((c) => (Number(c?.chapter_number ?? 0) || 0) > 0)
        .sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0))
        .map((c, idx) => {
          const n = Number(c.chapter_number ?? (idx + 1)) || (idx + 1);
          const title = String(c.title ?? `Capítulo ${n}`).trim() || `Capítulo ${n}`;
          const wc = wordCount(c.content);
          const target_words = Math.max(defaultTargetWords, wc || 0);

          return {
            id: `outline_${String(n).padStart(2, "0")}`,
            chapter_number: n,
            chapter_title: title,
            status: "PENDING",
            target_words,
            objective: "",
            key_points: [],
            subheads_h2: [],
            tools_frameworks: [],
            exercises: [],
            deliverable: "",
            transition_to_next: "",
          };
        });

      fromChapters++;
    } else {
      const seed = (p.topic || p.title || "").trim();
      nextOutline = buildFallbackOutline12(seed, defaultTargetWords);
      fromFallback++;
    }

    await httpJson(`${base}/projects?id=eq.${p.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ outline_12: nextOutline }),
    });

    updated++;
    lines.push(`- ✅ ${p.id} | ${p.title} | outline_12=${nextOutline.length} (${Array.isArray(chapters) && chapters.length ? "from chapters" : "fallback"})`);
  }

  lines.push("");
  lines.push(`## Summary`);
  lines.push(`- projects total: ${projects.length}`);
  lines.push(`- updated: ${updated}`);
  lines.push(`- skipped (already had outline_12): ${skipped}`);
  lines.push(`- updated from chapters: ${fromChapters}`);
  lines.push(`- updated from fallback: ${fromFallback}`);

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

  console.log("✅ DONE");
  console.log("projects:", projects.length);
  console.log("updated:", updated, "| skipped:", skipped);
  console.log("from chapters:", fromChapters, "| from fallback:", fromFallback);
  console.log("report:", reportPath);
})().catch((e) => {
  console.error("❌ Error:", e?.message || e);
  if (e?.status) console.error("HTTP:", e.status);
  if (e?.body) console.error(String(e.body).slice(0, 800));
  process.exit(1);
});
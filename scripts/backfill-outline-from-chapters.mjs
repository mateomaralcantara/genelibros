// scripts/backfill-outline-from-chapters.mjs
// Backfill: crea projects.outline_12 a partir de sections tipo CHAPTER.
// Uso:
//   node scripts/backfill-outline-from-chapters.mjs
//   node scripts/backfill-outline-from-chapters.mjs <projectId>
//   node scripts/backfill-outline-from-chapters.mjs <projectId> <defaultTargetWords>
// Ej:
//   node scripts/backfill-outline-from-chapters.mjs a2b60b30-7f0a-4827-9d9f-6ddb8916970e 4000

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

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ""));
}

function wordCount(text) {
  const t = String(text ?? "").trim();
  if (!t) return 0;
  const m = t.match(/\S+/g);
  return m ? m.length : 0;
}

async function httpJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!r.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return json;
}

function pickKey(env) {
  // Para scripts: lo ideal es SERVICE_ROLE (solo local)
  return env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
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

  const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  let projectId = process.argv[2];

  // si no lo pasan, usa el último actualizado
  if (!projectId) {
    const list = await httpJson(`${base}/projects?select=id,title,updated_at&order=updated_at.desc&limit=1`, { headers });
    projectId = list?.[0]?.id;
    if (!projectId) throw new Error("No hay proyectos.");
    console.log(`ℹ️ Usando último proyecto: ${projectId} (${list?.[0]?.title || "sin título"})`);
  }

  if (!isUuid(projectId)) throw new Error(`projectId NO es UUID válido: "${projectId}"`);

  const defaultTargetWords = Math.max(500, Number(process.argv[3] || env.DEFAULT_CHAPTER_WORDS || 3000));

  // 1) cargar proyecto
  const projRows = await httpJson(
    `${base}/projects?select=id,title,topic,outline_12,updated_at&limit=1&id=eq.${projectId}`,
    { headers }
  );
  const proj = projRows?.[0];
  if (!proj) throw new Error("No encontré ese projectId en projects.");

  const existingOutline = Array.isArray(proj.outline_12) ? proj.outline_12 : [];
  if (existingOutline.length) {
    console.log(`✅ Este proyecto ya tiene outline_12 (${existingOutline.length}). No hago nada.`);
    process.exit(0);
  }

  // 2) cargar capítulos desde sections
  const sections = await httpJson(
    `${base}/sections?select=id,type,chapter_number,title,status,content&project_id=eq.${projectId}&type=eq.CHAPTER&order=chapter_number.asc`,
    { headers }
  );
  if (!Array.isArray(sections) || sections.length === 0) {
    console.log("❌ No hay CHAPTER en sections. No puedo backfillear outline_12.");
    console.log("👉 Primero genera capítulos o revisa por qué no se guardan sections tipo CHAPTER.");
    process.exit(1);
  }

  // 3) construir outline_12 basado en sections
  const outline_12 = sections
    .filter((s) => (Number(s?.chapter_number ?? 0) || 0) > 0)
    .sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0))
    .map((s, idx) => {
      const n = Number(s.chapter_number ?? (idx + 1)) || (idx + 1);
      const title = String(s.title ?? `Capítulo ${n}`).trim() || `Capítulo ${n}`;
      const wc = wordCount(s.content);
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

  // 4) patch projects.outline_12
  const patched = await httpJson(`${base}/projects?id=eq.${projectId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ outline_12 }),
  });

  console.log("✅ Backfill OK: projects.outline_12 actualizado");
  console.log("project:", patched?.[0]?.id, "| title:", patched?.[0]?.title);
  console.log("outline_12 count:", Array.isArray(patched?.[0]?.outline_12) ? patched[0].outline_12.length : 0);
  console.log("defaultTargetWords:", defaultTargetWords);

  // Guardar reporte
  const outDir = path.join(ROOT, ".trace");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "outline_backfill.md");

  const lines = [];
  lines.push(`# Outline Backfill Report`);
  lines.push(`project_id: ${projectId}`);
  lines.push(`title: ${proj.title || ""}`);
  lines.push(`defaultTargetWords: ${defaultTargetWords}`);
  lines.push(`outline_12 count: ${outline_12.length}`);
  lines.push("");
  lines.push("## Outline (first 12)");
  for (const o of outline_12.slice(0, 12)) {
    lines.push(`- ${o.chapter_number} | ${o.chapter_title} | target_words=${o.target_words}`);
  }
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`📝 Reporte: ${reportPath}`);
})().catch((e) => {
  console.error("❌ Error:", e?.message || e);
  if (e?.status) console.error("HTTP:", e.status);
  if (e?.body) console.error(String(e.body).slice(0, 800));
  process.exit(1);
});
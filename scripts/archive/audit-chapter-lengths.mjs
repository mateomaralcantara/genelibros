#!/usr/bin/env node
/**
 * Audit: why chapters are short (Supabase).
 *
 * Reads .env.local for:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Optional (recommended if RLS blocks REST):
 *   SUPABASE_SERVICE_ROLE_KEY  (DO NOT COMMIT)
 *
 * Output:
 *   .health/chapters_audit.md
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".health");
const OUT_MD = path.join(OUT_DIR, "chapters_audit.md");

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

function wc(text) {
  const t = (text ?? "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function isPlaceholder(text) {
  const t = (text ?? "").trim();
  if (!t) return true;
  const compact = t.replace(/\s+/g, "");
  if (compact === "..." || compact === "…") return true;
  if (t.length < 300 && /(\.\.\.|…)/.test(t)) return true;
  return false;
}

function looksTruncated(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  // Heurística: termina sin punto/cierre típico o queda cortado a mitad de frase
  const tail = t.slice(-120);
  const endsClean = /[.!?…"”)\]]\s*$/.test(tail);
  const endsWeird = /[,;:]\s*$/.test(tail) || /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\s*$/.test(tail) === false;
  // Si es muy corto y no termina “cerrado”, sospecha
  return t.length > 800 && !endsClean && endsWeird;
}

async function supaGetJson(url, apiKey) {
  const r = await fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    throw new Error(`Supabase REST error ${r.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

function restBase(supabaseUrl) {
  return supabaseUrl.replace(/\/$/, "") + "/rest/v1";
}

function mdEscape(s) {
  return String(s ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

(async () => {
  const envLocal = parseEnvFile(path.join(ROOT, ".env.local"));
  const env = { ...envLocal, ...process.env };

  const SUPABASE_URL = env.VITE_SUPABASE_URL;
  const ANON = env.VITE_SUPABASE_ANON_KEY;
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) throw new Error("Falta VITE_SUPABASE_URL en .env.local");
  if (!ANON && !SERVICE) throw new Error("Falta VITE_SUPABASE_ANON_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.local");

  const API_KEY = SERVICE || ANON; // service role si existe, si no anon
  const base = restBase(SUPABASE_URL);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) Projects (outline_12 trae target_words)
  const projects = await supaGetJson(
    `${base}/projects?select=id,title,outline_12,updated_at&order=updated_at.desc`,
    API_KEY
  );

  // 2) Sections (chapters)
  const sections = await supaGetJson(
    `${base}/sections?select=id,project_id,type,chapter_number,title,content,status,updated_at&order=project_id.asc&order=type.asc&order=chapter_number.asc`,
    API_KEY
  );

  const byProject = new Map();
  for (const p of projects) byProject.set(p.id, p);

  // Build target map: projectId -> chapterNumber -> targetWords
  const targetMap = new Map();
  for (const p of projects) {
    const o12 = Array.isArray(p.outline_12) ? p.outline_12 : [];
    const m = new Map();
    for (let i = 0; i < o12.length; i++) {
      const o = o12[i];
      const n = Number(o?.chapter_number ?? (i + 1)) || (i + 1);
      const tw = Number(o?.target_words ?? 0) || 0;
      if (n > 0) m.set(n, tw);
    }
    targetMap.set(p.id, m);
  }

  // Filter chapters
  const chapters = sections.filter((s) => s?.type === "CHAPTER");

  // Summaries
  let md = `# Chapter Length Audit\n\nGenerated: ${new Date().toISOString()}\n\n`;
  md += `Projects: **${projects.length}**\n\nChapters in DB: **${chapters.length}**\n\n`;
  md += `> Si esto falla por RLS, usa SUPABASE_SERVICE_ROLE_KEY en .env.local (solo local, no lo subas).\n\n`;

  for (const p of projects) {
    const pCh = chapters.filter((c) => c.project_id === p.id);
    const title = p.title || p.id;

    const wordCounts = pCh.map((c) => wc(c.content || ""));
    const avg = wordCounts.length ? Math.round(wordCounts.reduce((a,b)=>a+b,0) / wordCounts.length) : 0;
    const min = wordCounts.length ? Math.min(...wordCounts) : 0;
    const max = wordCounts.length ? Math.max(...wordCounts) : 0;

    md += `## ${title}\n\n`;
    md += `- project_id: \`${p.id}\`\n`;
    md += `- capítulos: **${pCh.length}** | promedio: **${avg}** | min: **${min}** | max: **${max}**\n\n`;

    if (!pCh.length) {
      md += `_Sin capítulos guardados en sections._\n\n`;
      continue;
    }

    md += `| Capítulo | status | words | target_words | ratio | flags |\n`;
    md += `|---:|---|---:|---:|---:|---|\n`;

    const tm = targetMap.get(p.id) || new Map();

    pCh
      .slice()
      .sort((a,b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0))
      .forEach((c) => {
        const n = Number(c.chapter_number ?? 0) || 0;
        const words = wc(c.content || "");
        const target = tm.get(n) || 0;
        const ratio = target ? (words / target).toFixed(2) : "";
        const flags = [];
        if (isPlaceholder(c.content || "")) flags.push("PLACEHOLDER/EMPTY");
        if (looksTruncated(c.content || "")) flags.push("TRUNCATED?");
        if (target >= 3000 && words < 1200) flags.push("WAY_TOO_SHORT");
        if (target > 0 && words < target * 0.6) flags.push("<60% target");
        md += `| ${n} | ${mdEscape(c.status)} | ${words} | ${target || ""} | ${ratio} | ${flags.join(", ")} |\n`;
      });

    md += `\n### Detalles de capítulos problemáticos\n\n`;

    const bad = pCh.filter((c) => {
      const n = Number(c.chapter_number ?? 0) || 0;
      const words = wc(c.content || "");
      const target = tm.get(n) || 0;
      if (isPlaceholder(c.content || "")) return true;
      if (target >= 3000 && words < 1200) return true;
      if (target > 0 && words < target * 0.6) return true;
      return false;
    });

    if (!bad.length) {
      md += `_No se detectaron capítulos claramente cortos vs target._\n\n`;
    } else {
      for (const c of bad.slice(0, 30)) {
        const n = Number(c.chapter_number ?? 0) || 0;
        const words = wc(c.content || "");
        const target = (tm.get(n) || 0);
        const head = String(c.content || "").trim().slice(0, 220).replace(/\s+/g, " ");
        const tail = String(c.content || "").trim().slice(-260).replace(/\s+/g, " ");

        md += `**Capítulo ${n}** — words=${words} target=${target}\n\n`;
        md += `- title: ${mdEscape(c.title)}\n`;
        md += `- updated_at: ${mdEscape(c.updated_at)}\n`;
        md += `- status: ${mdEscape(c.status)}\n\n`;
        md += `**Inicio:**\n\n> ${head}\n\n`;
        md += `**Final:**\n\n> ${tail}\n\n`;
        md += `---\n\n`;
      }
    }
  }

  md += `\n## Interpretación rápida\n\n`;
  md += `- Si **target_words** (outline) es 3000–6000 pero en DB ves 400–800 palabras: el modelo está generando corto o tu app está pidiendo corto.\n`;
  md += `- Si ves flag **TRUNCATED?**: podría estar cortándose por tokens/stop; revisa finish reason (MAX_TOKENS) y configura maxOutputTokens.\n`;
  md += `- Token tip: 100 tokens ~ 60–80 palabras; un capítulo de 6000 palabras puede necesitar ~8k–10k tokens de salida. :contentReference[oaicite:0]{index=0}\n`;
  md += `- gemini-3.1-flash-lite soporta hasta ~65k output tokens, así que 6000 palabras deberían caber si le das maxOutputTokens suficiente. :contentReference[oaicite:1]{index=1}\n`;
  md += `\n`;

  fs.writeFileSync(OUT_MD, md, "utf8");

  console.log("✅ Audit listo:");
  console.log(" -", path.relative(ROOT, OUT_MD));
  console.log("");
  console.log("Tip: abre el .md y mira los flags WAY_TOO_SHORT y <60% target.");
})().catch((e) => {
  console.error("❌ Audit falló:", e.message);
  process.exit(1);
});
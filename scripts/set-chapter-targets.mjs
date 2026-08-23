// @ts-nocheck
/**
 * Set target_words for every outline_12 chapter of a project (Supabase).
 * Usage:
 *   node scripts/set-chapter-targets.mjs <projectId> <targetWords>
 * Example:
 *   node scripts/set-chapter-targets.mjs 7677e08f-656b-4022-a654-171bcad2a137 6000
 */

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

const ROOT = process.cwd();
const envLocal = parseEnvFile(path.join(ROOT, ".env.local"));
const env = { ...envLocal, ...process.env };

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) throw new Error("Falta VITE_SUPABASE_URL en .env.local");
if (!KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (recomendado) o VITE_SUPABASE_ANON_KEY en .env.local");

const projectId = process.argv[2];
const targetWords = Number(process.argv[3] || 0);

if (!projectId) throw new Error("Uso: node scripts/set-chapter-targets.mjs <projectId> <targetWords>");
if (!targetWords || targetWords < 500) throw new Error("targetWords inválido (usa 3000 o 6000)");

const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";

async function getJson(url) {
  const r = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`REST ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function patch(url, body) {
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`REST ${r.status}: ${t}`);
  return JSON.parse(t);
}

const proj = await getJson(`${base}/projects?select=id,title,outline_12&id=eq.${projectId}`);
if (!proj?.[0]) throw new Error("No encontré ese projectId en projects");

const outline = Array.isArray(proj[0].outline_12) ? proj[0].outline_12 : [];
if (!outline.length) {
  console.log("⚠️ Este libro no tiene outline_12 todavía. Genera el dossier/outline primero.");
  process.exit(0);
}

const nextOutline = outline.map((o, idx) => {
  const n = Number(o?.chapter_number ?? (idx + 1)) || (idx + 1);
  return { ...o, chapter_number: n, target_words: targetWords };
});

const updated = await patch(`${base}/projects?id=eq.${projectId}`, { outline_12: nextOutline });

console.log("✅ Actualizado outline_12 target_words");
console.log("title:", updated?.[0]?.title);
console.log("project_id:", updated?.[0]?.id);
console.log("target_words:", targetWords);
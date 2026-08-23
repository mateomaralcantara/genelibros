#!/usr/bin/env node
/**
 * Extend CHAPTER content in Supabase until target words reached (3000–6000).
 * - Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS (LOCAL ONLY, DON'T COMMIT).
 * - Uses Gemini direct (DEV) with VITE_GEMINI_API_KEY.
 *
 * Usage:
 *   node scripts/extend-chapter.mjs <projectId> <chapterNumber> [targetWords] [maxSteps]
 *
 * Example:
 *   node scripts/extend-chapter.mjs 01a7d4... 3 5000 6
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const ROOT = process.cwd();

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

const envLocal = parseEnvFile(path.join(ROOT, ".env.local"));
const env = { ...envLocal, ...process.env };

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY; // dev key
const GEMINI_MODEL = env.VITE_GEMINI_MODEL || "gemini-3.1-flash-lite";

if (!SUPABASE_URL) throw new Error("Falta VITE_SUPABASE_URL en .env.local");
if (!SERVICE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local (solo local).");
if (!GEMINI_KEY) throw new Error("Falta VITE_GEMINI_API_KEY (o GEMINI_API_KEY) en .env.local para generar.");

const projectId = process.argv[2];
const chapterNumber = Number(process.argv[3] || 0);
const targetWordsArg = process.argv[4] ? Number(process.argv[4]) : 0;
const maxSteps = process.argv[5] ? Math.max(1, Number(process.argv[5])) : 6;

if (!projectId) throw new Error("Uso: node scripts/extend-chapter.mjs <projectId> <chapterNumber> [targetWords] [maxSteps]");
if (!chapterNumber) throw new Error("chapterNumber inválido");

function wc(text) {
  const t = (text ?? "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function tail(text, maxChars = 2800) {
  const t = (text ?? "").trim();
  if (!t) return "";
  return t.length <= maxChars ? t : t.slice(t.length - maxChars);
}

// evita repetir: si el modelo re-imprime el final, recorta overlap
function trimOverlap(existing, addition) {
  const a = (existing ?? "").trim();
  const b = (addition ?? "").trim();
  if (!a || !b) return b;

  const aTail = a.slice(-1200);
  // busca el mayor sufijo de aTail que sea prefijo de b
  for (let k = Math.min(800, aTail.length); k >= 80; k -= 20) {
    const suffix = aTail.slice(-k);
    if (b.startsWith(suffix)) return b.slice(k).trimStart();
  }
  return b;
}

function cleanModelText(t) {
  let s = String(t ?? "").trim();
  // algunos modelos devuelven comillas o markdown
  s = s.replace(/^```(json|text)?/i, "").replace(/```$/i, "").trim();
  return s;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  // 1) Cargar proyecto (title + outline_12)
  const { data: proj, error: pErr } = await supabase
    .from("projects")
    .select("id,title,topic,outline_12,tone_style,audience")
    .eq("id", projectId)
    .single();

  if (pErr) throw new Error(`No pude cargar project: ${pErr.message}`);
  const outline = Array.isArray(proj?.outline_12) ? proj.outline_12 : [];

  // targetWords: del outline o arg
  let targetWords = targetWordsArg;
  if (!targetWords) {
    const o = outline.find((x) => Number(x?.chapter_number ?? 0) === chapterNumber);
    targetWords = Number(o?.target_words ?? 0) || 0;
  }
  if (!targetWords) targetWords = 3000; // fallback mínimo si no hay outline

  // 2) Cargar o crear sección
  const { data: secRows, error: sErr } = await supabase
    .from("sections")
    .select("id,project_id,type,chapter_number,title,content,status")
    .eq("project_id", projectId)
    .eq("type", "CHAPTER")
    .eq("chapter_number", chapterNumber)
    .limit(1);

  if (sErr) throw new Error(`No pude leer section: ${sErr.message}`);

  let section = secRows?.[0] ?? null;
  if (!section) {
    const { data: ins, error: iErr } = await supabase
      .from("sections")
      .insert({
        project_id: projectId,
        type: "CHAPTER",
        chapter_number: chapterNumber,
        title: `Capítulo ${chapterNumber}`,
        content: "",
        status: "PENDING",
      })
      .select("id,project_id,type,chapter_number,title,content,status")
      .single();

    if (iErr) throw new Error(`No pude crear section: ${iErr.message}`);
    section = ins;
  }

  let content = String(section.content ?? "");
  const startWords = wc(content);

  // 3) Prompt base (ancla fuerte para evitar “capítulo corto”)
  const chapterOutline = outline.find((x) => Number(x?.chapter_number ?? 0) === chapterNumber) ?? null;
  const chapterObjective = chapterOutline?.objective ? String(chapterOutline.objective) : "";
  const chapterKeyPoints = Array.isArray(chapterOutline?.key_points) ? chapterOutline.key_points.filter(Boolean) : [];
  const chapterH2 = Array.isArray(chapterOutline?.subheads_h2) ? chapterOutline.subheads_h2.filter(Boolean) : [];

  const bookTitle = proj?.title || "Libro";
  const bookTopic = proj?.topic || "";
  const audience = proj?.audience || "";
  const tone = proj?.tone_style || "";

  console.log(`\n== Extensión de capítulo ${chapterNumber} ==`);
  console.log(`Project: ${bookTitle} (${projectId})`);
  console.log(`Actual: ${startWords} palabras | Target: ${targetWords} | maxSteps: ${maxSteps}\n`);

  // 4) Loop: continuar hasta target
  let step = 0;
  while (wc(content) < targetWords && step < maxSteps) {
    step += 1;

    const remaining = targetWords - wc(content);
    // pedimos chunks grandes para llegar a 3000–6000 en pocas llamadas
    const desiredChunk = Math.max(900, Math.min(2000, Math.floor(remaining * 0.6)));

    const prompt = `
Vas a CONTINUAR un capítulo de un libro. NO repitas texto ya escrito.
NO escribas título ni encabezados; solo contenido narrativo/explicativo del capítulo.

LIBRO:
- Título: ${bookTitle}
- Tema: ${bookTopic}
- Audiencia: ${audience}
- Tono/estilo: ${tone}

CAPÍTULO ${chapterNumber}:
- Objetivo: ${chapterObjective}
- Puntos clave: ${chapterKeyPoints.slice(0, 12).join(" | ")}
- Subtítulos sugeridos (H2): ${chapterH2.slice(0, 12).join(" | ")}

REGLAS:
- Continúa exactamente desde donde quedó (mis últimas líneas abajo).
- Produce ~${desiredChunk} palabras en esta continuación (ni 200, ni 400: debe ser un bloque sustancial).
- Evita relleno, evita listas infinitas, mantén coherencia y progresión.
- No cierres el capítulo todavía si faltan muchas palabras para el target (${targetWords}).

ÚLTIMO CONTEXTO (cola del capítulo):
"""
${tail(content, 2800)}
"""
`.trim();

    const resp = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        // clave: permitir salidas largas (esto es lo que mata capítulos de 400 palabras)
        maxOutputTokens: 12000,
        temperature: 0.85,
      },
    });

    let add = cleanModelText(resp?.text || "");
    if (!add) {
      console.log(`Step ${step}: modelo devolvió vacío. Abortando.`);
      break;
    }

    add = trimOverlap(content, add);
    const addWords = wc(add);

    if (addWords < 500) {
      console.log(`Step ${step}: salida demasiado corta (${addWords} palabras). Reintentando con instrucciones más duras…`);

      const resp2 = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Escribe una continuación LARGA (1200–2000 palabras) y coherente. NO repitas. Continúa desde aquí:\n\n"""${tail(
                  content,
                  2800
                )}"""`,
              },
            ],
          },
        ],
        config: { maxOutputTokens: 16000, temperature: 0.85 },
      });

      let add2 = cleanModelText(resp2?.text || "");
      add2 = trimOverlap(content, add2);
      if (wc(add2) > addWords) add = add2;
    }

    content = (content.trim() ? content.trim() + "\n\n" : "") + add.trim();
    console.log(`Step ${step}: +${wc(add)} palabras | Total: ${wc(content)}/${targetWords}`);
  }

  const finalWords = wc(content);
  const reached = finalWords >= Math.floor(targetWords * 0.95);

  // 5) Guardar en sections + versionado
  const { error: upErr } = await supabase
    .from("sections")
    .upsert(
      {
        id: section.id,
        project_id: projectId,
        type: "CHAPTER",
        chapter_number: chapterNumber,
        title: section.title || `Capítulo ${chapterNumber}`,
        content,
        status: reached ? "COMPLETED" : "PENDING",
      },
      { onConflict: "id" }
    );

  if (upErr) throw new Error(`No pude guardar sections: ${upErr.message}`);

  const { error: vErr } = await supabase.from("section_versions").insert({
    section_id: section.id,
    content,
  });
  if (vErr) console.warn("⚠️ No pude insertar section_versions:", vErr.message);

  // 6) Rebuild master + snapshot
  const { data: master, error: rpcErr } = await supabase.rpc("build_master_text", { p_project_id: projectId });
  if (rpcErr) {
    console.warn("⚠️ RPC build_master_text falló:", rpcErr.message);
  } else {
    const { data: latest } = await supabase
      .from("master_documents")
      .select("version")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1);

    const nextVersion = (latest?.[0]?.version ?? 0) + 1;

    const { error: mErr } = await supabase.from("master_documents").insert({
      project_id: projectId,
      title: bookTitle,
      content: String(master ?? ""),
      version: nextVersion,
    });
    if (mErr) console.warn("⚠️ No pude insertar master_documents:", mErr.message);
  }

  console.log("\n✅ Terminado");
  console.log(`- Inicial: ${startWords} palabras`);
  console.log(`- Final:   ${finalWords} palabras`);
  console.log(`- Target:  ${targetWords}`);
  console.log(`- Status:  ${reached ? "COMPLETED" : "PENDING"}\n`);
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
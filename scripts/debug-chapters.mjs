// scripts/debug-chapters.mjs
// Diagnóstico: por qué no aparecen capítulos / outline_12 / CHAPTER sections en Supabase
// Uso:
//   node scripts/debug-chapters.mjs
//   node scripts/debug-chapters.mjs <projectId>

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

// Detecta arrays tipo outline (12 items con chapter_number / title / target_words)
function looksLikeOutlineArray(arr) {
  if (!Array.isArray(arr) || arr.length < 6) return false;
  let score = 0;
  for (const x of arr.slice(0, 12)) {
    if (!x || typeof x !== "object") continue;
    if ("chapter_number" in x || "chapterNumber" in x) score += 2;
    if ("chapter_title" in x || "chapterTitle" in x || "title" in x) score += 1;
    if ("target_words" in x || "targetWords" in x) score += 1;
  }
  return score >= 6;
}

function deepFindOutline(node, depth = 0) {
  if (depth > 7) return null;

  if (Array.isArray(node)) {
    if (looksLikeOutlineArray(node)) return node;
    for (const it of node) {
      const found = deepFindOutline(it, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (node && typeof node === "object") {
    const keys = Object.keys(node);

    // prioriza llaves sospechosas
    const preferred = keys.filter((k) => /outline|blueprint|chapters/i.test(k));
    for (const k of preferred) {
      const found = deepFindOutline(node[k], depth + 1);
      if (found) return found;
    }
    for (const k of keys) {
      const found = deepFindOutline(node[k], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

async function httpJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // deja json null
  }
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

  const projectIdArg = process.argv[2];
  const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";

  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };

  const outDir = path.join(ROOT, ".trace");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "chapters_debug.md");

  const lines = [];
  const now = new Date().toISOString();
  lines.push(`# Chapters Debug Report`);
  lines.push(`Generated: ${now}`);
  lines.push(`Base: ${base}`);
  lines.push("");

  let projectId = projectIdArg;

  try {
    if (!projectId) {
      // toma el último actualizado
      const list = await httpJson(`${base}/projects?select=id,title,topic,updated_at&order=updated_at.desc&limit=1`, { headers });
      projectId = list?.[0]?.id;
      if (!projectId) throw new Error("No hay proyectos en DB.");
      console.log(`ℹ️ Usando último proyecto: ${projectId} (${list?.[0]?.title || "sin título"})`);
    }

    if (!isUuid(projectId)) {
      throw new Error(`projectId NO es UUID válido: "${projectId}"`);
    }

    // 1) Project row (outline_12 + dossier)
    const projRows = await httpJson(
      `${base}/projects?select=id,title,topic,outline_12,dossier,updated_at,created_at&limit=1&id=eq.${projectId}`,
      { headers }
    );
    const proj = projRows?.[0];
    if (!proj) throw new Error("No encontré ese projectId en projects.");

    const outline = Array.isArray(proj.outline_12) ? proj.outline_12 : [];
    const dossier = proj.dossier ?? null;
    const outlineInDossier = dossier ? deepFindOutline(dossier) : null;

    lines.push(`## Project`);
    lines.push(`- id: \`${proj.id}\``);
    lines.push(`- title: ${proj.title}`);
    lines.push(`- topic: ${proj.topic || ""}`);
    lines.push(`- updated_at: ${proj.updated_at}`);
    lines.push(`- outline_12 count: **${outline.length}**`);
    lines.push(`- dossier has outline-looking array: **${outlineInDossier ? "YES" : "NO"}**`);
    lines.push("");

    if (outline.length) {
      lines.push(`### outline_12 sample (first 5)`);
      for (const o of outline.slice(0, 5)) {
        const n = o.chapter_number ?? o.chapterNumber ?? "?";
        const t = o.chapter_title ?? o.chapterTitle ?? o.title ?? "";
        const tw = o.target_words ?? o.targetWords ?? 0;
        lines.push(`- ${n} | ${t} | target_words=${tw}`);
      }
      lines.push("");
    } else if (outlineInDossier) {
      lines.push(`### 🚨 Problema detectado`);
      lines.push(`Tu proyecto NO tiene outline_12 en projects, pero SÍ parece tenerlo dentro de dossier/dashboard.`);
      lines.push(`Eso significa que tu app NO está copiando/persistiendo el outline al campo projects.outline_12.`);
      lines.push(`Consecuencia: el UI no lista capítulos → no puedes generar capítulos.`);
      lines.push("");
      lines.push(`### outline encontrado dentro de dossier (first 5)`);
      for (const o of outlineInDossier.slice(0, 5)) {
        const n = o.chapter_number ?? o.chapterNumber ?? "?";
        const t = o.chapter_title ?? o.chapterTitle ?? o.title ?? "";
        const tw = o.target_words ?? o.targetWords ?? 0;
        lines.push(`- ${n} | ${t} | target_words=${tw}`);
      }
      lines.push("");
    } else {
      lines.push(`### 🚨 Problema detectado`);
      lines.push(`No hay outline_12 en projects y tampoco se detectó outline dentro de dossier.`);
      lines.push(`Eso suele indicar que BUILD_FULL_DOSSIER no está devolviendo outline (o se está perdiendo al merge).`);
      lines.push("");
    }

    // 2) Sections (CHAPTERs)
    const sections = await httpJson(
      `${base}/sections?select=id,type,chapter_number,title,status,content,updated_at,created_at&project_id=eq.${projectId}&order=type.asc&order=chapter_number.asc`,
      { headers }
    );

    const proposal = sections.filter((s) => s.type === "PROPOSAL");
    const intro = sections.filter((s) => s.type === "INTRODUCTION");
    const chapters = sections.filter((s) => s.type === "CHAPTER");

    lines.push(`## Sections`);
    lines.push(`- PROPOSAL rows: **${proposal.length}**`);
    lines.push(`- INTRODUCTION rows: **${intro.length}**`);
    lines.push(`- CHAPTER rows: **${chapters.length}**`);
    lines.push("");

    if (proposal[0]) lines.push(`- Proposal words: ${wordCount(proposal[0].content)} | status=${proposal[0].status}`);
    if (intro[0]) lines.push(`- Intro words: ${wordCount(intro[0].content)} | status=${intro[0].status}`);
    lines.push("");

    if (chapters.length) {
      lines.push(`### Chapters in DB (first 12)`);
      for (const c of chapters.slice(0, 12)) {
        lines.push(
          `- ch ${c.chapter_number}: "${c.title}" | words=${wordCount(c.content)} | status=${c.status}`
        );
      }
      lines.push("");
    } else {
      lines.push(`### 🚨 Problema detectado`);
      lines.push(`No existen filas CHAPTER en sections para este proyecto.`);
      lines.push(`Eso significa que nunca se guardó ningún capítulo (o no se ejecutó generación de capítulos).`);
      lines.push("");
      lines.push(`Si outline_12 está vacío: el UI nunca intentará generar capítulos.`);
      lines.push(`Si outline_12 existe: revisa tu flujo "Autogenerar todo" / "Generar selección" y que llame GENERATE_CHAPTER.`);
      lines.push("");
    }

    // 3) Master documents
    const masters = await httpJson(
      `${base}/master_documents?select=id,version,title,content,created_at&project_id=eq.${projectId}&order=version.desc&limit=1`,
      { headers }
    );
    const master = masters?.[0] ?? null;
    lines.push(`## Master Documents`);
    lines.push(`- latest snapshot exists: **${master ? "YES" : "NO"}**`);
    if (master) {
      lines.push(`- version: ${master.version}`);
      lines.push(`- title: ${master.title}`);
      lines.push(`- master words: ${wordCount(master.content)}`);
    }
    lines.push("");

    // Conclusion recommendations
    lines.push(`## Conclusión (qué arreglar según el caso)`);
    if (!outline.length && outlineInDossier) {
      lines.push(`✅ Caso A: outline está en dossier pero NO en projects.outline_12`);
      lines.push(`- Arregla: al terminar BUILD_FULL_DOSSIER, copia outline_12 al state y persiste en projects.outline_12.`);
      lines.push(`- Sin eso: el UI no listará capítulos.`);
    } else if (!outline.length && !outlineInDossier) {
      lines.push(`✅ Caso B: no existe outline en ningún lado`);
      lines.push(`- Arregla prompt + parsing: BUILD_FULL_DOSSIER debe devolver project_state_updated.outline_12 (12 items).`);
      lines.push(`- Si gemini-3.1-flash-lite no lo entrega, crea fallback local de 12 capítulos.`);
    } else if (outline.length && !chapters.length) {
      lines.push(`✅ Caso C: outline_12 existe, pero no hay CHAPTER sections`);
      lines.push(`- Arregla: tu flujo "Autogenerar todo" debe iterar outline_12 y llamar GENERATE_CHAPTER por cada chapter_number.`);
      lines.push(`- Verifica que no se esté marcando 'Blueprint completo' sin capítulos.`);
    } else {
      lines.push(`✅ Caso D: outline y capítulos existen`);
      lines.push(`- Si aún “no salen” en UI: el problema es de render/mapping (BookViewer/Dashboard).`);
    }

    fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
    console.log(`✅ Reporte creado: ${reportPath}`);

    // Print quick summary to console
    console.log("\n=== QUICK SUMMARY ===");
    console.log("project:", proj.id, proj.title);
    console.log("outline_12 count:", outline.length, "| outline in dossier:", Boolean(outlineInDossier));
    console.log("sections chapters count:", chapters.length);
    console.log("=====================\n");
  } catch (e) {
    console.error("❌ Error:", e?.message || e);
    if (e?.status) console.error("HTTP status:", e.status);
    if (e?.body) console.error("Body:", e.body.slice(0, 800));
    process.exit(1);
  }
})();
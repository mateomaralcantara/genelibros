#!/usr/bin/env node
/**
 * Healthcheck / Architecture audit for TS/React/Vite projects.
 * Generates:
 *  - .health/report.md
 *  - .health/summary.json
 *
 * What it checks:
 *  - Biggest files (complexity proxy)
 *  - Excessive "any" usage
 *  - Suspicious patterns: nested <button>, unsafe .map, autoselect loops, VITE secrets
 *  - Gemini client usage on frontend (risk)
 *  - localStorage usage (if you wanted 100% Supabase)
 *  - Optional: tsc --noEmit, eslint, madge circular deps (best-effort)
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".health");
const REPORT_MD = path.join(OUT_DIR, "report.md");
const SUMMARY_JSON = path.join(OUT_DIR, "summary.json");

const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", ".next", ".git", ".scan", ".health", ".vercel"
]);

const EXT_OK = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readTextSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function listFilesRec(dir) {
  const out = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (IGNORE_DIRS.has(it.name)) continue;
      out.push(...listFilesRec(full));
    } else if (it.isFile()) {
      const ext = path.extname(it.name).toLowerCase();
      if (EXT_OK.has(ext)) out.push(full);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32", // make npx/npm work reliably on Windows
    ...opts,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
  };
}

function findLineHits(text, predicate) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (predicate(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function scoreFile(lines, anyCount, asAnyCount) {
  // Simple heuristic score:
  // - big file = heavier
  // - many any/as any = weaker typing
  let score = 0;
  if (lines >= 800) score += 5;
  else if (lines >= 500) score += 4;
  else if (lines >= 350) score += 3;
  else if (lines >= 220) score += 2;
  else if (lines >= 140) score += 1;

  if (anyCount >= 30) score += 4;
  else if (anyCount >= 15) score += 3;
  else if (anyCount >= 8) score += 2;
  else if (anyCount >= 3) score += 1;

  if (asAnyCount >= 20) score += 3;
  else if (asAnyCount >= 10) score += 2;
  else if (asAnyCount >= 4) score += 1;

  return score;
}

function severityLabel(n) {
  if (n >= 7) return "HIGH";
  if (n >= 4) return "MED";
  return "LOW";
}

// ---- Scan ----
ensureDir(OUT_DIR);

const files = listFilesRec(ROOT);

const fileStats = [];
const findings = {
  nestedButtons: [],
  unsafeMap: [],
  autoselectActiveProject: [],
  viteSecrets: [],
  googleGenAiFrontend: [],
  localStorageUsage: [],
  hardcodedGeminiEndpoint: [],
};

for (const f of files) {
  const text = readTextSafe(f);
  if (!text) continue;

  const lines = text.split(/\r?\n/).length;
  const anyCount = (text.match(/\bany\b/g) || []).length;
  const asAnyCount = (text.match(/\bas\s+any\b/g) || []).length;

  fileStats.push({
    file: rel(f),
    lines,
    anyCount,
    asAnyCount,
    score: scoreFile(lines, anyCount, asAnyCount),
  });

  // 1) nested button: <button ... <button
  if (/<button\b[\s\S]*?<button\b/i.test(text)) {
    findings.nestedButtons.push({ file: rel(f) });
  }

  // 2) unsafe map: ".map(" without optional chaining in same line
  // (heuristic: flags lines with ".map(" that don't include "?.map(" and not preceded by Array.isArray on same line)
  const mapHits = findLineHits(text, (ln) => ln.includes(".map(") && !ln.includes("?.map(") && !ln.includes("Array.isArray"));
  if (mapHits.length) {
    findings.unsafeMap.push({ file: rel(f), hits: mapHits.slice(0, 10) });
  }

  // 3) autoselect bug patterns
  const autoHits = findLineHits(text, (ln) =>
    /setActiveProjectId\(/.test(ln) && /!activeProjectId|activeProjectId\s*===\s*null/.test(ln)
  );
  if (autoHits.length) {
    findings.autoselectActiveProject.push({ file: rel(f), hits: autoHits.slice(0, 10) });
  }

  // 4) VITE secrets: VITE_*_KEY in code
  const viteHits = findLineHits(text, (ln) => /import\.meta\.env\.VITE_.*(KEY|TOKEN|SECRET)/i.test(ln));
  if (viteHits.length) {
    findings.viteSecrets.push({ file: rel(f), hits: viteHits.slice(0, 10) });
  }

  // 5) GoogleGenAI usage (should be server-only)
  const genAiHits = findLineHits(text, (ln) => /GoogleGenAI|@google\/genai/.test(ln));
  if (genAiHits.length) {
    // Heuristic: if file is in components/ or App.tsx, it's frontend
    const r = rel(f);
    if (r.startsWith("components/") || r.endsWith("App.tsx") || r.endsWith("App.supabase.tsx") || r.startsWith("src/")) {
      findings.googleGenAiFrontend.push({ file: r, hits: genAiHits.slice(0, 10) });
    }
  }

  // 6) localStorage usage
  const lsHits = findLineHits(text, (ln) => /localStorage\./.test(ln));
  if (lsHits.length) {
    findings.localStorageUsage.push({ file: rel(f), hits: lsHits.slice(0, 10) });
  }

  // 7) direct Gemini endpoint usage (frontend)
  const hardHits = findLineHits(text, (ln) => /generativelanguage\.googleapis\.com|:generateContent/.test(ln));
  if (hardHits.length) {
    findings.hardcodedGeminiEndpoint.push({ file: rel(f), hits: hardHits.slice(0, 10) });
  }
}

// Sort worst offenders
fileStats.sort((a, b) => b.score - a.score || b.lines - a.lines);

// ---- Run best-effort tooling ----
const tooling = {
  tsc: null,
  eslint: null,
  madge: null,
};

const hasTsconfig = fs.existsSync(path.join(ROOT, "tsconfig.json"));
const hasPkg = fs.existsSync(path.join(ROOT, "package.json"));

if (hasTsconfig) {
  // Try npx tsc --noEmit
  const r = runCmd("npx", ["tsc", "--noEmit"]);
  tooling.tsc = { ok: r.ok, status: r.status, out: (r.stdout || r.stderr).slice(0, 8000) };
}

if (hasPkg) {
  // Try eslint if config exists
  const hasEslintConfig =
    fs.existsSync(path.join(ROOT, ".eslintrc")) ||
    fs.existsSync(path.join(ROOT, ".eslintrc.json")) ||
    fs.existsSync(path.join(ROOT, ".eslintrc.js")) ||
    fs.existsSync(path.join(ROOT, "eslint.config.js")) ||
    fs.existsSync(path.join(ROOT, ".eslintrc.cjs"));

  if (hasEslintConfig) {
    const r = runCmd("npx", ["eslint", ".", "--max-warnings=0"]);
    tooling.eslint = { ok: r.ok, status: r.status, out: (r.stdout || r.stderr).slice(0, 8000) };
  }

  // Madge circular deps (best effort)
  const srcDir = fs.existsSync(path.join(ROOT, "src")) ? "src" : ".";
  const r = runCmd("npx", ["madge", srcDir, "--extensions", "ts,tsx,js,jsx", "--circular"]);
  tooling.madge = { ok: r.ok, status: r.status, out: (r.stdout || r.stderr).slice(0, 8000) };
}

// ---- Recommendations ----
function summarizeTopRefactors() {
  const top = fileStats.slice(0, 10);
  const recs = top.map((x) => {
    const sev = severityLabel(x.score);
    const why = [
      x.lines >= 350 ? `archivo grande (${x.lines} líneas)` : null,
      x.anyCount >= 8 ? `mucho "any" (${x.anyCount})` : null,
      x.asAnyCount >= 4 ? `mucho "as any" (${x.asAnyCount})` : null,
    ].filter(Boolean);
    return { file: x.file, severity: sev, score: x.score, why };
  });
  return recs;
}

const recommendations = {
  topRefactorCandidates: summarizeTopRefactors(),
  highRisk: [],
  quickWins: [],
};

if (findings.nestedButtons.length) {
  recommendations.highRisk.push({
    title: "Nested <button> (HTML inválido)",
    fix: "Cambia el contenedor externo a <div role='button' tabIndex={0}> y deja el botón interno como <button> (stopPropagation).",
    files: findings.nestedButtons.map((x) => x.file),
  });
}
if (findings.viteSecrets.length || findings.googleGenAiFrontend.length) {
  recommendations.highRisk.push({
    title: "Riesgo de secret exposure (VITE_* y/o GoogleGenAI en frontend)",
    fix: "Mueve Gemini a backend (/api/composer) y guarda GEMINI_API_KEY como env privada (sin VITE_).",
    files: Array.from(new Set([
      ...findings.viteSecrets.map((x) => x.file),
      ...findings.googleGenAiFrontend.map((x) => x.file),
    ])),
  });
}
if (findings.autoselectActiveProject.length) {
  recommendations.quickWins.push({
    title: "Auto-selección que puede impedir 'Crear nuevo'",
    fix: "Aísla el autoselect a 'solo una vez por sesión' con useRef (didAutoSelectRef), y al crear nuevo setéalo true.",
    files: findings.autoselectActiveProject.map((x) => x.file),
  });
}
if (findings.unsafeMap.length) {
  recommendations.quickWins.push({
    title: ".map potencialmente inseguro",
    fix: "Usa Array.isArray(x) ? x.map(...) : [] o x?.map?.(...) si aplica; evita undefined.map.",
    files: findings.unsafeMap.slice(0, 10).map((x) => x.file),
  });
}
if (findings.localStorageUsage.length) {
  recommendations.quickWins.push({
    title: "localStorage encontrado (si tu objetivo es 100% Supabase)",
    fix: "Eliminar persistencia local y centralizar lectura/escritura en repo.ts (Supabase).",
    files: findings.localStorageUsage.map((x) => x.file),
  });
}

// ---- Write report ----
const now = new Date().toISOString();

function mdSection(title, body) {
  return `\n## ${title}\n\n${body}\n`;
}

let report = `# Software Health Report\n\nGenerated: **${now}**\n\n`;
report += `**Files scanned:** ${files.length}\n\n`;

report += mdSection(
  "Top refactor candidates (prioridad)",
  recommendations.topRefactorCandidates
    .map((r, i) => `**${i + 1}. ${r.file}** — ${r.severity} (score ${r.score})\n- Motivos: ${r.why.join(", ") || "—"}`)
    .join("\n\n")
);

report += mdSection(
  "High risk findings",
  recommendations.highRisk.length
    ? recommendations.highRisk
        .map(
          (x) =>
            `### ${x.title}\n- Fix: ${x.fix}\n- Archivos:\n${x.files.map((f) => `  - ${f}`).join("\n")}`
        )
        .join("\n\n")
    : "Nada crítico detectado."
);

report += mdSection(
  "Quick wins",
  recommendations.quickWins.length
    ? recommendations.quickWins
        .map(
          (x) =>
            `### ${x.title}\n- Fix: ${x.fix}\n- Archivos:\n${x.files.map((f) => `  - ${f}`).join("\n")}`
        )
        .join("\n\n")
    : "No hay quick wins obvios."
);

report += mdSection(
  "Tooling checks (best-effort)",
  [
    tooling.tsc
      ? `### TypeScript (tsc --noEmit)\nStatus: **${tooling.tsc.ok ? "OK" : "FAIL"}**\n\`\`\`\n${tooling.tsc.out}\n\`\`\``
      : "### TypeScript\nNo tsconfig.json detectado o no se ejecutó.",
    tooling.eslint
      ? `### ESLint\nStatus: **${tooling.eslint.ok ? "OK" : "FAIL"}**\n\`\`\`\n${tooling.eslint.out}\n\`\`\``
      : "### ESLint\nNo config detectado o no se ejecutó.",
    tooling.madge
      ? `### Madge circular deps\nStatus: **${tooling.madge.ok ? "OK" : "FAIL"}**\n\`\`\`\n${tooling.madge.out}\n\`\`\``
      : "### Madge\nNo se ejecutó.",
  ].join("\n\n")
);

report += mdSection(
  "Raw findings (muestras)",
  [
    `### Nested buttons\n${findings.nestedButtons.length ? findings.nestedButtons.map((x) => `- ${x.file}`).join("\n") : "—"}`,
    `### Unsafe .map (muestra)\n${
      findings.unsafeMap.length
        ? findings.unsafeMap
            .slice(0, 5)
            .map((x) => `- ${x.file}\n${x.hits.map((h) => `  - L${h.line}: ${h.text}`).join("\n")}`)
            .join("\n")
        : "—"
    }`,
    `### Autoselect patterns\n${
      findings.autoselectActiveProject.length
        ? findings.autoselectActiveProject
            .slice(0, 5)
            .map((x) => `- ${x.file}\n${x.hits.map((h) => `  - L${h.line}: ${h.text}`).join("\n")}`)
            .join("\n")
        : "—"
    }`,
    `### VITE secrets usage\n${findings.viteSecrets.length ? findings.viteSecrets.map((x) => `- ${x.file}`).join("\n") : "—"}`,
    `### GoogleGenAI usage in frontend\n${findings.googleGenAiFrontend.length ? findings.googleGenAiFrontend.map((x) => `- ${x.file}`).join("\n") : "—"}`,
    `### localStorage usage\n${findings.localStorageUsage.length ? findings.localStorageUsage.map((x) => `- ${x.file}`).join("\n") : "—"}`,
  ].join("\n\n")
);

fs.writeFileSync(REPORT_MD, report, "utf8");

const summary = {
  generatedAt: now,
  filesScanned: files.length,
  fileStatsTop10: fileStats.slice(0, 10),
  findings,
  tooling,
  recommendations,
};
fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2), "utf8");

console.log(`✅ Healthcheck completo.`);
console.log(`- Report: ${path.relative(ROOT, REPORT_MD)}`);
console.log(`- Summary: ${path.relative(ROOT, SUMMARY_JSON)}`);
#!/usr/bin/env node
/* scripts/where-css.js
   Reporta: CSS/SCSS encontrados, quién los importa, Tailwind configs, @tailwind,
   y los archivos TSX/JSX que más “manejan” UI via className / inline style.
*/
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  ".git",
  "coverage",
  ".turbo",
  ".vite",
]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const STYLE_EXT = new Set([".css", ".scss", ".sass", ".less"]);
const ALL_EXT = new Set([...CODE_EXT, ...STYLE_EXT]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (ALL_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

function extractImports(code) {
  const out = [];

  // import 'x';
  // import foo from 'x';
  // import {a} from "x";
  const importRe = /^\s*import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/gm;

  // require("x")
  const requireRe = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

  // dynamic import("x")
  const dynImportRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  let m;
  while ((m = importRe.exec(code))) out.push(m[1]);
  while ((m = requireRe.exec(code))) out.push(m[1]);
  while ((m = dynImportRe.exec(code))) out.push(m[1]);

  return out;
}

function isStyleImport(spec) {
  return (
    spec.endsWith(".css") ||
    spec.endsWith(".scss") ||
    spec.endsWith(".sass") ||
    spec.endsWith(".less")
  );
}

function existsConfig(names) {
  for (const n of names) {
    const p = path.join(ROOT, n);
    if (fs.existsSync(p)) return n;
  }
  return null;
}

function header(title) {
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
}

const files = walk(ROOT);

// Indexes
const styleFiles = [];
const codeFiles = [];
for (const f of files) {
  const ext = path.extname(f);
  if (STYLE_EXT.has(ext)) styleFiles.push(f);
  if (CODE_EXT.has(ext)) codeFiles.push(f);
}

// Build reverse import map: styleSpec -> importers[]
const styleImporters = new Map();
const localStyleImporters = new Map(); // resolved relative path when possible

// Stats
const uiDrivers = []; // {file, classNameCount, inlineStyleCount, hasStyled, hasEmotion, hasCssInJs}
const tailwindDirectives = []; // css files containing @tailwind

for (const f of codeFiles) {
  const code = readText(f);
  const imports = extractImports(code);

  for (const spec of imports) {
    if (!isStyleImport(spec)) continue;
    if (!styleImporters.has(spec)) styleImporters.set(spec, []);
    styleImporters.get(spec).push(rel(f));

    // best-effort resolve ONLY for relative paths
    if (spec.startsWith(".")) {
      const resolved = path.resolve(path.dirname(f), spec);
      const resolvedRel = rel(resolved);
      if (!localStyleImporters.has(resolvedRel)) localStyleImporters.set(resolvedRel, []);
      localStyleImporters.get(resolvedRel).push(rel(f));
    }
  }

  const classNameCount = (code.match(/\bclassName\s*=\s*/g) || []).length;
  const inlineStyleCount = (code.match(/\bstyle\s*=\s*\{\{/g) || []).length;

  const hasStyled = /\bstyled\./.test(code) || /from\s+["']styled-components["']/.test(code);
  const hasEmotion = /@emotion\/react|@emotion\/styled/.test(code);
  const hasCssInJs = /\bcss`/.test(code) || /\bcreateGlobalStyle\b/.test(code);

  if (classNameCount || inlineStyleCount || hasStyled || hasEmotion || hasCssInJs) {
    uiDrivers.push({
      file: rel(f),
      classNameCount,
      inlineStyleCount,
      hasStyled,
      hasEmotion,
      hasCssInJs,
    });
  }
}

for (const f of styleFiles) {
  const css = readText(f);
  if (/@tailwind\s+(base|components|utilities)\s*;/.test(css)) {
    tailwindDirectives.push(rel(f));
  }
}

// Tailwind / PostCSS configs
const tailwindCfg = existsConfig([
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
]);
const postcssCfg = existsConfig([
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
]);

// Report
header("1) Configuración de estilos (Tailwind / PostCSS / CSS-in-JS)");
console.log(`tailwind.config.*: ${tailwindCfg ? "SI -> " + tailwindCfg : "NO"}`);
console.log(`postcss.config.*:  ${postcssCfg ? "SI -> " + postcssCfg : "NO"}`);
console.log(`CSS con @tailwind: ${tailwindDirectives.length ? "SI" : "NO"}`);
for (const f of tailwindDirectives) console.log("  - " + f);

header("2) Archivos de estilos encontrados (.css/.scss/.sass/.less)");
if (!styleFiles.length) {
  console.log("No se encontraron archivos de estilos en el árbol del proyecto.");
} else {
  for (const f of styleFiles.map(rel).sort()) console.log("  - " + f);
}

header("3) Quién importa estilos (import './x.css')");
if (!styleImporters.size && !localStyleImporters.size) {
  console.log("No se detectaron imports directos a .css/.scss/.sass/.less desde TS/JS.");
} else {
  // raw spec map
  if (styleImporters.size) {
    console.log("Imports por spec (tal como aparece en el código):");
    for (const [spec, imps] of [...styleImporters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`\n- ${spec}`);
      for (const x of [...new Set(imps)].sort()) console.log("   -> " + x);
    }
  }

  // resolved relative files map
  if (localStyleImporters.size) {
    console.log("\nImports resueltos (solo rutas relativas):");
    for (const [spec, imps] of [...localStyleImporters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`\n- ${spec}`);
      for (const x of [...new Set(imps)].sort()) console.log("   -> " + x);
    }
  }
}

header("4) Dónde realmente se “modela” el look (ranking por uso de className / style={{}})");
uiDrivers.sort((a, b) => (b.classNameCount - a.classNameCount) || (b.inlineStyleCount - a.inlineStyleCount));

const top = uiDrivers.slice(0, 20);
if (!top.length) {
  console.log("No se detectó uso de className/style={{}} en TS/JS (raro para apps React).");
} else {
  console.log("Top 20 archivos que más definen UI:");
  for (const x of top) {
    const flags = [
      x.hasStyled ? "styled-components" : null,
      x.hasEmotion ? "emotion" : null,
      x.hasCssInJs ? "css-in-js" : null,
    ].filter(Boolean);

    console.log(
      `- ${x.file}\n  className=${x.classNameCount}  inlineStyle=${x.inlineStyleCount}` +
        (flags.length ? `  (${flags.join(", ")})` : "")
    );
  }
}

header("5) Conclusión automática (sin opinión, solo evidencia)");
const tailwindLikely =
  !!tailwindCfg || tailwindDirectives.length > 0 || uiDrivers.some((x) => x.classNameCount >= 20);

if (tailwindLikely) {
  console.log(
    "Tu styling es principalmente vía clases en JSX (Tailwind/utility-first) + (posible) CSS global con @tailwind.\n" +
      "Lo normal es que el look se ajuste en: (a) strings de className en componentes, (b) un archivo global (index.css) si existe."
  );
} else if (styleFiles.length) {
  console.log(
    "Tu styling parece depender principalmente de archivos .css/.scss importados y/o estilos globales.\n" +
      "Busca el/los entrypoints que importan CSS (main.tsx/index.tsx)."
  );
} else {
  console.log(
    "No se detectó Tailwind ni imports de CSS. Revisa si el styling se inyecta por librería o config externa."
  );
}

process.exit(0);

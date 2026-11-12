#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function exists(p) {
  return fs.existsSync(path.join(ROOT, p));
}
function read(p) {
  try {
    return fs.readFileSync(path.join(ROOT, p), "utf8");
  } catch {
    return "";
  }
}
function pickFirst(paths) {
  for (const p of paths) if (exists(p)) return p;
  return null;
}
function scanFile(p, patterns) {
  const txt = read(p);
  const hits = [];
  for (const pat of patterns) {
    if (pat.re.test(txt)) hits.push(pat.name);
  }
  return hits;
}

console.log("\n=== CSS ENGINE DETECTOR ===\n");

// 1) package.json
const pkgPath = pickFirst(["package.json"]);
if (!pkgPath) {
  console.log("No encontré package.json en la raíz. Estás corriendo el script en el folder correcto?");
  process.exit(1);
}
const pkg = JSON.parse(read(pkgPath));
console.log(`package.json type: ${pkg.type || "(no definido -> CJS default)"}`);

const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const watch = [
  "tailwindcss",
  "postcss",
  "autoprefixer",
  "twind",
  "@twind/core",
  "unocss",
  "vite-plugin-windicss",
  "windicss",
  "styled-components",
  "@emotion/react",
  "@emotion/styled",
  "sass",
  "less",
];
console.log("\nDependencias relevantes encontradas:");
let any = false;
for (const k of watch) {
  if (deps[k]) {
    any = true;
    console.log(`- ${k}@${deps[k]}`);
  }
}
if (!any) console.log("- (ninguna de las típicas)");

// 2) Config files típicos
const configs = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
  "uno.config.ts",
  "uno.config.js",
  "windi.config.ts",
  "windi.config.js",
  "twind.config.ts",
  "twind.config.js",
];
console.log("\nConfigs encontrados:");
let cfgAny = false;
for (const c of configs) {
  if (exists(c)) {
    cfgAny = true;
    console.log(`- ${c}`);
  }
}
if (!cfgAny) console.log("- (ninguno)");

// 3) Dónde entra el CSS global (index.css)
const entryCandidates = ["index.tsx", "src/index.tsx", "main.tsx", "src/main.tsx"];
const entry = pickFirst(entryCandidates);
console.log(`\nEntry React detectado: ${entry || "(no encontrado en rutas típicas)"}`);

const htmlCandidates = ["index.html", "public/index.html"];
const html = pickFirst(htmlCandidates);
console.log(`HTML detectado: ${html || "(no encontrado en rutas típicas)"}`);

// 4) Heurísticas: CDN Tailwind / Uno / Twind / Windi / PostCSS plugin markers
const patterns = [
  { name: "CDN Tailwind (cdn.tailwindcss.com)", re: /cdn\.tailwindcss\.com/i },
  { name: "UnoCSS (virtual:uno.css)", re: /virtual:uno\.css/i },
  { name: "WindiCSS (windi.css / vite-plugin-windicss)", re: /windi(\.css|css)/i },
  { name: "Twind (setup / twind)", re: /\btwind\b|@twind\/core|setup\(/i },
  { name: "Tailwind directives (@tailwind)", re: /@tailwind\s+(base|components|utilities)\s*;/i },
];

if (html) {
  const hits = scanFile(html, patterns);
  console.log(`\nSeñales en ${html}: ${hits.length ? hits.join(", ") : "(ninguna)"}`);
}

if (entry) {
  const hits = scanFile(entry, patterns);
  console.log(`Señales en ${entry}: ${hits.length ? hits.join(", ") : "(ninguna)"}`);
}

// 5) index.css análisis rápido
if (exists("index.css") || exists("src/index.css")) {
  const cssPath = exists("index.css") ? "index.css" : "src/index.css";
  const css = read(cssPath);
  const hasTailwind = /@tailwind\s+(base|components|utilities)\s*;/.test(css);
  const hasLotsOfUtilities = /(\.bg-|\.(p|m|text|rounded|border)-)/.test(css) && css.length > 200000;

  console.log(`\nAnálisis ${cssPath}:`);
  console.log(`- Tiene @tailwind directives: ${hasTailwind ? "SI" : "NO"}`);
  console.log(`- Parece CSS precompilado con utilidades (heurística): ${hasLotsOfUtilities ? "PROBABLE" : "NO/INCIERTO"}`);
}

// 6) Conclusión
console.log("\nConclusión:");
if (deps.tailwindcss && (exists("tailwind.config.js") || exists("tailwind.config.cjs") || exists("tailwind.config.ts") || exists("tailwind.config.mjs"))) {
  console.log("- Estás usando Tailwind clásico (config presente). Tu look se define por className + config + index.css.");
} else if (deps.twind || deps["@twind/core"]) {
  console.log("- Estás usando Twind (runtime). Tu look vive casi 100% en className + setup Twind.");
} else if (deps.unocss) {
  console.log("- Estás usando UnoCSS. Tu look vive en className + uno.config (si existe) o defaults.");
} else if (deps["vite-plugin-windicss"] || deps.windicss) {
  console.log("- Estás usando WindiCSS. Tu look vive en className + config Windi.");
} else {
  console.log("- No hay evidencia concluyente de motor utility en deps/config. Revisa si estás usando CSS precompilado o alguna plantilla.");
}

process.exit(0);

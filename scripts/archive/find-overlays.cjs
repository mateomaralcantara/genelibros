#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const IGNORE = new Set(["node_modules", "dist", ".git", "build", ".next", "out", "coverage", ".vite"]);

const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);

const patterns = [
  { name: "absolute/fixed overlay", re: /\b(className\s*=\s*["'`][^"'`]*\b(absolute|fixed)\b[^"'`]*\b(inset-0|top-0|left-0|right-0|bottom-0)\b[^"'`]*["'`])/i },
  { name: "high z-index", re: /\b(className\s*=\s*["'`][^"'`]*\bz-(40|50|\\[\\d+\\])\b[^"'`]*["'`])/i },
  { name: "backdrop blur layer", re: /\b(className\s*=\s*["'`][^"'`]*\bbackdrop-blur\b[^"'`]*["'`])/i },
  { name: "opaque bg layer", re: /\b(className\s*=\s*["'`][^"'`]*\bbg-(slate|black|zinc|neutral|gray)-9(00|50)\b[^"'`]*["'`])/i },
  { name: "overflow hidden/clip", re: /\b(className\s*=\s*["'`][^"'`]*\boverflow-(hidden|clip)\b[^"'`]*["'`])/i },
  { name: "height clamp (h-screen/min-h/max-h)", re: /\b(className\s*=\s*["'`][^"'`]*\b(h-screen|min-h-|max-h-)\b[^"'`]*["'`])/i },
  { name: "inline style position/zIndex", re: /\bstyle\s*=\s*\{\{[^}]*\b(position|zIndex|inset|top|left|right|bottom|overflow|height|maxHeight)\b[^}]*\}\}/i },
];

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (exts.has(ext)) out.push(full);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

function scanFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      if (p.re.test(line)) {
        hits.push({ file: rel(file), line: i + 1, rule: p.name, snippet: line.trim().slice(0, 220) });
      }
    }
  }
  return hits;
}

const files = walk(ROOT);
let all = [];
for (const f of files) {
  all = all.concat(scanFile(f));
}

all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

console.log("\n=== Overlay / Clipping Suspects ===\n");
if (!all.length) {
  console.log("No encontré patrones típicos. Puede ser algo más sutil (pseudo-elemento, stacking context por transform, etc.).");
  process.exit(0);
}

let current = null;
for (const h of all) {
  if (h.file !== current) {
    current = h.file;
    console.log("\n" + current);
  }
  console.log(`  L${h.line}  [${h.rule}]  ${h.snippet}`);
}

console.log("\nTip: si el documento se ve 'recortado', enfócate en overflow/height/maxHeight en el contenedor padre del viewer.");

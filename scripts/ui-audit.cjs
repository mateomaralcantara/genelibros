#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const IGNORE = new Set(["node_modules", "dist", "build", ".git", ".next", "out", "coverage"]);

function walk(dir, out = []) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items) {
    if (IGNORE.has(it.name)) continue;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function read(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function lineOf(text, idx) {
  // 1-based
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function snippetAt(text, idx, size = 140) {
  const start = Math.max(0, idx - Math.floor(size / 2));
  const end = Math.min(text.length, start + size);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function auditNestedButtons(file, src) {
  const re = /<\/?button\b[^>]*\/?>/gi;
  const stack = [];
  const findings = [];

  let m;
  while ((m = re.exec(src))) {
    const tag = m[0];
    const pos = m.index;
    const isClose = /^<\/button/i.test(tag);
    const isSelfClose = /\/>\s*$/.test(tag) && !isClose;

    if (isClose) {
      if (stack.length) stack.pop();
      continue;
    }
    if (isSelfClose) continue;

    // open <button ...>
    if (stack.length > 0) {
      const outer = stack[stack.length - 1];
      findings.push({
        file,
        outerLine: outer.line,
        innerLine: lineOf(src, pos),
        outerSnippet: outer.snip,
        innerSnippet: snippetAt(src, pos),
      });
    }
    stack.push({ line: lineOf(src, pos), snip: snippetAt(src, pos) });
  }

  return findings;
}

function extractStringLiterals(src) {
  // captura "..." '...' `...` (heurístico, suficiente para Tailwind class strings)
  const res = [];
  const patterns = [
    /"([^"\\]*(?:\\.[^"\\]*)*)"/g,
    /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
    /`([^`\\]*(?:\\.[^`\\]*)*)`/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) {
      res.push({ value: m[1], index: m.index });
    }
  }
  return res;
}

function auditFlexClippingRisks(file, src) {
  const lits = extractStringLiterals(src);
  const risks = [];

  for (const lit of lits) {
    const s = lit.value;
    if (!s.includes("overflow-hidden")) continue;

    // Riesgo fuerte si hay flex layout + height clamp + no min-h-0
    const hasFlex = /\bflex\b/.test(s);
    const hasHeightClamp = /\bh-screen\b|\bh-full\b|\bmin-h-\[|\bmax-h-|\bh-\[/.test(s);
    const missingMinH0 = !/\bmin-h-0\b/.test(s);

    if (hasFlex && hasHeightClamp && missingMinH0) {
      risks.push({
        file,
        line: lineOf(src, lit.index),
        classes: s.length > 180 ? s.slice(0, 180) + "…" : s,
      });
    }
  }

  return risks;
}

function auditTailwindEntry() {
  const idxCss = path.join(ROOT, "index.css");
  const s = read(idxCss);
  if (!s) return null;
  const hasImport = s.includes('@import "tailwindcss"') || s.includes("@import 'tailwindcss'");
  const hasDirectives = s.includes("@tailwind base") || s.includes("@tailwind utilities") || s.includes("@tailwind components");
  return { file: "index.css", hasImport, hasDirectives };
}

function main() {
  const all = walk(ROOT).filter((p) => /\.(tsx|jsx|ts|js|css)$/.test(p));
  const sources = all
    .map((p) => ({ p, s: read(p) }))
    .filter((x) => x.s != null);

  console.log("\n=== UI AUDIT (MasterDoc / CSS / DOM) ===\n");
  console.log("Root:", ROOT);

  const tw = auditTailwindEntry();
  if (tw) {
    console.log("\n1) Tailwind entry (index.css):");
    console.log(`- ${tw.file}: @import tailwindcss = ${tw.hasImport ? "YES" : "NO"} | @tailwind directives = ${tw.hasDirectives ? "YES" : "NO/Maybe v4 import"}`);
  } else {
    console.log("\n1) Tailwind entry (index.css): NO encontrado en root.");
  }

  // Nested buttons
  const nested = [];
  for (const f of sources.filter((x) => /\.(tsx|jsx)$/.test(x.p))) {
    nested.push(...auditNestedButtons(f.p, f.s));
  }

  console.log("\n2) HTML invalid: <button> dentro de <button> (esto hay que matarlo):");
  if (!nested.length) {
    console.log("- OK: no detecté nested buttons en TSX/JSX.");
  } else {
    for (const n of nested.slice(0, 30)) {
      console.log(`\n- ${n.file}`);
      console.log(`  outer line ${n.outerLine}: ${n.outerSnippet}`);
      console.log(`  inner line ${n.innerLine}: ${n.innerSnippet}`);
    }
    if (nested.length > 30) console.log(`\n  ... ${nested.length - 30} más (recorta output).`);
  }

  // Flex clipping risks
  const risks = [];
  for (const f of sources.filter((x) => /\.(tsx|jsx|ts|js)$/.test(x.p))) {
    risks.push(...auditFlexClippingRisks(f.p, f.s));
  }

  console.log("\n3) Riesgos de clipping (flex + overflow-hidden + h-screen/h-full y sin min-h-0):");
  if (!risks.length) {
    console.log("- OK: no vi patrones fuertes de clipping.");
  } else {
    for (const r of risks.slice(0, 50)) {
      console.log(`- ${r.file}:${r.line}`);
      console.log(`  "${r.classes}"`);
    }
    if (risks.length > 50) console.log(`\n  ... ${risks.length - 50} más (recorta output).`);
  }

  console.log("\n=== FIN ===");
  console.log("Si el Documento Maestro se ve recortado: donde veas esos risks, agrega 'min-h-0' en el flex-child correcto.");
  console.log("Si salió nested buttons: cambia el wrapper externo de <button> a <div role='button'> o saca el botón interno.");
}

main();

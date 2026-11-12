#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);

const toLines = (s) => s.split(/\r?\n/);
const lineOfIndex = (text, idx) => text.slice(0, idx).split(/\r?\n/).length;

const findFile = (rel) => {
  const p = path.join(ROOT, rel);
  return exists(p) ? p : null;
};

const targets = [
  findFile("App.tsx"),
  findFile("components/BookViewer.tsx"),
  findFile("components/GenerationDashboard.tsx"),
].filter(Boolean);

if (!targets.length) {
  console.error("No encontré App.tsx / components/*.tsx desde:", ROOT);
  process.exit(1);
}

function detectNestedButtons(content) {
  // Heurística simple: tokeniza <button ...> y </button> con stack.
  const re = /<button\b[^>]*>|<\/button\s*>/gi;
  const stack = [];
  const hits = [];

  let m;
  while ((m = re.exec(content))) {
    const tok = m[0];
    const idx = m.index;

    const isOpen = tok.startsWith("<button") && !tok.startsWith("</");
    const isClose = tok.startsWith("</button");

    if (isOpen) {
      if (stack.length > 0) {
        hits.push({
          outerOpenIdx: stack[stack.length - 1],
          innerOpenIdx: idx,
        });
      }
      stack.push(idx);
    } else if (isClose) {
      stack.pop();
    }
  }

  return hits.map((h) => ({
    outerLine: lineOfIndex(content, h.outerOpenIdx),
    innerLine: lineOfIndex(content, h.innerOpenIdx),
  }));
}

function classRiskLines(content) {
  const lines = toLines(content);
  const risks = [];

  const hasMinH0 = (s) => /\bmin-h-0\b/.test(s);
  const hasFlex = (s) => /\bflex\b/.test(s);
  const hasOverflowHidden = (s) => /\boverflow-hidden\b/.test(s);
  const hasHClamp = (s) => /\bh-screen\b|\bh-full\b|\bmin-h-\[|\bmax-h-\[/.test(s);
  const hasScrollY = (s) => /\boverflow-y-auto\b|\boverflow-auto\b|\boverflow-y-scroll\b/.test(s);

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!/className=|className:\s*|`/.test(L) && !/className/.test(L)) continue;

    const isFlexHiddenClamp = hasFlex(L) && hasOverflowHidden(L) && hasHClamp(L) && !hasMinH0(L);
    const isFlexHidden = hasFlex(L) && hasOverflowHidden(L) && !hasMinH0(L);
    const isScrollYNoMin = hasScrollY(L) && !hasMinH0(lines.slice(Math.max(0, i - 3), i + 4).join("\n"));

    if (isFlexHiddenClamp) risks.push({ line: i + 1, kind: "flex + overflow-hidden + height clamp (añade min-h-0)", text: L.trim() });
    else if (isFlexHidden) risks.push({ line: i + 1, kind: "flex + overflow-hidden (posible recorte; considera min-h-0)", text: L.trim() });

    if (isScrollYNoMin) risks.push({ line: i + 1, kind: "scroll-y detectado pero no veo min-h-0 cerca (revisa contenedor flex padre)", text: L.trim() });
  }

  return risks;
}

console.log("\n=== MASTERDOC STATIC CHECK ===\nRoot:", ROOT);

for (const file of targets) {
  const content = read(file);
  console.log("\n---", path.relative(ROOT, file), "---");

  const nested = detectNestedButtons(content);
  if (nested.length) {
    console.log("\n[HTML inválido] <button> dentro de <button> (esto rompe UI y puede causar bugs):");
    nested.slice(0, 10).forEach((n, idx) => {
      console.log(`  #${idx + 1} outer line ${n.outerLine}  -> inner line ${n.innerLine}`);
    });
  } else {
    console.log("[OK] No detecté nested <button> aquí.");
  }

  const risks = classRiskLines(content);
  if (risks.length) {
    console.log("\n[Clipping / Scroll risks] (candidatos a recortar el Documento Maestro):");
    risks.slice(0, 20).forEach((r) => {
      console.log(`  L${String(r.line).padStart(4, " ")}  [${r.kind}]  ${r.text}`);
    });
  } else {
    console.log("[OK] No vi riesgos obvios de flex/overflow en className.");
  }
}

console.log("\n=== FIN ===");
console.log("Si el Documento Maestro se ve recortado: donde salga 'flex + overflow-hidden' en un flex-child, agrega 'min-h-0'.");
console.log("Si sale nested <button>: cambia el wrapper externo a <div role='button'> o elimina el botón interno.");

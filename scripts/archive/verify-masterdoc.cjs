// scripts/verify-masterdoc.cjs
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vite"]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else {
      if (/\.(tsx|ts)$/.test(ent.name)) out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

const patterns = [
  { tag: "overflow hidden/clip", re: /\boverflow-(hidden|x-hidden|y-hidden)\b|\boverflow-hidden\b/ },
  { tag: "scroll container", re: /\boverflow-y-(auto|scroll)\b/ },
  { tag: "height clamp", re: /\b(h-screen|min-h-\[|max-h-\[|h-full|min-h-full|max-h-full)\b/ },
  { tag: "flex column", re: /\bflex\b.*\bflex-col\b|\bflex-col\b/ },
  { tag: "missing min-h-0 hint", re: /\bmin-h-0\b/ },
  { tag: "possible overlay", re: /\b(absolute|fixed|inset-0|z-\d+|backdrop-blur)\b/ },
];

function scanFile(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const txt = fs.readFileSync(file, "utf8");
  const lines = txt.split(/\r?\n/);

  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      if (p.re.test(line)) hits.push({ line: i + 1, tag: p.tag, text: line.trim() });
    }
  }
  return { rel, hits, hasMinH0: /\bmin-h-0\b/.test(txt) };
}

const files = walk(ROOT);

// prioriza lo relevante (App + Viewer)
const focus = files.filter(f =>
  /App\.tsx$/.test(f) ||
  /BookViewer\.tsx$/.test(f) ||
  /BookProposalDisplay\.tsx$/.test(f) ||
  /GenerationDashboard/.test(f)
);

console.log("\n=== MASTER DOC STATIC VERIFIER ===\n");
if (!focus.length) {
  console.log("No encontré App.tsx/BookViewer.tsx por nombre. Revisé:", ROOT);
  process.exit(0);
}

for (const f of focus) {
  const r = scanFile(f);
  if (!r.hits.length) continue;

  console.log(`\n${r.rel}`);
  if (!r.hasMinH0) console.log("  (!) Nota: este archivo no contiene 'min-h-0' (si hay flex + scroll, puede doler).");

  // muestra solo lo más relevante
  r.hits
    .filter(h => ["overflow hidden/clip", "scroll container", "height clamp", "flex column", "possible overlay"].includes(h.tag))
    .slice(0, 40)
    .forEach(h => {
      console.log(`  L${String(h.line).padStart(4, " ")}  [${h.tag}]  ${h.text}`);
    });
}

console.log("\nTip: si ves 'flex-col' + 'overflow-y-auto' y algún padre con 'overflow-hidden' y sin 'min-h-0', ahí está el recorte.\n");

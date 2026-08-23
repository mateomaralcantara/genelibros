// scripts/fix-bookviewer-title-priority.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const file = "components/BookViewer.tsx";
const abs = path.join(ROOT, file);

if (!fs.existsSync(abs)) {
  console.error(`No existe ${file}`);
  process.exit(1);
}

const backup = `${abs}.bak_title_priority`;
fs.copyFileSync(abs, backup);

let c = fs.readFileSync(abs, "utf8");

c = c.replaceAll(
  "const title = s(st.book_title, s(project?.title, 'Documento maestro')).trim();",
  "const title = s(project?.title, s(st.book_title, 'Documento maestro')).trim();"
);

c = c.replaceAll(
  "() => s((project as any)?.state?.book_title, s((project as any)?.title, 'Documento')),",
  "() => s((project as any)?.title, s((project as any)?.state?.book_title, 'Documento')),",
);

fs.writeFileSync(abs, c, "utf8");

console.log("✅ BookViewer corregido.");
console.log(`Backup creado: ${backup}`);
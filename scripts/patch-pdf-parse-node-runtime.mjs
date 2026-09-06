import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");

function walk(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(?:ts|js|mts|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

const targets = walk(root).filter((file) => {
  const source = fs.readFileSync(file, "utf8");

  return (
    /\bPDFParse\b/.test(source) &&
    /from\s+["']pdf-parse["']/.test(source)
  );
});

if (!targets.length) {
  throw new Error(
    "PDF_PARSE_NODE_FIX: no se encontró consumidor de PDFParse."
  );
}

let changed = 0;

for (const file of targets) {
  let source = fs.readFileSync(file, "utf8");
  const original = source;

  const pdfImport =
    /import\s+\{[^}]*\bPDFParse\b[^}]*\}\s+from\s+["']pdf-parse["'];?/;

  const match = source.match(pdfImport);

  if (!match) {
    throw new Error(
      `PDF_PARSE_NODE_FIX: import PDFParse no reconocido en ${file}`
    );
  }

  if (!/from\s+["']pdf-parse\/worker["']/.test(source)) {
    source = source.replace(
      match[0],
      `import { CanvasFactory } from "pdf-parse/worker";\n${match[0]}`
    );
  }

  source = source.replace(
    /new\s+PDFParse\s*\(\s*\{/g,
    (found, offset, whole) => {
      const after = whole.slice(offset, offset + 500);

      if (
        /^new\s+PDFParse\s*\(\s*\{[\s\S]{0,250}?\bCanvasFactory\b/.test(
          after
        )
      ) {
        return found;
      }

      return `${found}\n    CanvasFactory,`;
    }
  );

  if (source !== original) {
    fs.writeFileSync(file, source, "utf8");
    changed += 1;

    console.log(
      `[Genelibros] PDFParse Node/Vercel fix: ${path.relative(process.cwd(), file)}`
    );
  } else {
    console.log(
      `[Genelibros] PDFParse ya preparado: ${path.relative(process.cwd(), file)}`
    );
  }
}

console.log({
  targets: targets.length,
  changed,
  fix: "DOMMatrix + CanvasFactory",
});

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

console.log("[Genelibros] PDFParse Node/Vercel regression test");

const importTest = `
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

if (!CanvasFactory) throw new Error("CanvasFactory missing");
if (!PDFParse) throw new Error("PDFParse missing");

console.log("PDF_PARSE_NODE_IMPORT_OK");
`;

const result = spawnSync(
  process.execPath,
  ["--input-type=module", "-e", importTest],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: false,
  }
);

if (result.error) throw result.error;

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

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

const consumers = walk(path.resolve("src")).filter((file) => {
  const source = fs.readFileSync(file, "utf8");

  return (
    /\bPDFParse\b/.test(source) &&
    /from\s+["']pdf-parse["']/.test(source)
  );
});

if (!consumers.length) {
  throw new Error("No PDFParse consumers found.");
}

for (const file of consumers) {
  const source = fs.readFileSync(file, "utf8");

  const workerPosition =
    source.indexOf('from "pdf-parse/worker"');

  const pdfPosition =
    source.indexOf('from "pdf-parse"');

  if (workerPosition < 0 || pdfPosition < 0) {
    throw new Error(
      `PDF worker import missing: ${file}`
    );
  }

  if (workerPosition > pdfPosition) {
    throw new Error(
      `pdf-parse/worker debe importarse antes que pdf-parse: ${file}`
    );
  }

  if (
    /new\s+PDFParse\s*\(\s*\{/.test(source) &&
    !/new\s+PDFParse\s*\(\s*\{[\s\S]{0,300}?\bCanvasFactory\b/.test(
      source
    )
  ) {
    throw new Error(
      `CanvasFactory no conectado al constructor: ${file}`
    );
  }
}

console.log("PDF_PARSE_NODE_IMPORT_OK");
console.log("DOMMATRIX_REGRESSION_PASS");

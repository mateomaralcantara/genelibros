// ============================================================
// GENELIBROS — Prueba de carga de funciones serverless (0 LLM)
//
// Transpila api/ y src/ a JavaScript ESM archivo por archivo (sin tocar
// los imports, igual que Vercel) y luego importa con Node cada función
// de api/ y cada handler de src/server/vercel-handlers/.
//
// Detecta fallos que el typecheck no ve, como un import relativo sin
// extensión .js (ERR_MODULE_NOT_FOUND → FUNCTION_INVOCATION_FAILED en
// producción). No ejecuta ningún handler ni llama a proveedores.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_DIRS = ["api", "src"];
const ROOT_TS_FILES = fs
  .readdirSync(ROOT)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"));
const COPY_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json"]);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "genelibros-api-load-"));

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function emit(relPath) {
  const src = path.join(ROOT, relPath);
  const ext = path.extname(relPath);
  if ((ext === ".ts" || ext === ".tsx") && !relPath.endsWith(".d.ts")) {
    const code = fs.readFileSync(src, "utf8");
    const result = ts.transpileModule(code, {
      fileName: relPath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        esModuleInterop: true,
      },
    });
    const target = path.join(outDir, relPath.replace(/\.(ts|tsx)$/, ".js"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, result.outputText);
  } else if (COPY_EXTENSIONS.has(ext)) {
    const target = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
  }
}

for (const dir of SOURCE_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) emit(path.relative(ROOT, file));
}
for (const file of ROOT_TS_FILES) emit(file);

fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(outDir, "node_modules"), "junction");

const entries = [
  ...walk(path.join(outDir, "api")),
  ...walk(path.join(outDir, "src", "server", "vercel-handlers")),
]
  .filter((file) => file.endsWith(".js"))
  .sort();

console.log("\n================================================");
console.log(" GENELIBROS — API RUNTIME LOAD TEST (0 LLM)");
console.log("================================================");

let failures = 0;
for (const file of entries) {
  const label = path.relative(outDir, file);
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.default !== "function") {
      throw new Error("no exporta un handler por defecto (export default function)");
    }
    console.log(`PASS  ${label}`);
  } catch (error) {
    failures += 1;
    const code = error?.code ? `${error.code}: ` : "";
    console.error(`FAIL  ${label}\n      ${code}${String(error?.message || error).split("\n")[0]}`);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n❌ ${failures} función(es) no cargan. En Vercel fallarían con FUNCTION_INVOCATION_FAILED.`);
  console.error("   Pista: los imports relativos deben terminar en .js (el proyecto es \"type\": \"module\").");
  process.exit(1);
}

console.log(`\n✅ ${entries.length} funciones cargan correctamente.`);
process.exit(0);

import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
const before = runtime;

// Google ya no sirve gemini-2.5-flash a cuentas nuevas. Este parche corre
// DESPUÉS de Credit Guard, de modo que también corrige los fallbacks que el
// guard haya instalado dinámicamente en el runtime local.
runtime = runtime
  .replace(/models\/gemini-2\.5-flash/gi, "gemini-3.6-flash")
  .replace(/gemini-2\.5-flash/gi, "gemini-3.6-flash");

if (/gemini-2\.5-flash/i.test(runtime)) {
  console.error("[Genelibros] DEEP MODEL COMPAT: quedó una referencia legacy a gemini-2.5-flash. 0 llamadas LLM.");
  process.exit(2);
}

if (runtime !== before) {
  fs.writeFileSync(runtimeFile, runtime, "utf8");
  console.log("[Genelibros] DEEP MODEL COMPAT: gemini-2.5-flash migrado a gemini-3.6-flash.");
} else {
  console.log("[Genelibros] DEEP MODEL COMPAT: runtime ya usa modelos compatibles.");
}

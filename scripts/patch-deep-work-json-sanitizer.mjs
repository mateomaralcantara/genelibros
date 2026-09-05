import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/deep-work-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
let changed = false;

// DEEP_JSON_CONTROL_SANITIZER_V1
// Gemini puede devolver JSON aparentemente correcto con caracteres de control
// ASCII crudos dentro de strings largos. JSON.parse los rechaza. Esta capa
// escapa SOLO esos controles dentro de strings y no hace ninguna llamada LLM.

const helperMarker = "DEEP_JSON_CONTROL_SANITIZER_V1_APPLIED";

if (!runtime.includes(helperMarker)) {
  const parseMarker = "function parseJson(text: string): AnyRow {";
  const at = runtime.indexOf(parseMarker);
  if (at < 0) {
    console.error("[Genelibros] DEEP JSON SANITIZER: no se encontró parseJson(). 0 llamadas LLM.");
    process.exit(2);
  }

  const helper = `// DEEP_JSON_CONTROL_SANITIZER_V1_APPLIED\nfunction escapeIllegalJsonControlChars(input: string): string {\n  let out = \"\";\n  let inString = false;\n  let escaped = false;\n\n  for (let i = 0; i < input.length; i += 1) {\n    const char = input[i];\n\n    if (!inString) {\n      if (char === '\"') inString = true;\n      out += char;\n      continue;\n    }\n\n    if (escaped) {\n      out += char;\n      escaped = false;\n      continue;\n    }\n\n    if (char === \\\"\\\\\\\") {\n      out += char;\n      escaped = true;\n      continue;\n    }\n\n    if (char === '\"') {\n      out += char;\n      inString = false;\n      continue;\n    }\n\n    const code = char.charCodeAt(0);\n    if (code <= 0x1f) {\n      if (code === 0x08) out += \"\\\\b\";\n      else if (code === 0x09) out += \"\\\\t\";\n      else if (code === 0x0a) out += \"\\\\n\";\n      else if (code === 0x0c) out += \"\\\\f\";\n      else if (code === 0x0d) out += \"\\\\r\";\n      else out += \"\\\\u\" + code.toString(16).padStart(4, \"0\");\n      continue;\n    }\n\n    out += char;\n  }\n\n  return out;\n}\n\n`;

  runtime = runtime.slice(0, at) + helper + runtime.slice(at);
  changed = true;
}

if (!runtime.includes("const sanitized = escapeIllegalJsonControlChars(repaired);")) {
  const oldBlock = `    const repaired = candidate.replace(/,\\s*([}\\]])/g, \"$1\").replace(/\\u0000/g, \"\");\n    try {\n      return JSON.parse(repaired);\n    } catch (error) {\n      throw new Error(\n        \`Deep Work: respuesta JSON inválida. \${String((error as any)?.message || error)}. Preview: \${repaired.slice(0, 350)}\`,\n      );\n    }`;

  const newBlock = `    const repaired = candidate.replace(/,\\s*([}\\]])/g, \"$1\").replace(/\\u0000/g, \"\");\n    const sanitized = escapeIllegalJsonControlChars(repaired);\n    try {\n      return JSON.parse(sanitized);\n    } catch (error) {\n      throw new Error(\n        \`Deep Work: respuesta JSON inválida tras saneo local. \${String((error as any)?.message || error)}. Preview: \${sanitized.slice(0, 350)}\`,\n      );\n    }`;

  if (!runtime.includes(oldBlock)) {
    console.error("[Genelibros] DEEP JSON SANITIZER: no se encontró el fallback parseJson esperado. 0 llamadas LLM.");
    process.exit(3);
  }
  runtime = runtime.replace(oldBlock, newBlock);
  changed = true;
}

const required = [
  runtime.includes(helperMarker),
  runtime.includes("function escapeIllegalJsonControlChars"),
  runtime.includes("const sanitized = escapeIllegalJsonControlChars(repaired);"),
  runtime.includes("JSON.parse(sanitized)"),
];
if (required.some((ok) => !ok)) {
  console.error("[Genelibros] DEEP JSON SANITIZER: validación estructural falló. No se escribe runtime.");
  process.exit(4);
}

if (changed) {
  fs.writeFileSync(runtimeFile, runtime, "utf8");
  console.log("[Genelibros] DEEP JSON SANITIZER instalado: controles crudos se escapan localmente, 0 llamadas extra.");
} else {
  console.log("[Genelibros] DEEP JSON SANITIZER ya estaba instalado.");
}

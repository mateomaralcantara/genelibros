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

  const helper = String.raw`// DEEP_JSON_CONTROL_SANITIZER_V1_APPLIED
function escapeIllegalJsonControlChars(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (!inString) {
      if (char === '"') inString = true;
      out += char;
      continue;
    }

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      out += char;
      inString = false;
      continue;
    }

    const code = char.charCodeAt(0);
    if (code <= 0x1f) {
      if (code === 0x08) out += "\\b";
      else if (code === 0x09) out += "\\t";
      else if (code === 0x0a) out += "\\n";
      else if (code === 0x0c) out += "\\f";
      else if (code === 0x0d) out += "\\r";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }

    out += char;
  }

  return out;
}

`;

  runtime = runtime.slice(0, at) + helper + runtime.slice(at);
  changed = true;
}

if (!runtime.includes("const sanitized = escapeIllegalJsonControlChars(repaired);")) {
  const parseNeedle = "    try {\n      return JSON.parse(repaired);";
  if (!runtime.includes(parseNeedle)) {
    console.error("[Genelibros] DEEP JSON SANITIZER: no se encontró el fallback JSON.parse(repaired). 0 llamadas LLM.");
    process.exit(3);
  }

  runtime = runtime.replace(
    parseNeedle,
    "    const sanitized = escapeIllegalJsonControlChars(repaired);\n    try {\n      return JSON.parse(sanitized);"
  );
  runtime = runtime.replace(
    "Preview: ${repaired.slice(0, 350)}",
    "Preview: ${sanitized.slice(0, 350)}"
  );
  runtime = runtime.replace(
    "Deep Work: respuesta JSON inválida.",
    "Deep Work: respuesta JSON inválida tras saneo local."
  );
  changed = true;
}

const required = [
  runtime.includes(helperMarker),
  runtime.includes("function escapeIllegalJsonControlChars"),
  runtime.includes('if (char === "\\\\")'),
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

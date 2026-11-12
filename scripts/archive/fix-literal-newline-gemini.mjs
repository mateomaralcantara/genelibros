import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = path.join(root, "src", "lib", "gemini.ts");

if (!fs.existsSync(file)) {
  console.error("❌ No existe:", file);
  process.exit(1);
}

const backup = `${file}.bak_fix_literal_newline`;
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

let replacements = 0;

const badPatterns = [
  String.raw`\nfunction buildPlainPrompt`,
  String.raw`\n function buildPlainPrompt`,
  String.raw`\r\nfunction buildPlainPrompt`,
];

for (const bad of badPatterns) {
  if (code.includes(bad)) {
    code = code.split(bad).join("\nfunction buildPlainPrompt");
    replacements++;
  }
}

// Reparación general para otros caracteres \\n literales
// que hayan quedado antes de declaraciones TypeScript.
code = code.replace(
  /\\n(?=(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$])/g,
  "\n"
);

code = code.replace(
  /\\n(?=(?:const|let|type|interface|class)\s+[A-Za-z_$])/g,
  "\n"
);

fs.writeFileSync(file, code, "utf8");

console.log("✅ Archivo corregido:", file);
console.log("✅ Backup:", backup);
console.log("✅ Reemplazos directos:", replacements);

const remaining = code.match(/\\nfunction\s+[A-Za-z_$]/g) ?? [];

if (remaining.length > 0) {
  console.warn("⚠️ Todavía existen secuencias sospechosas:", remaining.length);
  process.exitCode = 2;
} else {
  console.log("✅ No quedan secuencias \\\\n antes de funciones.");
}
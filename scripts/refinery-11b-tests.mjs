import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const tests = [];
function test(name, fn) {
  try {
    tests.push({ name, ok: Boolean(fn()) });
  } catch (error) {
    tests.push({ name, ok: false, error: String(error?.message || error) });
  }
}

const required = [
  "src/server/vercel-handlers/manuscript-audit.ts",
  "src/server/refinery-runtime.ts",
  "src/lib/refinery/types.ts",
  "src/lib/refinery/metrics.ts",
  "src/lib/refinery/client.ts",
  "src/lib/refinery/index.ts",
  "sql/refinery-11b-schema.sql",
];

for (const file of required) test(`Existe ${file}`, () => exists(file));

const api = read("src/server/vercel-handlers/manuscript-audit.ts");
const runtime = read("src/server/refinery-runtime.ts");
const metrics = read("src/lib/refinery/metrics.ts");
const schema = read("sql/refinery-11b-schema.sql");
const registry = read("src/lib/brain/agent-registry.ts");
const pkg = JSON.parse(read("package.json"));
const combined = [api, runtime, metrics].join("\n");

test("API autentica JWT", () =>
  api.includes("auth.getUser(token)") &&
  api.includes("authorization")
);
test("API valida ownership", () =>
  api.includes("project.user_id") &&
  api.includes("user.id")
);
test("API usa sections CHAPTER", () =>
  api.includes('.from("sections")') &&
  api.includes('.eq("type", "CHAPTER")')
);
test("API tiene fallback master_documents", () =>
  api.includes('.from("master_documents")')
);
test("Runtime usa GEMINI_API_KEY server-side", () =>
  runtime.includes("process.env.GEMINI_API_KEY")
);
test("Runtime no usa VITE_GEMINI_API_KEY", () =>
  !runtime.includes("VITE_GEMINI_API_KEY")
);
test("Auditor evalúa 12 dimensiones por capítulo", () => {
  const keys = [
    "structure", "thesis", "depth", "clarity", "redundancy", "continuity",
    "style", "pacing", "originality", "factuality", "evidence", "publishability"
  ];
  return keys.every((key) => runtime.includes(`"${key}"`));
});
test("Auditor global evalúa nonRepetition", () =>
  runtime.includes('"nonRepetition"')
);
test("Auditor genera surgeryPlan", () =>
  runtime.includes('"surgeryPlan"')
);
test("Auditor detecta overlap semántico", () =>
  runtime.includes('"semanticOverlap"')
);
test("Métricas deterministas cuentan palabras", () =>
  metrics.includes("wordCount")
);
test("Métricas detectan párrafos repetidos", () =>
  metrics.includes("repeatedParagraphWords")
);
test("Métricas crean matriz lexical", () =>
  metrics.includes("lexicalOverlapMatrix")
);
test("Auditor es no destructivo", () =>
  !api.includes('.from("sections").update') &&
  !api.includes('.from("sections").delete') &&
  !api.includes('.from("master_documents").update')
);
test("Persistencia de evaluaciones existe", () =>
  schema.includes("create table if not exists public.manuscript_evaluations")
);
test("RLS habilitado", () =>
  schema.includes("enable row level security")
);
test("RLS select propio", () =>
  schema.includes("user_id = auth.uid()")
);
test("Writes cliente revocados", () =>
  schema.includes("revoke insert, update, delete")
);
test("MANUSCRIPT_AUDITOR está READY", () => {
  const line = registry
    .split(/\r?\n/)
    .find((x) => x.includes('"MANUSCRIPT_AUDITOR"'));
  return Boolean(line && line.includes("ready("));
});
test("MASTER_BOOK_REFINER permanece registrado", () => {
  return registry.includes('"MASTER_BOOK_REFINER"');
});
test("package tiene refinery:11b:test", () =>
  pkg.scripts?.["refinery:11b:test"] === "node scripts/refinery-11b-tests.mjs"
);
test("package tiene refinery:verify", () =>
  typeof pkg.scripts?.["refinery:verify"] === "string"
);
test("No hay claves literales obvias", () =>
  !/AIza[0-9A-Za-z\-_]{30,}/.test(combined) &&
  !/sk-[A-Za-z0-9_\-]{32,}/.test(combined)
);

console.log("\n==========================================");
console.log("GENELIBROS 5.0 — BOOK REFINERY 11B TESTS");
console.log("==========================================");

for (const item of tests) {
  console.log(
    `${item.ok ? "✅ PASS" : "❌ FAIL"}: ${item.name}` +
      (item.error ? ` — ${item.error}` : ""),
  );
}

const failed = tests.filter((x) => !x.ok);
console.log("");

if (failed.length) {
  console.error(`❌ FASE 11B: ${failed.length} prueba(s) fallaron.`);
  process.exit(1);
}

console.log(`✅ FASE 11B: ${tests.length} pruebas estructurales pasaron.`);
console.log("✅ MANUSCRIPT_AUDITOR listo como primer agente funcional de Book Refinery.");
console.log("ℹ️ El audit live requiere GEMINI_API_KEY + Supabase y ejecutar el SQL 11B.");

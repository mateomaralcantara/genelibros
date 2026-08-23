// scripts/fix-title-and-reader-format.mjs
// Corrige:
// 1. Título canónico: project.title manda siempre.
// 2. Evita que dashboard.book_title pise el título.
// 3. Neutraliza enlaces azules / prose-a:text-indigo en BookViewer.
// 4. Refuerza que el visor herede color editorial neutro.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const targets = [
  "src/lib/editor.ts",
  "components/BookViewer.tsx",
  "components/GenerationDashboard.tsx",
];

function abs(file) {
  return path.join(ROOT, file);
}

function exists(file) {
  return fs.existsSync(abs(file));
}

function read(file) {
  return fs.readFileSync(abs(file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(abs(file), content, "utf8");
}

function backup(file) {
  const src = abs(file);
  const dst = abs(`${file}.bak_title_format`);
  fs.copyFileSync(src, dst);
  console.log(`✅ Backup: ${file}.bak_title_format`);
}

function replaceAllSafe(content, replacements) {
  let out = content;
  for (const [from, to] of replacements) {
    if (typeof from === "string") {
      out = out.split(from).join(to);
    } else {
      out = out.replace(from, to);
    }
  }
  return out;
}

function patchEditor() {
  const file = "src/lib/editor.ts";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);
  let c = read(file);

  if (!c.includes("function getCanonicalBookTitle")) {
    const helper = `

function isBadBookTitle(value: unknown): boolean {
  const t = String(value ?? "").trim();
  if (!t) return true;
  return /^(libro sin t[ií]tulo|documento maestro|documento|untitled)$/i.test(t);
}

function getCanonicalBookTitle(currentProject: any, mergedState: any, dashboard?: any): string {
  const projectTitle = String(currentProject?.title ?? "").trim();
  if (!isBadBookTitle(projectTitle)) return projectTitle;

  const stateTitle = String(mergedState?.book_title ?? mergedState?.bookTitle ?? "").trim();
  if (!isBadBookTitle(stateTitle)) return stateTitle;

  const dashboardTitle = String(dashboard?.book_title ?? "").trim();
  if (!isBadBookTitle(dashboardTitle)) return dashboardTitle;

  return "Libro sin título";
}

function enforceCanonicalBookTitle(currentProject: any, mergedState: any, dashboard?: any): string {
  const canonicalTitle = getCanonicalBookTitle(currentProject, mergedState, dashboard);

  if (mergedState && typeof mergedState === "object") {
    mergedState.book_title = canonicalTitle;
    mergedState.bookTitle = canonicalTitle;
  }

  if (dashboard && typeof dashboard === "object") {
    dashboard.book_title = canonicalTitle;
  }

  return canonicalTitle;
}
`;

    // Lo insertamos antes de buildMasterFromState si existe.
    if (c.includes("export function buildMasterFromState")) {
      c = c.replace("export function buildMasterFromState", `${helper}\nexport function buildMasterFromState`);
    } else {
      c += helper;
    }
  }

  c = replaceAllSafe(c, [
    [
      "const stateMaster = buildMasterFromState(mergedState, ensureString(dashboard.book_title, (currentProject as any)?.title)).trim();",
      "const canonicalTitle = enforceCanonicalBookTitle(currentProject, mergedState, dashboard);\n  const stateMaster = buildMasterFromState(mergedState, canonicalTitle).trim();",
    ],
    [
      "title: ensureString(dashboard.book_title, (currentProject as any)?.title || ensureString((mergedState as any).book_title, \"Libro sin título\")),",
      "title: canonicalTitle,",
    ],
    [
      "title: ensureString(dashboard.book_title, ensureString((mergedState as any).book_title, \"Documento maestro\")),",
      "title: canonicalTitle,",
    ],
    [
      "(state as any).book_title = ensureString((state as any).book_title, ensureString((state as any).bookTitle, \"Libro sin título\"));",
      "(state as any).book_title = ensureString((state as any).book_title, ensureString((state as any).bookTitle, \"Libro sin título\"));\n  (state as any).bookTitle = (state as any).book_title;",
    ],
  ]);

  write(file, c);
  console.log(`✅ Corregido: ${file}`);
}

function patchBookViewer() {
  const file = "components/BookViewer.tsx";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);
  let c = read(file);

  c = replaceAllSafe(c, [
    ["prose-a:text-indigo-700", "prose-a:text-inherit prose-a:no-underline"],
    ["prose-a:text-amber-800", "prose-a:text-inherit prose-a:no-underline"],
    ["prose-a:text-indigo-300", "prose-a:text-inherit prose-a:no-underline"],
    ["prose-strong:text-slate-100", "prose-strong:text-inherit"],
    [
      "'prose max-w-none',",
      "'prose max-w-none prose-a:text-inherit prose-a:no-underline prose-strong:text-inherit prose-headings:text-inherit',",
    ],
  ]);

  // Si existe el div del contenido, le agregamos clase neutral para que todo herede color.
  c = c.replace(
    "<div className={proseCls}>",
    '<div className={cx(proseCls, "book-content [&_*]:text-inherit [&_a]:no-underline [&_a]:pointer-events-none")}>'
  );

  write(file, c);
  console.log(`✅ Corregido: ${file}`);
}

function patchGenerationDashboard() {
  const file = "components/GenerationDashboard.tsx";
  if (!exists(file)) {
    console.log(`⚠️ No existe ${file}`);
    return;
  }

  backup(file);
  let c = read(file);

  // project.title debe mandar sobre state y dashboard.
  c = c.replace(
    `String(project?.title || "").trim() ||
      String(state?.book_title || "").trim() ||
      String(dashboard?.book_title || "").trim() ||
      "Libro sin título"`,
    `String(project?.title || "").trim() ||
      String(state?.book_title || "").trim() ||
      "Libro sin título"`
  );

  c = c.replace(
    "}, [project?.title, state?.book_title, dashboard?.book_title]);",
    "}, [project?.title, state?.book_title]);"
  );

  write(file, c);
  console.log(`✅ Corregido: ${file}`);
}

function main() {
  console.log("");
  console.log("=== FIX TITLE + READER FORMAT ===");
  console.log("Proyecto:", ROOT);

  for (const file of targets) {
    if (!exists(file)) console.log(`⚠️ Falta: ${file}`);
  }

  patchEditor();
  patchBookViewer();
  patchGenerationDashboard();

  console.log("");
  console.log("✅ Parche terminado.");
  console.log("");
  console.log("Ahora ejecuta:");
  console.log("node scripts/audit-book-title-format.mjs");
  console.log("npm run dev");
}

main();
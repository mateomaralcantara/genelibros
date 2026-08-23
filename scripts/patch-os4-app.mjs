import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, "utf8");
}

function backup(rel) {
  const src = path.join(ROOT, rel);
  const dst = `${src}.bak_os4_${Date.now()}`;
  fs.copyFileSync(src, dst);
  console.log("🛡️ Backup:", path.relative(ROOT, dst));
}

function assertIncludes(code, marker, label) {
  if (!code.includes(marker)) {
    throw new Error(`No encontré marcador para ${label}: ${marker}`);
  }
}

const appPath = "App.tsx";
const pkgPath = "package.json";

backup(appPath);
backup(pkgPath);

let app = read(appPath);

if (!app.includes('from "./components/AutonomousPublishingOS"')) {
  assertIncludes(
    app,
    'import GenerationDashboard from "./components/GenerationDashboard";',
    "import GenerationDashboard"
  );
  app = app.replace(
    'import GenerationDashboard from "./components/GenerationDashboard";',
    'import GenerationDashboard from "./components/GenerationDashboard";\nimport AutonomousPublishingOS from "./components/AutonomousPublishingOS";'
  );
}

app = app.replace(
  'const [viewMode, setViewMode] = useState<"plan" | "book">("plan");',
  'const [viewMode, setViewMode] = useState<"plan" | "book" | "os4">("plan");'
);

if (!app.includes('onClick={() => setViewMode("os4")}')) {
  const bookTab = `              <button
                onClick={() => setViewMode("book")}
                className={\`flex-1 py-3 text-sm font-bold border-b-2 transition-all \${
                  viewMode === "book"
                    ? "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }\`}
              >
                <BookOpenIcon className="w-4 h-4 inline mr-2" /> Documento Maestro
              </button>`;

  assertIncludes(app, bookTab, "tab Documento Maestro");

  const os4Tab = `${bookTab}

              <button
                onClick={() => setViewMode("os4")}
                className={\`flex-1 py-3 text-sm font-bold border-b-2 transition-all \${
                  viewMode === "os4"
                    ? "border-fuchsia-500 text-fuchsia-300 bg-fuchsia-500/10"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }\`}
              >
                SUPREME OS
              </button>`;

  app = app.replace(bookTab, os4Tab);
}

if (!app.includes("<AutonomousPublishingOS")) {
  const oldRender = `              viewMode === "plan" ? (
                <div className="min-h-full bg-slate-950">
                  <GenerationDashboard
                    project={activeProject}
                    onGenerate={handleGenerateSection}
                    onGenerateRemaining={handleGenerateRemaining}
                    onOpenBookView={() => setViewMode("book")}
                    isGeneratingGlobal={isLoading || anyGenerating}
                  />
                </div>
              ) : (
                <div className="min-h-full bg-slate-950">
                  <BookViewer project={activeProject} onEditSection={handleEditSection as any} />
                </div>
              )`;

  assertIncludes(app, oldRender, "render plan/book");

  const newRender = `              viewMode === "plan" ? (
                <div className="min-h-full bg-slate-950">
                  <GenerationDashboard
                    project={activeProject}
                    onGenerate={handleGenerateSection}
                    onGenerateRemaining={handleGenerateRemaining}
                    onOpenBookView={() => setViewMode("book")}
                    isGeneratingGlobal={isLoading || anyGenerating}
                  />
                </div>
              ) : viewMode === "os4" ? (
                <div className="min-h-full bg-slate-950">
                  <AutonomousPublishingOS
                    project={activeProject}
                    defaultChapterWords={defaultChapterWords}
                    onProjectUpdated={(nextProject) => {
                      projectsRef.current = projectsRef.current.map((p) =>
                        p.id === nextProject.id ? nextProject : p
                      );
                      updateProjectById(nextProject.id, () => nextProject);
                    }}
                  />
                </div>
              ) : (
                <div className="min-h-full bg-slate-950">
                  <BookViewer project={activeProject} onEditSection={handleEditSection as any} />
                </div>
              )`;

  app = app.replace(oldRender, newRender);
}

if (!app.includes("BESTSELLER_OS4_SUPREME_INTEGRATED")) {
  app += `

/**
 * BESTSELLER_OS4_SUPREME_INTEGRATED
 * Market → Concept Battle → Author DNA → Blueprint → Research → Knowledge Graph
 * → Simulation → Writing → Fact-check → Quality Council → Master → Launch.
 */
export const BESTSELLER_OS4_SUPREME_INTEGRATED = true;
`;
}

write(appPath, app);

const pkg = JSON.parse(read(pkgPath));
pkg.scripts = pkg.scripts || {};
pkg.scripts["os4:test"] = "node scripts/os4-tests.mjs";
pkg.scripts["os4:verify"] =
  "npm run typecheck && npm run build && npm run os4:test";
pkg.scripts["os4:market"] =
  "node scripts/market-perfection-score.mjs --full";
write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log("✅ App.tsx integrado con SUPREME OS.");
console.log("✅ package.json actualizado.");
console.log("");
console.log("Ahora:");
console.log("npm run os4:verify");
console.log("");
console.log("Y ejecuta en Supabase:");
console.log("sql/bestseller-os4-schema.sql");

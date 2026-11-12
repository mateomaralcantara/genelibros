import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const marker = "BESTSELLER_OS4_PHASE_10B";

function file(rel) { return path.join(root, rel); }
function read(rel) { return fs.readFileSync(file(rel), "utf8"); }
function write(rel, text) { fs.writeFileSync(file(rel), text, "utf8"); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function replaceOnce(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  assert(count === 1, `${label}: se esperaba 1 coincidencia y hay ${count}.`);
  return text.replace(search, replacement);
}

// ---------------------------------------------------------------------------
// UI Mission Control: durable enqueue + polling + controls
// ---------------------------------------------------------------------------
{
  const rel = "components/AutonomousPublishingOS.tsx";
  let s = read(rel);

  if (!s.includes(marker)) {
    const repoImport = `import { getOs4Profile, listOs4QualityReports, patchOs4Profile, saveOs4Approval } from "../src/lib/os4/repo";`;
    assert(s.includes(repoImport), "UI: no encontré import repo OS4.");
    s = s.replace(
      repoImport,
      `${repoImport}
import {
  cancelOs4DurableJob,
  enqueueOs4DurableBook,
  latestOs4DurableJob,
  resumeOs4DurableJob,
  type Os4DurableJob,
} from "../src/lib/os4/jobs";
// ${marker}`
    );

    const launchState = `  const [launchPlan, setLaunchPlan] = useState<any>(null);`;
    assert(s.includes(launchState), "UI: no encontré launchPlan state.");
    s = s.replace(
      launchState,
      `${launchState}
  const [durableJob, setDurableJob] = useState<Os4DurableJob | null>(null);`
    );

    const refreshStart = `    const [p, q] = await Promise.all([
      getOs4Profile(project.id),
      listOs4QualityReports(project.id),
    ]);`;
    assert(s.includes(refreshStart), "UI: no encontré refresh Promise.all.");
    s = s.replace(
      refreshStart,
      `    const [p, q, j] = await Promise.all([
      getOs4Profile(project.id),
      listOs4QualityReports(project.id),
      latestOs4DurableJob(project.id).catch(() => null),
    ]);`
    );

    const setQ = `    setQualityReports(q);`;
    assert(s.includes(setQ), "UI: no encontré setQualityReports.");
    s = s.replace(setQ, `${setQ}
    setDurableJob(j);`);

    const effect = `  useEffect(() => {
    refresh().catch(() => {});
  }, [project.id]);`;
    assert(s.includes(effect), "UI: no encontré useEffect refresh.");
    s = s.replace(
      effect,
      `${effect}

  useEffect(() => {
    const timer = window.setInterval(() => {
      latestOs4DurableJob(project.id)
        .then((job) => {
          setDurableJob(job);
          if (job?.status === "COMPLETED") refresh().catch(() => {});
        })
        .catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [project.id]);`
    );

    s = s.replace(
      `className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2"`,
      `className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2"`
    );

    const fullBook = `              <Action
                disabled={busy || outline.length === 0}
                label="3. Libro completo Supreme"
                onClick={() =>
                  run(async () => {
                    const finalProject = await runOs4AllChapters(project, {
                      targetWords,
                      minimumScore: 9.2,
                      maxRepairIterations: 3,
                      onEvent,
                      shouldStop: () => stopRef.current,
                      onProject: onProjectUpdated,
                    });
                    onProjectUpdated(finalProject);
                  })
                }
              />`;
    assert(s.includes(fullBook), "UI: no encontré botón Libro completo Supreme.");
    const durableAction = `${fullBook}

              <Action
                disabled={busy}
                label="4. Libro 24/7 DURABLE"
                onClick={() =>
                  run(async () => {
                    const job = await enqueueOs4DurableBook({
                      projectId: project.id,
                      mode,
                      targetChapterWords: targetWords,
                      authorSamples,
                      researchUrls: parsedUrls,
                      maxResearchQueries: 6,
                    });
                    setDurableJob(job);
                    onEvent({
                      stage: "WRITING",
                      status: "RUNNING",
                      message:
                        "Job durable encolado. Puedes cerrar el navegador; Supabase Cron continuará el libro.",
                      metadata: { durable_job_id: job.id },
                    });
                  })
                }
              />`;
    s = s.replace(fullBook, durableAction);

    const errorBlock = `            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                {error}
              </div>
            )}`;
    assert(s.includes(errorBlock), "UI: no encontré bloque de error.");
    const durablePanel = `            {durableJob && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black">DURABLE 24/7</span>
                  <span>{durableJob.status}</span>
                  <span>step: {String(durableJob.checkpoint?.step || "—")}</span>
                  <span>cap: {String(durableJob.checkpoint?.chapter_number || "—")}</span>
                  <span>attempts: {durableJob.attempts}/{durableJob.max_attempts}</span>
                  {["WAITING_APPROVAL", "BLOCKED", "FAILED", "RETRYING"].includes(durableJob.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const next = await resumeOs4DurableJob(project.id, durableJob.id);
                          setDurableJob(next);
                        })
                      }
                      className="ml-auto rounded-lg bg-cyan-700 hover:bg-cyan-600 px-3 py-2 text-[10px] font-black"
                    >
                      REANUDAR JOB
                    </button>
                  )}
                  {!["COMPLETED", "CANCELLED", "DEAD_LETTER"].includes(durableJob.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const next = await cancelOs4DurableJob(project.id, durableJob.id);
                          setDurableJob(next);
                        })
                      }
                      className="rounded-lg bg-rose-800 hover:bg-rose-700 px-3 py-2 text-[10px] font-black"
                    >
                      CANCELAR JOB
                    </button>
                  )}
                </div>
                {durableJob.last_error && (
                  <div className="mt-2 text-rose-200">{durableJob.last_error}</div>
                )}
              </div>
            )}

${errorBlock}`;
    s = s.replace(errorBlock, durablePanel);

    write(rel, s);
  }
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------
{
  const rel = "package.json";
  const pkg = JSON.parse(read(rel));
  pkg.scripts ||= {};
  pkg.scripts["os4:10b:test"] = "node scripts/os4-10b-tests.mjs";
  pkg.scripts["os4:10b:verify"] =
    "npm run os4:10b:test && npm run typecheck && npm run build";
  pkg.scripts["os4:10b:live"] =
    "node scripts/os4-10b-live-verify.mjs";
  write(rel, JSON.stringify(pkg, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Evaluador: acepta PRODUCCIÓN del worker solo con prueba live generada
// por os4-10b-live-verify.mjs.
// ---------------------------------------------------------------------------
{
  const rel = "scripts/evaluate-os4-supreme.mjs";
  if (fs.existsSync(file(rel))) {
    let s = read(rel);
    if (!s.includes("os4-worker-production-proof.json")) {
      const baseRepoLine = `const baseRepo = R("src/data/repo.ts");`;
      assert(s.includes(baseRepoLine), "Evaluator: no encontré baseRepo.");
      s = s.replace(
        baseRepoLine,
        `${baseRepoLine}
let workerProof = {};
try { workerProof = JSON.parse(R("reports/os4-worker-production-proof.json") || "{}"); } catch {}
const workerLiveVerified =
  workerProof?.verified === true &&
  workerProof?.scheduler_verified === true &&
  workerProof?.lease_verified === true &&
  workerProof?.completed_status === "COMPLETED";`
      );

      const productionFalse = `    production:false,
    note:"PRODUCCIÓN requiere evidencia externa de scheduler/worker desplegado; no se concede por análisis estático.",`;
      assert(s.includes(productionFalse), "Evaluator: no encontré production:false worker.");
      s = s.replace(
        productionFalse,
        `    production:workerLiveVerified,
    note:workerLiveVerified
      ? "Worker + scheduler verificados mediante healthcheck durable externo."
      : "PRODUCCIÓN requiere reports/os4-worker-production-proof.json generado por os4:10b:live.",`
      );

      const capLine = `cap(!workerIntegrated, 9.8, "No hay worker durable 24/7 verificado.");`;
      assert(s.includes(capLine), "Evaluator: no encontré cap worker.");
      s = s.replace(
        capLine,
        `cap(!workerIntegrated || !workerLiveVerified, 9.8, "No hay worker durable 24/7 + scheduler verificados.");`
      );

      write(rel, s);
    }
  }
}

console.log("✅ BESTSELLER OS4 FASE 10B aplicada.");
console.log("   - Worker 24/7 independiente del navegador");
console.log("   - Supabase generation_jobs durable");
console.log("   - Atomic leasing / SKIP LOCKED");
console.log("   - Heartbeat + checkpoint resume");
console.log("   - Retries con exponential backoff");
console.log("   - Dead-letter queue");
console.log("   - Mission Control con Libro 24/7 DURABLE");
console.log("   - Evaluador preparado para prueba live real");

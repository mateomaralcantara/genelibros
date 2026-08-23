import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../types";
import {
  runOs4AllChapters,
  runOs4Chapter,
  runOs4LaunchPlan,
  runOs4MasterAudit,
  runOs4PublishingPlan,
  runOs4Preproduction,
} from "../src/lib/os4/orchestrator";
import { getOs4Profile, listOs4QualityReports, patchOs4Profile, saveOs4Approval } from "../src/lib/os4/repo";
import {
  cancelOs4DurableJob,
  enqueueOs4DurableBook,
  latestOs4DurableJob,
  resumeOs4DurableJob,
  type Os4DurableJob,
} from "../src/lib/os4/jobs";
// BESTSELLER_OS4_PHASE_10B
import { OS4_STAGE_ORDER, OS4_VERSION } from "../src/lib/os4/config";
import type {
  Os4Mode,
  Os4PipelineEvent,
  Os4Profile,
} from "../src/lib/os4/types";

type Props = {
  project: Project;
  defaultChapterWords: number;
  onProjectUpdated: (project: Project) => void;
};

function fmtScore(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}/10` : "—";
}

function stageIndex(stage: string | undefined): number {
  return Math.max(0, OS4_STAGE_ORDER.indexOf(stage as any));
}

const AutonomousPublishingOS: React.FC<Props> = ({
  project,
  defaultChapterWords,
  onProjectUpdated,
}) => {
  const [profile, setProfile] = useState<Os4Profile | null>(null);
  const [qualityReports, setQualityReports] = useState<any[]>([]);
  const [mode, setMode] = useState<Os4Mode>("SUPERVISED");
  const [targetWords, setTargetWords] = useState(defaultChapterWords || 3000);
  const [authorSamples, setAuthorSamples] = useState("");
  const [researchUrlsText, setResearchUrlsText] = useState("");
  const [chapterNumber, setChapterNumber] = useState(1);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Os4PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [masterAudit, setMasterAudit] = useState<any>(null);
  const [publishingPlan, setPublishingPlan] = useState<any>(null);
  const [launchPlan, setLaunchPlan] = useState<any>(null);
  const [durableJob, setDurableJob] = useState<Os4DurableJob | null>(null);
  const stopRef = useRef(false);

  const outline = useMemo(
    () => Array.isArray((project.state as any)?.outline_12)
      ? (project.state as any).outline_12
      : [],
    [project]
  );

  const refresh = async () => {
    const [p, q, j] = await Promise.all([
      getOs4Profile(project.id),
      listOs4QualityReports(project.id),
      latestOs4DurableJob(project.id).catch(() => null),
    ]);
    setProfile(p);
    setQualityReports(q);
    setDurableJob(j);
    if (p?.mode) setMode(p.mode);
    if (p?.master_audit) setMasterAudit(p.master_audit);
    if (p?.publishing_plan) setPublishingPlan(p.publishing_plan);
    if (p?.launch_plan) setLaunchPlan(p.launch_plan);
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, [project.id]);

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
  }, [project.id]);

  const onEvent = (event: Os4PipelineEvent) => {
    setLog((prev) => [event, ...prev].slice(0, 120));
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    stopRef.current = false;
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const parsedUrls = researchUrlsText
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 15);

  const currentStageIdx = stageIndex(profile?.current_stage);

  return (
    <div className="min-h-full bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/60 to-slate-950 p-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-indigo-300 font-black">
                BestSeller Autonomous Publishing OS
              </div>
              <h2 className="mt-1 text-2xl md:text-3xl font-black text-white">
                SUPREME CONTROL CENTER
              </h2>
              <div className="mt-1 text-xs text-slate-400 font-mono">
                OS4 {OS4_VERSION} · {project.title}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 min-w-[330px]">
              <Metric label="OS4 Score" value={fmtScore(profile?.overall_score)} />
              <Metric label="Market" value={fmtScore(profile?.market?.market_score)} />
              <Metric label="Blueprint" value={fmtScore(profile?.blueprint?.blueprint_score)} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
            Pipeline Autónomo
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-8 gap-2">
            {OS4_STAGE_ORDER.map((stage, i) => {
              const active = profile?.current_stage === stage;
              const done = i < currentStageIdx || profile?.status === "COMPLETED";
              return (
                <div
                  key={stage}
                  className={[
                    "rounded-xl border px-3 py-2 text-[10px] font-black text-center",
                    active
                      ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                      : done
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-800 bg-slate-950 text-slate-500",
                  ].join(" ")}
                >
                  {stage}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              {(["AUTONOMOUS", "SUPERVISED", "EDITORIAL"] as Os4Mode[]).map((m) => (
                <button
                  key={m}
                  disabled={busy}
                  onClick={() => setMode(m)}
                  className={[
                    "px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border",
                    mode === m
                      ? "bg-indigo-600 border-indigo-400 text-white"
                      : "bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800",
                  ].join(" ")}
                >
                  {m}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] text-slate-500 uppercase font-black">
                  palabras/cap.
                </span>
                <input
                  type="number"
                  min={800}
                  max={20000}
                  step={250}
                  value={targetWords}
                  onChange={(e) => setTargetWords(Number(e.target.value || 3000))}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Muestras del autor para Author DNA
                </label>
                <textarea
                  value={authorSamples}
                  onChange={(e) => setAuthorSamples(e.target.value)}
                  placeholder="Pega aquí textos propios. OS4 extraerá ritmo, vocabulario, estructura y voz."
                  className="mt-2 w-full min-h-36 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  URLs de investigación opcionales
                </label>
                <textarea
                  value={researchUrlsText}
                  onChange={(e) => setResearchUrlsText(e.target.value)}
                  placeholder={"Una URL por línea.\nSi /api/research tiene proveedor de búsqueda, OS4 también usa queries automáticas."}
                  className="mt-2 w-full min-h-36 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
              <Action
                disabled={busy}
                label="1. Preparar Supreme"
                onClick={() =>
                  run(async () => {
                    const result = await runOs4Preproduction(project, {
                      mode,
                      targetChapterWords: targetWords,
                      authorSamples,
                      researchUrls: parsedUrls,
                      maxResearchQueries: 6,
                      onEvent,
                    });
                    onProjectUpdated(result.project);
                    setProfile(result.profile);
                  })
                }
              />

              <Action
                disabled={busy || outline.length === 0}
                label="2. Council capítulo"
                onClick={() =>
                  run(async () => {
                    const result = await runOs4Chapter(project, chapterNumber, {
                      targetWords,
                      minimumScore: 9.2,
                      maxRepairIterations: 3,
                      onEvent,
                    });
                    onProjectUpdated(result.project);
                  })
                }
              />

              <Action
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
              />

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
              />

              <button
                disabled={!busy}
                onClick={() => {
                  stopRef.current = true;
                  onEvent({
                    stage: "WRITING",
                    status: "BLOCKED",
                    message: "Solicitud de parada recibida. Se detendrá al terminar la operación actual.",
                  });
                }}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-xs font-black text-rose-300 disabled:opacity-30"
              >
                DETENER
              </button>
            </div>

            <div className="flex flex-wrap gap-2 items-center rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[10px] font-black uppercase text-slate-500">
                Capítulo
              </span>
              <select
                value={chapterNumber}
                onChange={(e) => setChapterNumber(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs"
              >
                {outline.map((x: any) => (
                  <option key={x.chapter_number} value={x.chapter_number}>
                    {x.chapter_number}. {x.chapter_title || x.title}
                  </option>
                ))}
              </select>

              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const audit = await runOs4MasterAudit(project, onEvent);
                    setMasterAudit(audit);
                  })
                }
                className="ml-auto rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-black"
              >
                AUDITAR MASTER
              </button>

              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const publishing = await runOs4PublishingPlan(project, onEvent);
                    setPublishingPlan(publishing);
                  })
                }
                className="rounded-lg bg-indigo-700 hover:bg-indigo-600 px-3 py-2 text-xs font-black"
              >
                PUBLISHING DIRECTOR
              </button>

              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const launch = await runOs4LaunchPlan(project, onEvent);
                    setLaunchPlan(launch);
                  })
                }
                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3 py-2 text-xs font-black"
              >
                CREAR LAUNCH SYSTEM
              </button>
            </div>


            {profile?.status === "WAITING_APPROVAL" && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="w-full text-[10px] font-black uppercase tracking-widest text-amber-300">
                  Gate humano requerido
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await saveOs4Approval({
                        projectId: project.id,
                        stage: profile.current_stage,
                        decision: "APPROVED",
                        note: "Aprobación desde Supreme Control Center",
                      });
                      await patchOs4Profile(project.id, { status: "COMPLETED" });
                      onEvent({
                        stage: profile.current_stage,
                        status: "COMPLETED",
                        message: "Gate humano aprobado.",
                      });
                    })
                  }
                  className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3 py-2 text-xs font-black"
                >
                  APROBAR GATE
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await saveOs4Approval({
                        projectId: project.id,
                        stage: profile.current_stage,
                        decision: "REJECTED",
                        note: "Rechazado desde Supreme Control Center",
                      });
                      await patchOs4Profile(project.id, { status: "BLOCKED" });
                      onEvent({
                        stage: profile.current_stage,
                        status: "BLOCKED",
                        message: "Gate humano rechazado.",
                      });
                    })
                  }
                  className="rounded-lg bg-rose-700 hover:bg-rose-600 px-3 py-2 text-xs font-black"
                >
                  RECHAZAR
                </button>
              </div>
            )}

            {durableJob && (
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

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">
              Telemetría editorial
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Stage" value={profile?.current_stage || "—"} />
              <Metric label="Status" value={profile?.status || "—"} />
              <Metric label="Research" value={fmtScore(profile?.research_bundle?.coverage_score)} />
              <Metric label="Simulation" value={fmtScore(profile?.simulation?.structural_score)} />
              <Metric label="Quality reports" value={String(qualityReports.length)} />
              <Metric label="Chapters" value={String(outline.length)} />
            </div>

            <div className="mt-4 max-h-72 overflow-y-auto space-y-2">
              {log.length === 0 ? (
                <div className="text-xs text-slate-600">
                  El log aparecerá aquí cuando ejecutes OS4.
                </div>
              ) : (
                log.map((event, index) => (
                  <div
                    key={`${event.stage}-${index}`}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-2"
                  >
                    <div className="text-[9px] font-black text-indigo-300">
                      {event.stage} · {event.status}
                    </div>
                    <div className="text-[11px] text-slate-300 mt-1">
                      {event.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {(masterAudit || launchPlan) && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {masterAudit && (
              <JsonPanel title="Master Audit" value={masterAudit} />
            )}
            {launchPlan && (
              <JsonPanel title="Launch System" value={launchPlan} />
            )}
          </div>
        )}

        {qualityReports.length > 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
              Últimos Quality Gates
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left p-2">Cap.</th>
                    <th className="text-left p-2">Score</th>
                    <th className="text-left p-2">Estado</th>
                    <th className="text-left p-2">Iteración</th>
                  </tr>
                </thead>
                <tbody>
                  {qualityReports.slice(0, 20).map((q: any) => (
                    <tr key={q.id} className="border-t border-slate-800">
                      <td className="p-2">{q.chapter_number}</td>
                      <td className="p-2 font-black">{fmtScore(q.global_score)}</td>
                      <td className="p-2">{q.status}</td>
                      <td className="p-2">{q.iteration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
    <div className="text-[9px] uppercase tracking-widest text-slate-500 font-black">
      {label}
    </div>
    <div className="mt-1 text-sm font-black text-white truncate">{value}</div>
  </div>
);

const Action: React.FC<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="rounded-xl border border-indigo-500/30 bg-indigo-600 hover:bg-indigo-500 px-3 py-3 text-xs font-black text-white disabled:opacity-40 transition"
  >
    {label}
  </button>
);

const JsonPanel: React.FC<{ title: string; value: any }> = ({ title, value }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
      {title}
    </div>
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[11px] text-slate-300 bg-slate-950 rounded-xl p-3 border border-slate-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  </div>
);

export default AutonomousPublishingOS;

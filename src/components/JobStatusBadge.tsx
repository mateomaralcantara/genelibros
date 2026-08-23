import React from "react";
import type { GenerationJob } from "../lib/jobTypes";

export default function JobStatusBadge({ job }: { job?: GenerationJob | null }) {
  if (!job) return null;
  const color =
    job.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" :
    job.status === "ERROR" ? "bg-red-500/15 text-red-200 border-red-500/30" :
    job.status === "CANCELLED" ? "bg-slate-500/15 text-slate-200 border-slate-500/30" :
    "bg-indigo-500/15 text-indigo-200 border-indigo-500/30";

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${color}`}>
      <div className="font-black">{job.status}</div>
      <div className="mt-1 opacity-80">{job.current_step || "Procesando..."}</div>
      <div className="mt-2 h-1.5 rounded-full bg-black/30 overflow-hidden">
        <div className="h-full bg-current transition-all" style={{ width: `${Math.max(0, Math.min(100, job.progress_percent || 0))}%` }} />
      </div>
      {job.error_message ? <div className="mt-2 text-red-200">{job.error_message}</div> : null}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationJob } from "../lib/jobTypes";
import { getProjectJobs } from "../lib/jobsClient";

export function useGenerationJobs(projectId?: string | null, intervalMs = 3500) {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setJobs([]);
      return;
    }
    setLoading(true);
    try {
      setJobs(await getProjectJobs(projectId));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh().catch(() => {});
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => refresh().catch(() => {}), intervalMs);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [refresh, intervalMs]);

  return { jobs, loading, refresh };
}

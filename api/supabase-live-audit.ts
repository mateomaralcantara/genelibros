const TABLES = [
  "manuscript_evaluations",
  "manuscript_audit_jobs",
  "manuscript_chapter_versions",
  "manuscript_refinement_applies",
  "manuscript_refinement_jobs",
  "deep_work_apply_history",
  "deep_work_artifacts",
  "deep_work_jobs",
  "research_claims",
  "research_dossiers",
  "research_evidence",
  "research_jobs",
  "research_sources"
];

const RPCS = [
  "refinery_claim_audit_job",
  "refinery_complete_audit_job",
  "refinery_fail_audit_job",
  "refinery_heartbeat_audit_job",
  "refinery_release_audit_job",
  "refinery_sweep_audit_jobs",

  "refinery_apply_chapter_version",
  "refinery_claim_refinement_job",
  "refinery_complete_refinement_job",
  "refinery_create_chapter_version",
  "refinery_fail_refinement_job",
  "refinery_heartbeat_refinement_job",
  "refinery_release_refinement_job",
  "refinery_rollback_chapter_apply",

  "deep_apply_chapter_candidate",
  "deep_claim_work_job",
  "deep_complete_work_job",
  "deep_create_artifact",
  "deep_fail_work_job",
  "deep_heartbeat_work_job",
  "deep_release_work_job",
  "deep_rollback_chapter_candidate",
  "deep_sweep_work_jobs",

  "research_claim_job",
  "research_complete_job",
  "research_fail_job",
  "research_heartbeat_job",
  "research_release_job",
  "research_sweep_jobs"
];

async function timedFetch(url: string, options: any = {}) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  }
  finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {

  if (process.env.VERCEL_ENV === "production") {
    return res.status(403).json({
      ok: false,
      error: "Preview only."
    });
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false
    });
  }

  const url = String(
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();

  if (!url || !key) {
    return res.status(500).json({
      ok: false,
      error: "Supabase server env missing.",
      env: {
        url: Boolean(url),
        serviceRole: Boolean(key)
      }
    });
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`
  };

  try {

    const schemaResponse = await timedFetch(
      `${url}/rest/v1/`,
      {
        headers: {
          ...headers,
          Accept: "application/openapi+json"
        }
      }
    );

    if (!schemaResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: "OpenAPI failure",
        status: schemaResponse.status
      });
    }

    const schema = await schemaResponse.json();

    const paths =
      Object.keys(schema.paths || {});

    const missingTables =
      TABLES.filter(
        x => !paths.includes(`/${x}`)
      );

    const missingRpcs =
      RPCS.filter(
        x => !paths.includes(`/rpc/${x}`)
      );

    const readFailures: any[] = [];

    for (const table of TABLES) {

      try {

        const r = await timedFetch(
          `${url}/rest/v1/${table}?select=*&limit=0`,
          {
            headers: {
              ...headers,
              Accept: "application/json"
            }
          }
        );

        if (!r.ok) {
          readFailures.push({
            table,
            status: r.status
          });
        }
      }
      catch {
        readFailures.push({
          table,
          status: "NETWORK"
        });
      }
    }

    const tablePresent =
      TABLES.length - missingTables.length;

    const rpcPresent =
      RPCS.length - missingRpcs.length;

    const reads =
      TABLES.length - readFailures.length;

    const ok =
      tablePresent === 13 &&
      rpcPresent === 29 &&
      reads === 13;

    return res.status(ok ? 200 : 503).json({
      ok,

      tables: {
        expected: 13,
        present: tablePresent,
        missing: missingTables
      },

      reads: {
        expected: 13,
        successful: reads,
        failures: readFailures
      },

      rpcs: {
        expected: 29,
        present: rpcPresent,
        missing: missingRpcs
      },

      contract: {
        expected: 42,
        present: tablePresent + rpcPresent
      },

      safety: {
        writes: 0,
        rpcExecuted: 0,
        geminiCalls: 0
      }
    });
  }
  catch (error: any) {

    return res.status(500).json({
      ok: false,
      error: String(
        error?.message || error
      )
    });
  }
}
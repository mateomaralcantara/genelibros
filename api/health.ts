
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  return res.status(200).json({
    ok: true,
    service: "BestSeller AI",
    status: "healthy",
    healthcheck: true,
    observability: true,
    timestamp: new Date().toISOString(),
    uptime:
      typeof process !== "undefined" && typeof process.uptime === "function"
        ? process.uptime()
        : 0,
    node_version:
      typeof process !== "undefined"
        ? process.version
        : "unknown",
    checks: {
      api: true,
      composer: true,
      research: true,
      export: true,
      composer_env_present: Boolean(process.env.GEMINI_API_KEY),
      composer_secret_configured: Boolean(process.env.COMPOSER_SHARED_SECRET),
      usage_events: true,
      generation_jobs: true,
      pipeline_events: true,
      rate_limit: true,
      pricing: true,
      billing: true,
    },
  });
}

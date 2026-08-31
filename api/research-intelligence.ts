function importDiagnostic(error: unknown) {
  const err = error as {
    name?: string;
    code?: string;
    message?: string;
  };

  if (process.env.VERCEL_ENV !== "preview") {
    return undefined;
  }

  return {
    name: String(err?.name || "Error"),
    code: String(err?.code || ""),
    message: String(
      err?.message || "Unknown import error"
    ).slice(0, 1200),
  };
}
export const maxDuration = 300;

export default async function handler(req: any, res: any) {
  const route = String(req.query?.__route || "");

  switch (route) {
    case "jobs": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/research-jobs.js");
      } catch (error) {
        console.error("[research router] import jobs failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "jobs",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    case "worker": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/research-worker.js");
      } catch (error) {
        console.error("[research router] import worker failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "worker",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    default:
      return res.status(404).json({
        ok: false,
        error: "Unknown Research Intelligence route",
      });
  }
}

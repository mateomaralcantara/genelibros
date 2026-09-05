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
    case "audit": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/manuscript-audit.js");
      } catch (error) {
        console.error("[refinery router] import audit failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "audit",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    case "audit-jobs": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/manuscript-audit-jobs.js");
      } catch (error) {
        console.error("[refinery router] import audit-jobs failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "audit-jobs",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    case "refinement-apply": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinement-apply.js");
      } catch (error) {
        console.error("[refinery router] import refinement-apply failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinement-apply",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    case "refinement-jobs": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinement-jobs.js");
      } catch (error) {
        console.error("[refinery router] import refinement-jobs failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinement-jobs",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    case "refinement-worker": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinement-worker.js");
      } catch (error) {
        console.error("[refinery router] import refinement-worker failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinement-worker",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    case "refinery-worker": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinery-worker.js");
      } catch (error) {
        console.error("[refinery router] import refinery-worker failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinery-worker",
          diagnostic: importDiagnostic(error),
        });
      }

      return mod.default(req, res);
    }

    default:
      return res.status(404).json({
        ok: false,
        error: "Unknown Refinery route",
      });
  }
}

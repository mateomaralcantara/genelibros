export const maxDuration = 300;

export default async function handler(req: any, res: any) {
  const route = String(req.query?.__route || "");

  switch (route) {
    case "audit": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/manuscript-audit");
      } catch (error) {
        console.error("[refinery router] import audit failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "audit",
        });
      }

      return mod.default(req, res);
    }

    case "audit-jobs": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/manuscript-audit-jobs");
      } catch (error) {
        console.error("[refinery router] import audit-jobs failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "audit-jobs",
        });
      }

      return mod.default(req, res);
    }

    case "refinement-apply": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinement-apply");
      } catch (error) {
        console.error("[refinery router] import refinement-apply failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinement-apply",
        });
      }

      return mod.default(req, res);
    }

    case "refinement-jobs": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinement-jobs");
      } catch (error) {
        console.error("[refinery router] import refinement-jobs failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinement-jobs",
        });
      }

      return mod.default(req, res);
    }

    case "refinement-worker": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinement-worker");
      } catch (error) {
        console.error("[refinery router] import refinement-worker failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinement-worker",
        });
      }

      return mod.default(req, res);
    }

    case "refinery-worker": {
      let mod;
      try {
        mod = await import("../src/server/vercel-handlers/refinery-worker");
      } catch (error) {
        console.error("[refinery router] import refinery-worker failed", error);
        return res.status(500).json({
          ok: false,
          error: "ROUTER_IMPORT_FAILED",
          route: "refinery-worker",
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

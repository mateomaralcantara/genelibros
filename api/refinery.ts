import manuscriptAudit from "../src/server/vercel-handlers/manuscript-audit";
import manuscriptAuditJobs from "../src/server/vercel-handlers/manuscript-audit-jobs";
import refinementApply from "../src/server/vercel-handlers/refinement-apply";
import refinementJobs from "../src/server/vercel-handlers/refinement-jobs";
import refinementWorker from "../src/server/vercel-handlers/refinement-worker";
import refineryWorker from "../src/server/vercel-handlers/refinery-worker";

export const maxDuration = 300;

export default async function handler(req: any, res: any) {
  const route = String(req.query?.__route || "");

  switch (route) {
    case "audit":
      return manuscriptAudit(req, res);
    case "audit-jobs":
      return manuscriptAuditJobs(req, res);
    case "refinement-apply":
      return refinementApply(req, res);
    case "refinement-jobs":
      return refinementJobs(req, res);
    case "refinement-worker":
      return refinementWorker(req, res);
    case "refinery-worker":
      return refineryWorker(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: "Unknown Refinery route",
      });
  }
}

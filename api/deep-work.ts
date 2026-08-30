import deepWorkApply from "../src/server/vercel-handlers/deep-work-apply";
import deepWorkJobs from "../src/server/vercel-handlers/deep-work-jobs";
import deepWorkWorker from "../src/server/vercel-handlers/deep-work-worker";

export const maxDuration = 300;

export default async function handler(req: any, res: any) {
  const route = String(req.query?.__route || "");

  switch (route) {
    case "apply":
      return deepWorkApply(req, res);
    case "jobs":
      return deepWorkJobs(req, res);
    case "worker":
      return deepWorkWorker(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: "Unknown Deep Work route",
      });
  }
}

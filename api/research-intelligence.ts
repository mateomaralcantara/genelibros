import researchJobs from "../src/server/vercel-handlers/research-jobs";
import researchWorker from "../src/server/vercel-handlers/research-worker";

export const maxDuration = 300;

export default async function handler(req: any, res: any) {
  const route = String(req.query?.__route || "");

  switch (route) {
    case "jobs":
      return researchJobs(req, res);
    case "worker":
      return researchWorker(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: "Unknown Research Intelligence route",
      });
  }
}

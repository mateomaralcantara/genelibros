import fs from "node:fs";
import path from "node:path";

const file = path.resolve("api/research-intelligence.ts");

let source = fs.readFileSync(file, "utf8");

const marker = "GENELIBROS_RESEARCH_ROUTER_PREAUTH";

if (source.includes(marker)) {
  console.log("[Genelibros] Research router pre-auth ya instalado.");
  process.exit(0);
}

const pattern = /case\s+["']worker["']\s*:\s*\{/;
const match = source.match(pattern);

if (!match) {
  throw new Error(
    "RESEARCH_ROUTER_PREAUTH: no se encontró case worker."
  );
}

const replacement = `${match[0]}

      /* ${marker} */
      const expectedWorkerSecret = String(
        process.env.RESEARCH_WORKER_SECRET ||
        process.env.DEEP_WORKER_SECRET ||
        process.env.REFINERY_WORKER_SECRET ||
        process.env.OS4_WORKER_SECRET ||
        ""
      );

      const suppliedWorkerSecret = String(
        req.headers?.["x-research-worker-secret"] ||
        req.headers?.authorization ||
        ""
      ).replace(/^Bearer\\s+/i, "");

      if (!expectedWorkerSecret) {
        return res.status(500).json({
          ok: false,
          error: "RESEARCH_WORKER_SECRET_MISSING",
        });
      }

      if (suppliedWorkerSecret !== expectedWorkerSecret) {
        return res.status(401).json({
          ok: false,
          error: "Worker no autorizado.",
        });
      }
`;

source = source.replace(match[0], replacement);

fs.writeFileSync(file, source, "utf8");

console.log("[Genelibros] Research router pre-auth instalado.");

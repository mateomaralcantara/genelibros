import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

function run(command, args, label) {
  console.log(`\n[Genelibros] FINAL GATE > ${label}`);
  const r = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) {
    console.error(`[Genelibros] FINAL GATE FAIL — ${label}`);
    process.exit(r.status ?? 1);
  }
}

function runNode(script, args = []) {
  run(process.execPath, [script, ...args], `node ${script}${args.length ? ` ${args.join(" ")}` : ""}`);
}

function runNpm(args) {
  const isWindows = process.platform === "win32";
  if (isWindows) {
    const command = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    run(command, ["/d", "/s", "/c", `npm ${args.join(" ")}`], `npm ${args.join(" ")}`);
  } else {
    run("npm", args, `npm ${args.join(" ")}`);
  }
}

function capture(command, args) {
  const r = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) {
    process.stderr.write(r.stderr || "");
    process.exit(r.status ?? 1);
  }
  return String(r.stdout || "");
}

console.log("\n================================================");
console.log(" GENELIBROS — FINAL RELEASE GATE");
console.log(" ZERO LLM / ZERO PROVIDER CALLS");
console.log("================================================");

const requiredFiles = [
  "scripts/research-chapter-preflight.mjs",
  "scripts/research-topic-resolution-tests.mjs",
  "scripts/deep-production-v1-contract.mjs",
  "scripts/run-deep-production-v1.mjs",
  "scripts/run-deep-production-repair-v1.mjs",
  "scripts/deep-production-book.mjs",
  "scripts/deep-production-book-universal-v1.mjs",
  "scripts/run-deep-production-book-universal-v1.mjs",
  "scripts/research-curate-official-evidence.mjs",
  "src/server/research-document-ingestion.ts",
  "vercel.json",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.resolve(process.cwd(), file))) {
    console.error(`[Genelibros] FINAL GATE FAIL — falta ${file}`);
    process.exit(2);
  }
}
console.log(`[Genelibros] Archivos críticos: ${requiredFiles.length}/${requiredFiles.length} presentes.`);

const tracked = capture("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
const forbidden = tracked.filter((file) =>
  file === ".env.local" ||
  file.startsWith(".tools/") ||
  file.startsWith(".hardening-backups/") ||
  file.includes("node_modules/")
);
if (forbidden.length) {
  console.error("[Genelibros] FINAL GATE FAIL — archivos sensibles/prohibidos rastreados:");
  for (const file of forbidden) console.error(` - ${file}`);
  process.exit(3);
}
console.log("[Genelibros] Seguridad Git: OK.");

const vercel = JSON.parse(fs.readFileSync(path.resolve("vercel.json"), "utf8"));
const rewrites = Array.isArray(vercel?.rewrites) ? vercel.rewrites : [];
const requiredRoutes = ["/api/deep-work-worker", "/api/deep-work-jobs", "/api/deep-work-apply", "/api/research-worker", "/api/research-jobs"];
const routeSources = new Set(rewrites.map((r) => String(r?.source || "")));
for (const route of requiredRoutes) {
  if (!routeSources.has(route)) {
    console.error(`[Genelibros] FINAL GATE FAIL — falta rewrite ${route}`);
    process.exit(4);
  }
}
console.log(`[Genelibros] Vercel rewrites críticos: ${requiredRoutes.length}/${requiredRoutes.length} OK.`);

runNode("scripts/patch-research-gap-source-cap.mjs");
runNode("scripts/patch-research-document-ingestion.mjs");
runNode("scripts/patch-research-evidence-semantics.mjs");
runNode("scripts/patch-research-credit-guard.mjs");
runNode("scripts/patch-deep-work-v58.mjs");
runNode("scripts/patch-deep-work-credit-guard.mjs");
runNode("scripts/patch-deep-work-model-compat.mjs");
runNode("scripts/patch-deep-work-json-sanitizer.mjs");
runNode("scripts/patch-deep-work-longform-text.mjs");
runNode("scripts/patch-deep-work-research-override.mjs");

runNode("scripts/research-topic-resolution-tests.mjs");
runNode("scripts/research-document-ingestion-tests.mjs");
runNode("scripts/research-evidence-semantics-tests.mjs");
runNode("scripts/research-credit-guard-tests.mjs");
runNode("scripts/research-official-curation-tests.mjs");
runNode("scripts/deep-work-json-sanitizer-tests.mjs");
runNode("scripts/deep-work-longform-text-tests.mjs");
runNode("scripts/deep-work-credit-guard-tests.mjs");
runNode("scripts/deep-production-v1-tests.mjs");
runNode("scripts/deep-production-book-v1-tests.mjs");
runNode("scripts/deep-production-book-universal-v1-tests.mjs");

runNpm(["run", "typecheck"]);
runNpm(["run", "build"]);
run("git", ["diff", "--check"], "git diff --check");

console.log("\n================================================");
console.log(" ✅ GENELIBROS — RELEASE CANDIDATE READY");
console.log("================================================");
console.log({
  llmCalls: 0,
  providerCalls: 0,
  typecheck: "PASS",
  build: "PASS",
  gitSecurity: "PASS",
  vercelRoutes: "PASS",
  research: "PASS",
  productionV1: "PASS",
  bookProductionV1: "PASS",
  universalBookV1: "PASS",
});

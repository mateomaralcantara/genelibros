import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const execute = args.includes("--execute");

function runNode(script, scriptArgs = []) {
  console.log(`\n[Genelibros] > node ${script} ${scriptArgs.join(" ")}`.trim());
  const r = spawnSync(process.execPath, [script, ...scriptArgs], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}
function runNpm(npmArgs) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npm";
  const commandArgs = isWindows ? ["/d", "/s", "/c", `npm ${npmArgs.join(" ")}`] : npmArgs;
  console.log(`\n[Genelibros] > npm ${npmArgs.join(" ")}`);
  const r = spawnSync(command, commandArgs, { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

console.log("\n================================================");
console.log(" GENELIBROS — UNIVERSAL BOOK V1");
console.log(" Research → Production → Quality → Apply");
console.log("================================================");
console.log("[Genelibros] Primera pasada Research única por capítulo; no hay loops automáticos.");
console.log("[Genelibros] Production mantiene threshold 9.3 y 0 reparaciones automáticas.");
console.log(`[Genelibros] Modo: ${execute ? "EXECUTE" : "PREFLIGHT ONLY (0 LLM)"}.`);

runNode("scripts/patch-research-gap-source-cap.mjs");
runNode("scripts/patch-research-document-ingestion.mjs");
runNode("scripts/patch-research-evidence-semantics.mjs");
runNode("scripts/patch-research-credit-guard.mjs");
runNode("scripts/deep-production-book-universal-v1-tests.mjs");
runNode("scripts/research-topic-resolution-tests.mjs");
runNode("scripts/research-document-ingestion-tests.mjs");
runNode("scripts/research-evidence-semantics-tests.mjs");
runNode("scripts/research-credit-guard-tests.mjs");
runNode("scripts/deep-production-v1-tests.mjs");
runNpm(["run", "typecheck"]);
runNode("scripts/deep-production-book-universal-v1.mjs", args);

console.log(`\n[Genelibros] UNIVERSAL BOOK V1 ${execute ? "terminado o pausado de forma segura" : "preflight terminado"}.`);
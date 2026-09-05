import { spawnSync } from "node:child_process";
import process from "node:process";

const rawArgs = process.argv.slice(2);
const execute = rawArgs.includes("--execute");

function runNode(script, args = []) {
  console.log(`\n[Genelibros] > node ${script} ${args.join(" ")}`.trim());
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}
function runNpm(args) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npm";
  const commandArgs = isWindows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
  console.log(`\n[Genelibros] > npm ${args.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

console.log("\n================================================");
console.log(" GENELIBROS — BOOK PRODUCTION V1 / SEQUENTIAL");
console.log("================================================");
console.log("[Genelibros] Capítulos secuenciales: APPLY de N antes de generar N+1.");
console.log("[Genelibros] 0 repairs automáticos; REJECTED pausa el libro y preserva progreso.");
console.log(`[Genelibros] Modo: ${execute ? "EXECUTE" : "PREFLIGHT ONLY (0 LLM)"}.`);

runNode("scripts/deep-production-book-v1-tests.mjs");
runNode("scripts/deep-production-v1-tests.mjs");
runNpm(["run", "typecheck"]);
runNode("scripts/deep-production-book.mjs", rawArgs);

console.log(`\n[Genelibros] BOOK PRODUCTION V1 ${execute ? "terminado o pausado de forma segura" : "preflight terminado"}.`);

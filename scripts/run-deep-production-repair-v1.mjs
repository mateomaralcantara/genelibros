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
console.log(" GENELIBROS — PRODUCTION V1 / EXPLICIT REPAIR");
console.log("================================================");
console.log("[Genelibros] Máximo: 1 DIRECT REPAIR + 1 QUALITY; hard cap final 9.");
console.log("[Genelibros] La invocación se reserva antes de llamar al proveedor: no hay retries ciegos.");
console.log(`[Genelibros] Modo: ${execute ? "EXECUTE" : "PREFLIGHT ONLY (0 LLM)"}.`);

runNode("scripts/patch-deep-work-v58.mjs");
runNode("scripts/patch-deep-work-credit-guard.mjs");
runNode("scripts/patch-deep-work-model-compat.mjs");
runNode("scripts/patch-deep-work-json-sanitizer.mjs");
runNode("scripts/patch-deep-work-longform-text.mjs");
runNode("scripts/patch-deep-work-research-override.mjs");

runNode("scripts/deep-work-json-sanitizer-tests.mjs");
runNode("scripts/deep-work-longform-text-tests.mjs");
runNode("scripts/deep-work-credit-guard-tests.mjs");
runNode("scripts/deep-production-v1-tests.mjs");
runNpm(["run", "typecheck"]);

runNode("scripts/deep-production-repair.mjs", rawArgs);

if (!execute) {
  console.log("\n[Genelibros] PRODUCTION V1 REPAIR PREFLIGHT terminado. 0 llamadas LLM.");
  process.exit(0);
}

runNode("scripts/run-deep-final-local-stack.mjs");
runNode("scripts/deep-production-apply.mjs", rawArgs.filter((arg) => arg !== "--execute"));

console.log("\n[Genelibros] PRODUCTION V1 reparación final terminada.");

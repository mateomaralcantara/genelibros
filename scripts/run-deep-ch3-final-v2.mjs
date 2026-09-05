import { spawnSync } from "node:child_process";
import process from "node:process";

function runNode(script, args = []) {
  console.log(`\n[Genelibros] > node ${script} ${args.join(" ")}`.trim());
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

function runNpm(args) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npm";
  const commandArgs = isWindows
    ? ["/d", "/s", "/c", `npm ${args.join(" ")}`]
    : args;
  console.log(`\n[Genelibros] > npm ${args.join(" ")}`);
  const r = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

console.log("\n================================================");
console.log(" GENELIBROS — CHAPTER 3 FINAL V2 / LONGFORM SAFE");
console.log("================================================");
console.log("[Genelibros] Reutiliza el mismo job y dossier. No crea Research nuevo.");
console.log("[Genelibros] Draft A/B + Synthesis = texto plano; Critic/Quality = JSON corto.");
console.log("[Genelibros] Hard cap del job permanece en 7 llamadas registradas.\n");

runNode("scripts/patch-deep-work-v58.mjs");
runNode("scripts/patch-deep-work-credit-guard.mjs");
runNode("scripts/patch-deep-work-model-compat.mjs");
runNode("scripts/patch-deep-work-json-sanitizer.mjs");
runNode("scripts/patch-deep-work-longform-text.mjs");
runNode("scripts/patch-deep-work-research-override.mjs");

runNode("scripts/deep-work-json-sanitizer-tests.mjs");
runNode("scripts/deep-work-longform-text-tests.mjs");
runNode("scripts/deep-work-credit-guard-tests.mjs");
runNode("scripts/deep-work-final-override-tests.mjs");
runNpm(["run", "typecheck"]);

runNode("scripts/deep-work-chapter3-final.mjs");
runNode("scripts/run-deep-final-local-stack.mjs");
runNode("scripts/apply-deep-work-chapter3-approved.mjs");

console.log("\n[Genelibros] CHAPTER 3 FINAL V2 terminado.");

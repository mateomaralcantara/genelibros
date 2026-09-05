import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function loadEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[m[1]] = value;
  }
  return env;
}

const root = process.cwd();
const localEnv = loadEnvFile(path.resolve(root, ".env.local"));
const env = { ...process.env, ...localEnv };
const requiredGroups = [
  ["DEEP_WORKER_SECRET", "REFINERY_WORKER_SECRET", "OS4_WORKER_SECRET"],
  ["SUPABASE_URL", "VITE_SUPABASE_URL"],
  ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"],
  ["GEMINI_API_KEY", "VITE_GEMINI_API_KEY"],
];
const missing = requiredGroups
  .filter((group) => !group.some((key) => String(env[key] || "").trim()))
  .map((group) => group.join("/"));
if (missing.length) {
  console.error("[Genelibros] Deep final bloqueado: faltan variables en .env.local:");
  for (const item of missing) console.error(` - ${item}`);
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(2);
}

const isWindows = process.platform === "win32";
const shell = isWindows ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npm";
const devArgs = isWindows ? ["/d", "/s", "/c", "npm run deep:11c:dev"] : ["run", "deep:11c:dev"];
const workerArgs = isWindows ? ["/d", "/s", "/c", "npm run deep:11c:worker"] : ["run", "deep:11c:worker"];

console.log("\n================================================");
console.log(" GENELIBROS — DEEP FINAL ONE-COMMAND STACK");
console.log("================================================");
console.log("[Genelibros] Configuración validada. Iniciando API en puerto 3000...");

const dev = spawn(shell, devArgs, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"], windowsHide: false });
function killDev() {
  if (!dev || dev.killed) return;
  try {
    if (isWindows && dev.pid) spawnSync("taskkill", ["/pid", String(dev.pid), "/t", "/f"], { stdio: "ignore" });
    else dev.kill("SIGTERM");
  } catch {}
}
process.on("SIGINT", () => { killDev(); process.exit(130); });
process.on("SIGTERM", () => { killDev(); process.exit(143); });

let exited = false;
dev.on("exit", () => { exited = true; });
let ready = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  if (exited) break;
  try {
    const r = await fetch("http://localhost:3000/api/deep-work-worker", { method: "GET" });
    if (r.status === 405 || r.status === 401 || r.status === 200) { ready = true; break; }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  killDev();
  console.error("[Genelibros] /api/deep-work-worker no quedó disponible. Worker NO ejecutado.");
  process.exit(3);
}

console.log("[Genelibros] Ruta Deep Work disponible. Ejecutando worker protegido...\n");
const worker = spawn(shell, workerArgs, { cwd: root, env, stdio: "inherit", windowsHide: false });
const code = await new Promise((resolve) => {
  worker.on("exit", (c) => resolve(c ?? 0));
  worker.on("error", () => resolve(4));
});
killDev();
if (code !== 0) {
  console.error(`[Genelibros] Deep worker terminó con código ${code}.`);
  process.exit(code);
}
console.log("\n[Genelibros] Deep final terminado. Servidor local cerrado.");

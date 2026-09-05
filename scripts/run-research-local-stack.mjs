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
  ["RESEARCH_WORKER_SECRET", "DEEP_WORKER_SECRET", "REFINERY_WORKER_SECRET", "OS4_WORKER_SECRET"],
  ["SUPABASE_URL", "VITE_SUPABASE_URL"],
  ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"],
  ["GEMINI_API_KEY", "VITE_GEMINI_API_KEY"],
];
const missing = requiredGroups
  .filter((group) => !group.some((key) => String(env[key] || "").trim()))
  .map((group) => group.join("/"));
if (missing.length) {
  console.error("[Genelibros] Research RUN bloqueado: faltan variables en .env.local:");
  for (const item of missing) console.error(` - ${item}`);
  console.error("[Genelibros] 0 llamadas LLM realizadas.");
  process.exit(2);
}

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npm";
const devArgs = isWindows ? ["/d", "/s", "/c", "npm run research:11d:dev"] : ["run", "research:11d:dev"];
const workerArgs = isWindows ? ["/d", "/s", "/c", "npm run research:11d:worker"] : ["run", "research:11d:worker"];

console.log("\n================================================");
console.log(" GENELIBROS — RESEARCH 11D ONE-COMMAND RUN");
console.log("================================================");
console.log("[Genelibros] Configuración local validada sin imprimir secretos.");
console.log("[Genelibros] Arrancando API local protegida en puerto 3000...");

const dev = spawn(npmCommand, devArgs, {
  cwd: root,
  env,
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: false,
});

function killDev() {
  if (!dev || dev.killed) return;
  try {
    if (isWindows && dev.pid) {
      spawnSync("taskkill", ["/pid", String(dev.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      dev.kill("SIGTERM");
    }
  } catch {}
}

process.on("SIGINT", () => { killDev(); process.exit(130); });
process.on("SIGTERM", () => { killDev(); process.exit(143); });

let devExited = false;
let devExitCode = null;
dev.on("exit", (code) => {
  devExited = true;
  devExitCode = code;
});

dev.on("error", (error) => {
  console.error(`[Genelibros] No se pudo iniciar Research Dev: ${error.message}`);
});

let ready = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  if (devExited) break;
  try {
    const response = await fetch("http://localhost:3000/api/research-worker", { method: "GET" });
    if (response.status === 405 || response.status === 401 || response.status === 200) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!ready) {
  killDev();
  console.error(`[Genelibros] /api/research-worker no quedó disponible en puerto 3000. exit=${devExitCode ?? "running"}`);
  console.error("[Genelibros] Worker NO ejecutado; no se autorizó consumo LLM desde este comando.");
  process.exit(3);
}

console.log("[Genelibros] Ruta /api/research-worker disponible. Ejecutando worker protegido...\n");

const worker = spawn(npmCommand, workerArgs, {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: false,
});

const workerCode = await new Promise((resolve) => {
  worker.on("exit", (code) => resolve(code ?? 0));
  worker.on("error", () => resolve(4));
});

killDev();

if (workerCode !== 0) {
  console.error(`[Genelibros] Research Worker terminó con código ${workerCode}.`);
  process.exit(workerCode);
}

console.log("\n[Genelibros] Research RUN finalizado. Servidor local cerrado.");

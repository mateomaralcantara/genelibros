import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function loadEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    env[m[1]] = value;
  }
  return env;
}

const root = process.cwd();
const localEnv = loadEnvFile(path.resolve(root, ".env.local"));
const requiredGroups = [
  ["DEEP_WORKER_SECRET", "REFINERY_WORKER_SECRET", "OS4_WORKER_SECRET"],
  ["SUPABASE_URL", "VITE_SUPABASE_URL"],
  ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"],
  ["GEMINI_API_KEY", "VITE_GEMINI_API_KEY"],
];

const merged = { ...process.env, ...localEnv };
const missing = requiredGroups
  .filter((group) => !group.some((key) => String(merged[key] || "").trim()))
  .map((group) => group.join("/"));

if (missing.length) {
  console.error("[Genelibros] No se inicia Vercel Dev: faltan variables server-side en .env.local:");
  for (const name of missing) console.error(` - ${name}`);
  process.exit(2);
}

console.log("[Genelibros] .env.local cargado en el proceso de Vercel Dev.");
console.log("[Genelibros] Variables sensibles detectadas sin imprimir sus valores.");
console.log("[Genelibros] Iniciando http://localhost:3000 ...\n");

const command = process.platform === "win32" ? "vercel.cmd" : "vercel";
const child = spawn(command, ["dev", "--listen", "3000"], {
  cwd: root,
  env: merged,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`[Genelibros] No se pudo iniciar Vercel CLI: ${error.message}`);
  console.error("Verifica con: vercel --version");
  process.exit(3);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

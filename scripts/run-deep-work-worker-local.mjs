import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv(path.resolve(".env.local"));
const base = process.env.DEEP_WORKER_URL || "http://localhost:3000/api/deep-work-worker";
const secret = process.env.DEEP_WORKER_SECRET || process.env.REFINERY_WORKER_SECRET || process.env.OS4_WORKER_SECRET || "";
if (!secret) {
  console.error("Falta DEEP_WORKER_SECRET (o fallback REFINERY_WORKER_SECRET/OS4_WORKER_SECRET) en .env.local.");
  process.exit(2);
}

console.log("\n==============================================");
console.log(" GENELIBROS 11C — LOCAL DEEP WORK ENGINE");
console.log("==============================================");
console.log(`Worker: ${base}\n`);

let tick = 0;
while (true) {
  tick += 1;
  let response;
  try {
    response = await fetch(base, { method: "POST", headers: { "x-deep-worker-secret": secret } });
  } catch (error) {
    console.error(`[TICK ${String(tick).padStart(2, "0")}] NETWORK ERROR: ${error.message}`);
    process.exit(3);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok) {
    console.error(`[TICK ${String(tick).padStart(2, "0")}] HTTP ${response.status}`, body);
    const message = String(body?.error || body?.message || "");
    const fatalConfig =
      response.status === 401 ||
      /Falta DEEP_WORKER_SECRET|REFINERY_WORKER_SECRET|OS4_WORKER_SECRET|credenciales server-side de Supabase|GEMINI_API_KEY/i.test(message);
    if (fatalConfig) {
      console.error("[Genelibros] Error de configuración local. Worker detenido para evitar reintentos inútiles.");
      process.exit(5);
    }
    if (body?.status === "DEAD_LETTER") process.exit(4);
    await new Promise((r) => setTimeout(r, 2500));
    continue;
  }
  if (body?.idle) {
    console.log("No hay Deep Work jobs activos.");
    break;
  }
  const extra = body?.quality ? ` quality=${body.quality} verdict=${body.verdict}` : "";
  console.log(`[TICK ${String(tick).padStart(2, "0")}] step=${body.step} -> ${body.next} progress=${body.progress}%${extra}`);
  if (body?.next === "COMPLETED") break;
  await new Promise((r) => setTimeout(r, 400));
}

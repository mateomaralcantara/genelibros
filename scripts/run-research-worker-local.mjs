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

const url = process.env.RESEARCH_WORKER_URL || "http://localhost:3000/api/research-worker";
const secret = String(process.env.RESEARCH_WORKER_SECRET || "").trim();

if (!secret) {
  console.error("[Genelibros] Falta RESEARCH_WORKER_SECRET en .env.local. Worker detenido antes de hacer llamadas de red/LLM.");
  process.exit(2);
}

console.log("\n================================================");
console.log(" GENELIBROS 11D — LOCAL RESEARCH INTELLIGENCE");
console.log("================================================");
console.log("[Genelibros] .env.local cargado para Research Worker.");
console.log("[Genelibros] RESEARCH_WORKER_SECRET detectado sin imprimir su valor.");
console.log("Worker:", url, "\n");

let tick = 0;
let idle = 0;

while (tick < 250) {
  tick += 1;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-research-worker-secret": secret },
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (!r.ok) {
      console.log(`[TICK ${String(tick).padStart(2, "0")}] HTTP ${r.status}`, body);
      const message = String(body?.error || body?.message || "");
      const fatalConfig =
        r.status === 401 ||
        /Faltan variables del Research worker|RESEARCH_WORKER_SECRET|credenciales server-side de Supabase|GEMINI_API_KEY/i.test(message);
      if (fatalConfig) {
        console.error("[Genelibros] Error fatal de configuración/autenticación. Worker detenido para evitar reintentos inútiles.");
        process.exit(5);
      }
      await new Promise((x) => setTimeout(x, 12000));
      continue;
    }

    if (body?.idle) {
      idle += 1;
      if (idle >= 3) {
        console.log("No hay Research jobs activos.");
        break;
      }
      await new Promise((x) => setTimeout(x, 5000));
      continue;
    }

    idle = 0;
    const result = body?.result || {};
    console.log(
      `[TICK ${String(tick).padStart(2, "0")}] step=${body?.step || "?"} -> ${body?.next_step || body?.status || "?"} progress=${body?.progress ?? "?"}%` +
      (result.sources != null ? ` sources=${result.sources}` : "") +
      (result.evidence_total != null ? ` evidence=${result.evidence_total}` : "") +
      (result.claims != null ? ` claims=${result.claims}` : "") +
      (result.ready_for_writing != null ? ` ready=${result.ready_for_writing}` : "")
    );

    if (body?.status === "COMPLETED") {
      console.log("\n✅ RESEARCH INTELLIGENCE COMPLETED");
      console.log("Dossier:", result.dossier_id);
      console.log("Ready for writing:", result.readyForWriting);
      console.log("Coverage:", result.coverageScore);
      console.log("Evidence:", result.evidenceScore);
      console.log("Factual confidence:", result.factualConfidenceScore);
      console.log("Sources:", result.sources);
      console.log("Claims:", result.claims);
      console.log("Gaps:", result.gaps);
      console.log("AI calls:", result?.usage?.calls);
      console.log("Tokens:", result?.usage?.totalTokens);
      if (result?.budgetGuard) console.log("Budget guard:", result.budgetGuard);
      if (result?.gapClosureStopReason) console.log("Stop reason:", result.gapClosureStopReason);
      break;
    }

    await new Promise((x) => setTimeout(x, 1200));
  } catch (e) {
    console.log(`[TICK ${String(tick).padStart(2, "0")}] NETWORK ERROR:`, e?.message || e);
    process.exit(6);
  }
}

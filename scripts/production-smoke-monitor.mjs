// ============================================================
// GENELIBROS — Monitor de producción (0 LLM, 0 coste)
//
// Llama a cada función de producción SIN sesión. Una función sana
// responde 4xx (401 no autorizado, 400 datos inválidos, 405 método).
// Una función caída responde 5xx (p. ej. FUNCTION_INVOCATION_FAILED por
// un import roto, o falta de variables de entorno) o no responde.
//
// Uso:  PRODUCTION_URL=https://gene.libroseller.com node scripts/production-smoke-monitor.mjs
// Salida: tabla legible + resumen JSON en MONITOR_REPORT (si se define).
// Código de salida 1 si algo está caído.
// ============================================================

import fs from "node:fs";
import process from "node:process";

const BASE = String(process.env.PRODUCTION_URL || "https://gene.libroseller.com").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.MONITOR_TIMEOUT_MS || 25000);
const RETRY_DELAY_MS = Number(process.env.MONITOR_RETRY_DELAY_MS || 5000);

/** [método, ruta, descripción] — ninguna llamada lleva sesión: nunca se ejecuta trabajo real. */
const CHECKS = [
  ["GET", "/api/health", "Salud general"],
  ["POST", "/api/composer", "Generación de texto"],
  ["POST", "/api/os4", "Agentes OS4"],
  ["POST", "/api/os4-jobs", "Cola OS4"],
  ["POST", "/api/os4-worker", "Worker OS4"],
  ["POST", "/api/research", "Investigación web"],
  ["POST", "/api/research-jobs", "Cola de investigación"],
  ["POST", "/api/research-worker", "Worker de investigación"],
  ["POST", "/api/deep-work-jobs", "Cola de mejora profunda"],
  ["POST", "/api/deep-work-apply", "Aplicar mejora profunda"],
  ["POST", "/api/deep-work-worker", "Worker de mejora profunda"],
  ["POST", "/api/manuscript-audit", "Auditoría de manuscrito"],
  ["POST", "/api/manuscript-audit-jobs", "Cola de auditoría"],
  ["POST", "/api/refinement-jobs", "Cola de refinado"],
  ["POST", "/api/refinement-apply", "Aplicar refinado"],
  ["POST", "/api/refinement-worker", "Worker de refinado"],
  ["POST", "/api/refinery-worker", "Worker de refinery"],
  ["POST", "/api/export", "Exportación"],
  ["GET", "/", "Página principal"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(method, path) {
  const started = Date.now();
  try {
    const response = await fetch(BASE + path, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? "{}" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = (await response.text()).slice(0, 2000);
    const ms = Date.now() - started;
    const vercelError = text.match(/FUNCTION_INVOCATION_FAILED|FUNCTION_INVOCATION_TIMEOUT|NO_RESPONSE_FROM_FUNCTION|DEPLOYMENT_NOT_FOUND/)?.[0] || "";
    const expectOk = path === "/api/health" || path === "/";
    const healthy = expectOk ? response.status === 200 : response.status < 500 && !vercelError;
    let detail = vercelError;
    if (!healthy && !detail) {
      try {
        detail = String(JSON.parse(text)?.error || "").slice(0, 160);
      } catch {
        detail = text.replace(/\s+/g, " ").slice(0, 160);
      }
    }
    return { status: response.status, ms, healthy, detail };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, healthy: false, detail: String(error?.name === "TimeoutError" ? `Sin respuesta en ${TIMEOUT_MS / 1000}s` : error?.message || error) };
  }
}

const results = [];
for (const [method, path, label] of CHECKS) {
  let result = await probe(method, path);
  if (!result.healthy) {
    // Reintento único para descartar arranques en frío o fallos de red puntuales.
    await sleep(RETRY_DELAY_MS);
    result = await probe(method, path);
  }
  results.push({ method, path, label, ...result });
  const icon = result.healthy ? "✅" : "❌";
  console.log(`${icon} ${String(result.status).padEnd(3)} ${method.padEnd(4)} ${path.padEnd(28)} ${String(result.ms).padStart(5)} ms  ${label}${result.detail ? "  — " + result.detail : ""}`);
}

const failed = results.filter((r) => !r.healthy);
const report = {
  base: BASE,
  checked_at: new Date().toISOString(),
  total: results.length,
  failed: failed.length,
  results,
};

if (process.env.MONITOR_REPORT) {
  fs.writeFileSync(process.env.MONITOR_REPORT, JSON.stringify(report, null, 2));
}

console.log(failed.length ? `\n❌ ${failed.length}/${results.length} comprobaciones fallan en ${BASE}` : `\n✅ ${results.length}/${results.length} comprobaciones OK en ${BASE}`);
process.exit(failed.length ? 1 : 0);

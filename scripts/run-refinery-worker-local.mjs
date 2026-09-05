import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, name, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[name]) process.env[name] = value;
  }
}

const root = process.cwd();
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const url =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

const secret =
  process.env.REFINERY_WORKER_SECRET ||
  process.env.OS4_WORKER_SECRET;

const workerUrl =
  process.env.REFINERY_WORKER_URL ||
  "http://localhost:3000/api/refinery-worker";

const args = process.argv.slice(2);
const jobIndex = args.indexOf("--job");
const explicitJobId =
  jobIndex >= 0 ? String(args[jobIndex + 1] || "").trim() : "";

if (!url) throw new Error("Falta SUPABASE_URL.");
if (!serviceKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY.");
if (!secret) {
  throw new Error(
    "Falta REFINERY_WORKER_SECRET u OS4_WORKER_SECRET.",
  );
}

const supabase = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function currentJob() {
  if (explicitJobId) {
    const { data, error } = await supabase
      .from("manuscript_audit_jobs")
      .select(
        "id,project_id,status,progress,checkpoint,attempts,max_attempts,last_error,next_retry_at,result",
      )
      .eq("id", explicitJobId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  const { data, error } = await supabase
    .from("manuscript_audit_jobs")
    .select(
      "id,project_id,status,progress,checkpoint,attempts,max_attempts,last_error,next_retry_at,result",
    )
    .in("status", [
      "QUEUED",
      "RUNNING",
      "RETRYING",
      "FAILED",
    ])
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function callWorker() {
  const response = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-os4-worker-secret": secret,
    },
    body: JSON.stringify({
      worker_id: `local-refinery-${process.pid}`,
    }),
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Worker respondió texto no JSON (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(
      body?.error || `Worker HTTP ${response.status}`,
    );
  }

  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log("");
console.log("==============================================");
console.log(" GENELIBROS 11B.2 — LOCAL DURABLE AUDITOR");
console.log("==============================================");
console.log(`Worker: ${workerUrl}`);
if (explicitJobId) console.log(`Job:    ${explicitJobId}`);
console.log("");

let ticks = 0;

while (true) {
  const before = await currentJob();

  if (!before) {
    console.log("No hay auditorías activas.");
    break;
  }

  if (before.status === "COMPLETED") {
    console.log("");
    console.log("✅ AUDITORÍA DURABLE COMPLETADA");
    console.log(`Job:        ${before.id}`);
    console.log(`Progress:   ${before.progress}%`);
    console.log(
      `Evaluation: ${before.result?.evaluation_id || "pendiente"}`,
    );
    console.log(
      `Score:      ${before.result?.global?.overallScore ?? "—"}`,
    );
    console.log(
      `Verdict:    ${before.result?.global?.verdict ?? "—"}`,
    );
    break;
  }

  if (
    before.status === "DEAD_LETTER" ||
    before.status === "CANCELLED"
  ) {
    throw new Error(
      `Job ${before.status}: ${before.last_error || "sin detalle"}`,
    );
  }

  ticks += 1;

  const cp = before.checkpoint || {};
  const completed = Array.isArray(before.result?.chapters)
    ? before.result.chapters.length
    : 0;
  const total = Number(before.result?.chapterCount || 0);

  console.log(
    `[TICK ${String(ticks).padStart(2, "0")}] ` +
      `status=${before.status} ` +
      `step=${cp.step || "INIT"} ` +
      `chapters=${completed}/${total || "?"} ` +
      `progress=${before.progress}%`,
  );

  try {
    await callWorker();
  } catch (error) {
    console.error(
      `[WARN] ${String(error?.message || error)}`,
    );
  }

  await sleep(1200);

  const after = await currentJob();

  if (
    after?.status === "RETRYING" &&
    after?.last_error
  ) {
    console.log(
      `[RETRYING] attempts=${after.attempts}/${after.max_attempts}: ${after.last_error}`,
    );

    const nextRetry = Date.parse(
      String(after.next_retry_at || ""),
    );

    if (Number.isFinite(nextRetry)) {
      const waitMs = Math.max(
        1200,
        Math.min(65000, nextRetry - Date.now() + 500),
      );
      await sleep(waitMs);
    }
  }
}

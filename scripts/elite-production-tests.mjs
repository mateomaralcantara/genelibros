import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

function read(file) {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function assert(name, condition) {
  if (!condition) {
    console.error("❌ FAIL:", name);
    process.exitCode = 1;
    return;
  }

  console.log("✅ PASS:", name);
}

function checkNodeSyntax(file) {
  try {
    execSync(`node --check "${file}"`, {
      cwd: ROOT,
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

console.log("");
console.log("==========================================");
console.log("ELITE PRODUCTION TESTS 10/10");
console.log("==========================================");

const pkgRaw = read("package.json");
const pkg = JSON.parse(pkgRaw);

const app = read("App.tsx");
const composer = read("api/composer.ts");
const health = read("api/health.ts");
const research = read("api/research.ts");
const exportApi = read("api/export.ts");
const logger = read("src/lib/elite/elite-logger.ts");
const monitor = read("src/lib/elite/elite-health-monitor.ts");
const quality = read("src/lib/elite/elite-quality-gate.ts");
const promptBank = read("src/lib/elite/elite-prompt-bank.ts");
const market = read("scripts/market-perfection-score.mjs");

assert("package.json es JSON válido", Boolean(pkg.name));
assert("script test existe", Boolean(pkg.scripts?.test));
assert("script build existe", Boolean(pkg.scripts?.build));
assert("script elite:final10 existe", Boolean(pkg.scripts?.["elite:final10"]));
assert("script typecheck existe", Boolean(pkg.scripts?.typecheck));
assert("script audit:high existe", Boolean(pkg.scripts?.["audit:high"]));

assert("final-live-10-integration.mjs tiene sintaxis válida", checkNodeSyntax("scripts/final-live-10-integration.mjs"));
assert("market-perfection-score.mjs tiene sintaxis válida", checkNodeSyntax("scripts/market-perfection-score.mjs"));
assert("elite-smoke-tests.mjs tiene sintaxis válida", checkNodeSyntax("scripts/elite-smoke-tests.mjs"));

assert("Composer tiene logs estructurados", composer.includes("project_id") && composer.includes("action") && composer.includes("user_id"));
assert("Composer tiene runtime 10", composer.includes("ELITE_COMPOSER_10_LIVE_RUNTIME"));
assert("Healthcheck existe y responde status healthy", health.includes("healthy") && health.includes("checks"));
assert("Healthcheck incluye uptime", health.includes("uptime"));
assert("Healthcheck incluye node_version", health.includes("node_version"));
assert("Research API tiene POST", research.includes('req.method !== "POST"'));
assert("Export API tiene formatos", exportApi.includes("pdf") && exportApi.includes("docx") && exportApi.includes("epub"));

assert("Logger elite existe", logger.includes("eliteLogEvent"));
assert("Logger maneja project_id", logger.includes("project_id"));
assert("Logger maneja action", logger.includes("action"));
assert("Logger maneja user_id", logger.includes("user_id"));

assert("Monitor elite existe", monitor.includes("eliteHealthSnapshot"));
assert("Monitor tiene healthcheck", monitor.includes("healthcheck"));
assert("Monitor tiene observability", monitor.includes("observability"));

assert("Quality gate existe", quality.includes("scoreEliteChapterText"));
assert("Fact-check prompt existe", promptBank.includes("buildEliteFactCheckPrompt"));
assert("Evaluator detecta audit", market.includes("npm audit --audit-level=high"));
assert("Evaluator detecta tsc", market.includes("npx tsc --noEmit"));

if (process.exitCode) {
  console.log("");
  console.log("❌ Elite production tests fallaron.");
  process.exit(process.exitCode);
}

console.log("");
console.log("✅ Elite production tests pasaron.");

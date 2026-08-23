import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const marker = "BESTSELLER_OS4_PHASE_10A";

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function write(rel, text) { fs.writeFileSync(path.join(root, rel), text, "utf8"); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function replaceOnce(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  assert(count === 1, `${label}: se esperaba 1 coincidencia y hay ${count}.`);
  return text.replace(search, replacement);
}

// ---------------------------------------------------------------------------
// api/os4.ts — Cost Engine real sobre usageMetadata
// ---------------------------------------------------------------------------
{
  const rel = "api/os4.ts";
  let s = read(rel);
  if (!s.includes(marker)) {
    const anchor = `function maxTokens(agent: Agent): number {`;
    assert(s.includes(anchor), "api/os4.ts: no encontré maxTokens().");

    const costCode = `
// ${marker}
type Os4TokenPrice = { inputPerMillionUsd: number; outputPerMillionUsd: number };

const OS4_BUILTIN_TOKEN_PRICING: Record<string, Os4TokenPrice> = {
  // Google AI Developer API — Standard paid tier. Override siempre con
  // OS4_MODEL_PRICING_JSON si cambias de modalidad/precio/modelo.
  "gemini-2.5-flash": { inputPerMillionUsd: 0.30, outputPerMillionUsd: 2.50 },
  "gemini-2.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.00 },
};

function os4PricingTable(): Record<string, Os4TokenPrice> {
  const raw = String(process.env.OS4_MODEL_PRICING_JSON || "").trim();
  if (!raw) return OS4_BUILTIN_TOKEN_PRICING;
  try {
    const parsed = JSON.parse(raw);
    return { ...OS4_BUILTIN_TOKEN_PRICING, ...(parsed || {}) };
  } catch {
    console.warn("OS4_MODEL_PRICING_JSON inválido; usando pricing integrado.");
    return OS4_BUILTIN_TOKEN_PRICING;
  }
}

function estimateOs4TokenCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = os4PricingTable()[model];
  if (!p) return 0;
  const input = Math.max(0, Number(inputTokens || 0));
  const output = Math.max(0, Number(outputTokens || 0));
  const cost = (input / 1_000_000) * Number(p.inputPerMillionUsd || 0)
    + (output / 1_000_000) * Number(p.outputPerMillionUsd || 0);
  return Math.round(cost * 1_000_000) / 1_000_000;
}

`;
    s = s.replace(anchor, costCode + anchor);

    const oldUsage = `      usage: {\n        input_tokens:\n          usage.promptTokenCount ??\n          usage.inputTokenCount ??\n          0,\n        output_tokens:\n          usage.candidatesTokenCount ??\n          usage.outputTokenCount ??\n          0,\n        total_tokens:\n          usage.totalTokenCount ??\n          0,\n      },`;

    assert(s.includes(oldUsage), "api/os4.ts: no encontré bloque usage esperado.");
    const newUsage = `      usage: (() => {\n        const inputTokens = Number(usage.promptTokenCount ?? usage.inputTokenCount ?? 0) || 0;\n        const outputTokens = Number(usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0) || 0;\n        return {\n          input_tokens: inputTokens,\n          output_tokens: outputTokens,\n          total_tokens: Number(usage.totalTokenCount ?? (inputTokens + outputTokens)) || 0,\n          estimated_cost_usd: estimateOs4TokenCostUsd(model, inputTokens, outputTokens),\n        };\n      })(),`;
    s = s.replace(oldUsage, newUsage);
    write(rel, s);
  }
}

// ---------------------------------------------------------------------------
// types.ts — usage cost + publishing_plan
// ---------------------------------------------------------------------------
{
  const rel = "src/lib/os4/types.ts";
  let s = read(rel);

  if (!s.includes("estimated_cost_usd?: number;")) {
    s = replaceOnce(
      s,
      `    total_tokens?: number;\n`,
      `    total_tokens?: number;\n    estimated_cost_usd?: number;\n`,
      "types usage cost"
    );
  }

  if (!s.includes("publishing_plan:")) {
    s = replaceOnce(
      s,
      `  master_audit: Os4MasterAudit | null;\n  launch_plan: Os4LaunchPlan | null;`,
      `  master_audit: Os4MasterAudit | null;\n  publishing_plan: Record<string, unknown> | null;\n  launch_plan: Os4LaunchPlan | null;`,
      "types publishing_plan"
    );
  }
  write(rel, s);
}

// ---------------------------------------------------------------------------
// repo.ts — persist cost from actual response usage
// ---------------------------------------------------------------------------
{
  const rel = "src/lib/os4/repo.ts";
  let s = read(rel);
  if (!s.includes("estimated_cost_usd: Number(response.usage?.estimated_cost_usd")) {
    s = replaceOnce(
      s,
      `    output_tokens: Number(response.usage?.output_tokens ?? 0),\n    metadata: {},`,
      `    output_tokens: Number(response.usage?.output_tokens ?? 0),\n    estimated_cost_usd: Number(response.usage?.estimated_cost_usd ?? 0),\n    metadata: {},`,
      "repo estimated cost"
    );
  }
  write(rel, s);
}

// ---------------------------------------------------------------------------
// orchestrator.ts — conectar PUBLISHING_DIRECTOR al flujo real
// ---------------------------------------------------------------------------
{
  const rel = "src/lib/os4/orchestrator.ts";
  let s = read(rel);
  if (!s.includes("export async function runOs4PublishingPlan")) {
    const anchor = `export async function runOs4LaunchPlan(`;
    assert(s.includes(anchor), "orchestrator: no encontré runOs4LaunchPlan.");

    const fn = `
export async function runOs4PublishingPlan(
  project: Project,
  onEvent?: (event: Os4PipelineEvent) => void
) {
  emit(project.id, onEvent, {
    stage: "PUBLISHING",
    status: "RUNNING",
    message: "Publishing Director construyendo especificación editorial final.",
  });

  const profile = await getOs4Profile(project.id);
  const masterText = ensureString((project.master_document as any)?.text, "");

  const output: any = await trackedAgent({
    projectId: project.id,
    agent: "PUBLISHING_DIRECTOR",
    action: "BUILD_PUBLISHING_PACKAGE",
    payload: {
      title: project.title,
      blueprint: profile?.blueprint,
      master_audit: profile?.master_audit,
      master_excerpt: masterText.slice(0, 70000),
      requested_formats: ["DOCX", "PDF", "EPUB"],
      instruction:
        "Genera especificación operativa, metadata, front matter, formato, checklist y bloqueos. No afirmes que un binario fue generado si no lo fue.",
    },
    inputSummary: "Publishing Director: " + project.title,
  });

  const score = clampScore(output?.score ?? output?.global_score);

  await patchOs4Profile(project.id, {
    publishing_plan: output,
    current_stage: "PUBLISHING",
    status: Array.isArray(output?.blocking_issues) && output.blocking_issues.length
      ? "WAITING_APPROVAL"
      : "COMPLETED",
    overall_score: score || profile?.overall_score || 0,
  } as any);

  emit(project.id, onEvent, {
    stage: "PUBLISHING",
    status: Array.isArray(output?.blocking_issues) && output.blocking_issues.length
      ? "WAITING_APPROVAL"
      : "COMPLETED",
    message: "Publishing Director: " + score + "/10",
    score,
  });

  return output;
}

`;
    s = s.replace(anchor, fn + anchor);
    write(rel, s);
  }
}

// ---------------------------------------------------------------------------
// UI — botón Publishing Director y estado persistido
// ---------------------------------------------------------------------------
{
  const rel = "components/AutonomousPublishingOS.tsx";
  let s = read(rel);

  if (!s.includes("runOs4PublishingPlan,")) {
    s = replaceOnce(
      s,
      `  runOs4MasterAudit,\n  runOs4Preproduction,`,
      `  runOs4MasterAudit,\n  runOs4PublishingPlan,\n  runOs4Preproduction,`,
      "UI import publishing"
    );
  }

  if (!s.includes("const [publishingPlan, setPublishingPlan]")) {
    s = replaceOnce(
      s,
      `  const [masterAudit, setMasterAudit] = useState<any>(null);\n  const [launchPlan, setLaunchPlan] = useState<any>(null);`,
      `  const [masterAudit, setMasterAudit] = useState<any>(null);\n  const [publishingPlan, setPublishingPlan] = useState<any>(null);\n  const [launchPlan, setLaunchPlan] = useState<any>(null);`,
      "UI state publishing"
    );
  }

  if (!s.includes("p?.publishing_plan")) {
    s = replaceOnce(
      s,
      `    if (p?.master_audit) setMasterAudit(p.master_audit);\n    if (p?.launch_plan) setLaunchPlan(p.launch_plan);`,
      `    if (p?.master_audit) setMasterAudit(p.master_audit);\n    if (p?.publishing_plan) setPublishingPlan(p.publishing_plan);\n    if (p?.launch_plan) setLaunchPlan(p.launch_plan);`,
      "UI refresh publishing"
    );
  }

  if (!s.includes("PUBLISHING DIRECTOR")) {
    const anchor = `              <button\n                disabled={busy}\n                onClick={() =>\n                  run(async () => {\n                    const launch = await runOs4LaunchPlan(project, onEvent);`;
    assert(s.includes(anchor), "UI: no encontré botón Launch para insertar Publishing.");
    const button = `              <button\n                disabled={busy}\n                onClick={() =>\n                  run(async () => {\n                    const publishing = await runOs4PublishingPlan(project, onEvent);\n                    setPublishingPlan(publishing);\n                  })\n                }\n                className="rounded-lg bg-indigo-700 hover:bg-indigo-600 px-3 py-2 text-xs font-black"\n              >\n                PUBLISHING DIRECTOR\n              </button>\n\n`;
    s = s.replace(anchor, button + anchor);
  }

  write(rel, s);
}

// ---------------------------------------------------------------------------
// package.json — test 10A
// ---------------------------------------------------------------------------
{
  const rel = "package.json";
  const pkg = JSON.parse(read(rel));
  pkg.scripts ||= {};
  pkg.scripts["os4:10a:test"] = "node scripts/os4-10a-tests.mjs";
  pkg.scripts["os4:10a:verify"] = "npm run os4:10a:test && npm run typecheck && npm run build";
  write(rel, JSON.stringify(pkg, null, 2) + "\n");
}

console.log("✅ BESTSELLER OS4 FASE 10A aplicada.");
console.log("   - Cost Engine por tokens/modelo");
console.log("   - estimated_cost_usd persistido");
console.log("   - Publishing Director conectado al orchestrator/UI");
console.log("   - SQL de persistencia preparado");

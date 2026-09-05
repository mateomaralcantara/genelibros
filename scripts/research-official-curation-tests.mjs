import fs from "node:fs";

const curate = fs.readFileSync("scripts/research-curate-official-evidence.mjs", "utf8");
const selector = fs.readFileSync("scripts/run-deep-production-editorial-v1.mjs", "utf8");
const contract = fs.readFileSync("scripts/deep-production-v1-contract.mjs", "utf8");
const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
}

check("curation has no Gemini call", !/GoogleGenAI|generateContent|generateJson|discoverGroundedSources/.test(curate));
check("curation requires completed source job", curate.includes('job.status !== "COMPLETED"'));
check("curation uses only Class A for new evidence", curate.includes('sourceClass !== "A"'));
check("curation requires numerical/dated material", curate.includes("NUMBER_RE"));
check("curation rejects absence/limitation phrases", curate.includes("NEGATIVE"));
check("curation preserves exact excerpt hash", curate.includes("exactExcerptSha256"));
check("curation marks evidence SUPPORT explicitly", curate.includes('evidenceType: "SUPPORT"'));
check("curation confidence is bounded and explicit", curate.includes("confidenceScore: 9.5"));
check("curation target never below 7.5", curate.includes("Math.max(7.5"));
check("curation blocks persistence below Production minimum", curate.includes("productionOverrideEligible") && curate.includes("No se mutó nada"));
check("curation defaults to preflight/no mutation", curate.includes("if (!apply)"));
check("curation preserves original dossier", curate.includes("Original Research dossier preserved"));
check("curation never falsifies ready_for_writing", curate.includes("readyForWriting: false") && curate.includes("ready_for_writing: false"));
check("curation creates separate dossier", curate.includes('from("research_dossiers")') && curate.includes("dossierRow.id"));
check("curation is idempotent", curate.includes("idempotencyKey"));
check("curation rolls back new job on persistence failure", curate.includes('from("research_jobs").delete()'));

check("selector imports frozen Production thresholds", selector.includes("MIN_RESEARCH_EVIDENCE") && selector.includes("MIN_RESEARCH_COVERAGE"));
check("selector does not lower threshold", !selector.includes("7.0") && contract.includes('MIN_RESEARCH_EVIDENCE = 7.5'));
check("selector prefers ready dossier then editorial eligible", selector.includes('ready_for_writing === true') && selector.includes("eligible[0]"));
check("selector explicit editorial override", selector.includes('args.push("--allow-editorial-override")'));
check("selector is zero-LLM before execute", selector.includes("llmCallsMadeBySelector: 0"));
check("selector requires explicit execute", selector.includes("if (!execute)"));
check("selector invokes existing Production V1 runner", selector.includes('scripts/run-deep-production-v1.mjs'));

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} official-curation checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed.length) process.exit(1);

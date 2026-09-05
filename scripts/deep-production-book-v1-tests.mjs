import fs from "node:fs";
import path from "node:path";
import { FIRST_PASS_MAX_LLM_CALLS, QUALITY_THRESHOLD } from "./deep-production-v1-contract.mjs";

const root = process.cwd();
const book = fs.readFileSync(path.resolve(root, "scripts/deep-production-book.mjs"), "utf8");
const runner = fs.readFileSync(path.resolve(root, "scripts/run-deep-production-book-v1.mjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.resolve(root, "package.json"), "utf8"));

const checks = [
  ["book orchestrator contains no direct LLM client", !book.includes("GoogleGenAI") && !book.includes("generateContent(")],
  ["book preflight has zero LLM claim", book.includes("llmCallsMadeByPreflight: 0")],
  ["book execute is explicit opt-in", book.includes('const execute = hasFlag("--execute")') && runner.includes('rawArgs.includes("--execute")')],
  ["book-wide call budget required", book.includes("--book-max-calls") && book.includes("EXECUTE bloqueado")],
  ["book reserves seven calls before starting each chapter", FIRST_PASS_MAX_LLM_CALLS === 7 && book.includes("remainingBookBudget < FIRST_PASS_MAX_LLM_CALLS")],
  ["quality threshold remains 9.3", QUALITY_THRESHOLD === 9.3 && book.includes("score < QUALITY_THRESHOLD")],
  ["chapters are sorted sequentially", book.includes(".sort((a, b) => Number(a.chapter_number || 0) - Number(b.chapter_number || 0))")],
  ["chapter enqueue pins exact dossier", book.includes('"--dossier", String(item.dossier.id)')],
  ["book uses universal chapter enqueue", book.includes('runNode("scripts/deep-production-chapter.mjs"')],
  ["book uses shared local worker stack", book.includes('runNode("scripts/run-deep-final-local-stack.mjs")')],
  ["book uses universal apply", book.includes('runNode("scripts/deep-production-apply.mjs"')],
  ["apply happens before next loop iteration", book.indexOf('runNode("scripts/deep-production-apply.mjs", ["--job", completedJob.id])') < book.indexOf('execution.push({ chapterNumber: item.chapterNumber, state: "COMPLETED_APPLIED"')],
  ["research must already be ready", book.includes('.eq("ready_for_writing", true)') && book.includes("BLOCK_RESEARCH")],
  ["book does not run research generation", !book.includes("research:11d") && !book.includes("run-research") && !book.includes("research-worker")],
  ["book never runs automatic repair", !book.includes("deep-production-repair.mjs") && book.includes("No se repara automáticamente")],
  ["rejected chapter pauses with explicit repair command", book.includes("PAUSED_REPAIR_REQUIRED") && book.includes("npm run deep:prod:repair")],
  ["technical failure pauses without retry", book.includes("PAUSED_TECHNICAL") && book.includes("No hay retry automático") && !book.includes("--resume-technical")],
  ["already applied chapter is skipped", book.includes("SKIPPED_APPLIED") && book.includes("approvedAndApplied")],
  ["approved pending apply costs zero LLM", book.includes("APPLIED_EXISTING_APPROVAL") && book.includes("callsAdded: 0")],
  ["legacy approved content can be recognized", book.includes("anyAppliedJob") && book.includes("Contenido actual coincide con un job APPROVED")],
  ["refresh research is explicit", book.includes("--refresh-research") && book.includes("refreshResearch")],
  ["global active jobs block safe book start", book.includes("globalActive") && book.includes("cola limpia")],
  ["book records actual job usage", book.includes("recordedCallsThisRun += callsAdded")],
  ["book persists resumable manifest", book.includes("book-${projectId}-last-run.json") && book.includes("writeManifest")],
  ["budget pause preserves progress", book.includes("PAUSED_BOOK_BUDGET") && book.includes("Progreso preservado")],
  ["runner tests before orchestrating", runner.indexOf("deep-production-book-v1-tests.mjs") < runner.indexOf("deep-production-book.mjs")],
  ["runner also rechecks frozen Production V1", runner.includes("deep-production-v1-tests.mjs") && runner.includes('runNpm(["run", "typecheck"])')],
  ["public book command installed", String(pkg.scripts?.["deep:prod:book"] || "").includes("run-deep-production-book-v1.mjs")],
  ["public book verify command installed", String(pkg.scripts?.["deep:prod:book:verify"] || "").includes("deep-production-book-v1-tests.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} Book Production V1 checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

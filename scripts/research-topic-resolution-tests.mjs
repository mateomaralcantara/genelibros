import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "scripts/research-chapter-preflight.mjs");
const source = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");

const checks = [
  ["project state parser exists", source.includes("function projectState(project)")],
  ["state outline is read", source.includes("project.state.outline_12")],
  ["state chapters are read", source.includes("project.state.chapters")],
  ["state chapter fallback resolver exists", source.includes("function resolveStateChapterTopic")],
  ["generic chapter titles remain rejected", source.includes("isGenericChapterTitle(value, chapterNumber)")],
  ["section title keeps first priority after explicit topic", source.includes("const topic = explicitTopic || titleTopic || outlineTopicResolution.topic || stateChapterTopicResolution.topic")],
  ["outline location is surfaced", source.includes("outlineLocation: outlineResolution.location")],
  ["state chapter hint is surfaced", source.includes("stateChapterHint: compactOutlineEntry(stateChapterEntry)")],
  ["state book hints are surfaced", source.includes("state?.book_topic") || source.includes("state.book_topic")],
  ["checkpoint stores resolved blueprint context", source.includes("outlineContext: compactOutlineEntry(outlineEntry || stateChapterEntry)")],
  ["missing topic error lists state locations", source.includes("project.state.outline_12, project.state.chapters")],
  ["preflight remains zero LLM", source.includes("llmCallsMadeByPreflight: 0")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS — ${name}`);
  else {
    failed += 1;
    console.error(`FAIL — ${name}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} Research Topic Resolution checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed) process.exit(1);

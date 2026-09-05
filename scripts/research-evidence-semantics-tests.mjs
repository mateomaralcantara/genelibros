import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
const runtime = fs.readFileSync(runtimeFile, "utf8");

const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
}

check("evidence semantics marker installed", runtime.includes("RESEARCH_EVIDENCE_SEMANTICS_V2"));
check("evidence output classifies support vs limitation", runtime.includes('evidenceType: "SUPPORT|LIMITATION"'));
check("historical evidence compatibility exists", runtime.includes("Compatibilidad con dossiers históricos sin evidenceType"));
check("supportive evidence helper exists", runtime.includes("function supportiveResearchEvidence"));
check("limitations explicitly excluded", runtime.includes('if(type==="LIMITATION")return false'));
check("claim builder filters supportive evidence", runtime.includes("const evidence=supportiveResearchEvidence(input.evidence)"));
check("claim builder avoids paid call when no support exists", runtime.includes("if(!evidence.length)"));
check("claim builder prompt says SUPPORT only", runtime.includes("ONLY from supplied SUPPORT evidence"));
check("dossier computes metrics from supportive evidence", runtime.includes("const supportiveEvidence=supportiveResearchEvidence(input.evidence)"));
check("coverage ignores non-support evidence", runtime.includes("coveredQuestionIds.size/input.questions.length"));
check("coverage only counts known research questions", runtime.includes("validQuestionIds.has(id)"));
check("citation auditor gets supportive evidence", runtime.includes("evidence:supportiveEvidence"));
check("research ready gate requires evidence >=7.5", runtime.includes("&&evidence>=7.5&&factual>=7.5"));
check("full evidence history remains stored in dossier", runtime.includes("evidence:input.evidence,claims:input.claims"));

// Fixture-level contract: these are the exact semantics expected for legacy dossiers.
function legacySupportive(item) {
  const type = String(item?.evidenceType || "").trim().toUpperCase();
  const supports = Array.isArray(item?.supports) ? item.supports.filter(Boolean) : [];
  const relevance = Math.max(0, Math.min(10, Number(item?.relevanceScore || 0)));
  const confidence = Math.max(0, Math.min(10, Number(item?.confidenceScore || 0)));
  if (type === "LIMITATION") return false;
  if (type === "SUPPORT") return supports.length > 0 && relevance >= 2 && confidence >= 2;
  return supports.length > 0 && relevance >= 3 && confidence >= 3;
}

const fixture = [
  { evidence: "official number", supports: ["official number"], relevanceScore: 9, confidenceScore: 9 },
  { evidence: "source lacks requested data", supports: [], relevanceScore: 2, confidenceScore: 9 },
  { evidence: "weak mention only", supports: ["institution name"], relevanceScore: 1, confidenceScore: 1 },
  { evidenceType: "LIMITATION", evidence: "explicit limitation", supports: ["text"], relevanceScore: 9, confidenceScore: 9 },
  { evidenceType: "SUPPORT", evidence: "explicit support", supports: ["text"], relevanceScore: 8, confidenceScore: 8 },
];
const selected = fixture.filter(legacySupportive);
check("fixture excludes high-confidence absence evidence", !selected.some((x) => x.evidence.includes("lacks")));
check("fixture excludes weak mentions", !selected.some((x) => x.evidence.includes("weak")));
check("fixture respects explicit LIMITATION", !selected.some((x) => x.evidence.includes("explicit limitation")));
check("fixture keeps real support", selected.some((x) => x.evidence === "official number"));
check("fixture keeps explicit SUPPORT", selected.some((x) => x.evidence === "explicit support"));

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} Research Evidence Semantics checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed.length) process.exit(1);

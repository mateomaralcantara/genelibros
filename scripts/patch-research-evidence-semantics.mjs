import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");

const MARKER = "RESEARCH_EVIDENCE_SEMANTICS_V2";
if (runtime.includes(MARKER)) {
  console.log("[Genelibros] RESEARCH EVIDENCE SEMANTICS V2 ya estaba instalado.");
  process.exit(0);
}

const schemaNeedle = `              evidence: "string",\n              relevanceScore: 0,\n              confidenceScore: 0,\n              supports: ["string"],`;
const schemaReplacement = `              evidence: "string",\n              evidenceType: "SUPPORT|LIMITATION",\n              relevanceScore: 0,\n              confidenceScore: 0,\n              supports: ["string"],`;
if (!runtime.includes(schemaNeedle)) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: output schema marker no encontrado.");
}
runtime = runtime.replace(schemaNeedle, schemaReplacement);

const evidenceNeedle = `              evidence:\n                clean(e.evidence),\n\n              relevanceScore:`;
const evidenceReplacement = `              evidence:\n                clean(e.evidence),\n\n              // ${MARKER}\n              // SUPPORT = material factual que sí responde una pregunta.\n              // LIMITATION = ausencia, insuficiencia o límite de la fuente.\n              evidenceType:\n                ["SUPPORT", "LIMITATION"].includes(clean(e.evidenceType).toUpperCase())\n                  ? clean(e.evidenceType).toUpperCase()\n                  : (\n                      Array.isArray(e.supports) &&\n                      e.supports.map(clean).filter(Boolean).length > 0 &&\n                      Number(e.relevanceScore || 0) >= 3 &&\n                      Number(e.confidenceScore || 0) >= 3\n                    )\n                    ? "SUPPORT"\n                    : "LIMITATION",\n\n              relevanceScore:`;
if (!runtime.includes(evidenceNeedle)) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: evidence mapper marker no encontrado.");
}
runtime = runtime.replace(evidenceNeedle, evidenceReplacement);

const buildClaimsMarker = `export async function buildClaims(input:{topic:string;evidence:ResearchEvidence[];sources:ResearchSource[]}){`;
const helperBlock = `function isSupportiveResearchEvidence(item:any){\n  const type=clean(item?.evidenceType).toUpperCase();\n  const supports=Array.isArray(item?.supports)?item.supports.map(clean).filter(Boolean):[];\n  const relevance=Math.max(0,Math.min(10,Number(item?.relevanceScore||0)));\n  const confidence=Math.max(0,Math.min(10,Number(item?.confidenceScore||0)));\n\n  if(type==="LIMITATION")return false;\n  if(type==="SUPPORT")return supports.length>0&&relevance>=2&&confidence>=2;\n\n  // Compatibilidad con dossiers históricos sin evidenceType.\n  return supports.length>0&&relevance>=3&&confidence>=3;\n}\n\nfunction supportiveResearchEvidence(items:ResearchEvidence[]){\n  return (items||[]).filter(isSupportiveResearchEvidence);\n}\n\n`;
if (!runtime.includes(buildClaimsMarker)) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: buildClaims marker no encontrado.");
}
runtime = runtime.replace(buildClaimsMarker, helperBlock + buildClaimsMarker);

const oldClaimsStart = `export async function buildClaims(input:{topic:string;evidence:ResearchEvidence[];sources:ResearchSource[]}){\n  const r=await generateJson({system:"You are CLAIM_BUILDER. Build factual claims ONLY from supplied evidence. Every claim must list exact evidence IDs and source IDs. No unsupported synthesis. Return JSON only.",prompt:JSON.stringify({topic:input.topic,evidence:input.evidence,sources:input.sources.map(s=>({id:s.id,url:s.url,sourceClass:s.sourceClass,credibilityScore:s.credibilityScore})),output_schema:{claims:[{claim:"string",status:"VERIFIED|PARTIALLY_VERIFIED|CONFLICTED|UNVERIFIED",confidenceScore:0,evidenceIds:["ev_x"],sourceIds:["src_x"],citationReady:true}]}}),maxOutputTokens:12000});\n  const validE=new Set(input.evidence.map(e=>e.id));const validS=new Set(input.sources.map(s=>s.id));`;
const newClaimsStart = `export async function buildClaims(input:{topic:string;evidence:ResearchEvidence[];sources:ResearchSource[]}){\n  const evidence=supportiveResearchEvidence(input.evidence);\n  if(!evidence.length){\n    return {claims:[] as ResearchClaim[],usage:{calls:0,inputTokens:0,outputTokens:0,totalTokens:0} as ResearchUsage,model:MODEL};\n  }\n  const r=await generateJson({system:"You are CLAIM_BUILDER. Build factual claims ONLY from supplied SUPPORT evidence. LIMITATION/absence evidence has already been excluded. Every claim must list exact evidence IDs and source IDs. No unsupported synthesis. Return JSON only.",prompt:JSON.stringify({topic:input.topic,evidence,sources:input.sources.map(s=>({id:s.id,url:s.url,sourceClass:s.sourceClass,credibilityScore:s.credibilityScore})),output_schema:{claims:[{claim:"string",status:"VERIFIED|PARTIALLY_VERIFIED|CONFLICTED|UNVERIFIED",confidenceScore:0,evidenceIds:["ev_x"],sourceIds:["src_x"],citationReady:true}]}}),maxOutputTokens:12000});\n  const validE=new Set(evidence.map(e=>e.id));const validS=new Set(input.sources.map(s=>s.id));`;
if (!runtime.includes(oldClaimsStart)) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: buildClaims body esperado no encontrado.");
}
runtime = runtime.replace(oldClaimsStart, newClaimsStart);

const oldDossierMetrics = `  const verified=input.claims.filter(c=>c.status==="VERIFIED"&&c.citationReady);const critical=input.gaps.filter(g=>["CRITICAL","HIGH"].includes(g.severity));const classAB=input.sources.filter(s=>["A","B"].includes(s.sourceClass));\n  const coverage=input.questions.length?Math.min(10,(new Set(input.evidence.flatMap(e=>e.questionIds)).size/input.questions.length)*10):0;\n  const evidence=input.evidence.length?input.evidence.reduce((s,e)=>s+e.confidenceScore,0)/input.evidence.length:0;\n  const factual=input.claims.length?input.claims.reduce((s,c)=>s+c.confidenceScore,0)/input.claims.length:0;\n  const r=await generateJson({system:"You are CITATION_AUDITOR and research dossier editor. Use ONLY verified/partially verified claims. Explicitly prohibit unsupported claims. Do not invent references. Return JSON only.",prompt:JSON.stringify({...input,verifiedClaims:verified,sources:input.sources.map(s=>({id:s.id,title:s.title,url:s.url,class:s.sourceClass,credibility:s.credibilityScore})),metrics:{coverage,evidence,factual},output_schema:{executiveSummary:"string",writingInstructions:["string"],prohibitedClaims:["string"],citationPlan:[{claimId:"claim_x",sourceIds:["src_x"],note:"string"}]}})});`;
const newDossierMetrics = `  const verified=input.claims.filter(c=>c.status==="VERIFIED"&&c.citationReady);const critical=input.gaps.filter(g=>["CRITICAL","HIGH"].includes(g.severity));const classAB=input.sources.filter(s=>["A","B"].includes(s.sourceClass));\n  const supportiveEvidence=supportiveResearchEvidence(input.evidence);\n  const validQuestionIds=new Set(input.questions.map(q=>q.id));\n  const coveredQuestionIds=new Set(supportiveEvidence.flatMap(e=>e.questionIds.filter(id=>validQuestionIds.has(id))));\n  const coverage=input.questions.length?Math.min(10,(coveredQuestionIds.size/input.questions.length)*10):0;\n  const evidence=supportiveEvidence.length?supportiveEvidence.reduce((s,e)=>s+e.confidenceScore,0)/supportiveEvidence.length:0;\n  const factual=input.claims.length?input.claims.reduce((s,c)=>s+c.confidenceScore,0)/input.claims.length:0;\n  const r=await generateJson({system:"You are CITATION_AUDITOR and research dossier editor. Use ONLY verified/partially verified claims and SUPPORT evidence. Explicitly prohibit unsupported claims. LIMITATION evidence is for gap/audit history only. Do not invent references. Return JSON only.",prompt:JSON.stringify({...input,evidence:supportiveEvidence,verifiedClaims:verified,sources:input.sources.map(s=>({id:s.id,title:s.title,url:s.url,class:s.sourceClass,credibility:s.credibilityScore})),metrics:{coverage,evidence,factual,supportiveEvidence:supportiveEvidence.length,limitationEvidence:Math.max(0,input.evidence.length-supportiveEvidence.length)},output_schema:{executiveSummary:"string",writingInstructions:["string"],prohibitedClaims:["string"],citationPlan:[{claimId:"claim_x",sourceIds:["src_x"],note:"string"}]}})});`;
if (!runtime.includes(oldDossierMetrics)) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: dossier metrics body esperado no encontrado.");
}
runtime = runtime.replace(oldDossierMetrics, newDossierMetrics);

const oldReady = `readyForWriting:verified.length>=3&&classAB.length>=2&&critical.length===0&&coverage>=7.5&&factual>=7.5`;
const newReady = `readyForWriting:verified.length>=3&&classAB.length>=2&&critical.length===0&&coverage>=7.5&&evidence>=7.5&&factual>=7.5`;
if (!runtime.includes(oldReady)) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: readyForWriting marker no encontrado.");
}
runtime = runtime.replace(oldReady, newReady);

const required = [
  ["marker", runtime.includes(MARKER)],
  ["evidence type schema", runtime.includes('evidenceType: "SUPPORT|LIMITATION"')],
  ["supportive filter", runtime.includes("function supportiveResearchEvidence")],
  ["claims use support only", runtime.includes("const evidence=supportiveResearchEvidence(input.evidence)")],
  ["dossier uses support only", runtime.includes("const supportiveEvidence=supportiveResearchEvidence(input.evidence)")],
  ["ready evidence gate", runtime.includes("&&evidence>=7.5&&factual>=7.5")],
];
const missing = required.filter(([, ok]) => !ok).map(([name]) => name);
if (missing.length) throw new Error(`RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: ${missing.join(", ")}`);

fs.writeFileSync(runtimeFile, runtime, "utf8");
console.log("[Genelibros] RESEARCH EVIDENCE SEMANTICS V2 instalado: SUPPORT separado de LIMITATION.");
console.log("[Genelibros] Claims, coverage, evidenceScore y citation audit usan solo SUPPORT; gaps conservan el historial completo.");

import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");

const MARKER = "RESEARCH_EVIDENCE_SEMANTICS_V2";

function installedChecks(source) {
  return [
    ["marker", source.includes(MARKER)],
    ["evidence type schema", source.includes('evidenceType: "SUPPORT|LIMITATION"')],
    ["supportive filter", source.includes("function supportiveResearchEvidence")],
    ["claims use support only", source.includes("const evidence=supportiveResearchEvidence(input.evidence)")],
    ["dossier uses support only", source.includes("const supportiveEvidence=supportiveResearchEvidence(input.evidence)")],
    ["ready evidence gate", source.includes("&&evidence>=7.5&&factual>=7.5")],
  ];
}

function assertInstalled(source) {
  const missing = installedChecks(source).filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) {
    throw new Error(`RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: ${missing.join(", ")}`);
  }
}

if (runtime.includes(MARKER)) {
  assertInstalled(runtime);
  console.log("[Genelibros] RESEARCH EVIDENCE SEMANTICS V2 ya estaba instalado y validado.");
  process.exit(0);
}

function replaceOnce(needle, replacement, label) {
  if (!runtime.includes(needle)) {
    throw new Error(`RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: ${label} no encontrado.`);
  }
  runtime = runtime.replace(needle, replacement);
}

// 1) El analista debe declarar si una salida es soporte factual o solamente una limitación/ausencia.
if (!runtime.includes('evidenceType: "SUPPORT|LIMITATION"')) {
  replaceOnce(
    `              evidence: "string",\n              relevanceScore: 0,\n              confidenceScore: 0,\n              supports: ["string"],`,
    `              evidence: "string",\n              evidenceType: "SUPPORT|LIMITATION",\n              relevanceScore: 0,\n              confidenceScore: 0,\n              supports: ["string"],`,
    "output schema marker",
  );
}

// 2) Persistir evidenceType; para respuestas antiguas, inferir de forma conservadora.
if (!runtime.includes(`// ${MARKER}`)) {
  replaceOnce(
    `              evidence:\n                clean(e.evidence),\n\n              relevanceScore:`,
    `              evidence:\n                clean(e.evidence),\n\n              // ${MARKER}\n              // SUPPORT = material factual que sí responde una pregunta.\n              // LIMITATION = ausencia, insuficiencia o límite de la fuente.\n              evidenceType:\n                ["SUPPORT", "LIMITATION"].includes(clean(e.evidenceType).toUpperCase())\n                  ? clean(e.evidenceType).toUpperCase()\n                  : (\n                      Array.isArray(e.supports) &&\n                      e.supports.map(clean).filter(Boolean).length > 0 &&\n                      Number(e.relevanceScore || 0) >= 3 &&\n                      Number(e.confidenceScore || 0) >= 3\n                    )\n                    ? "SUPPORT"\n                    : "LIMITATION",\n\n              relevanceScore:`,
    "evidence mapper marker",
  );
}

const buildClaimsStart = `export async function buildClaims(input:{topic:string;evidence:ResearchEvidence[];sources:ResearchSource[]}){`;
const detectContradictionsStart = `export async function detectContradictions(input:{claims:ResearchClaim[];evidence:ResearchEvidence[];sources:ResearchSource[]}){`;
const claimsAt = runtime.indexOf(buildClaimsStart);
const contradictionsAt = runtime.indexOf(detectContradictionsStart);
if (claimsAt < 0 || contradictionsAt < 0 || contradictionsAt <= claimsAt) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: límites de buildClaims no encontrados.");
}

const helperAndClaims = `// ${MARKER}\nfunction isSupportiveResearchEvidence(item:any){\n  const type=clean(item?.evidenceType).toUpperCase();\n  const supports=Array.isArray(item?.supports)?item.supports.map(clean).filter(Boolean):[];\n  const relevance=Math.max(0,Math.min(10,Number(item?.relevanceScore||0)));\n  const confidence=Math.max(0,Math.min(10,Number(item?.confidenceScore||0)));\n\n  if(type==="LIMITATION")return false;\n  if(type==="SUPPORT")return supports.length>0&&relevance>=2&&confidence>=2;\n\n  // Compatibilidad con dossiers históricos sin evidenceType.\n  return supports.length>0&&relevance>=3&&confidence>=3;\n}\n\nfunction supportiveResearchEvidence(items:ResearchEvidence[]){\n  return (items||[]).filter(isSupportiveResearchEvidence);\n}\n\nexport async function buildClaims(input:{topic:string;evidence:ResearchEvidence[];sources:ResearchSource[]}){\n  const evidence=supportiveResearchEvidence(input.evidence);\n  if(!evidence.length){\n    return {claims:[] as ResearchClaim[],usage:{calls:0,inputTokens:0,outputTokens:0,totalTokens:0},model:MODEL};\n  }\n  const r=await generateJson({system:"You are CLAIM_BUILDER. Build factual claims ONLY from supplied SUPPORT evidence. LIMITATION/absence evidence has already been excluded. Every claim must list exact evidence IDs and source IDs. No unsupported synthesis. Return JSON only.",prompt:JSON.stringify({topic:input.topic,evidence,sources:input.sources.map(s=>({id:s.id,url:s.url,sourceClass:s.sourceClass,credibilityScore:s.credibilityScore})),output_schema:{claims:[{claim:"string",status:"VERIFIED|PARTIALLY_VERIFIED|CONFLICTED|UNVERIFIED",confidenceScore:0,evidenceIds:["ev_x"],sourceIds:["src_x"],citationReady:true}]}}),maxOutputTokens:12000});\n  const validE=new Set(evidence.map(e=>e.id));const validS=new Set(input.sources.map(s=>s.id));\n  const claims:ResearchClaim[]=Array.isArray(r.data?.claims)?r.data.claims.map((c:AnyRow,i:number)=>{const evidenceIds=Array.isArray(c.evidenceIds)?c.evidenceIds.map(clean).filter((x:string)=>validE.has(x)):[];const sourceIds=Array.isArray(c.sourceIds)?c.sourceIds.map(clean).filter((x:string)=>validS.has(x)):[];const status=["VERIFIED","PARTIALLY_VERIFIED","CONFLICTED","UNVERIFIED"].includes(clean(c.status))?c.status:"UNVERIFIED";return {id:makeId("claim",\`${i}:\${clean(c.claim)}\`),claim:clean(c.claim),status,confidenceScore:Math.max(0,Math.min(10,Number(c.confidenceScore||0))),evidenceIds,sourceIds,contradictionIds:[],citationReady:Boolean(c.citationReady)&&evidenceIds.length>0&&sourceIds.length>0} as ResearchClaim;}).filter((c:ResearchClaim)=>c.claim):[];\n  return {claims,usage:r.usage,model:r.model};\n}\n\n`;

runtime = runtime.slice(0, claimsAt) + helperAndClaims + runtime.slice(contradictionsAt);

// 3) Reemplazar buildDossier completo. Es más seguro que depender del formato minificado histórico.
const buildDossierStart = `export async function buildDossier(input:{title:string;questions:ResearchQuestion[];sources:ResearchSource[];evidence:ResearchEvidence[];claims:ResearchClaim[];contradictions:ResearchContradiction[];gaps:ResearchGap[]}){`;
const dossierAt = runtime.indexOf(buildDossierStart);
if (dossierAt < 0) {
  throw new Error("RESEARCH_EVIDENCE_SEMANTICS_PATCH_INCOMPLETE: buildDossier no encontrado.");
}

const newDossier = `export async function buildDossier(input:{title:string;questions:ResearchQuestion[];sources:ResearchSource[];evidence:ResearchEvidence[];claims:ResearchClaim[];contradictions:ResearchContradiction[];gaps:ResearchGap[]}){\n  const verified=input.claims.filter(c=>c.status==="VERIFIED"&&c.citationReady);const critical=input.gaps.filter(g=>["CRITICAL","HIGH"].includes(g.severity));const classAB=input.sources.filter(s=>["A","B"].includes(s.sourceClass));\n  const supportiveEvidence=supportiveResearchEvidence(input.evidence);\n  const validQuestionIds=new Set(input.questions.map(q=>q.id));\n  const coveredQuestionIds=new Set(supportiveEvidence.flatMap(e=>e.questionIds.filter(id=>validQuestionIds.has(id))));\n  const coverage=input.questions.length?Math.min(10,(coveredQuestionIds.size/input.questions.length)*10):0;\n  const evidence=supportiveEvidence.length?supportiveEvidence.reduce((s,e)=>s+e.confidenceScore,0)/supportiveEvidence.length:0;\n  const factual=input.claims.length?input.claims.reduce((s,c)=>s+c.confidenceScore,0)/input.claims.length:0;\n  const r=await generateJson({system:"You are CITATION_AUDITOR and research dossier editor. Use ONLY verified/partially verified claims and SUPPORT evidence. Explicitly prohibit unsupported claims. LIMITATION evidence is for gap/audit history only. Do not invent references. Return JSON only.",prompt:JSON.stringify({...input,evidence:supportiveEvidence,verifiedClaims:verified,sources:input.sources.map(s=>({id:s.id,title:s.title,url:s.url,class:s.sourceClass,credibility:s.credibilityScore})),metrics:{coverage,evidence,factual,supportiveEvidence:supportiveEvidence.length,limitationEvidence:Math.max(0,input.evidence.length-supportiveEvidence.length)},output_schema:{executiveSummary:"string",writingInstructions:["string"],prohibitedClaims:["string"],citationPlan:[{claimId:"claim_x",sourceIds:["src_x"],note:"string"}]}})});\n  const claimIds=new Set(input.claims.map(c=>c.id));const sourceIds=new Set(input.sources.map(s=>s.id));\n  const dossier:ResearchDossier={title:input.title,executiveSummary:clean(r.data?.executiveSummary),questions:input.questions,sources:input.sources.map(s=>({...s,excerpt:s.excerpt?s.excerpt.slice(0,1200):s.excerpt})),evidence:input.evidence,claims:input.claims,contradictions:input.contradictions,gaps:input.gaps,writingInstructions:Array.isArray(r.data?.writingInstructions)?r.data.writingInstructions.map(clean).filter(Boolean):[],prohibitedClaims:Array.isArray(r.data?.prohibitedClaims)?r.data.prohibitedClaims.map(clean).filter(Boolean):[],citationPlan:Array.isArray(r.data?.citationPlan)?r.data.citationPlan.map((p:AnyRow)=>({claimId:clean(p.claimId),sourceIds:Array.isArray(p.sourceIds)?p.sourceIds.map(clean).filter((x:string)=>sourceIds.has(x)):[],note:clean(p.note)})).filter((p:AnyRow)=>claimIds.has(p.claimId)&&p.sourceIds.length):[],coverageScore:Number(coverage.toFixed(2)),evidenceScore:Number(evidence.toFixed(2)),factualConfidenceScore:Number(factual.toFixed(2)),readyForWriting:verified.length>=3&&classAB.length>=2&&critical.length===0&&coverage>=7.5&&evidence>=7.5&&factual>=7.5};\n  return {dossier,usage:r.usage,model:r.model};\n}\n`;

// buildDossier es actualmente la última función del runtime.
runtime = runtime.slice(0, dossierAt) + newDossier;

assertInstalled(runtime);
fs.writeFileSync(runtimeFile, runtime, "utf8");
console.log("[Genelibros] RESEARCH EVIDENCE SEMANTICS V2 instalado: SUPPORT separado de LIMITATION.");
console.log("[Genelibros] Claims, coverage, evidenceScore y citation audit usan solo SUPPORT; gaps conservan el historial completo.");

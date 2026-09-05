import fs from "node:fs";
const checks=[];const check=(name,ok)=>checks.push([name,Boolean(ok)]);const exists=(p)=>fs.existsSync(p);const text=(p)=>fs.readFileSync(p,"utf8");
for(const p of ["src/server/vercel-handlers/research-jobs.ts","src/server/vercel-handlers/research-worker.ts","src/server/research-intelligence-runtime.ts","src/lib/research-intelligence/types.ts","src/lib/research-intelligence/client.ts","src/lib/research-intelligence/index.ts","scripts/run-research-worker-local.mjs","scripts/prepare-research-worker-local.ps1","sql/research-11d-engine.sql","sql/research-11d-verify.sql"])check(`Existe ${p}`,exists(p));
const runtime=text("src/server/research-intelligence-runtime.ts"),worker=text("src/server/vercel-handlers/research-worker.ts"),jobs=text("src/server/vercel-handlers/research-jobs.ts"),sql=text("sql/research-11d-engine.sql"),client=text("src/lib/research-intelligence/client.ts"),index=text("src/lib/research-intelligence/index.ts"),runner=text("scripts/run-research-worker-local.mjs"),prep=text("scripts/prepare-research-worker-local.ps1"),pkg=JSON.parse(text("package.json"));
for(const agent of ["RESEARCH_STRATEGIST","QUERY_ARCHITECT","SOURCE_HUNTER","WEB_EXTRACTOR","SOURCE_RANKER","EVIDENCE_ANALYST","CLAIM_BUILDER","CONTRADICTION_ENGINE","FACT_VERIFIER","CITATION_AUDITOR","RESEARCH_GAP_DETECTOR"])check(`${agent} funcional/declarado`,index.includes(agent)||runtime.includes(agent));
check("Runtime usa GEMINI_API_KEY server-side",runtime.includes("process.env.GEMINI_API_KEY"));
check("Runtime no usa VITE_GEMINI_API_KEY",!runtime.includes("VITE_GEMINI_API_KEY"));
check("Default gemini-3.6-flash",runtime.includes("gemini-3.6-flash"));
check("Google Search grounding",runtime.includes("googleSearch"));
check("Discovery usa grounding metadata",runtime.includes("groundingMetadata"));

check(
  "11D.2 captura groundingSupports",
  runtime.includes("groundingSupports")
);

check(
  "11D.2 preserva groundingExcerpt",
  runtime.includes("groundingExcerpt")
);

check(
  "11D.2 Evidence usa grounding fallback",
  runtime.includes("GOOGLE_SEARCH_GROUNDING_SUPPORT")
);

check(
  "11D.2 worker procesa grounding aunque falle extracción",
  worker.includes(
    'source.extractionStatus!=="EXTRACTED"&&!String(source.groundingExcerpt||"").trim()'
  )
);
check("Discovery acepta URLs solo de grounding",runtime.includes("groundingChunks"));
check("Manual URLs soportadas",jobs.includes("manual_urls"));
check("Fuentes A/B/C/D",runtime.includes("CLASS_A_DOMAINS")&&runtime.includes("CLASS_B_DOMAINS"));
check("Ranking de fuentes",runtime.includes("rankSources"));
check("Bloquea localhost",runtime.includes("localhost"));
check("Bloquea IP privada",runtime.includes("isPrivateIp"));
check("Valida DNS",runtime.includes("dns.lookup"));
check("Controla redirects",runtime.includes("MAX_REDIRECTS"));
check(
  "Extractor limita respuesta web",
  runtime.includes("MAX_FETCH_BYTES = 2_000_000") &&
  runtime.includes("readResponseTextLimited") &&
  runtime.includes("reader.cancel")
);
check("Timeout extracción",runtime.includes("FETCH_TIMEOUT_MS"));
check("Solo http/https",runtime.includes('["http:", "https:"]'));
check(
  "Evidence no inventa hechos",
  /extract\s+only\s+evidence\s+explicitly\s+supported/i.test(runtime) &&
  runtime.includes("Never infer missing numbers") &&
  runtime.includes("do not fill the gap from memory")
);
check("Claims ligados a evidence/source IDs",runtime.includes("Every claim must list exact evidence IDs"));
check("Filtra IDs inválidos",runtime.includes("validE")&&runtime.includes("validS"));
check("Contradiction Engine",runtime.includes("CONTRADICTION_ENGINE"));
check("Fact Verifier",runtime.includes("FACT_VERIFIER"));
check("Fact verifier prefiere A/B",runtime.includes("independent Class A/B"));
check("Citation audit fuerte",runtime.includes("strong"));
check("Gap detector",runtime.includes("RESEARCH_GAP_DETECTOR"));
check("Dossier prohibitedClaims",runtime.includes("prohibitedClaims"));
check("Dossier citationPlan",runtime.includes("citationPlan"));
check("Dossier coverageScore",runtime.includes("coverageScore"));
check("Dossier evidenceScore",runtime.includes("evidenceScore"));
check("Dossier factualConfidenceScore",runtime.includes("factualConfidenceScore"));
check("Dossier readyForWriting",runtime.includes("readyForWriting"));
check("Parser JSON balanceado",runtime.includes("balancedJson"));
check(
  "Retry JSON truncado bajo Credit Guard",
  runtime.includes("RESEARCH_GENERATE_MAX_ATTEMPTS") &&
  runtime.includes("researchGenerateMaxAttempts") &&
  runtime.includes('process.env.RESEARCH_CREDIT_GUARD || "1"') &&
  runtime.includes('process.env.RESEARCH_GENERATE_MAX_ATTEMPTS || 1') &&
  runtime.includes("attempt >= researchGenerateMaxAttempts")
);
check("Max output 32768",runtime.includes("32768"));
for(const step of ["INIT","STRATEGY","QUERIES","DISCOVER","RANK","EXTRACT","EVIDENCE","CLAIMS","CONTRADICTIONS","VERIFY","CITATIONS","GAPS","DOSSIER","PERSIST"])check(`Worker procesa ${step}`,worker.includes(`checkpoint.step===\"${step}\"`)||worker.includes(`checkpoint.step === \"${step}\"`));
check("11D.3 procesa GAP_DISCOVER",worker.includes('checkpoint.step==="GAP_DISCOVER"'));
check("11D.3 procesa GAP_RANK",worker.includes('checkpoint.step==="GAP_RANK"'));
check("11D.3 procesa GAP_EXTRACT",worker.includes('checkpoint.step==="GAP_EXTRACT"'));
check("11D.3 procesa GAP_EVIDENCE",worker.includes('checkpoint.step==="GAP_EVIDENCE"'));
check("11D.3 máximo 2 rondas",worker.includes("MAX_GAP_CLOSURE_PASSES = 2"));
check("11D.3 máximo 12 queries por ronda",worker.includes("MAX_GAP_QUERIES_PER_PASS = 12"));
check("11D.3 máximo 6 fuentes nuevas por ronda",worker.includes("MAX_GAP_SOURCES_PER_PASS = 6"));
check("11D.3 conserva historial",worker.includes("gapClosureHistory"));
check("11D.3 frena sin mejora material",worker.includes("NO_MATERIAL_IMPROVEMENT"));
check("11D.3 frena si no aparecen fuentes nuevas",worker.includes("NO_NEW_SOURCES"));
check("11D.3 persiste grounding evidence",worker.includes("groundingEvidenceAvailable") && worker.includes("s.excerpt||s.groundingExcerpt"));

check("11D.4 prioriza CRITICAL gaps",worker.includes("criticalGapsForClosure")&&worker.includes("highGapsForClosure"));
check("11D.4 crea preguntas específicas por gap",worker.includes("gapQuestions")&&worker.includes("gapQuestionIdByGap"));
check("11D.4 GAP_EVIDENCE usa gapQuestions",worker.includes("(checkpoint.gapQuestions||[]).length"));
check("11D.4 Discovery conoce propósito",runtime.includes('Research purpose: ${input.query.purpose || "General research"}'));
check("11D.4 Gap Detector reevalúa cierre",runtime.includes("Do not repeat a gap already resolved by newer explicit evidence")&&runtime.includes("Never downgrade or close a gap without explicit supplied evidence"));

check("11D.4.1 no destruye letra s",!worker.includes('replace(/s+/g'));
check("11D.4.1 whitespace regex correcto",worker.includes('/\\s+/g'));
check("11D.4.1 dedupe URL canónica",worker.includes("canonicalResearchUrl")&&worker.includes("consolidateResearchInputs"));
check("11D.4.1 dedupe evidencia semántica",worker.includes("normalizeEvidenceFingerprint"));
check("11D.4.1 CLAIM_BUILDER usa grafo consolidado",worker.includes("researchIntegrity:")&&worker.includes("removedDuplicateSources"));

check("11D.5 stable gap fingerprint",runtime.includes("stableGapFingerprint"));
check("11D.5 source authority independence",runtime.includes("researchSourceAuthorityKey"));
check("11D.5 derived official calculation",runtime.includes("DERIVED_OFFICIAL_CALCULATION"));
check("11D.5 Critical Evidence Resolver",runtime.includes("resolveBlockingResearchGaps"));
check("11D.5 resolution ledger OPEN PARTIAL RESOLVED",runtime.includes('"OPEN","PARTIAL","RESOLVED"')||runtime.includes('"OPEN",\n        "PARTIAL",\n        "RESOLVED"'));
check("11D.5 contradiction scope adjudication",runtime.includes("APPARENT_CONTRADICTION_RESOLVED_BY_SCOPE"));
check("11D.5 worker CRITICAL_RESOLVE",worker.includes('checkpoint.step==="CRITICAL_RESOLVE"'));
check("11D.5 máximo 8 resolver queries",worker.includes("MAX_CRITICAL_RESOLVER_QUERIES = 8"));
check("11D.5 resolver review final",worker.includes("CRITICAL_RESOLVER_COMPLETE"));
check("11D.5 verifiedClaims exige citationReady",worker.includes('c.status==="VERIFIED" &&')&&worker.includes("Boolean(c.citationReady)"));

check("11D.5.1 FINAL_BLOCKER_FOLLOWUP stage",worker.includes('checkpoint.step==="FINAL_BLOCKER_FOLLOWUP"'));
check("11D.5.1 máximo 4 follow-up queries",worker.includes("MAX_FINAL_BLOCKER_FOLLOWUP_QUERIES = 4"));
check("11D.5.1 follow-up una sola vez",worker.includes("criticalResolverFollowupCompleted")&&worker.includes("criticalResolverFollowupActive"));
check("11D.5.1 dedupe queries previas",worker.includes("usedFollowupQueries")&&worker.includes("rememberFollowupQuery"));
check("11D.5.1 CRITICAL tiene prioridad",worker.includes("const rank:any={")&&worker.includes("CRITICAL:2")&&worker.includes("HIGH:1"));
check("11D.5.1 finaliza sin segundo loop",worker.includes("FINAL_BLOCKER_FOLLOWUP_COMPLETE"));

check("Worker secret server-side",worker.includes("RESEARCH_WORKER_SECRET"));
check("Worker heartbeat",worker.includes("research_heartbeat_job"));
check("Worker persiste sources",worker.includes('from("research_sources")'));
check("Worker persiste evidence",worker.includes('from("research_evidence")'));
check("Worker persiste claims",worker.includes('from("research_claims")'));
check("Worker persiste dossier",worker.includes('from("research_dossiers")'));
check("Jobs autentica JWT",jobs.includes("auth.getUser"));
check("Jobs ownership",jobs.includes('.eq("user_id",user.id)'));
check("Jobs idempotency",jobs.includes("idempotencyKey"));
check("Jobs reutiliza activos",jobs.includes("reused:true"));
check("Máximo 30 fuentes",jobs.includes("Math.min(30"));
check("Client usa ../supabase",client.includes('../supabase'));
for(const table of ["research_jobs","research_sources","research_evidence","research_claims","research_dossiers"])check(`SQL crea ${table}`,sql.includes(`public.${table}`));
check("SQL lease atómico",sql.includes("for update skip locked"));
check("SQL heartbeat",sql.includes("research_heartbeat_job"));
check("SQL release/checkpoint",sql.includes("research_release_job"));
check("SQL retry/backoff",sql.includes("power(2,v_attempts)"));
check("SQL dead letter",sql.includes("DEAD_LETTER"));
check("SQL sweep",sql.includes("research_sweep_jobs"));
check("SQL RLS jobs",sql.includes("research_jobs_select_own"));
check("SQL RLS sources",sql.includes("research_sources_select_own"));
check("SQL RLS evidence",sql.includes("research_evidence_select_own"));
check("SQL RLS claims",sql.includes("research_claims_select_own"));
check("SQL RLS dossiers",sql.includes("research_dossiers_select_own"));
check("SQL revoca writes cliente",sql.includes("revoke insert,update,delete"));
check("Runner no imprime secret",!runner.includes("console.log(secret"));
check("Prep no imprime secret",!prep.includes("Write-Host $Secret"));
check("package research:11d:test",Boolean(pkg.scripts?.["research:11d:test"]));
check("package research:11d:worker",Boolean(pkg.scripts?.["research:11d:worker"]));
check("package research:11d:verify",Boolean(pkg.scripts?.["research:11d:verify"]));
check("Sin clave Gemini literal",!/AIza[0-9A-Za-z_-]{20,}/.test(runtime+worker+jobs));
console.log("\n====================================================");console.log("GENELIBROS 5.0 — RESEARCH INTELLIGENCE 11D TESTS");console.log("====================================================");
let passed=0;for(const [name,ok] of checks){console.log(`${ok?"✅ PASS":"❌ FAIL"}: ${name}`);if(ok)passed++;}
console.log(`\n${passed}/${checks.length} pruebas pasaron.`);if(passed!==checks.length)process.exit(1);console.log("✅ FASE 11D: Research Intelligence estructuralmente validada.");

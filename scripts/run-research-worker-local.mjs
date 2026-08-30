const url=process.env.RESEARCH_WORKER_URL||"http://localhost:3000/api/research-worker";
const secret=process.env.RESEARCH_WORKER_SECRET;
if(!secret){console.error("Falta RESEARCH_WORKER_SECRET en el proceso.");process.exit(1);}
console.log("\n================================================");
console.log(" GENELIBROS 11D — LOCAL RESEARCH INTELLIGENCE");
console.log("================================================");
console.log("Worker:",url,"\n");
let tick=0,idle=0;
while(tick<250){tick+=1;try{
  const r=await fetch(url,{method:"POST",headers:{"x-research-worker-secret":secret}});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body={raw:text}};
  if(!r.ok){console.log(`[TICK ${String(tick).padStart(2,"0")}] HTTP ${r.status}`,body);await new Promise(x=>setTimeout(x,12000));continue;}
  if(body?.idle){idle+=1;if(idle>=3){console.log("No hay Research jobs activos.");break;}await new Promise(x=>setTimeout(x,5000));continue;}
  idle=0;const result=body?.result||{};
  console.log(`[TICK ${String(tick).padStart(2,"0")}] step=${body?.step||"?"} -> ${body?.next_step||body?.status||"?"} progress=${body?.progress??"?"}%`+(result.sources!=null?` sources=${result.sources}`:"")+(result.evidence_total!=null?` evidence=${result.evidence_total}`:"")+(result.claims!=null?` claims=${result.claims}`:"")+(result.ready_for_writing!=null?` ready=${result.ready_for_writing}`:""));
  if(body?.status==="COMPLETED"){console.log("\n✅ RESEARCH INTELLIGENCE COMPLETED");console.log("Dossier:",result.dossier_id);console.log("Ready for writing:",result.readyForWriting);console.log("Coverage:",result.coverageScore);console.log("Evidence:",result.evidenceScore);console.log("Factual confidence:",result.factualConfidenceScore);console.log("Sources:",result.sources);console.log("Claims:",result.claims);console.log("Gaps:",result.gaps);console.log("AI calls:",result?.usage?.calls);console.log("Tokens:",result?.usage?.totalTokens);break;}
  await new Promise(x=>setTimeout(x,1200));
}catch(e){console.log(`[TICK ${String(tick).padStart(2,"0")}] NETWORK ERROR:`,e?.message||e);await new Promise(x=>setTimeout(x,8000));}}

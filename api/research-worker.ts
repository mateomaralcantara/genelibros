type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: any;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  json(body: unknown): any;
};

import {
  createClient } from "@supabase/supabase-js";
import {
  addUsage,
  analyzeEvidence,
  auditCitations,
  buildClaims,
  buildDossier,
  buildQueries,
  buildResearchStrategy,
  detectContradictions,
  detectResearchGaps,
  discoverGroundedSources,
  extractSource,
  mergeSources,
  rankSources,
  sourceFromManualUrl,
  verifyClaims,
  resolveBlockingResearchGaps
} from "../src/server/research-intelligence-runtime";

export const maxDuration = 300;
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const WORKER_SECRET=process.env.RESEARCH_WORKER_SECRET||"";
const json=(res:VercelResponse,status:number,body:unknown)=>res.status(status).json(body);
const workerToken=(req:VercelRequest)=>String(req.headers["x-research-worker-secret"]||req.headers.authorization||"").replace(/^Bearer\s+/i,"");


/**
 * 11D.4.1 RESEARCH INTEGRITY
 *
 * El discovery puede recibir dos redirects Grounding distintos
 * que después de EXTRACT terminan en la misma URL final.
 *
 * Antes de construir claims:
 * - consolida fuentes por URL final canónica;
 * - remapea evidence.sourceId al source ganador;
 * - elimina evidencia semánticamente duplicada de la misma fuente;
 * - evita que una misma noticia cuente como corroboración independiente.
 */

function canonicalResearchUrl(raw:any){
  const value=
    String(raw||"").trim();

  if(!value){
    return "";
  }

  try{
    const url=
      new URL(value);

    url.hash="";

    const tracking=[
      "fbclid",
      "gclid",
      "dclid",
      "msclkid",
      "mc_cid",
      "mc_eid"
    ];

    for(
      const key
      of [...url.searchParams.keys()]
    ){
      const lower=
        key.toLowerCase();

      if(
        lower.startsWith("utm_") ||
        tracking.includes(lower)
      ){
        url.searchParams.delete(key);
      }
    }

    url.hostname=
      url.hostname.toLowerCase();

    if(
      url.pathname.length>1
    ){
      url.pathname=
        url.pathname.replace(
          /\/+$/g,
          ""
        );
    }

    return url.toString();

  }catch{
    return value.toLowerCase();
  }
}

function sourceIntegrityScore(
  source:any
){
  const sourceClassScore:any={
    A:40,
    B:30,
    C:20,
    D:10
  };

  return (
    (
      source?.extractionStatus==="EXTRACTED"
        ? 100
        : 0
    ) +

    (
      sourceClassScore[
        String(source?.sourceClass||"")
      ] || 0
    ) +

    Number(
      source?.credibilityScore||0
    ) +

    Math.min(
      20,
      String(
        source?.excerpt||
        source?.groundingExcerpt||
        ""
      ).length/1000
    )
  );
}

function uniqueStrings(
  values:any[]
){
  return Array.from(
    new Set(
      (values||[])
        .map(
          value=>
            String(value||"").trim()
        )
        .filter(Boolean)
    )
  );
}

function normalizeEvidenceFingerprint(
  value:any
){
  return String(value||"")
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9%$€£¥.,:/ -]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function consolidateResearchInputs(
  sources:any[],
  evidence:any[]
){
  const groups=
    new Map();

  for(
    const source
    of sources||[]
  ){
    const canonical=
      canonicalResearchUrl(
        source?.url
      );

    const key=
      canonical ||
      ("id:"+
        String(source?.id||""));

    const current=
      groups.get(key)||[];

    current.push(source);

    groups.set(
      key,
      current
    );
  }

  const aliases=
    new Map();

  const consolidatedSources=[];

  for(
    const [canonical,group]
    of groups.entries()
  ){
    const sorted=[
      ...group
    ].sort(
      (a,b)=>
        sourceIntegrityScore(b)-
        sourceIntegrityScore(a)
    );

    const winner=
      sorted[0];

    if(!winner){
      continue;
    }

    for(
      const source
      of sorted
    ){
      aliases.set(
        String(source?.id||""),
        String(winner?.id||"")
      );
    }

    const merged={
      ...winner,

      url:
        canonical.startsWith("id:")
          ? winner.url
          : canonical,

      queryIds:
        uniqueStrings(
          sorted.flatMap(
            item=>
              Array.isArray(item?.queryIds)
                ? item.queryIds
                : []
          )
        ),

      groundingSupportCount:
        sorted.reduce(
          (sum,item)=>
            sum+
            Number(
              item?.groundingSupportCount||0
            ),
          0
        ),

      excerpt:
        sorted
          .map(
            item=>
              String(item?.excerpt||"")
          )
          .filter(Boolean)
          .sort(
            (a,b)=>
              b.length-a.length
          )[0] ||
        winner.excerpt ||
        null,

      groundingExcerpt:
        sorted
          .map(
            item=>
              String(
                item?.groundingExcerpt||""
              )
          )
          .filter(Boolean)
          .sort(
            (a,b)=>
              b.length-a.length
          )[0] ||
        winner.groundingExcerpt ||
        null
    };

    consolidatedSources.push(
      merged
    );
  }

  const evidenceGroups=
    new Map();

  for(
    const item
    of evidence||[]
  ){
    const sourceId=
      aliases.get(
        String(item?.sourceId||"")
      ) ||
      String(item?.sourceId||"");

    const normalized={
      ...item,
      sourceId
    };

    const fingerprint=
      sourceId+
      "::"+
      normalizeEvidenceFingerprint(
        item?.evidence
      );

    const existing=
      evidenceGroups.get(
        fingerprint
      );

    if(!existing){

      evidenceGroups.set(
        fingerprint,
        normalized
      );

      continue;
    }

    const existingScore=
      Number(
        existing?.confidenceScore||0
      )*100+
      Number(
        existing?.relevanceScore||0
      );

    const incomingScore=
      Number(
        normalized?.confidenceScore||0
      )*100+
      Number(
        normalized?.relevanceScore||0
      );

    const winner=
      incomingScore>
      existingScore
        ? normalized
        : existing;

    const loser=
      winner===normalized
        ? existing
        : normalized;

    evidenceGroups.set(
      fingerprint,
      {
        ...winner,

        questionIds:
          uniqueStrings([
            ...(
              Array.isArray(
                winner?.questionIds
              )
                ? winner.questionIds
                : []
            ),
            ...(
              Array.isArray(
                loser?.questionIds
              )
                ? loser.questionIds
                : []
            )
          ]),

        supports:
          uniqueStrings([
            ...(
              Array.isArray(
                winner?.supports
              )
                ? winner.supports
                : []
            ),
            ...(
              Array.isArray(
                loser?.supports
              )
                ? loser.supports
                : []
            )
          ]),

        limitations:
          uniqueStrings([
            ...(
              Array.isArray(
                winner?.limitations
              )
                ? winner.limitations
                : []
            ),
            ...(
              Array.isArray(
                loser?.limitations
              )
                ? loser.limitations
                : []
            )
          ])
      }
    );
  }

  const consolidatedEvidence=
    Array.from(
      evidenceGroups.values()
    );

  return {
    sources:
      consolidatedSources,

    evidence:
      consolidatedEvidence,

    sourceAliases:
      Object.fromEntries(
        aliases.entries()
      ),

    removedSources:
      Math.max(
        0,
        (sources||[]).length-
        consolidatedSources.length
      ),

    removedEvidence:
      Math.max(
        0,
        (evidence||[]).length-
        consolidatedEvidence.length
      )
  };
}

export default async function handler(req:VercelRequest,res:VercelResponse){

const MAX_GAP_CLOSURE_PASSES = 2;
const MAX_GAP_QUERIES_PER_PASS = 12;
const MAX_GAP_SOURCES_PER_PASS = 6;
const MAX_CRITICAL_RESOLVER_QUERIES = 8;
const MAX_FINAL_BLOCKER_FOLLOWUP_QUERIES = 4;

  let admin: any = null;let job:any=null;const workerId=`research-${process.pid}-${Date.now()}`;
  try{
    if(req.method!=="POST")return json(res,405,{error:"Método no permitido."});
    if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!WORKER_SECRET)return json(res,500,{error:"Faltan variables del Research worker."});
    if(workerToken(req)!==WORKER_SECRET)return json(res,401,{error:"Worker no autorizado."});
    admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    await admin.rpc("research_sweep_jobs");
    const {data:claimed,error:claimError}=await admin.rpc("research_claim_job",{p_worker_id:workerId,p_lease_seconds:240});if(claimError)throw claimError;
    job=Array.isArray(claimed)?claimed[0]:claimed;
    if(!job)return json(res,200,{ok:true,idle:true,message:"No hay Research jobs activos."});
    const checkpoint={...(job.checkpoint||{}),step:job.checkpoint?.step||"INIT",usage:job.checkpoint?.usage||{calls:0,inputTokens:0,outputTokens:0,totalTokens:0},warnings:job.checkpoint?.warnings||[]};
    const release=async(nextCheckpoint:any,progress:number,result:any={})=>{const {error}=await admin!.rpc("research_release_job",{p_job_id:job.id,p_worker_id:workerId,p_checkpoint:nextCheckpoint,p_progress:progress,p_result:result});if(error)throw error;return json(res,200,{ok:true,job_id:job.id,status:"QUEUED",progress,step:checkpoint.step,next_step:nextCheckpoint.step,result});};
    const heartbeat=async()=>{const {error}=await admin!.rpc("research_heartbeat_job",{p_job_id:job.id,p_worker_id:workerId,p_lease_seconds:240});if(error)throw error;};

    if(checkpoint.step==="INIT"){
      const {data:project,error}=await admin.from("projects").select("id,title").eq("id",job.project_id).eq("user_id",job.user_id).maybeSingle();if(error)throw error;if(!project)throw new Error("Proyecto no encontrado.");
      let chapterTitle:string|null=null,chapterContent:string|null=null;
      if(job.chapter_number){const {data:section}=await admin.from("sections").select("title,content,chapter_number,order_index").eq("project_id",job.project_id).eq("type","CHAPTER").or(`chapter_number.eq.${job.chapter_number},order_index.eq.${job.chapter_number}`).limit(1).maybeSingle();chapterTitle=section?.title||null;chapterContent=section?.content||null;}
      const manualSources=(job.manual_urls||[]).map((u:string)=>{try{return sourceFromManualUrl(u)}catch{return null}}).filter(Boolean);
      return release({...checkpoint,step:"STRATEGY",projectTitle:project.title||"Libro",chapterTitle,chapterContent,sources:manualSources,nextQueryIndex:0,nextExtractIndex:0,nextEvidenceIndex:0},2);
    }

    if(checkpoint.step==="STRATEGY"){
      await heartbeat();const out=await buildResearchStrategy({topic:job.topic,objective:job.objective||"Construir un dossier verificable antes de escribir.",projectTitle:checkpoint.projectTitle,chapterTitle:checkpoint.chapterTitle,chapterContent:checkpoint.chapterContent});
      return release({...checkpoint,step:"QUERIES",strategy:out.strategy,usage:addUsage(checkpoint.usage,out.usage),model:out.model},8);
    }

    if(checkpoint.step==="QUERIES"){
      await heartbeat();const out=await buildQueries({topic:job.topic,questions:checkpoint.strategy?.questions||[]});
      return release({...checkpoint,step:"DISCOVER",queries:out.queries,nextQueryIndex:0,usage:addUsage(checkpoint.usage,out.usage),model:out.model},14);
    }

    if(checkpoint.step==="DISCOVER"){
      const queries=checkpoint.queries||[];const index=Number(checkpoint.nextQueryIndex||0);
      if(index>=queries.length)return release({...checkpoint,step:"RANK"},32);
      await heartbeat();
      try{const out=await discoverGroundedSources({query:queries[index]});const merged=mergeSources(checkpoint.sources||[],out.sources);return release({...checkpoint,step:"DISCOVER",nextQueryIndex:index+1,sources:merged,usage:addUsage(checkpoint.usage,out.usage),model:out.model},Math.min(31,15+Math.round(((index+1)/Math.max(1,queries.length))*16)),{query:index+1,queries:queries.length,sources:merged.length});}
      catch(error:any){const warnings=[...(checkpoint.warnings||[]),`Search query ${index+1}: ${error?.message||"grounding search failed"}`];if(index===queries.length-1&&!(checkpoint.sources||[]).length)throw error;return release({...checkpoint,step:"DISCOVER",nextQueryIndex:index+1,warnings},Math.min(31,15+Math.round(((index+1)/Math.max(1,queries.length))*16)));}
    }

    if(checkpoint.step==="RANK"){
      const ranked=rankSources(checkpoint.sources||[],Number(job.max_sources||10));if(!ranked.length)throw new Error("Research Intelligence no obtuvo fuentes utilizables.");
      return release({...checkpoint,step:"EXTRACT",rankedSources:ranked,nextExtractIndex:0},36,{ranked_sources:ranked.length});
    }

    if(checkpoint.step==="EXTRACT"){
      const sources=checkpoint.rankedSources||[];const index=Number(checkpoint.nextExtractIndex||0);if(index>=sources.length)return release({...checkpoint,step:"EVIDENCE",nextEvidenceIndex:0},56);
      await heartbeat();const updated=[...sources];try{updated[index]=await extractSource(updated[index]);}catch(error:any){updated[index]={...updated[index],extractionStatus:"FAILED",extractionError:error?.message||"No se pudo extraer la fuente."};}
      return release({...checkpoint,step:"EXTRACT",rankedSources:updated,nextExtractIndex:index+1},Math.min(55,37+Math.round(((index+1)/sources.length)*18)),{extracted:index+1,sources:sources.length,status:updated[index].extractionStatus});
    }

    if(checkpoint.step==="EVIDENCE"){
      const sources=checkpoint.rankedSources||[];const index=Number(checkpoint.nextEvidenceIndex||0);if(index>=sources.length)return release({...checkpoint,step:"CLAIMS"},74);
      const source=sources[index];if(source.extractionStatus!=="EXTRACTED"&&!String(source.groundingExcerpt||"").trim())return release({...checkpoint,step:"EVIDENCE",nextEvidenceIndex:index+1},Math.min(73,57+Math.round(((index+1)/sources.length)*16)));
      await heartbeat();const out=await analyzeEvidence({source,questions:checkpoint.strategy?.questions||[]});const evidence=[...(checkpoint.evidence||[]),...out.evidence];
      return release({...checkpoint,step:"EVIDENCE",nextEvidenceIndex:index+1,evidence,usage:addUsage(checkpoint.usage,out.usage),model:out.model},Math.min(73,57+Math.round(((index+1)/sources.length)*16)),{analyzed:index+1,sources:sources.length,evidence_total:evidence.length});
    }


    if(checkpoint.step==="CLAIMS"){

      const consolidated=
        consolidateResearchInputs(
          checkpoint.rankedSources||[],
          checkpoint.evidence||[]
        );

      const out=
        await buildClaims({
          topic:job.topic,
          evidence:
            consolidated.evidence,
          sources:
            consolidated.sources
        });

      const claimsProgress=
        Number(
          checkpoint.gapClosurePass||0
        )>0
          ? 96
          : 79;

      return release(
        {
          ...checkpoint,

          step:
            "CONTRADICTIONS",

          rankedSources:
            consolidated.sources,

          evidence:
            consolidated.evidence,

          sourceAliases:
            consolidated.sourceAliases,

          researchIntegrity:{
            removedDuplicateSources:
              consolidated.removedSources,

            removedDuplicateEvidence:
              consolidated.removedEvidence
          },

          claims:
            out.claims,

          usage:
            addUsage(
              checkpoint.usage,
              out.usage
            ),

          model:
            out.model
        },

        claimsProgress,

        {
          claims:
            out.claims.length,

          sources:
            consolidated.sources.length,

          evidence:
            consolidated.evidence.length,

          duplicate_sources_removed:
            consolidated.removedSources,

          duplicate_evidence_removed:
            consolidated.removedEvidence
        }
      );
    }

    if(checkpoint.step==="CONTRADICTIONS"){
      await heartbeat();const out=await detectContradictions({claims:checkpoint.claims||[],evidence:checkpoint.evidence||[],sources:checkpoint.rankedSources||[]});
      return release({...checkpoint,step:"VERIFY",contradictions:out.contradictions,usage:addUsage(checkpoint.usage,out.usage),model:out.model},Number(checkpoint.gapClosurePass||0)>0?96:83,{contradictions:out.contradictions.length});
    }

    if(checkpoint.step==="VERIFY"){
      await heartbeat();const out=await verifyClaims({claims:checkpoint.claims||[],contradictions:checkpoint.contradictions||[],evidence:checkpoint.evidence||[],sources:checkpoint.rankedSources||[]});
      return release({...checkpoint,step:"CITATIONS",claims:out.claims,usage:addUsage(checkpoint.usage,out.usage),model:out.model},Number(checkpoint.gapClosurePass||0)>0?96:87);
    }

    if(checkpoint.step==="CITATIONS"){
      const claims=await auditCitations({claims:checkpoint.claims||[],sources:checkpoint.rankedSources||[]});return release({...checkpoint,step:"GAPS",claims},Number(checkpoint.gapClosurePass||0)>0?96:90);
    }

    if(checkpoint.step==="GAPS"){
      await heartbeat();const out=await detectResearchGaps({topic:job.topic,questions:checkpoint.strategy?.questions||[],claims:checkpoint.claims||[],evidence:checkpoint.evidence||[],sources:checkpoint.rankedSources||[]});
      return release({...checkpoint,step:"DOSSIER",gaps:out.gaps,usage:addUsage(checkpoint.usage,out.usage),model:out.model},Number(checkpoint.gapClosurePass||0)>0?96:93,{gaps:out.gaps.length});
    }


    if(checkpoint.step==="GAP_DISCOVER"){
      const queries=checkpoint.gapQueries||[];
      const index=Number(checkpoint.nextGapQueryIndex||0);

      if(index>=queries.length){
        return release(
          {...checkpoint,step:"GAP_RANK"},
          96,
          {
            gap_pass:Number(checkpoint.gapClosurePass||0),
            gap_queries:queries.length,
            discovered_gap_sources:(checkpoint.gapSources||[]).length
          }
        );
      }

      await heartbeat();

      try{
        const out=await discoverGroundedSources({
          query:queries[index]
        });

        const merged=mergeSources(
          checkpoint.gapSources||[],
          out.sources
        );

        return release(
          {
            ...checkpoint,
            step:"GAP_DISCOVER",
            nextGapQueryIndex:index+1,
            gapSources:merged,
            usage:addUsage(
              checkpoint.usage,
              out.usage
            ),
            model:out.model
          },
          96,
          {
            gap_pass:Number(checkpoint.gapClosurePass||0),
            gap_query:index+1,
            gap_queries:queries.length,
            gap_sources:merged.length
          }
        );

      }catch(error:any){

        const warnings=[
          ...(checkpoint.warnings||[]),
          "Gap search query "+
            (index+1)+
            ": "+
            (error?.message||
              "grounding search failed")
        ];

        return release(
          {
            ...checkpoint,
            step:"GAP_DISCOVER",
            nextGapQueryIndex:index+1,
            warnings
          },
          96,
          {
            gap_pass:Number(checkpoint.gapClosurePass||0),
            gap_query:index+1,
            gap_search_failed:true
          }
        );
      }
    }

    if(checkpoint.step==="GAP_RANK"){
      const existing=
        checkpoint.rankedSources||[];

      const knownUrls=
        new Set(
          existing
            .map((s:any)=>
              String(s?.url||"").trim()
            )
            .filter(Boolean)
        );

      const candidates=
        (checkpoint.gapSources||[])
          .filter(
            (s:any)=>
              !knownUrls.has(
                String(s?.url||"").trim()
              )
          );

      const remainingCapacity=
        Math.max(
          0,
          30-existing.length
        );

      const sourceLimit=
        Math.min(
          MAX_GAP_SOURCES_PER_PASS,
          remainingCapacity
        );

      const ranked=
        sourceLimit>0
          ? rankSources(
              candidates,
              sourceLimit
            )
          : [];

      if(!ranked.length){

        const history=[
          ...(checkpoint.gapClosureHistory||[]),
          {
            pass:
              Number(
                checkpoint.gapClosurePass||0
              ),
            queries:
              (checkpoint.gapQueries||[])
                .map(
                  (q:any)=>
                    String(q?.query||"")
                )
                .filter(Boolean),
            baseline:
              checkpoint.gapBaseline||null,
            stopped:
              "NO_NEW_SOURCES"
          }
        ];

        return release(
          {
            ...checkpoint,
            step:"PERSIST",
            gapClosureHistory:history,
            gapClosureStopReason:
              "NO_NEW_SOURCES",

            criticalResolverNoNewSourcesHandled:
              Boolean(
                checkpoint.criticalResolverActive
              ),

            criticalResolverCompleted:
              checkpoint.criticalResolverActive
                ? true
                : checkpoint.criticalResolverCompleted,

            criticalResolverActive:
              false,

            criticalResolverFollowupCompleted:
              checkpoint.criticalResolverFollowupActive
                ? true
                : checkpoint.criticalResolverFollowupCompleted,

            criticalResolverFollowupActive:
              false
          },
          97,
          {
            gap_closure:
              "NO_NEW_SOURCES",
            gap_pass:
              Number(
                checkpoint.gapClosurePass||0
              )
          }
        );
      }

      const allSources=
        mergeSources(
          existing,
          ranked
        );

      return release(
        {
          ...checkpoint,
          step:"GAP_EXTRACT",
          rankedSources:allSources,
          gapRankedSources:ranked,
          nextGapExtractIndex:0
        },
        96,
        {
          gap_pass:
            Number(
              checkpoint.gapClosurePass||0
            ),
          new_sources:ranked.length,
          total_sources:allSources.length
        }
      );
    }

    if(checkpoint.step==="GAP_EXTRACT"){
      const gapSources=
        checkpoint.gapRankedSources||[];

      const index=
        Number(
          checkpoint.nextGapExtractIndex||0
        );

      if(index>=gapSources.length){
        return release(
          {
            ...checkpoint,
            step:"GAP_EVIDENCE",
            nextGapEvidenceIndex:0,
            gapEvidenceAdded:0
          },
          96
        );
      }

      await heartbeat();

      const updatedGap=[
        ...gapSources
      ];

      try{
        updatedGap[index]=
          await extractSource(
            updatedGap[index]
          );

      }catch(error:any){

        updatedGap[index]={
          ...updatedGap[index],
          extractionStatus:"FAILED",
          extractionError:
            error?.message||
            "No se pudo extraer la fuente."
        };
      }

      const updatedSource=
        updatedGap[index];

      const allSources=
        (checkpoint.rankedSources||[])
          .map(
            (source:any)=>
              source.id===updatedSource.id
                ? updatedSource
                : source
          );

      return release(
        {
          ...checkpoint,
          step:"GAP_EXTRACT",
          rankedSources:allSources,
          gapRankedSources:updatedGap,
          nextGapExtractIndex:index+1
        },
        96,
        {
          gap_pass:
            Number(
              checkpoint.gapClosurePass||0
            ),
          extracted:index+1,
          gap_sources:gapSources.length,
          status:
            updatedSource.extractionStatus
        }
      );
    }

    if(checkpoint.step==="GAP_EVIDENCE"){
      const gapSources=
        checkpoint.gapRankedSources||[];

      const index=
        Number(
          checkpoint.nextGapEvidenceIndex||0
        );

      if(index>=gapSources.length){

        return release(
          {
            ...checkpoint,
            step:"CLAIMS"
          },
          96,
          {
            gap_pass:
              Number(
                checkpoint.gapClosurePass||0
              ),
            gap_evidence_added:
              Number(
                checkpoint.gapEvidenceAdded||0
              ),
            evidence_total:
              (checkpoint.evidence||[])
                .length
          }
        );
      }

      const source=
        gapSources[index];

      if(
        source.extractionStatus!=="EXTRACTED" &&
        !String(
          source.groundingExcerpt||""
        ).trim()
      ){
        return release(
          {
            ...checkpoint,
            step:"GAP_EVIDENCE",
            nextGapEvidenceIndex:index+1
          },
          96,
          {
            gap_pass:
              Number(
                checkpoint.gapClosurePass||0
              ),
            skipped:index+1
          }
        );
      }

      await heartbeat();

      const out=
        await analyzeEvidence({
          source,
          questions:
            (checkpoint.gapQuestions||[]).length
              ? checkpoint.gapQuestions
              : checkpoint.strategy
                  ?.questions||[]
        });

      const beforeCount=
        (checkpoint.evidence||[])
          .length;

      const evidenceMap=
        new Map<string,any>();

      for(
        const item of [
          ...(checkpoint.evidence||[]),
          ...out.evidence
        ]
      ){
        if(item?.id){
          evidenceMap.set(
            item.id,
            item
          );
        }
      }

      const evidence=
        Array.from(
          evidenceMap.values()
        );

      const added=
        Math.max(
          0,
          evidence.length-beforeCount
        );

      return release(
        {
          ...checkpoint,
          step:"GAP_EVIDENCE",
          nextGapEvidenceIndex:index+1,
          evidence,
          gapEvidenceAdded:
            Number(
              checkpoint.gapEvidenceAdded||0
            )+added,
          usage:addUsage(
            checkpoint.usage,
            out.usage
          ),
          model:out.model
        },
        96,
        {
          gap_pass:
            Number(
              checkpoint.gapClosurePass||0
            ),
          analyzed:index+1,
          gap_sources:gapSources.length,
          evidence_total:evidence.length,
          evidence_added:added
        }
      );
    }




    if(checkpoint.step==="FINAL_BLOCKER_FOLLOWUP"){
      await heartbeat();

      const followupQueries=
        Array.isArray(
          checkpoint.finalBlockerFollowupQueries
        )
          ? checkpoint.finalBlockerFollowupQueries
          : [];

      const followupQuestions=
        Array.isArray(
          checkpoint.finalBlockerFollowupQuestions
        )
          ? checkpoint.finalBlockerFollowupQuestions
          : [];

      /*
       * Nada nuevo que buscar:
       * finalizar conservadoramente.
       */
      if(!followupQueries.length){
        return release(
          {
            ...checkpoint,

            step:"PERSIST",

            criticalResolverActive:
              false,

            criticalResolverFollowupActive:
              false,

            criticalResolverFollowupCompleted:
              true,

            gapClosureStopReason:
              "FINAL_BLOCKER_FOLLOWUP_NO_NEW_QUERIES"
          },
          97,
          {
            final_blocker_followup:
              "NO_NEW_QUERIES"
          }
        );
      }

      return release(
        {
          ...checkpoint,

          step:"GAP_DISCOVER",

          criticalResolverActive:
            false,

          criticalResolverCompleted:
            true,

          criticalResolverFollowupActive:
            true,

          criticalResolverFollowupCompleted:
            false,

          gapQueries:
            followupQueries,

          gapQuestions:
            followupQuestions,

          nextGapQueryIndex:
            0,

          gapSources:
            [],

          gapRankedSources:
            [],

          nextGapExtractIndex:
            0,

          nextGapEvidenceIndex:
            0,

          gapEvidenceAdded:
            0,

          gapClosureStopReason:
            null
        },
        96,
        {
          final_blocker_followup:
            "STARTED",

          followup_queries:
            followupQueries.length
        }
      );
    }


    if(checkpoint.step==="CRITICAL_RESOLVE"){
      await heartbeat();

      const blockers=
        (
          checkpoint.gaps||
          checkpoint.dossier?.gaps||
          []
        )
          .filter(
            (gap:any)=>
              gap.severity==="CRITICAL" ||
              gap.severity==="HIGH"
          );

      const out=
        await resolveBlockingResearchGaps({
          topic:
            String(job.topic||""),

          gaps:
            blockers,

          evidence:
            checkpoint.evidence||[],

          sources:
            checkpoint.rankedSources||[],

          claims:
            checkpoint.claims||[],

          contradictions:
            checkpoint.contradictions||[]
        });

      const nextUsage=
        addUsage(
          checkpoint.usage,
          out.usage
        );

      const usedQueries=
        new Set<string>();

      const normalizeQuery=
        (value:any)=>
          String(value||"")
            .trim()
            .replace(/\s+/g," ")
            .toLowerCase();

      for(
        const query
        of checkpoint.queries||[]
      ){
        const normalized=
          normalizeQuery(
            query?.query
          );

        if(normalized){
          usedQueries.add(
            normalized
          );
        }
      }

      for(
        const entry
        of checkpoint.gapClosureHistory||[]
      ){
        for(
          const query
          of Array.isArray(entry?.queries)
            ? entry.queries
            : []
        ){
          const normalized=
            normalizeQuery(query);

          if(normalized){
            usedQueries.add(
              normalized
            );
          }
        }
      }

      for(
        const query
        of checkpoint.gapQueries||[]
      ){
        const normalized=
          normalizeQuery(
            query?.query
          );

        if(normalized){
          usedQueries.add(
            normalized
          );
        }
      }

      const prepared:any[]=[];

      resolverQueries:
      for(
        const resolution
        of out.resolutions||[]
      ){
        if(
          resolution.status==="RESOLVED"
        ){
          continue;
        }

        for(
          const rawQuery
          of resolution.targetedQueries||[]
        ){
          const query=
            String(rawQuery||"")
              .trim()
              .replace(/\s+/g," ");

          const normalized=
            normalizeQuery(query);

          if(
            !query ||
            !normalized ||
            usedQueries.has(normalized)
          ){
            continue;
          }

          usedQueries.add(
            normalized
          );

          prepared.push({
            gapId:
              resolution.gapId,

            query
          });

          if(
            prepared.length>=
            MAX_CRITICAL_RESOLVER_QUERIES
          ){
            break resolverQueries;
          }
        }
      }

      /*
       * Sin nuevas queries:
       * no inventamos evidencia y no hacemos loops.
       */
      if(!prepared.length){
        return release(
          {
            ...checkpoint,

            step:"PERSIST",

            usage:
              nextUsage,

            model:
              out.model,

            criticalResolutionLedger:
              out.resolutions,

            criticalResolverCalculations:
              out.calculations,

            criticalResolverActive:
              false,

            criticalResolverCompleted:
              true,

            gapClosureStopReason:
              "CRITICAL_RESOLVER_NO_NEW_QUERIES"
          },
          97,
          {
            critical_resolver:
              "NO_NEW_QUERIES",

            blockers:
              blockers.length
          }
        );
      }

      const questionByGap=
        new Map<string,string>();

      const gapQuestions=
        blockers.map(
          (gap:any,index:number)=>{

            const id=
              "CRQ_"+
              (index+1);

            questionByGap.set(
              String(gap.id||""),
              id
            );

            return {
              id,

              question:
                String(
                  gap.gap||""
                ),

              importance:
                gap.severity,

              evidenceNeeded:[
                "Primary or official evidence whenever required",
                "Exact figures, dates, periods and entity scope",
                "Independent corroboration for material conflicts",
                "Evidence that directly resolves this blocker"
              ]
            };
          }
        );

      const gapQueries=
        prepared.map(
          (entry:any,index:number)=>({

            id:
              "CRGAP_"+
              (index+1),

            query:
              entry.query,

            purpose:
              "Critical Evidence Resolver: "+
              String(
                blockers.find(
                  (gap:any)=>
                    String(gap.id||"")===
                    String(entry.gapId||"")
                )?.gap||""
              ).slice(0,500),

            questionIds:
              questionByGap.has(
                String(entry.gapId||"")
              )
                ? [
                    questionByGap.get(
                      String(entry.gapId||"")
                    )
                  ]
                : []
          })
        );

      return release(
        {
          ...checkpoint,

          step:"GAP_DISCOVER",

          usage:
            nextUsage,

          model:
            out.model,

          criticalResolverActive:
            true,

          criticalResolverCompleted:
            false,

          criticalResolutionLedger:
            out.resolutions,

          criticalResolverCalculations:
            out.calculations,

          criticalResolverQueries:
            gapQueries,

          gapQueries,

          gapQuestions,

          nextGapQueryIndex:
            0,

          gapSources:
            [],

          gapRankedSources:
            [],

          nextGapExtractIndex:
            0,

          nextGapEvidenceIndex:
            0,

          gapEvidenceAdded:
            0,

          gapClosureStopReason:
            null
        },
        96,
        {
          critical_resolver:
            "STARTED",

          blockers:
            blockers.length,

          resolver_queries:
            gapQueries.length
        }
      );
    }


    if(checkpoint.step==="DOSSIER"){
      await heartbeat();

      const out=
        await buildDossier({
          title:
            String(
              checkpoint.projectTitle||
              "Libro"
            )+
            ": "+
            String(job.topic||""),
          questions:
            checkpoint.strategy
              ?.questions||[],
          sources:
            checkpoint.rankedSources||[],
          evidence:
            checkpoint.evidence||[],
          claims:
            checkpoint.claims||[],
          contradictions:
            checkpoint.contradictions||[],
          gaps:
            checkpoint.gaps||[]
        });

      const nextUsage=
        addUsage(
          checkpoint.usage,
          out.usage
        );

      const pass=
        Number(
          checkpoint.gapClosurePass||0
        );

      const criticalGaps=
        out.dossier.gaps
          .filter(
            (g:any)=>
              g.severity==="CRITICAL"
          )
          .length;

      const highGaps=
        out.dossier.gaps
          .filter(
            (g:any)=>
              g.severity==="HIGH"
          )
          .length;

      const verifiedClaims=
        out.dossier.claims
          .filter(
            (c:any)=>
              c.status==="VERIFIED" &&
              Boolean(c.citationReady)
          )
          .length;

      const classABSources=
        out.dossier.sources
          .filter(
            (s:any)=>
              s.sourceClass==="A" ||
              s.sourceClass==="B"
          )
          .length;

      const currentMetrics={
        coverage:
          Number(
            out.dossier.coverageScore||0
          ),
        evidence:
          out.dossier.evidence.length,
        evidenceScore:
          Number(
            out.dossier.evidenceScore||0
          ),
        claims:
          out.dossier.claims.length,
        verifiedClaims,
        classABSources,
        criticalGaps,
        highGaps,
        factual:
          Number(
            out.dossier
              .factualConfidenceScore||0
          )
      };

      let history=[
        ...(checkpoint.gapClosureHistory||[])
      ];

      let improved=true;

      if(
        pass>0 &&
        checkpoint.gapBaseline
      ){
        const baseline=
          checkpoint.gapBaseline;

        improved=
          Boolean(
            out.dossier.readyForWriting
          ) ||
          currentMetrics.coverage >=
            Number(
              baseline.coverage||0
            ) + 0.25 ||
          currentMetrics.evidence >
            Number(
              baseline.evidence||0
            ) ||
          currentMetrics.claims >
            Number(
              baseline.claims||0
            ) ||
          currentMetrics.verifiedClaims >
            Number(
              baseline.verifiedClaims||0
            ) ||
          currentMetrics.classABSources >
            Number(
              baseline.classABSources||0
            ) ||
          currentMetrics.criticalGaps <
            Number(
              baseline.criticalGaps||0
            );

        history=[
          ...history,
          {
            pass,
            queries:
              (checkpoint.gapQueries||[])
                .map(
                  (q:any)=>
                    String(q?.query||"")
                )
                .filter(Boolean),
            baseline,
            after:currentMetrics,
            newSources:
              (checkpoint.gapRankedSources||[])
                .length,
            newEvidence:
              Number(
                checkpoint.gapEvidenceAdded||0
              ),
            improved
          }
        ];
      }

      if(out.dossier.readyForWriting){

        return release(
          {
            ...checkpoint,
            step:"PERSIST",
            dossier:out.dossier,
            usage:nextUsage,
            model:out.model,
            gapClosureHistory:history,
            gapClosureStopReason:
              "READY_FOR_WRITING",

            criticalResolverCompleted:
              Boolean(
                checkpoint.criticalResolverActive
              ) ||
              Boolean(
                checkpoint.criticalResolverCompleted
              ),

            criticalResolverActive:
              false
          },
          97,
          {
            ready_for_writing:true,
            coverage_score:
              out.dossier.coverageScore,
            evidence_score:
              out.dossier.evidenceScore,
            factual_confidence_score:
              out.dossier
                .factualConfidenceScore,
            gap_passes:pass,
            gap_closure:
              "READY_FOR_WRITING"
          }
        );
      }



      /*
       * ======================================================
       * 11D.5.1 — FINAL BLOCKER FOLLOW-UP
       * ======================================================
       *
       * Dos situaciones:
       *
       * 1. Acaba de terminar CRITICAL_RESOLVE:
       *    adjudicamos nuevamente y, si aparecieron queries
       *    nuevas para blockers CRITICAL/HIGH, permitimos
       *    UNA sola micro-ronda adicional.
       *
       * 2. Acaba de terminar esa micro-ronda:
       *    adjudicación final y PERSIST obligatorio.
       *
       * Nunca existe un segundo follow-up.
       */

      if(
        checkpoint.criticalResolverFollowupActive
      ){
        const finalReview=
          await resolveBlockingResearchGaps({
            topic:
              String(job.topic||""),

            gaps:
              out.dossier.gaps||[],

            evidence:
              checkpoint.evidence||[],

            sources:
              checkpoint.rankedSources||[],

            claims:
              checkpoint.claims||[],

            contradictions:
              checkpoint.contradictions||[]
          });

        const finalUsage=
          addUsage(
            nextUsage,
            finalReview.usage
          );

        return release(
          {
            ...checkpoint,

            step:"PERSIST",

            dossier:
              out.dossier,

            usage:
              finalUsage,

            model:
              finalReview.model,

            gapClosureHistory:
              history,

            criticalResolutionLedger:
              finalReview.resolutions,

            criticalResolverCalculations:
              finalReview.calculations,

            criticalResolverActive:
              false,

            criticalResolverCompleted:
              true,

            criticalResolverFollowupActive:
              false,

            criticalResolverFollowupCompleted:
              true,

            gapClosureStopReason:
              "FINAL_BLOCKER_FOLLOWUP_COMPLETE"
          },
          97,
          {
            ready_for_writing:
              out.dossier.readyForWriting,

            final_blocker_followup:
              "COMPLETE",

            remaining_blockers:
              (
                out.dossier.gaps||[]
              )
                .filter(
                  (gap:any)=>
                    gap.severity==="CRITICAL" ||
                    gap.severity==="HIGH"
                )
                .length
          }
        );
      }


      if(
        checkpoint.criticalResolverActive
      ){
        const review=
          await resolveBlockingResearchGaps({
            topic:
              String(job.topic||""),

            gaps:
              out.dossier.gaps||[],

            evidence:
              checkpoint.evidence||[],

            sources:
              checkpoint.rankedSources||[],

            claims:
              checkpoint.claims||[],

            contradictions:
              checkpoint.contradictions||[]
          });

        const reviewedUsage=
          addUsage(
            nextUsage,
            review.usage
          );


        /*
         * ------------------------------------------------------
         * DEDUPE DE TODAS LAS QUERIES YA EJECUTADAS
         * ------------------------------------------------------
         */

        const normalizeFollowupQuery=
          (value:any)=>
            String(value||"")
              .trim()
              .replace(/\s+/g," ")
              .toLowerCase();

        const usedFollowupQueries=
          new Set<string>();

        const rememberFollowupQuery=
          (value:any)=>{
            const normalized=
              normalizeFollowupQuery(value);

            if(normalized){
              usedFollowupQueries.add(
                normalized
              );
            }
          };


        for(
          const query
          of checkpoint.queries||[]
        ){
          rememberFollowupQuery(
            query?.query||query
          );
        }


        for(
          const entry
          of checkpoint.gapClosureHistory||[]
        ){
          for(
            const query
            of Array.isArray(entry?.queries)
              ? entry.queries
              : []
          ){
            rememberFollowupQuery(
              query?.query||query
            );
          }
        }


        for(
          const query
          of checkpoint.criticalResolverQueries||[]
        ){
          rememberFollowupQuery(
            query?.query||query
          );
        }


        for(
          const query
          of checkpoint.gapQueries||[]
        ){
          rememberFollowupQuery(
            query?.query||query
          );
        }


        for(
          const query
          of checkpoint.finalBlockerFollowupQueries||[]
        ){
          rememberFollowupQuery(
            query?.query||query
          );
        }


        /*
         * ------------------------------------------------------
         * SOLO BLOCKERS ABIERTOS/PARCIALES.
         * CRITICAL SIEMPRE PRIMERO.
         * ------------------------------------------------------
         */

        const unresolved=
          (review.resolutions||[])
            .filter(
              (resolution:any)=>
                resolution.status!=="RESOLVED" &&
                (
                  resolution.severity==="CRITICAL" ||
                  resolution.severity==="HIGH"
                )
            )
            .sort(
              (a:any,b:any)=>{
                const rank:any={
                  CRITICAL:2,
                  HIGH:1
                };

                return(
                  (rank[b.severity]||0) -
                  (rank[a.severity]||0)
                );
              }
            );


        const dossierGaps=
          new Map(
            (
              out.dossier.gaps||[]
            ).map(
              (gap:any)=>[
                String(gap.id||""),
                gap
              ]
            )
          );


        const questionByGap=
          new Map<string,string>();

        const followupQuestions=
          unresolved.map(
            (
              resolution:any,
              index:number
            )=>{

              const id=
                "FBQ_"+(index+1);

              questionByGap.set(
                String(
                  resolution.gapId||""
                ),
                id
              );

              const gap:any=
                dossierGaps.get(
                  String(
                    resolution.gapId||""
                  )
                );

              return {
                id,

                question:
                  String(
                    gap?.gap ||
                    resolution.rationale ||
                    ""
                  ),

                importance:
                  resolution.severity,

                evidenceNeeded:[
                  "Primary or official evidence whenever the blocker requires it",
                  "Exact amounts, dates, periods, definitions and entity scope",
                  "Independent authority when corroboration is required",
                  "Evidence directly capable of closing the blocker"
                ]
              };
            }
          );


        const followupQueries:any[]=[];


        followupLoop:
        for(
          const resolution
          of unresolved
        ){
          for(
            const rawQuery
            of Array.isArray(
              resolution.targetedQueries
            )
              ? resolution.targetedQueries
              : []
          ){
            const query=
              String(rawQuery||"")
                .trim()
                .replace(/\s+/g," ");

            const normalized=
              normalizeFollowupQuery(
                query
              );

            if(
              !query ||
              !normalized ||
              usedFollowupQueries.has(
                normalized
              )
            ){
              continue;
            }

            usedFollowupQueries.add(
              normalized
            );

            const gap:any=
              dossierGaps.get(
                String(
                  resolution.gapId||""
                )
              );

            followupQueries.push({
              id:
                "FBGAP_"+
                (
                  followupQueries.length+
                  1
                ),

              query,

              purpose:
                "Final Blocker Follow-up: "+
                String(
                  gap?.gap ||
                  resolution.rationale ||
                  ""
                ).slice(0,500),

              questionIds:
                questionByGap.has(
                  String(
                    resolution.gapId||""
                  )
                )
                  ? [
                      questionByGap.get(
                        String(
                          resolution.gapId||""
                        )
                      )
                    ]
                  : []
            });

            if(
              followupQueries.length>=
              MAX_FINAL_BLOCKER_FOLLOWUP_QUERIES
            ){
              break followupLoop;
            }
          }
        }


        /*
         * ------------------------------------------------------
         * SOLO UNA VEZ.
         * Si hay queries realmente nuevas, hacemos follow-up.
         * ------------------------------------------------------
         */

        if(
          followupQueries.length>0 &&
          !checkpoint.criticalResolverFollowupCompleted
        ){
          return release(
            {
              ...checkpoint,

              step:
                "FINAL_BLOCKER_FOLLOWUP",

              dossier:
                out.dossier,

              usage:
                reviewedUsage,

              model:
                review.model,

              gapClosureHistory:
                history,

              criticalResolutionLedger:
                review.resolutions,

              criticalResolverCalculations:
                review.calculations,

              criticalResolverActive:
                false,

              criticalResolverCompleted:
                true,

              criticalResolverFollowupActive:
                false,

              criticalResolverFollowupCompleted:
                false,

              finalBlockerFollowupQueries:
                followupQueries,

              finalBlockerFollowupQuestions:
                followupQuestions,

              gapClosureStopReason:
                null
            },
            96,
            {
              ready_for_writing:
                false,

              final_blocker_followup:
                "QUEUED",

              followup_queries:
                followupQueries.length,

              unresolved_blockers:
                unresolved.length
            }
          );
        }


        /*
         * Sin queries nuevas:
         * terminar conservadoramente.
         */

        return release(
          {
            ...checkpoint,

            step:"PERSIST",

            dossier:
              out.dossier,

            usage:
              reviewedUsage,

            model:
              review.model,

            gapClosureHistory:
              history,

            criticalResolutionLedger:
              review.resolutions,

            criticalResolverCalculations:
              review.calculations,

            criticalResolverActive:
              false,

            criticalResolverCompleted:
              true,

            criticalResolverFollowupActive:
              false,

            criticalResolverFollowupCompleted:
              true,

            gapClosureStopReason:
              "CRITICAL_RESOLVER_COMPLETE_NO_NOVEL_FOLLOWUP"
          },
          97,
          {
            ready_for_writing:
              out.dossier.readyForWriting,

            critical_resolver:
              "COMPLETE",

            final_blocker_followup:
              "NO_NOVEL_QUERIES",

            remaining_blockers:
              (
                out.dossier.gaps||[]
              )
                .filter(
                  (gap:any)=>
                    gap.severity==="CRITICAL" ||
                    gap.severity==="HIGH"
                )
                .length
          }
        );
      }


      if(
        pass>0 &&
        !improved
      ){

        return release(
          {
            ...checkpoint,
            step:"PERSIST",
            dossier:out.dossier,
            usage:nextUsage,
            model:out.model,
            gapClosureHistory:history,
            gapClosureStopReason:
              "NO_MATERIAL_IMPROVEMENT"
          },
          97,
          {
            ready_for_writing:false,
            gap_passes:pass,
            gap_closure:
              "NO_MATERIAL_IMPROVEMENT"
          }
        );
      }

      if(
        pass>=
        MAX_GAP_CLOSURE_PASSES
      ){
        const blockers=
          (
            out.dossier.gaps||[]
          )
            .filter(
              (gap:any)=>
                gap.severity==="CRITICAL" ||
                gap.severity==="HIGH"
            );

        if(
          blockers.length &&
          !checkpoint.criticalResolverCompleted &&
          !checkpoint.criticalResolverActive
        ){
          return release(
            {
              ...checkpoint,

              step:
                "CRITICAL_RESOLVE",

              dossier:
                out.dossier,

              usage:
                nextUsage,

              model:
                out.model,

              gapClosureHistory:
                history,

              criticalResolverBaseline:
                currentMetrics,

              gapClosureStopReason:
                null
            },
            96,
            {
              ready_for_writing:
                false,

              critical_resolver:
                "QUEUED",

              blockers:
                blockers.length
            }
          );
        }

        return release(
          {
            ...checkpoint,

            step:"PERSIST",

            dossier:
              out.dossier,

            usage:
              nextUsage,

            model:
              out.model,

            gapClosureHistory:
              history,

            gapClosureStopReason:
              "MAX_PASSES_REACHED"
          },
          97,
          {
            ready_for_writing:false,

            gap_passes:
              pass,

            gap_closure:
              "MAX_PASSES_REACHED"
          }
        );
      }


      const gaps=
        out.dossier.gaps||[];

      const criticalGapsForClosure=
        gaps.filter(
          (g:any)=>
            g.severity==="CRITICAL"
        );

      const highGapsForClosure=
        gaps.filter(
          (g:any)=>
            g.severity==="HIGH"
        );

      /*
       * 11D.4:
       * Mientras exista UN gap CRITICAL,
       * toda la ronda se dedica exclusivamente
       * a los CRITICAL.
       *
       * HIGH solo entra cuando CRITICAL=0.
       */
      const eligibleGaps=
        criticalGapsForClosure.length
          ? criticalGapsForClosure
          : highGapsForClosure.length
            ? highGapsForClosure
            : gaps.filter(
                (g:any)=>
                  g.severity==="MEDIUM"
              );

      const nextGapQuestionPass=
        pass+1;

      const gapQuestions=
        eligibleGaps.map(
          (gap:any,index:number)=>({
            id:
              "GQ"+
              nextGapQuestionPass+
              "_"+
              (index+1),

            question:
              String(
                gap?.gap||""
              ),

            importance:
              gap?.severity==="CRITICAL"
                ? "CRITICAL"
                : gap?.severity==="HIGH"
                  ? "HIGH"
                  : "MEDIUM",

            evidenceNeeded:[
              "Direct evidence that specifically resolves this research gap",
              "Exact figures, dates and measurement periods when applicable",
              "Primary or official source whenever available",
              "Current data when the gap explicitly requires current information",
              "Independent corroboration when the factual claim is material"
            ]
          })
        );

      const gapQuestionIdByGap=
        new Map(
          eligibleGaps.map(
            (gap:any,index:number)=>[
              String(
                gap?.id||
                gap?.gap||
                index
              ),

              gapQuestions[index]?.id
            ]
          )
        );

      const usedQueries=
        new Set<string>();

      const normalizeQuery=
        (value:any)=>
          String(value||"")
            .trim()
            .replace(/\s+/g," ")
            .toLowerCase();

      for(
        const query of
        checkpoint.queries||[]
      ){
        const normalized=
          normalizeQuery(query?.query);

        if(normalized){
          usedQueries.add(normalized);
        }
      }

      for(
        const entry of history
      ){
        for(
          const query of
          Array.isArray(entry?.queries)
            ? entry.queries
            : []
        ){
          const normalized=
            normalizeQuery(query);

          if(normalized){
            usedQueries.add(normalized);
          }
        }
      }

      for(
        const query of
        checkpoint.gapQueries||[]
      ){
        const normalized=
          normalizeQuery(query?.query);

        if(normalized){
          usedQueries.add(normalized);
        }
      }

      const selectedQueries:any[]=[];

      outer:
      for(
        const gap of eligibleGaps
      ){

        const gapQuestionId=
          gapQuestionIdByGap.get(
            String(
              gap?.id||
              gap?.gap||
              ""
            )
          )||"";

        const recommended=
          Array.isArray(
            gap?.recommendedQueries
          )
            ? gap.recommendedQueries
            : [];

        for(
          const rawQuery of recommended
        ){
          const query=
            String(rawQuery||"")
              .trim()
              .replace(/\s+/g," ");

          const normalized=
            normalizeQuery(query);

          if(
            !query ||
            !normalized ||
            usedQueries.has(normalized)
          ){
            continue;
          }

          usedQueries.add(normalized);

          selectedQueries.push({
            query,
            purpose:
              "Close research gap: "+
              String(gap?.gap||"")
                .slice(0,500),
            questionIds:gapQuestionId?[gapQuestionId]:[]
          });

          if(
            selectedQueries.length>=
            MAX_GAP_QUERIES_PER_PASS
          ){
            break outer;
          }
        }
      }

      if(!selectedQueries.length){

        return release(
          {
            ...checkpoint,
            step:"PERSIST",
            dossier:out.dossier,
            usage:nextUsage,
            model:out.model,
            gapClosureHistory:history,
            gapClosureStopReason:
              "NO_ELIGIBLE_GAP_QUERIES"
          },
          97,
          {
            ready_for_writing:false,
            gap_passes:pass,
            gap_closure:
              "NO_ELIGIBLE_GAP_QUERIES"
          }
        );
      }

      const nextPass=
        pass+1;

      const gapQueries=
        selectedQueries.map(
          (query:any,index:number)=>({
            id:
              "GAP"+
              nextPass+
              "_"+
              (index+1),
            query:query.query,
            purpose:query.purpose,
            questionIds:
              query.questionIds
          })
        );

      return release(
        {
          ...checkpoint,
          step:"GAP_DISCOVER",
          dossier:out.dossier,
          usage:nextUsage,
          model:out.model,

          gapClosurePass:
            nextPass,

          gapClosureHistory:
            history,

          gapClosureStopReason:
            null,

          gapBaseline:
            currentMetrics,

          gapQueries,

          gapQuestions,

          nextGapQueryIndex:0,

          gapSources:[],

          gapRankedSources:[],

          nextGapExtractIndex:0,

          nextGapEvidenceIndex:0,

          gapEvidenceAdded:0
        },
        pass>0?96:94,
        {
          ready_for_writing:false,
          gap_closure:
            "START_PASS",
          gap_pass:
            nextPass,
          gap_queries:
            gapQueries.length,
          critical_gaps:
            criticalGaps,
          high_gaps:
            highGaps,
          coverage_score:
            out.dossier.coverageScore,
          evidence:
            out.dossier.evidence.length,
          claims:
            out.dossier.claims.length
        }
      );
    }

    if(checkpoint.step==="PERSIST"){
      const dossier=checkpoint.dossier;if(!dossier)throw new Error("Falta dossier para persistir.");
      const {data:dossierRow,error:dossierError}=await admin.from("research_dossiers").upsert({job_id:job.id,user_id:job.user_id,project_id:job.project_id,chapter_number:job.chapter_number,topic:job.topic,model:checkpoint.model,coverage_score:dossier.coverageScore,evidence_score:dossier.evidenceScore,factual_confidence_score:dossier.factualConfidenceScore,ready_for_writing:dossier.readyForWriting,result:dossier,usage:checkpoint.usage,completed_at:new Date().toISOString()},{onConflict:"job_id"}).select("id").single();if(dossierError)throw dossierError;
      if((checkpoint.rankedSources||[]).length){const {error}=await admin.from("research_sources").upsert((checkpoint.rankedSources||[]).map((s:any)=>({job_id:job.id,user_id:job.user_id,project_id:job.project_id,source_key:s.id,url:s.url,title:s.title,publisher:s.publisher,author:s.author,published_at:s.publishedAt,retrieved_at:s.retrievedAt,source_class:s.sourceClass,credibility_score:s.credibilityScore,metadata:{queryIds:s.queryIds,grounded:s.grounded,extractionStatus:s.extractionStatus,extractionError:s.extractionError,groundingSupportCount:s.groundingSupportCount||0,groundingEvidenceAvailable:Boolean(s.groundingExcerpt),evidenceFallback:!s.excerpt&&s.groundingExcerpt?"GOOGLE_SEARCH_GROUNDING_SUPPORT":null},excerpt:(s.excerpt||s.groundingExcerpt)?String(s.excerpt||s.groundingExcerpt).slice(0,4000):null})),{onConflict:"job_id,source_key"});if(error)throw error;}
      if((checkpoint.evidence||[]).length){const {error}=await admin.from("research_evidence").upsert((checkpoint.evidence||[]).map((e:any)=>({job_id:job.id,user_id:job.user_id,project_id:job.project_id,evidence_key:e.id,source_key:e.sourceId,question_ids:e.questionIds,evidence:e.evidence,relevance_score:e.relevanceScore,confidence_score:e.confidenceScore,supports:e.supports,limitations:e.limitations})),{onConflict:"job_id,evidence_key"});if(error)throw error;}
      if((checkpoint.claims||[]).length){const {error}=await admin.from("research_claims").upsert((checkpoint.claims||[]).map((c:any)=>({job_id:job.id,user_id:job.user_id,project_id:job.project_id,claim_key:c.id,claim:c.claim,verification_status:c.status,confidence_score:c.confidenceScore,evidence_ids:c.evidenceIds,source_ids:c.sourceIds,contradiction_ids:c.contradictionIds,citation_ready:c.citationReady})),{onConflict:"job_id,claim_key"});if(error)throw error;}
      const result={dossier_id:dossierRow.id,readyForWriting:dossier.readyForWriting,coverageScore:dossier.coverageScore,evidenceScore:dossier.evidenceScore,factualConfidenceScore:dossier.factualConfidenceScore,sources:dossier.sources.length,evidence:dossier.evidence.length,claims:dossier.claims.length,contradictions:dossier.contradictions.length,gaps:dossier.gaps.length,usage:checkpoint.usage,model:checkpoint.model,gapClosurePass:Number(checkpoint.gapClosurePass||0),gapClosureStopReason:checkpoint.gapClosureStopReason||null};
      const {error:completeError}=await admin.rpc("research_complete_job",{p_job_id:job.id,p_worker_id:workerId,p_result:result,p_checkpoint:{...checkpoint,step:"COMPLETED"}});if(completeError)throw completeError;
      return json(res,200,{ok:true,job_id:job.id,status:"COMPLETED",progress:100,result});
    }

    if(checkpoint.step==="COMPLETED")return json(res,200,{ok:true,job_id:job.id,status:"COMPLETED",progress:100,result:job.result});
    throw new Error(`Research step desconocido: ${checkpoint.step}`);
  }catch(error:any){if(admin&&job?.id){try{await admin.rpc("research_fail_job",{p_job_id:job.id,p_worker_id:workerId,p_error:error?.message||"Research worker error."});}catch{}}
    return json(res,500,{ok:false,job_id:job?.id||null,status:job?"RETRYING":"ERROR",error:error?.message||"Research worker error."});}
}

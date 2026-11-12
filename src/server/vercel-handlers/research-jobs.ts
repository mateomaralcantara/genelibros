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

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { guardPaidRequest, respondGuardError } from "../request-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const json = (res: VercelResponse, status: number, body: unknown) => res.status(status).json(body);
const tokenOf = (req: VercelRequest) => String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");

function safeUrl(v: unknown) {
  if (typeof v !== "string") return null;
  try { const u = new URL(v); return ["http:","https:"].includes(u.protocol) ? u.toString() : null; } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json(res,500,{error:"Faltan variables Supabase server-side."});
    const token = tokenOf(req); if (!token) return json(res,401,{error:"No autenticado."});
    const authClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
    const {data:{user},error:userError}=await authClient.auth.getUser(token); if(userError||!user)return json(res,401,{error:"Sesión inválida."});
    const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

    if(req.method==="GET"){
      const projectId=String(req.query.project_id||""); if(!projectId)return json(res,400,{error:"Falta project_id."});
      const {data:owned}=await admin.from("projects").select("id").eq("id",projectId).eq("user_id",user.id).maybeSingle();
      if(!owned)return json(res,404,{error:"Proyecto no encontrado."});
      const {data,error}=await admin.from("research_jobs").select("*").eq("project_id",projectId).eq("user_id",user.id).order("created_at",{ascending:false}).limit(25); if(error)throw error;
      return json(res,200,{ok:true,jobs:data||[]});
    }

    if(req.method!=="POST")return json(res,405,{error:"Método no permitido."});
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{}; if(body.action!=="enqueue")return json(res,400,{error:"action debe ser enqueue."});
    const projectId=String(body.project_id||""); const topic=String(body.topic||"").trim(); if(!projectId||!topic)return json(res,400,{error:"project_id y topic son obligatorios."});
    const chapterNumber=body.chapter_number==null?null:Math.max(1,Number(body.chapter_number)); const objective=String(body.objective||"").trim(); const depth=body.depth==="SUPREME"?"SUPREME":"DEEP"; const maxSources=Math.max(3,Math.min(30,Number(body.max_sources||(depth==="SUPREME"?18:10))));
    const {data:owned}=await admin.from("projects").select("id,title").eq("id",projectId).eq("user_id",user.id).maybeSingle(); if(!owned)return json(res,404,{error:"Proyecto no encontrado."});
    const manualUrls=Array.isArray(body.manual_urls)?Array.from(new Set(body.manual_urls.map(safeUrl).filter(Boolean).slice(0,25))):[];
    const idempotencyKey=crypto.createHash("sha256").update(JSON.stringify({user:user.id,project:projectId,chapter:chapterNumber,topic,objective,depth})).digest("hex");
    const {data:active}=await admin.from("research_jobs").select("*").eq("user_id",user.id).eq("idempotency_key",idempotencyKey).in("status",["QUEUED","RUNNING","RETRYING"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(active)return json(res,200,{ok:true,reused:true,job:active});
    try { await guardPaidRequest({kind:"user",userId:String(user.id)},"jobs"); }
    catch(guardError:any){ if(respondGuardError(res,guardError))return; throw guardError; }
    const {data:job,error}=await admin.from("research_jobs").insert({user_id:user.id,project_id:projectId,chapter_number:chapterNumber,topic,objective,depth,max_sources:maxSources,manual_urls:manualUrls,idempotency_key:idempotencyKey,status:"QUEUED",progress:0,checkpoint:{step:"INIT",usage:{calls:0,inputTokens:0,outputTokens:0,totalTokens:0},warnings:[]}}).select("*").single(); if(error)throw error;
    return json(res,202,{ok:true,reused:false,job});
  } catch(error:any){ return json(res,500,{error:error?.message||"Research jobs error."}); }
}

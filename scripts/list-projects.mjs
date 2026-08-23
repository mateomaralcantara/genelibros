import fs from "fs";
import path from "path";

function parseEnv(filePath){
  const raw = fs.readFileSync(filePath,"utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)){
    const t=line.trim(); if(!t||t.startsWith("#")) continue;
    const i=t.indexOf("="); if(i<0) continue;
    env[t.slice(0,i).trim()] = t.slice(i+1).trim();
  }
  return env;
}

const env = { ...parseEnv(path.join(process.cwd(), ".env.local")), ...process.env };
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) throw new Error("Falta VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (o SUPABASE_SERVICE_ROLE_KEY)");

const base = url.replace(/\/$/,"") + "/rest/v1";

const r = await fetch(`${base}/projects?select=id,title,updated_at&order=updated_at.desc&limit=20`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});

const text = await r.text();
if (!r.ok) throw new Error(`REST ${r.status}: ${text}`);

const data = JSON.parse(text);
console.table(data.map(p => ({ id: p.id, title: p.title, updated_at: p.updated_at })));
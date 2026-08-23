#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const daysArg = args.find(x => x.startsWith('--days='));
const watchArg = args.find(x => x.startsWith('--watch='));
const DAYS = Math.max(1, Math.min(3650, Number(daysArg?.split('=')[1] || 30)));
const WATCH = Math.max(0, Number(watchArg?.split('=')[1] || 0));
const CUTOFF = new Date(Date.now() - DAYS * 86400000).toISOString();
const PAGE = 1000;

function loadEnv(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

['.env.local','.env','.env.production.local','.env.production'].forEach(loadEnv);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

if (!url) throw new Error('Falta SUPABASE_URL o VITE_SUPABASE_URL.');
if (!serviceKey) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY. No uses VITE_ para esta clave y no la subas a Git.');

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const warnings = [];
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const dt = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const money = v => `$${n(v).toFixed(4)}`;
const ago = v => {
  const d = dt(v); if (!d) return '—';
  let s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s/60); if (m < 60) return `${m}m`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h`;
  const dd = Math.floor(h/24); return `${dd}d`;
};
const group = rows => {
  const m = new Map();
  for (const r of rows || []) { if (!r.user_id) continue; if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id).push(r); }
  return m;
};
const latest = (rows, k='created_at') => [...(rows || [])].sort((a,b)=>(dt(b?.[k])?.getTime()||0)-(dt(a?.[k])?.getTime()||0))[0] || null;

async function authUsers() {
  const out = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw error;
    const batch = data?.users || [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

async function table(name, filterRecent=false) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(name).select('*').range(from, from + PAGE - 1);
    if (filterRecent) q = q.gte('created_at', CUTOFF);
    const { data, error } = await q;
    if (error) { warnings.push(`${name}: ${error.message}`); return []; }
    const batch = data || [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function sessionState(devices) {
  const active = (devices || []).filter(x => !x.revoked_at && dt(x.last_seen_at) && Date.now()-dt(x.last_seen_at).getTime() <= 30*60*1000);
  const recent = active.filter(x => Date.now()-dt(x.last_seen_at).getTime() <= 2*60*1000);
  return { state: recent.length ? 'RECIENTE' : active.length ? 'ACTIVO' : 'OFFLINE', active: active.length };
}

function accessState(profile, request) {
  if (profile?.has_access === true) return 'APROBADO';
  const s = String(request?.status || '').toUpperCase();
  if (s === 'PENDING') return 'PENDIENTE';
  if (['REJECTED','DENIED'].includes(s)) return 'RECHAZADO';
  return 'SIN_ACCESO';
}

async function collect() {
  warnings.length = 0;
  const [users, profiles, requests, devices, projects, plans, usage, jobs, os4p, os4runs] = await Promise.all([
    authUsers(), table('profiles'), table('access_requests'), table('device_sessions'), table('projects'),
    table('user_plan_assignments'), table('usage_events', true), table('generation_jobs', true),
    table('os4_profiles'), table('os4_agent_runs', true)
  ]);

  const G = {
    profiles: group(profiles), requests: group(requests), devices: group(devices), projects: group(projects),
    plans: group(plans), usage: group(usage), jobs: group(jobs), os4p: group(os4p), os4runs: group(os4runs)
  };

  return users.map(u => {
    const id = u.id;
    const profile = latest(G.profiles.get(id), 'updated_at') || latest(G.profiles.get(id));
    const request = latest(G.requests.get(id));
    const devs = G.devices.get(id) || [];
    const projs = G.projects.get(id) || [];
    const plan = (G.plans.get(id) || []).find(x => String(x.status).toUpperCase() === 'ACTIVE') || latest(G.plans.get(id), 'updated_at');
    const use = G.usage.get(id) || [];
    const js = G.jobs.get(id) || [];
    const op = latest(G.os4p.get(id), 'updated_at');
    const oruns = G.os4runs.get(id) || [];
    const sess = sessionState(devs);
    const lastDevice = latest(devs, 'last_seen_at');
    const lastProject = latest(projs, 'updated_at');
    const lastRun = latest(oruns);
    const lastActivity = [u.last_sign_in_at,lastDevice?.last_seen_at,lastProject?.updated_at,lastRun?.created_at].map(dt).filter(Boolean).sort((a,b)=>b-a)[0] || null;
    const cost = use.reduce((s,x)=>s+n(x.estimated_cost_usd),0) + oruns.reduce((s,x)=>s+n(x.estimated_cost_usd),0);
    const alerts = [];
    if (sess.active > 1) alerts.push(`MULTIDISPOSITIVO:${sess.active}`);
    if (String(request?.status||'').toUpperCase()==='PENDING') alerts.push('SOLICITUD_PENDIENTE');
    const failed = js.filter(x => ['FAILED','ERROR','DEAD'].includes(String(x.status||'').toUpperCase())).length;
    if (failed) alerts.push(`JOBS_FALLIDOS:${failed}`);
    if (['BLOCKED','FAILED'].includes(String(op?.status||'').toUpperCase())) alerts.push(`OS4_${String(op.status).toUpperCase()}`);

    return {
      user_id: id,
      email: u.email || profile?.email || request?.email || '',
      nombre: profile?.full_name || request?.full_name || '',
      telefono: profile?.phone || request?.phone || '',
      acceso: accessState(profile, request),
      sesion: sess.state,
      dispositivos_activos: sess.active,
      ultimo_dispositivo: lastDevice?.device_label || '',
      ultima_actividad: lastActivity?.toISOString() || '',
      hace: ago(lastActivity),
      plan: plan?.plan_code || '—',
      creditos: plan?.credits_balance ?? null,
      proyectos: projs.length,
      ultimo_proyecto: lastProject?.title || '',
      eventos_uso: use.length,
      os4_runs: oruns.length,
      tokens_entrada: use.reduce((s,x)=>s+n(x.input_tokens),0)+oruns.reduce((s,x)=>s+n(x.input_tokens),0),
      tokens_salida: use.reduce((s,x)=>s+n(x.output_tokens),0)+oruns.reduce((s,x)=>s+n(x.output_tokens),0),
      costo_estimado_usd: Number(cost.toFixed(6)),
      jobs_cola: js.filter(x => ['QUEUED','PENDING'].includes(String(x.status||'').toUpperCase())).length,
      jobs_ejecutando: js.filter(x => ['RUNNING','PROCESSING'].includes(String(x.status||'').toUpperCase())).length,
      jobs_fallidos: failed,
      os4_stage: op?.current_stage || '—',
      os4_status: op?.status || '—',
      os4_score: op?.overall_score ?? null,
      alertas: alerts
    };
  }).sort((a,b)=>b.alertas.length-a.alertas.length || (dt(b.ultima_actividad)?.getTime()||0)-(dt(a.ultima_actividad)?.getTime()||0));
}

function csv(rows) {
  const keys = Object.keys(rows[0] || {});
  const esc = v => { const s = Array.isArray(v) ? v.join(' | ') : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  return [keys.join(','), ...rows.map(r => keys.map(k=>esc(r[k])).join(','))].join('\n')+'\n';
}

function html(rows) {
  const e = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const body = rows.map(r => `<tr class="${r.alertas.length?'alert':''}"><td>${e(r.email)}</td><td>${e(r.nombre)}</td><td>${e(r.acceso)}</td><td>${e(r.sesion)}</td><td>${e(r.plan)}</td><td>${r.proyectos}</td><td>${r.eventos_uso+r.os4_runs}</td><td>${e(money(r.costo_estimado_usd))}</td><td>${e(r.os4_stage+'/'+r.os4_status)}</td><td>${e(r.hace)}</td><td>${e(r.alertas.join(' | '))}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>BestSeller Usuarios</title><style>body{font-family:Segoe UI;background:#08111f;color:#e8eef9;padding:24px}table{width:100%;border-collapse:collapse;background:#0d1929}th,td{padding:9px;border-bottom:1px solid #24344c;font-size:12px;text-align:left}th{background:#14243a;position:sticky;top:0}.alert{background:#321a1d}.wrap{overflow:auto;max-height:80vh}.cards{display:flex;gap:12px;margin:18px 0}.card{background:#101d30;padding:15px;border-radius:12px;border:1px solid #24344c}</style><h1>BestSeller — Supervisor de Usuarios</h1><p>Ventana: ${DAYS} días · SOLO LECTURA · ${new Date().toLocaleString('es-DO')}</p><div class="cards"><div class="card">Usuarios<br><b>${rows.length}</b></div><div class="card">Aprobados<br><b>${rows.filter(x=>x.acceso==='APROBADO').length}</b></div><div class="card">Pendientes<br><b>${rows.filter(x=>x.acceso==='PENDIENTE').length}</b></div><div class="card">Activos ≤30m<br><b>${rows.filter(x=>x.sesion!=='OFFLINE').length}</b></div></div><div class="wrap"><table><thead><tr><th>Email</th><th>Nombre</th><th>Acceso</th><th>Sesión</th><th>Plan</th><th>Libros</th><th>Uso</th><th>Costo</th><th>OS4</th><th>Última</th><th>Alertas</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

async function run() {
  const rows = await collect();
  console.clear();
  console.log('==============================================================');
  console.log(' BESTSELLER — SUPERVISOR DE USUARIOS (SOLO LECTURA)');
  console.log('==============================================================');
  console.log(`Usuarios: ${rows.length} | Aprobados: ${rows.filter(x=>x.acceso==='APROBADO').length} | Pendientes: ${rows.filter(x=>x.acceso==='PENDIENTE').length} | Activos<=30m: ${rows.filter(x=>x.sesion!=='OFFLINE').length}`);
  console.table(rows.map(r=>({Email:r.email,Acceso:r.acceso,Sesion:r.sesion,Plan:r.plan,Libros:r.proyectos,Uso:r.eventos_uso+r.os4_runs,Costo:money(r.costo_estimado_usd),OS4:`${r.os4_stage}/${r.os4_status}`,Ultima:r.hace,Alertas:r.alertas.join('|')})));
  if (warnings.length) { console.log('\nADVERTENCIAS:'); warnings.forEach(w=>console.log('- '+w)); }

  const dir = path.join(ROOT,'reports'); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'users-supervision-latest.json'), JSON.stringify({generated_at:new Date().toISOString(),days:DAYS,warnings,users:rows},null,2));
  fs.writeFileSync(path.join(dir,'users-supervision-latest.csv'), csv(rows));
  fs.writeFileSync(path.join(dir,'users-supervision-latest.html'), html(rows));
  console.log('\nReportes:');
  console.log(path.join(dir,'users-supervision-latest.html'));
  console.log(path.join(dir,'users-supervision-latest.csv'));
  console.log(path.join(dir,'users-supervision-latest.json'));
}

if (WATCH > 0) {
  while (true) { try { await run(); } catch(e) { console.error(e); } await new Promise(r=>setTimeout(r,WATCH*1000)); }
} else {
  await run();
}

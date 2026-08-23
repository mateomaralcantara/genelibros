// src/data/repo.ts
import { supabase } from '../lib/supabase';

/**
 * Repo “all-in Supabase” optimizado:
 * - Tipos más claros
 * - updateProject + deleteProject
 * - upsertSection devuelve sectionId (útil para versionado)
 * - insertMasterSnapshot sin race (usa upsert + versión calculada en DB si tienes constraint)
 * - Errores con contexto
 *
 * Tablas esperadas:
 * - projects (id, user_id, title, topic, audience, tone_style, dossier jsonb, outline_12 jsonb, continuity_pack jsonb, created_at, updated_at)
 * - sections (id, project_id, type, chapter_number, title, content, status, updated_at, created_at)
 * - section_versions (id, section_id, content, created_at)
 * - master_documents (id, project_id, title, content, version int, created_at)
 * RPC:
 * - build_master_text(p_project_id uuid) -> text
 */

export type SectionType = 'PROPOSAL' | 'INTRODUCTION' | 'CHAPTER';
export type SectionStatus = 'PENDING' | 'COMPLETED';

export type ProjectRow = {
  id: string;
  user_id: string;
  title: string;
  topic: string | null;
  audience: string | null;
  tone_style: string | null;
  dossier: any;
  outline_12: any[];
  continuity_pack: any;
  created_at: string;
  updated_at: string;
};

export type SectionRow = {
  id: string;
  project_id: string;
  type: SectionType;
  chapter_number: number | null;
  title: string;
  content: string;
  status: SectionStatus;
  created_at?: string;
  updated_at?: string;
};

export type MasterDocRow = {
  id: string;
  project_id: string;
  title: string;
  content: string;
  version: number;
  created_at?: string;
};

function errCtx(msg: string, e: unknown): Error {
  const detail =
    typeof e === 'string'
      ? e
      : typeof (e as any)?.message === 'string'
        ? (e as any).message
        : JSON.stringify(e);
  return new Error(`${msg}: ${detail}`);
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw errCtx('getSession falló', error);
  const uid = data.session?.user?.id;
  if (!uid) throw new Error('No autenticado.');
  return uid;
}

/* ----------------------------- Auth ----------------------------- */

export async function signInMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw errCtx('signInMagicLink falló', error);
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw errCtx('getSession falló', error);
  return data.session;
}

/* ----------------------------- Projects ----------------------------- */

export async function listProjects(): Promise<Pick<ProjectRow, 'id' | 'title' | 'topic' | 'updated_at' | 'created_at'>[]> {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from('projects')
    .select('id,title,topic,updated_at,created_at')
    .eq('user_id', uid)
    .order('updated_at', { ascending: false });

  if (error) throw errCtx('listProjects falló', error);
  return data ?? [];
}

export async function createProject(payload: {
  title: string;
  topic?: string;
  audience?: string;
  tone_style?: string;
  dossier?: any;
  outline_12?: any[];
  continuity_pack?: any;
}): Promise<ProjectRow> {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: uid,
      title: payload.title,
      topic: payload.topic ?? null,
      audience: payload.audience ?? null,
      tone_style: payload.tone_style ?? null,
      dossier: payload.dossier ?? {},
      outline_12: payload.outline_12 ?? [],
      continuity_pack: payload.continuity_pack ?? {},
    })
    .select('*')
    .single();

  if (error) throw errCtx('createProject falló', error);
  return data as ProjectRow;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Pick<ProjectRow, 'title' | 'topic' | 'audience' | 'tone_style' | 'dossier' | 'outline_12' | 'continuity_pack'>>
) {
  const uid = await requireUserId();

  const { error } = await supabase
    .from('projects')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
    .eq('user_id', uid);

  if (error) throw errCtx('updateProject falló', error);
}

/**
 * Borra el libro completo.
 * Si tienes FK con ON DELETE CASCADE, podrías simplificar a borrar solo projects,
 * pero esta versión funciona incluso sin cascade.
 */
export async function deleteProject(projectId: string) {
  const uid = await requireUserId();

  // (0) ownership check rápido
  const { error: ownErr } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', uid).single();
  if (ownErr) throw errCtx('deleteProject: proyecto no encontrado o sin permisos', ownErr);

  // (1) secciones -> ids
  const { data: secRows, error: e1 } = await supabase.from('sections').select('id').eq('project_id', projectId);
  if (e1) throw errCtx('deleteProject: list sections falló', e1);

  const secIds = (secRows ?? []).map((r: any) => r.id).filter(Boolean);

  // (2) versions
  if (secIds.length) {
    const { error: e2 } = await supabase.from('section_versions').delete().in('section_id', secIds);
    if (e2) throw errCtx('deleteProject: delete section_versions falló', e2);
  }

  // (3) sections
  const { error: e3 } = await supabase.from('sections').delete().eq('project_id', projectId);
  if (e3) throw errCtx('deleteProject: delete sections falló', e3);

  // (4) master docs
  const { error: e4 } = await supabase.from('master_documents').delete().eq('project_id', projectId);
  if (e4) throw errCtx('deleteProject: delete master_documents falló', e4);

  // (5) project
  const { error: e5 } = await supabase.from('projects').delete().eq('id', projectId).eq('user_id', uid);
  if (e5) throw errCtx('deleteProject: delete project falló', e5);
}

/* ----------------------------- Full fetch ----------------------------- */

export async function getProjectFull(projectId: string): Promise<{
  project: ProjectRow;
  sections: SectionRow[];
  masterLatest: MasterDocRow | null;
}> {
  const uid = await requireUserId();

  const { data: project, error: e1 } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', uid)
    .single();
  if (e1) throw errCtx('getProjectFull: project falló', e1);

  const { data: sections, error: e2 } = await supabase
    .from('sections')
    .select('*')
    .eq('project_id', projectId)
    .order('type', { ascending: true })
    .order('chapter_number', { ascending: true });
  if (e2) throw errCtx('getProjectFull: sections falló', e2);

  const { data: masterLatest, error: e3 } = await supabase
    .from('master_documents')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1);
  if (e3) throw errCtx('getProjectFull: master_documents falló', e3);

  return { project: project as ProjectRow, sections: (sections ?? []) as SectionRow[], masterLatest: (masterLatest?.[0] ?? null) as any };
}

/* ----------------------------- Sections ----------------------------- */

/**
 * Upsert sección y devuelve su id (para que puedas versionarla).
 * Requiere constraint/unique: (project_id, type, chapter_number).
 */
export async function upsertSection(params: {
  project_id: string;
  type: SectionType;
  chapter_number: number | null;
  title: string;
  content: string;
  status: SectionStatus;
}): Promise<string> {
  const uid = await requireUserId();

  // ownership check: evita upsert en proyectos ajenos
  const { error: ownErr } = await supabase
    .from('projects')
    .select('id')
    .eq('id', params.project_id)
    .eq('user_id', uid)
    .single();
  if (ownErr) throw errCtx('upsertSection: proyecto no encontrado o sin permisos', ownErr);

  const { data, error } = await supabase
    .from('sections')
    .upsert(
      {
        project_id: params.project_id,
        type: params.type,
        chapter_number: params.chapter_number,
        title: params.title,
        content: params.content,
        status: params.status,
      },
      { onConflict: 'project_id,type,chapter_number' }
    )
    .select('id')
    .maybeSingle();

  if (error) throw errCtx('upsertSection falló', error);
  if (!data?.id) throw new Error('upsertSection: no se obtuvo id.');
  return data.id as string;
}

export async function insertSectionVersion(sectionId: string, content: string) {
  const { error } = await supabase.from('section_versions').insert({
    section_id: sectionId,
    content,
  });
  if (error) throw errCtx('insertSectionVersion falló', error);
}

/* ----------------------------- Master ----------------------------- */

/**
 * Snapshot del master.
 * Nota: calcular nextVersion en cliente puede tener race si abres 2 pestañas.
 * Mejor práctica: constraint UNIQUE(project_id, version) + retry simple.
 */
export async function insertMasterSnapshot(projectId: string, title: string, content: string) {
  const uid = await requireUserId();

  // ownership check
  const { error: ownErr } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', uid).single();
  if (ownErr) throw errCtx('insertMasterSnapshot: proyecto no encontrado o sin permisos', ownErr);

  // next version = max(version)+1 (client-side)
  const { data: latest, error: e0 } = await supabase
    .from('master_documents')
    .select('version')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1);

  if (e0) throw errCtx('insertMasterSnapshot: fetch latest version falló', e0);

  let nextVersion = (latest?.[0]?.version ?? 0) + 1;

  // insert con retry simple por si choca unique(project_id,version)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.from('master_documents').insert({
      project_id: projectId,
      title,
      content,
      version: nextVersion,
    });

    if (!error) return;

    // si falla por unique, sube versión y reintenta
    const msg = (error as any)?.message ?? '';
    const code = (error as any)?.code ?? '';
    if (code === '23505' || /duplicate key|unique/i.test(msg)) {
      nextVersion += 1;
      continue;
    }

    throw errCtx('insertMasterSnapshot falló', error);
  }

  throw new Error('insertMasterSnapshot: no se pudo insertar snapshot (colisión de version).');
}

export async function buildMasterServer(projectId: string) {
  const uid = await requireUserId();

  // ownership check
  const { error: ownErr } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', uid).single();
  if (ownErr) throw errCtx('buildMasterServer: proyecto no encontrado o sin permisos', ownErr);

  const { data, error } = await supabase.rpc('build_master_text', { p_project_id: projectId });
  if (error) throw errCtx('buildMasterServer falló', error);
  return (data ?? '') as string;
}

/* ----------------------------- Convenience helpers ----------------------------- */

/**
 * Flujo recomendado al guardar edición:
 * 1) upsertSection -> sectionId
 * 2) insertSectionVersion(sectionId, content)
 * 3) buildMasterServer(projectId) -> master
 * 4) insertMasterSnapshot(projectId, title, master)
 */
export async function saveSectionAndRebuildMaster(params: {
  project_id: string;
  type: SectionType;
  chapter_number: number | null;
  title: string;
  content: string;
  status: SectionStatus;
  project_title_for_master: string;
}) {
  const sectionId = await upsertSection({
    project_id: params.project_id,
    type: params.type,
    chapter_number: params.chapter_number,
    title: params.title,
    content: params.content,
    status: params.status,
  });

  // versionado (best effort, pero normalmente quieres que falle si falla)
  await insertSectionVersion(sectionId, params.content);

  const master = await buildMasterServer(params.project_id);
  await insertMasterSnapshot(params.project_id, params.project_title_for_master, master);

  return { sectionId, master };
}

// ----------------------------- User Settings -----------------------------
// Tabla: user_settings(user_id uuid PK, default_chapter_words int, updated_at timestamptz)

export async function getUserSettings(): Promise<{ default_chapter_words: number }> {
  const s = await getSession();
  const uid = s?.user?.id;
  if (!uid) throw new Error('No autenticado.');

  const { data, error } = await supabase
    .from('user_settings')
    .select('default_chapter_words')
    .eq('user_id', uid)
    .maybeSingle();

  // fallback si la tabla no existe todavía / RLS / etc.
  if (error) return { default_chapter_words: 3000 };

  const v = Number((data as any)?.default_chapter_words ?? 3000) || 3000;
  return { default_chapter_words: Math.max(500, Math.min(20000, v)) };
}

export async function upsertUserSettings(defaultChapterWords: number): Promise<number> {
  const s = await getSession();
  const uid = s?.user?.id;
  if (!uid) throw new Error('No autenticado.');

  const v = Math.max(500, Math.min(20000, Math.floor(Number(defaultChapterWords || 3000))));

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: uid, default_chapter_words: v, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (error) throw error;
  return v;
}
export async function getMyProfile() {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) throw new Error('No autenticado.');

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,has_access')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) throw error;

  return {
    user_id: uid,
    email: (data as any)?.email ?? session.user.email ?? '',
    has_access: Boolean((data as any)?.has_access),
  };
}

export async function getMyAccessRequest() {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) throw new Error('No autenticado.');

  const { data, error } = await supabase
    .from('access_requests')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] ?? null;
}

export async function createAccessRequest(payload: {
  name?: string;
  phone?: string;
  message?: string;
  transfer_reference?: string;
}) {
  const session = await getSession();
  const uid = session?.user?.id;
  const email = session?.user?.email;
  if (!uid || !email) throw new Error('No autenticado.');

  const { data, error } = await supabase
    .from('access_requests')
    .insert({
      user_id: uid,
      email,
      name: payload.name ?? null,
      phone: payload.phone ?? null,
      message: payload.message ?? null,
      transfer_reference: payload.transfer_reference ?? null,
      status: 'PENDING',
    })
    .select('id')
    .single();

  if (error) throw error;
  return (data as any)?.id as string;
}
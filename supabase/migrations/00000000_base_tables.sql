-- ============================================================
-- GENELIBROS — Tablas base de la aplicación
--
-- Estas tablas se crearon a mano en Supabase y no estaban versionadas.
-- Este archivo reproduce su estructura real de producción (exportada el
-- 2026-11-12): columnas, claves, restricciones y políticas RLS.
--
-- Va PRIMERO en supabase/install-order.txt: el resto de módulos las
-- referencian (projects, sections...).
--
-- Idempotente: en una base existente las tablas no se tocan
-- (create table if not exists) y las políticas se recrean iguales.
-- ============================================================

-- ---------- projects: un libro por fila ----------
create table if not exists public.projects (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  title text not null,
  topic text,
  audience text,
  tone_style text,
  dossier jsonb not null default '{}'::jsonb,
  outline_12 jsonb not null default '[]'::jsonb,
  continuity_pack jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  chapter_count integer not null default 12
);

-- ---------- sections: propuesta, introducción y capítulos ----------
create table if not exists public.sections (
  id uuid not null default gen_random_uuid() primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type = any (array['PROPOSAL'::text, 'INTRODUCTION'::text, 'CHAPTER'::text])),
  chapter_number integer,
  title text not null default ''::text,
  content text not null default ''::text,
  status text not null default 'PENDING'::text check (status = any (array['PENDING'::text, 'COMPLETED'::text])),
  words integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sections_project_id_type_chapter_number_key unique (project_id, type, chapter_number)
);

-- ---------- section_versions: historial de cada sección ----------
create table if not exists public.section_versions (
  id uuid not null default gen_random_uuid() primary key,
  section_id uuid not null references public.sections(id) on delete cascade,
  content text not null,
  words integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- master_documents: documento maestro del libro ----------
create table if not exists public.master_documents (
  id uuid not null default gen_random_uuid() primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default ''::text,
  content text not null default ''::text,
  words integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

-- ---------- profiles: datos del usuario y aprobación (has_access) ----------
-- has_access por defecto false: solo un administrador aprueba
-- (ver 20261116_profiles_has_access_default_false.sql y
-- 20261113_protect_profile_access.sql).
create table if not exists public.profiles (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  email text,
  has_access boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text,
  phone text
);

-- ---------- access_requests: solicitudes de acceso ----------
create table if not exists public.access_requests (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  name text,
  phone text,
  message text,
  transfer_reference text,
  status text not null default 'PENDING'::text check (status = any (array['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text
);

-- ---------- user_settings: preferencias por usuario ----------
create table if not exists public.user_settings (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  default_chapter_words integer not null default 3000,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.projects enable row level security;
alter table public.sections enable row level security;
alter table public.section_versions enable row level security;
alter table public.master_documents enable row level security;
alter table public.profiles enable row level security;
alter table public.access_requests enable row level security;
alter table public.user_settings enable row level security;

-- projects: cada usuario solo ve y modifica sus libros.
drop policy if exists projects_owner_select on public.projects;
create policy projects_owner_select on public.projects for select using (auth.uid() = user_id);
drop policy if exists projects_owner_insert on public.projects;
create policy projects_owner_insert on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists projects_owner_update on public.projects;
create policy projects_owner_update on public.projects for update using (auth.uid() = user_id);
drop policy if exists projects_owner_delete on public.projects;
create policy projects_owner_delete on public.projects for delete using (auth.uid() = user_id);

-- sections / section_versions / master_documents: a través del proyecto.
drop policy if exists sections_owner_all on public.sections;
create policy sections_owner_all on public.sections for all
  using (exists (select 1 from public.projects p where p.id = sections.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = sections.project_id and p.user_id = auth.uid()));

drop policy if exists section_versions_owner_all on public.section_versions;
create policy section_versions_owner_all on public.section_versions for all
  using (exists (select 1 from public.sections s join public.projects p on p.id = s.project_id
                 where s.id = section_versions.section_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.sections s join public.projects p on p.id = s.project_id
                      where s.id = section_versions.section_id and p.user_id = auth.uid()));

drop policy if exists master_docs_owner_all on public.master_documents;
create policy master_docs_owner_all on public.master_documents for all
  using (exists (select 1 from public.projects p where p.id = master_documents.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = master_documents.project_id and p.user_id = auth.uid()));

-- profiles: leer y editar el propio; al crearlo, has_access debe ser false.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = user_id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert
  with check (auth.uid() = user_id and has_access = false);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- access_requests: crear y leer las propias.
drop policy if exists requests_select_own on public.access_requests;
create policy requests_select_own on public.access_requests for select using (auth.uid() = user_id);
drop policy if exists requests_insert_own on public.access_requests;
create policy requests_insert_own on public.access_requests for insert with check (auth.uid() = user_id);

-- user_settings: leer, crear y editar las propias.
drop policy if exists "read own settings" on public.user_settings;
create policy "read own settings" on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists "insert own settings" on public.user_settings;
create policy "insert own settings" on public.user_settings for insert with check (auth.uid() = user_id);
drop policy if exists "update own settings" on public.user_settings;
create policy "update own settings" on public.user_settings for update using (auth.uid() = user_id);

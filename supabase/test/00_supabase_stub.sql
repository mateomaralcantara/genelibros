-- Simulación mínima de Supabase (roles, auth.uid(), tablas base) para probar
-- el orden de instalación en un Postgres normal. No ejecutar en producción.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
create schema if not exists extensions;
-- Tablas base creadas a mano en el proyecto real (forma mínima deducida del código).
create table if not exists public.projects (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), title text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.sections (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete cascade, kind text, chapter_number int, title text, content text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.profiles (user_id uuid primary key, email text, full_name text, phone text, has_access boolean not null default false);

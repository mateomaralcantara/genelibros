-- ============================================================
-- GENELIBROS — Una sola propuesta y una sola introducción por libro
--
-- Problema: la regla única de sections es (project_id, type, chapter_number)
-- y la propuesta y la introducción tienen chapter_number = NULL. En
-- Postgres dos NULL no chocan, así que cada guardado creaba una fila NUEVA
-- (un libro real tenía 3 propuestas y 6 introducciones) y al cargar salía
-- una cualquiera, a veces vacía.
--
-- Esta migración:
--   1. Por libro y tipo, conserva la fila más reciente CON TEXTO (si ninguna
--      tiene texto, la más reciente).
--   2. Mueve el historial (section_versions) de las demás a la conservada:
--      no se pierde ninguna versión.
--   3. Borra las filas sobrantes.
--   4. Crea un índice único para que no vuelva a pasar.
-- El código (src/data/repo.ts upsertSection) ya actualiza la fila existente.
--
-- Idempotente. Ejecutar una vez en Supabase → SQL Editor.
-- ============================================================

do $$
begin
  if to_regclass('public.sections') is null then
    raise notice 'sections no existe todavía: nada que deduplicar.';
    return;
  end if;

  create temporary table _singleton_ranked on commit drop as
  select
    s.id,
    s.project_id,
    s.type,
    row_number() over (
      partition by s.project_id, s.type
      order by (length(btrim(coalesce(s.content, ''))) > 0) desc,
               s.updated_at desc nulls last,
               s.created_at desc nulls last,
               s.id
    ) as rn
  from public.sections s
  where s.chapter_number is null;

  create temporary table _singleton_map on commit drop as
  select d.id as dup_id, k.id as keep_id
  from _singleton_ranked d
  join _singleton_ranked k
    on k.project_id = d.project_id and k.type = d.type and k.rn = 1
  where d.rn > 1;

  if to_regclass('public.section_versions') is not null then
    update public.section_versions v
    set section_id = m.keep_id
    from _singleton_map m
    where v.section_id = m.dup_id;
  end if;

  delete from public.sections s
  using _singleton_map m
  where s.id = m.dup_id;

  raise notice 'Filas duplicadas eliminadas: %', (select count(*) from _singleton_map);
end;
$$;

create unique index if not exists sections_one_singleton_per_project
  on public.sections (project_id, type)
  where chapter_number is null;

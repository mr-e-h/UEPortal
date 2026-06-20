-- Batch-lagring + versjonshistorikk for egenproduksjon (regneark-Avstemming).
--
-- ADDITIV (0018-stil): CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- enable RLS uten policies (= default-deny; tilgang via service_role i app-laget).
-- Idempotent: trygt å kjøre om igjen — ingen destruktive endringer.
--
-- PK/FK-typer: text, som baseline og 0018.
-- ISOLASJON: tabellen eksponeres ALDRI UE-side. Snapshot lagrer KUN rå celler
-- (egenprod-mengde / resolution / handled) — INGEN kundeverdi/kr.
--
-- Trinn:
--   A) Pre-steg (kritisk): slå sammen duplikate internal-rader → idempotent via CTE.
--   B) Unik delvis indeks på (project_id, project_budget_line_id, executed_by)
--      WHERE project_budget_line_id IS NOT NULL — nøkkel for batch-upsert.
--   C) Ny tabell project_production_versions — snapshot-historikk.

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Slå sammen duplikate (project_id, project_budget_line_id, 'internal')-rader.
--    Beholdt-raden: eldste id (min). Slettede rader: alle andre i gruppen.
--    Mengde summeres inn i eldste rad. CTE er idempotent: ingen duplikat = no-op.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_count integer;
begin
  -- Tell duplikate grupper (grupper med > 1 rad)
  select count(*) into v_count
  from (
    select project_id, project_budget_line_id
    from public.project_production_entries
    where executed_by = 'internal'
      and project_budget_line_id is not null
    group by project_id, project_budget_line_id
    having count(*) > 1
  ) dup;

  if v_count > 0 then
    -- Steg 1: oppdater eldste rad med summen av alle rader i gruppen
    with grouped as (
      select
        min(id) as keep_id,
        sum(quantity) as total_qty
      from public.project_production_entries
      where executed_by = 'internal'
        and project_budget_line_id is not null
      group by project_id, project_budget_line_id
      having count(*) > 1
    )
    update public.project_production_entries e
    set quantity = g.total_qty
    from grouped g
    where e.id = g.keep_id;

    -- Steg 2: slett alle rader i duplikat-grupper unntatt eldste
    delete from public.project_production_entries
    where id in (
      select e.id
      from public.project_production_entries e
      inner join (
        select
          min(id) as keep_id,
          project_id,
          project_budget_line_id
        from public.project_production_entries
        where executed_by = 'internal'
          and project_budget_line_id is not null
        group by project_id, project_budget_line_id
        having count(*) > 1
      ) g
        on  e.project_id              = g.project_id
        and e.project_budget_line_id  = g.project_budget_line_id
        and e.executed_by             = 'internal'
        and e.id                     <> g.keep_id
    );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) Unik delvis indeks — nøkkel for batch-upsert i app-laget.
--    NULL er distinkt i Postgres, så en vanlig unique constraint på nullable
--    project_budget_line_id ville tillate flere NULL-rader. Med WHERE IS NOT NULL
--    er det trygt: NULL-rader er frie, not-null-rader er unike per gruppe.
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists uidx_ppe_internal_per_budget_line
  on public.project_production_entries (project_id, project_budget_line_id, executed_by)
  where project_budget_line_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) Versjonshistorikk for egenproduksjon (snapshot-mønster fra 0013).
--    snapshot = jsonb { lines: [{ project_budget_line_id, product_id,
--                                 executed_no_cost_quantity, resolution, handled }] }
--    INGEN kundeverdi/kr i snapshot — kun rå celler.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.project_production_versions (
  id           text        primary key,
  project_id   text        not null references public.projects(id) on delete cascade,
  taken_at     timestamptz not null default now(),
  taken_by     text        references public.users(id) on delete set null,
  taken_by_name text       not null default '',
  snapshot     jsonb       not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ppver_project_taken
  on public.project_production_versions (project_id, taken_at desc);

-- RLS på (0 policies = default-deny). All tilgang via service_role i app-laget.
alter table public.project_production_versions enable row level security;

-- 0021: Materiell som eget mengde-budsjett per prosjekt.
--
-- IKKE produkter, IKKE budsjettlinjer, IKKE i ordreverdi/økonomi. Lastes opp som
-- egen Excel med versjonering (forrige opplasting logges), og avstemmes MANUELT
-- mot faktisk forbruk for å få en fasit til slutt.
--
-- ADDITIV + idempotent (CREATE TABLE/INDEX IF NOT EXISTS). RLS aktivert uten
-- policies = default-deny; all tilgang via service_role i app-laget. PK/FK = text.

-- Gjeldende materiell-budsjett (planlagt mengde) + manuell avstemming.
create table if not exists public.project_materials (
  id                text        primary key,
  project_id        text        not null references public.projects(id) on delete cascade,
  material_code     text        not null default '',
  material_name     text        not null default '',
  category          text        not null default '',
  unit              text        not null default '',
  planned_quantity  numeric     not null default 0,
  -- Pris/leverandør lagres for sporing — vises IKKE som salgsverdi, teller IKKE i økonomi.
  unit_price        numeric     not null default 0,
  supplier          text        not null default '',
  -- Avstemming (manuell): faktisk brukt + saksbehandling. null = ikke avstemt ennå.
  actual_quantity   numeric,
  reconciled        boolean     not null default false,
  comment           text        not null default '',
  sort_order        integer     not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_project_materials_project on public.project_materials (project_id);
alter table public.project_materials enable row level security;

-- Logg av tidligere opplastinger (fil i budget-files + øyeblikksbilde av lista).
create table if not exists public.project_material_versions (
  id           text        primary key,
  project_id   text        not null references public.projects(id) on delete cascade,
  version      integer     not null default 0,
  file_name    text,
  snapshot     jsonb       not null,
  uploaded_by  text        not null default '',
  uploaded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_pmv_project_version on public.project_material_versions (project_id, version desc);
alter table public.project_material_versions enable row level security;

-- Versjonshistorikk for fremdriftsplanen: ett øyeblikksbilde (snapshot) av hele
-- planen (faser + milepæler) hver gang den lagres, med HVEM og NÅR. Arkivet
-- viser gammel mot ny, og endringsloggen (hvem/hva/fra→til) utledes ved å diffe
-- to versjoner. Samme mønster som budget_versions for budsjett.
--
-- snapshot = jsonb { phases: [...rader...], milestones: [...rader...] } — lagrer
-- hele radene så vi kan rendre og diffe uten join mot (kanskje endrede) tabeller.
create table if not exists public.project_phase_versions (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  taken_at timestamptz not null default now(),
  taken_by text references public.users(id) on delete set null,
  taken_by_name text,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ppv_project_taken
  on public.project_phase_versions (project_id, taken_at desc);

-- RLS på (0 policies = default-deny). All tilgang går gjennom service_role i
-- app-laget (lib/api-guard), som resten av tabellene.
alter table public.project_phase_versions enable row level security;

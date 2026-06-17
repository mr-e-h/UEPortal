-- Interne deltakere med innsyn (lese) i et prosjekt — i tillegg til den ENE
-- prosjektlederen (project_managers) og den ENE byggelederen
-- (project_site_managers). Deltakere får synlighet, IKKE skrivetilgang:
-- getProjectScope (lese) tar dem med, getProjectWriteScope (skrive) gjør det ikke.
-- FK-ene er text fordi projects.id og users.id er text i denne basen.
create table if not exists public.project_participants (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- RLS på (0 policies = default-deny); all tilgang går via service_role i app-laget.
alter table public.project_participants enable row level security;

create index if not exists idx_project_participants_user on public.project_participants(user_id);
create index if not exists idx_project_participants_project on public.project_participants(project_id);

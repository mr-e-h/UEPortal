-- Del ett produkt (budsjettlinje) mellom flere underentreprenører: hver ANDEL =
-- en UE med sin mengde + kostpris + ansvar. Budsjettlinjen beholder produkt +
-- total mengde + kundepris (kunden faktureres for hele produktet ÉN gang).
--
-- ADDITIVT: en linje med kun ÉN UE bruker fortsatt project_budget_lines.
-- assigned_subcontractor_id + subcontractor_cost_price_snapshot som før. Andeler
-- brukes KUN når et produkt deles på flere UE. UE-kost = Σ(andel.mengde ×
-- andel.kostpris) når andeler finnes, ellers den gamle ett-UE-beregningen.
create table if not exists public.project_budget_line_subcontractors (
  id text primary key,
  budget_line_id text not null references public.project_budget_lines(id) on delete cascade,
  subcontractor_id text not null references public.subcontractors(id) on delete cascade,
  quantity numeric not null default 0,
  cost_price_snapshot numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (budget_line_id, subcontractor_id)
);

create index if not exists idx_pbls_line on public.project_budget_line_subcontractors (budget_line_id);

-- RLS på (0 policies = default-deny). All tilgang via service_role i app-laget.
alter table public.project_budget_line_subcontractors enable row level security;

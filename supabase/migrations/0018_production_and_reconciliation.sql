-- Utført produksjon UTEN UE-kostnad (egenprod/intern) + en «Avstemming»-fase som
-- avstemmer planlagt vs faktisk utført per budsjettlinje før prosjektet lukkes mot
-- kunde. To nye tabeller + én ny kolonne på projects — ALT additivt (0015/0016/0017-
-- stil: CREATE TABLE IF NOT EXISTS, ALTER … ADD COLUMN IF NOT EXISTS, enable RLS med
-- 0 policies = default-deny; all tilgang via service_role i app-laget).
--
-- PK-typer: projects.id, project_budget_lines.id, products.id, subcontractors.id,
-- users.id er ALLE `text` i baseline — derfor er HVER FK-kolonne her `text` for å
-- matche (samme valg som 0015/0016/0017, der text/uuid-mismatch tidligere har skapt
-- problemer).
--
-- ISOLASJON: disse tabellene eksponeres ALDRI UE-side. executed_by∈('internal',
-- 'other') er IKKE UEs produksjon; UE-egen produksjon tilskrives kun via
-- subcontractor_id når executed_by = 'subcontractor'. Kundeverdier (planlagt/diff)
-- gates med canSeeCustomerEconomics i app-laget.

-- A) Produksjonsføringer. En føring = utført mengde av ett produkt på ett prosjekt,
-- valgfritt knyttet til en budsjettlinje. Føres opptjent STRAKS mot kunde via
-- budsjettlinjas customer_price_snapshot (se lib/project-economy.ts) — den rører
-- IKKE fakturerings-laget (ue_invoices/billed_at) og auto-fakturerer ikke.
-- cost lagres alltid (v1: 0 kr = ordinær UE-kost), men cost>0 flyter IKKE inn i
-- ueReportedCost i v1 (deferred v2 — manuelt registrert holdes adskilt fra
-- rapportert-fra-UE).
create table if not exists public.project_production_entries (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  project_budget_line_id text references public.project_budget_lines(id) on delete set null,
  product_id text not null references public.products(id) on delete restrict,
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null default 'stk',
  executed_by text not null check (executed_by in ('subcontractor', 'internal', 'other')),
  subcontractor_id text references public.subcontractors(id) on delete set null,
  cost numeric not null default 0,
  comment text not null default '',
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ppe_budget_line on public.project_production_entries (project_budget_line_id);
create index if not exists idx_ppe_project on public.project_production_entries (project_id);

-- RLS på (0 policies = default-deny). All tilgang via service_role i app-laget.
alter table public.project_production_entries enable row level security;

-- B) Avstemmingslinjer. Én rad per budsjettlinje (nøkkel project_budget_line_id):
-- snapshot av planlagt vs utført (UE-rapportert vs no-cost) + diff i mengde og
-- kundeverdi, pluss saksbehandling (resolution/handled) før prosjektavslutning.
-- diff_customer_value/planlagt-verdi strippes for ikke-admin i app-laget.
-- project_budget_line_id er NOT NULL: avstemming er ALLTID per budsjettlinje, og
-- unique(project_id, project_budget_line_id) + upsert (PUT-ruten) krever en
-- ikke-null nøkkel (NULL er distinkt i Postgres, så NULL ville brutt upserten).
create table if not exists public.project_reconciliation_lines (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  project_budget_line_id text not null references public.project_budget_lines(id) on delete cascade,
  product_id text not null references public.products(id) on delete restrict,
  planned_quantity numeric,
  executed_ue_quantity numeric,
  executed_no_cost_quantity numeric,
  diff_quantity numeric,
  diff_customer_value numeric,
  resolution text not null default '',
  handled boolean not null default false,
  handled_by text references public.users(id) on delete set null,
  handled_at timestamptz,
  unique (project_id, project_budget_line_id)
);

-- RLS på (0 policies = default-deny). All tilgang via service_role i app-laget.
alter table public.project_reconciliation_lines enable row level security;

-- C) Avstemmingsstatus på prosjektet. Lukk-gate mot kunde KUN på 'completed' i
-- app-laget; default 'not_started' så historiske prosjekter er uendret.
alter table public.projects
  add column if not exists reconciliation_status text not null default 'not_started'
    check (reconciliation_status in ('not_started', 'in_progress', 'ready_for_final_check', 'reconciled', 'closed'));

-- Faktisk internkost via månedlig avstemming.
--
-- Ressurspoolen (internal_resources) er bare et ESTIMAT. Én gang i måneden
-- avstemmes faktisk forbruk ved å legge inn det totale antallet interntimer som
-- ble brukt den måneden. Den faktiske kosten = total_hours × hourly_cost_snapshot
-- fordeles så på prosjektene som var aktive den måneden, vektet på omsetning —
-- nøyaktig samme fordeling som estimat-rutenettet (se lib/resource-allocation.ts,
-- allocateActualInternalCost). Fordelingen skjer i app-laget, ikke i DB.
--
-- hourly_cost_snapshot er teamets snittkost (Σ kost ÷ Σ timer fra ressursene)
-- på avstemmingstidspunktet, snapshotet så tallet er låst selv om ressursene
-- endres senere.
--
-- Én rad per (år, måned). Company-wide økonomi → API gater til main/company
-- (requireUserAdmin).
create table if not exists public.internal_hours_monthly (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  total_hours numeric not null default 0 check (total_hours >= 0),
  hourly_cost_snapshot numeric not null default 0 check (hourly_cost_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month)
);

-- Default-deny backstop, likt alle andre tabeller: RLS på med NULL policies.
-- All tilgang går via service_role i API-laget (lib/supabase.ts).
alter table public.internal_hours_monthly enable row level security;

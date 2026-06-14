-- Internal resource pool.
--
-- Named internal resources (people/roles) each with available hours and an
-- hourly cost. The pool's total hours and total cost are spread across active
-- projects weighted by each project's revenue (total contract value) — the
-- weighting is computed in the app layer (lib/resource-allocation.ts), not in
-- the DB. This is company-wide economics, so the API gates reads/writes to
-- main/company (requireUserAdmin); a project_manager is project-scoped and
-- never sees the portfolio-wide pool.
create table if not exists public.internal_resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hours numeric not null default 0,
  hourly_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Default-deny backstop, consistent with every other table: RLS enabled with
-- ZERO policies. All access goes through service_role in the API layer (see
-- lib/supabase.ts). Forgetting this would leave the table readable/writable by
-- anon/authenticated.
alter table public.internal_resources enable row level security;

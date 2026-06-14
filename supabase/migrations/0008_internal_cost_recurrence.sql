-- Interne kostnader kan nå være enten et ENGANGSKJØP (one_time, i én måned —
-- som før) eller en LØPENDE MÅNEDLIG kostnad (monthly, f.eks. leie av riggplass)
-- som løper fast fra startmåned til en valgfri sluttmåned (tom = ut prosjektet).
--
-- one_time: (year, month) = måneden kosten treffer (uendret oppførsel).
-- monthly:  (year, month) = startmåned, (end_year, end_month) = sluttmåned (kan
--           være null = løper til prosjektets slutt). amount = beløp PER måned.
--
-- Summering (utvidelse av månedlige poster over periodene) gjøres i app-laget,
-- se lib/internal-costs.ts.
alter table public.project_internal_costs
  add column if not exists recurrence text not null default 'one_time',
  add column if not exists end_year int,
  add column if not exists end_month int;

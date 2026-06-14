-- Manuell OVERSTYRING av tiltenkte interne timer på prosjektet. null = bruk det
-- beregnede tallet (ordreverdi-vektet andel av timepoolen over varigheten, se
-- /api/projects/[id]/allocated-hours). Satt = admin har dratt tallet opp/ned.
alter table public.projects add column if not exists planned_hours numeric;

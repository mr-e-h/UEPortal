-- Faser kan tildeles en enkelt UE (underentreprenør). Tom = generell fase (alle);
-- satt = fasen tilhører den UE-en. Brukes til å filtrere fremdriftsplanen på UE
-- og til at UE-er ser hvilke faser som er deres på sine prosjekter.
--
-- Nullable + ON DELETE SET NULL: fjernes en UE, blir fasene generelle igjen
-- (faseplanen skal ikke forsvinne fordi en UE slettes).
alter table public.project_phases
  add column if not exists subcontractor_id text references public.subcontractors(id) on delete set null;

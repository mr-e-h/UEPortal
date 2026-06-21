-- 0022: Skill manuelt tillagt materiell fra Excel-importert.
--
-- En ny Excel-opplasting skal kun ERSTATTE Excel-radene (source='excel') og la
-- manuelt tillagte rader (source='manual') stå. Tidligere slettet importen HELE
-- lista, så manuelle rader forsvant ved neste opplasting.
--
-- ADDITIV + idempotent. Eksisterende rader er alle fra Excel (manuell tilføying
-- fantes ikke før denne endringen) → default 'excel' dekker backfillen.

alter table public.project_materials
  add column if not exists source text not null default 'excel';

alter table public.project_materials
  drop constraint if exists project_materials_source_chk;
alter table public.project_materials
  add constraint project_materials_source_chk check (source in ('excel', 'manual'));

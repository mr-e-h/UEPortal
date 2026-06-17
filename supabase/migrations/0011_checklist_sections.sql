-- Seksjoner i sjekklister: en rad er enten en SEKSJON-overskrift (is_section=true)
-- eller et avhukbart PUNKT (is_section=false). Rekkefølgen styres av sort_order,
-- og overskrifter grupperer punktene under seg — så man kan bygge store,
-- strukturerte sjekklister i prosjekttype-malen og huke av per prosjekt.
alter table public.project_type_checklist_items
  add column if not exists is_section boolean not null default false;

alter table public.project_checklist_items
  add column if not exists is_section boolean not null default false;

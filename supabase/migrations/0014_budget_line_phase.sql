-- Koble budsjettlinjer til faser i fremdriftsplanen. Med dette kan fasens andel
-- av ordreverdien AVLEDES fra linjene som er tagget til fasen (se ØKONOMIMODELL.md
-- punkt 1b) i stedet for en manuell vekt. Nullable — utaggede linjer påvirker
-- ikke fordelingen. on delete set null: slettes en fase, mister linjene bare
-- taggen (beholder seg selv).
alter table public.project_budget_lines
  add column if not exists phase_id uuid references public.project_phases(id) on delete set null;

create index if not exists idx_pbl_phase on public.project_budget_lines (phase_id);

-- Vekt per fase for prognose-synergien: hvor stor andel av prosjektets
-- inntekt og UE-kost som hører til fasen. Brukes til å fordele budsjettet
-- automatisk utover månedene fasen varer (lib/forecast-distribution.ts), så
-- man slipper å legge inn prognosen måned for måned.
--
-- Nullable: null = "auto" — fasens varighet (antall måneder) brukes som vekt.
-- Satt (> 0) = manuell vekt som overstyrer varigheten. Endrer ikke eksisterende
-- faser (alle starter på auto).
alter table public.project_phases
  add column if not exists weight numeric;

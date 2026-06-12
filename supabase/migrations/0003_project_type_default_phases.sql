-- 0003: Standardfaser per prosjekttype.
--
-- Semantikk: INGEN rader for en prosjekttype = ALLE aktive fasetyper er
-- standard (dagens oppførsel videreføres uten seeding). Rader for en type =
-- kun de valgte fasetypene er standard for prosjekter av den typen.
-- Brukes av POST /api/project-phases/apply-standard («Legg til standard-
-- faser» på prosjektets fremdriftsplan) og redigeres på /admin/project-types.
--
-- Additiv migrasjon — oppretter kun ny tabell, endrer ingenting eksisterende.

CREATE TABLE IF NOT EXISTS project_type_default_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_type_id uuid NOT NULL REFERENCES project_types(id) ON DELETE CASCADE,
  phase_type_id uuid NOT NULL REFERENCES phase_types(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_type_id, phase_type_id)
);

CREATE INDEX IF NOT EXISTS idx_ptdp_project_type
  ON project_type_default_phases(project_type_id);

-- INVARIANT (se CLAUDE.md): RLS på med null policies — service_role går
-- utenom; default-deny-backstopp mot direkte klienttilgang.
ALTER TABLE project_type_default_phases ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 0002_project_phases.sql
-- ----------------------------------------------------------------------------
-- Fremdriftsplan-datamodell (Pakke B): typed arbeidsfaser per prosjekt, så
-- porteføljevisningen kan filtrere på fase ("Graving", "Luftarbeid", ...)
-- på tvers av prosjekter. Dagens `milestones` (fritekst-titler) røres IKKE —
-- de kan ikke filtreres konsistent og beholdes som de er inntil en eventuell
-- senere konsolidering.
--
-- Migrasjonen er ADDITIV: to nye tabeller + seed av standard-fasetyper
-- (referansedata, idempotent via ON CONFLICT DO NOTHING). Ingen eksisterende
-- tabeller, rader eller constraints endres.
--
-- Denne filen committes for review og kjøres IKKE her — den kjøres mot live
-- Supabase som et separat, eksplisitt godkjent steg (samme regime som 0001).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. phase_types — konfigurerbare arbeidsfase-typer (database-drevet, ikke
--    hardkodet i frontend). Admin kan legge til/endre/deaktivere senere.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phase_types (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  color      text,
  is_active  boolean     NOT NULL DEFAULT true,
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE phase_types
  ADD CONSTRAINT phase_types_pkey PRIMARY KEY (id);

ALTER TABLE phase_types
  ADD CONSTRAINT phase_types_name_key UNIQUE (name);

-- ----------------------------------------------------------------------------
-- 2. Seed av standard-fasetyper. Referansedata (ikke forretningsdata):
--    idempotent — kjøres migrasjonen på nytt skjer ingenting. Farger er en
--    dempet, adskillbar palett; kan endres i admin senere.
-- ----------------------------------------------------------------------------
INSERT INTO phase_types (name, color, sort_order) VALUES
  ('Graving',       '#D97706', 10),  -- amber-600
  ('Luftarbeid',    '#0EA5E9', 20),  -- sky-500
  ('Blåsing',       '#8B5CF6', 30),  -- violet-500
  ('Skjøting',      '#10B981', 40),  -- emerald-500
  ('Befaring',      '#64748B', 50),  -- slate-500
  ('Dokumentasjon', '#F59E0B', 60),  -- amber-500
  ('Overlevering',  '#2563EB', 70),  -- blue-600
  ('Annet',         '#94A3B8', 80)   -- slate-400
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. project_phases — planlagte/pågående arbeidsfaser per prosjekt.
--    phase_type_id er RESTRICT så en fasetype ikke kan slettes mens faser
--    peker på den (deaktiver med is_active=false i stedet).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_phases (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id       text        NOT NULL,
  phase_type_id    uuid        NOT NULL,
  name             text,
  start_date       date        NOT NULL,
  end_date         date,
  status           text        NOT NULL DEFAULT 'planned',
  progress_percent numeric     NOT NULL DEFAULT 0,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_phases
  ADD CONSTRAINT project_phases_pkey PRIMARY KEY (id);

ALTER TABLE project_phases
  ADD CONSTRAINT project_phases_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_phases
  ADD CONSTRAINT project_phases_phase_type_id_fkey
  FOREIGN KEY (phase_type_id) REFERENCES phase_types(id) ON DELETE RESTRICT;

ALTER TABLE project_phases
  ADD CONSTRAINT project_phases_status_check
  CHECK (status = ANY (ARRAY['planned'::text, 'in_progress'::text, 'done'::text]));

ALTER TABLE project_phases
  ADD CONSTRAINT project_phases_progress_percent_check
  CHECK (progress_percent >= 0 AND progress_percent <= 100);

ALTER TABLE project_phases
  ADD CONSTRAINT project_phases_dates_check
  CHECK (end_date IS NULL OR end_date >= start_date);

-- ----------------------------------------------------------------------------
-- 4. Indekser for porteføljevisningens spørringer (per prosjekt, per
--    fasetype-filter, og tidsvindu).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS project_phases_project_id_idx
  ON project_phases (project_id);

CREATE INDEX IF NOT EXISTS project_phases_phase_type_id_idx
  ON project_phases (phase_type_id);

CREATE INDEX IF NOT EXISTS project_phases_start_date_idx
  ON project_phases (start_date);

-- ----------------------------------------------------------------------------
-- 5. RLS: enable uten policies (default-deny backstop) — samme mønster som
--    resten av skjemaet. All autorisasjon håndheves i app-laget via
--    service_role-klienten + lib/api-guard.ts.
-- ----------------------------------------------------------------------------
ALTER TABLE phase_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;

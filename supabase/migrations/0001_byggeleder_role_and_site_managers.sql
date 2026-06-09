-- ============================================================================
-- 0001_byggeleder_role_and_site_managers.sql
-- ----------------------------------------------------------------------------
-- Fase 1B, Pakke 1 — introduce the "byggeleder" (site manager) role and its
-- project-assignment table. This migration is purely ADDITIVE and backward-
-- compatible: it widens one CHECK constraint by a single allowed value and
-- creates one new, empty table. No existing row, column, table or role is
-- modified or removed, and NO data is inserted.
--
-- Mirrors the existing `project_managers` pattern exactly (same column types,
-- same FK/ON DELETE rules, same RLS-on/no-policy default-deny posture) so the
-- application's getProjectScope() can treat site managers identically to
-- project managers.
--
-- Reference: supabase/migrations/0000_baseline_schema.sql
--   - users_role_check                      (line 624)
--   - project_managers table + constraints  (lines 310-316, 563, 589, 657-659, 827)
--   - users.id / projects.id are `text`     (lines 502-503, 355-356)
--
-- This file is committed to the repo for review. It is NOT run against the
-- live database here — apply it explicitly later via the Supabase CLI / MCP.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Widen users.role CHECK to allow 'byggeleder'.
--    All five existing values are preserved (including the legacy
--    'subcontractor' value); only 'byggeleder' is added.
-- ----------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY[
    'company'::text,
    'project_manager'::text,
    'subcontractor'::text,
    'main'::text,
    'sub'::text,
    'byggeleder'::text
  ]));

-- ----------------------------------------------------------------------------
-- 2. New table: project_site_managers
--    One row per (project, byggeleder-user) assignment. Same shape as
--    project_managers. Uses IF NOT EXISTS so re-running the migration is safe.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_site_managers (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  project_id  text        NOT NULL,
  user_id     text        NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text
);

-- Primary key
ALTER TABLE project_site_managers
  ADD CONSTRAINT project_site_managers_pkey PRIMARY KEY (id);

-- One assignment per (project, user)
ALTER TABLE project_site_managers
  ADD CONSTRAINT project_site_managers_project_id_user_id_key UNIQUE (project_id, user_id);

-- Foreign keys (mirror project_managers ON DELETE rules)
ALTER TABLE project_site_managers
  ADD CONSTRAINT project_site_managers_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_site_managers
  ADD CONSTRAINT project_site_managers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE project_site_managers
  ADD CONSTRAINT project_site_managers_assigned_by_fkey
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 3. Indexes.
--    The UNIQUE (project_id, user_id) constraint already provides an index
--    that covers project_id (and project_id+user_id lookups). getProjectScope()
--    queries by user_id, which is NOT the leading column of that composite
--    index, so add an explicit user_id index. A standalone project_id index is
--    not needed (covered by the composite's leading column).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS project_site_managers_user_id_idx
  ON project_site_managers (user_id);

-- ----------------------------------------------------------------------------
-- 4. Row Level Security: enable with NO policies (default-deny backstop),
--    matching every other table in this schema. All authorization is enforced
--    in the application layer via the service_role client + lib/api-guard.ts.
-- ----------------------------------------------------------------------------
ALTER TABLE project_site_managers ENABLE ROW LEVEL SECURITY;

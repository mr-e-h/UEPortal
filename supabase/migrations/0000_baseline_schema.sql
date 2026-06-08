-- ============================================================================
-- 0000_baseline_schema.sql  —  BASELINE SCHEMA (schema-only, no data)
-- ============================================================================
--
-- Source project : entrepenor-rapport  (Supabase ref: uvvxezkqwznisgywpojs)
-- Region         : eu-west-1 (Ireland, EEA)
-- Postgres       : 17.6
-- Generated      : Fase 0 — read-only introspection via Supabase MCP
--                  (pg_catalog / information_schema only). NO table data was
--                  read or included. No emails, password hashes, sessions,
--                  tokens, file references or business rows are present here.
--
-- WHAT THIS FILE IS
--   A faithful, hand-assembled DDL snapshot of the live `public` schema:
--   43 tables, all primary keys, unique + foreign-key + check constraints,
--   ~75 indexes, 1 function, 1 trigger, and RLS-enabled flags on every table.
--   It is the versioned "baseline" the repo previously lacked — the database
--   structure now lives in git, not only in the live Supabase instance.
--
-- SECURITY MODEL (carried over from the live DB — see lib/supabase.ts)
--   Every table has RLS ENABLED with ZERO policies. RLS-on + no-policy =
--   default-deny for anon/authenticated. All access goes through the Next.js
--   server using the service_role key (which bypasses RLS); authorization is
--   enforced in lib/api-guard.ts, NOT by RLS policies. The ENABLE ROW LEVEL
--   SECURITY statements at the end preserve that backstop on a rebuild.
--
-- HOW TO USE
--   * Reference / disaster recovery: this documents the exact structure.
--   * Rebuild into a fresh project: run top-to-bottom (extensions must exist;
--     on Supabase they are pre-installed). Review role/grant specifics first.
--   * Future changes: add NEW numbered migrations (0001_*, 0002_*). Do NOT
--     edit this baseline. See supabase/README.md.
--
-- NOT INCLUDED (intentionally)
--   * No row data (schema-only).
--   * No RLS policies (there are none in the live DB).
--   * No storage bucket objects (the `attachments` / `budget-files` buckets
--     live in Supabase Storage, not in the SQL schema).
--   * No roles/grants/ownership (managed by Supabase).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions (Supabase-managed; present by default in a Supabase project)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"          WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto             WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements   WITH SCHEMA extensions;
-- supabase_vault (schema: vault) is provisioned by Supabase; not recreated here.

-- ============================================================================
-- TABLES
-- ============================================================================

CREATE TABLE access_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  company text,
  phone text,
  message text,
  desired_role text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_at timestamp with time zone,
  decided_by text,
  decision_note text
);

CREATE TABLE activity_log (
  id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  metadata jsonb
);

CREATE TABLE budget_versions (
  id text NOT NULL,
  project_id text NOT NULL,
  version integer NOT NULL,
  total_sales_value numeric DEFAULT 0 NOT NULL,
  total_cost_value numeric DEFAULT 0 NOT NULL,
  uploaded_by text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  file_name text
);

CREATE TABLE change_order_consequence_lines (
  id text NOT NULL,
  change_order_id text NOT NULL,
  product_id text NOT NULL,
  quantity numeric NOT NULL,
  unit text NOT NULL,
  cost_price_snapshot numeric DEFAULT 0 NOT NULL,
  customer_price_snapshot numeric DEFAULT 0 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE change_order_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  change_order_id text NOT NULL,
  product_id text NOT NULL,
  requested_quantity numeric NOT NULL,
  unit text NOT NULL,
  cost_price_snapshot numeric NOT NULL,
  customer_price_snapshot numeric NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE change_orders (
  id text NOT NULL,
  project_id text NOT NULL,
  product_id text NOT NULL,
  subcontractor_id text NOT NULL,
  requested_quantity numeric NOT NULL,
  unit text DEFAULT 'stk'::text NOT NULL,
  cost_price_snapshot numeric DEFAULT 0 NOT NULL,
  customer_price_snapshot numeric DEFAULT 0 NOT NULL,
  total_cost numeric DEFAULT 0 NOT NULL,
  total_customer_value numeric DEFAULT 0 NOT NULL,
  profit numeric DEFAULT 0 NOT NULL,
  reason text DEFAULT ''::text NOT NULL,
  attachment_url text,
  status text NOT NULL,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by text,
  admin_comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_to_customer_at timestamp with time zone,
  change_order_number integer NOT NULL,
  solution text DEFAULT ''::text NOT NULL,
  em_type text DEFAULT 'economic'::text NOT NULL,
  submitted_by text
);

CREATE TABLE forecast_periods (
  id text NOT NULL,
  name text NOT NULL,
  year integer NOT NULL,
  start_month integer NOT NULL,
  end_month integer NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  locked boolean DEFAULT false NOT NULL,
  locked_at timestamp with time zone,
  locked_by text
);

CREATE TABLE hour_entries (
  id text NOT NULL,
  project_id text NOT NULL,
  time_type_id text NOT NULL,
  hours numeric DEFAULT 0 NOT NULL,
  date date NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  cost_per_hour_snapshot numeric DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE invitations (
  id text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  accepted_at timestamp with time zone
);

CREATE TABLE lump_sum_codes (
  code text NOT NULL
);

CREATE TABLE milestones (
  id text NOT NULL,
  project_id text NOT NULL,
  subcontractor_id text,
  title text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  color text DEFAULT '#3B82F6'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sort_order integer
);

CREATE TABLE password_resets (
  id text NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone
);

CREATE TABLE products (
  id text NOT NULL,
  name text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  unit text DEFAULT 'stk'::text NOT NULL,
  county text DEFAULT ''::text NOT NULL,
  customer_price numeric DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE project_budget_lines (
  id text NOT NULL,
  project_id text NOT NULL,
  product_id text NOT NULL,
  budget_quantity numeric DEFAULT 0 NOT NULL,
  customer_price_snapshot numeric DEFAULT 0 NOT NULL,
  assigned_subcontractor_id text,
  subcontractor_cost_price_snapshot numeric DEFAULT 0 NOT NULL,
  source text,
  line_type text
);

CREATE TABLE project_checklist_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id text NOT NULL,
  label text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  completed_at timestamp with time zone,
  completed_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_forecast_extras (
  id text NOT NULL,
  project_id text NOT NULL,
  type text NOT NULL,
  role text,
  line_name text,
  year integer NOT NULL,
  month integer NOT NULL,
  value numeric DEFAULT 0 NOT NULL,
  text text
);

CREATE TABLE project_forecast_months (
  id text NOT NULL,
  project_forecast_id text NOT NULL,
  month integer NOT NULL,
  year integer NOT NULL,
  expected_revenue numeric DEFAULT 0 NOT NULL,
  expected_ue_cost numeric DEFAULT 0 NOT NULL,
  expected_internal_cost numeric DEFAULT 0 NOT NULL,
  expected_other_cost numeric DEFAULT 0 NOT NULL,
  risk_amount numeric DEFAULT 0 NOT NULL,
  comment text DEFAULT ''::text NOT NULL
);

CREATE TABLE project_forecasts (
  id text NOT NULL,
  forecast_period_id text NOT NULL,
  project_id text NOT NULL,
  project_manager_id text,
  total_sales_value_snapshot numeric DEFAULT 0 NOT NULL,
  already_invoiced_snapshot numeric DEFAULT 0 NOT NULL,
  remaining_invoice_value_snapshot numeric DEFAULT 0 NOT NULL,
  expected_revenue numeric DEFAULT 0 NOT NULL,
  expected_ue_cost numeric DEFAULT 0 NOT NULL,
  expected_internal_cost numeric DEFAULT 0 NOT NULL,
  expected_other_cost numeric DEFAULT 0 NOT NULL,
  risk_amount numeric DEFAULT 0 NOT NULL,
  expected_profit numeric DEFAULT 0 NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  status text NOT NULL,
  submitted_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by text,
  returned_comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_hour_budgets (
  id text NOT NULL,
  project_id text NOT NULL,
  time_type_id text NOT NULL,
  estimated_hours numeric DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_internal_costs (
  id text NOT NULL,
  project_id text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  amount numeric DEFAULT 0 NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_invoices (
  id text NOT NULL,
  project_id text NOT NULL,
  amount numeric NOT NULL,
  invoice_date date NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_managers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id text NOT NULL,
  user_id text NOT NULL,
  assigned_at timestamp with time zone DEFAULT now() NOT NULL,
  assigned_by text
);

CREATE TABLE project_month_plans (
  id text NOT NULL,
  project_id text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  expected_revenue numeric DEFAULT 0 NOT NULL,
  internal_hours numeric DEFAULT 0 NOT NULL,
  internal_cost numeric DEFAULT 0 NOT NULL,
  ue_hours numeric DEFAULT 0 NOT NULL,
  ue_cost numeric DEFAULT 0 NOT NULL,
  other_cost numeric DEFAULT 0 NOT NULL,
  risk numeric DEFAULT 0 NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_subcontractors (
  id text NOT NULL,
  project_id text NOT NULL,
  subcontractor_id text NOT NULL
);

CREATE TABLE project_type_checklist_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_type_id uuid NOT NULL,
  label text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE projects (
  id text NOT NULL,
  name text NOT NULL,
  project_number text DEFAULT ''::text NOT NULL,
  order_number text,
  customer text DEFAULT ''::text NOT NULL,
  county text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  deleted boolean DEFAULT false NOT NULL,
  deleted_at timestamp with time zone,
  project_type_id uuid
);

CREATE TABLE rate_limits (
  key text NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  reset_at timestamp with time zone NOT NULL
);

CREATE TABLE report_lines (
  id text NOT NULL,
  project_id text NOT NULL,
  project_budget_line_id text NOT NULL,
  subcontractor_id text NOT NULL,
  reported_quantity numeric DEFAULT 0 NOT NULL,
  report_date date NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  status text NOT NULL
);

CREATE TABLE reports (
  id text NOT NULL,
  project_id text NOT NULL,
  subcontractor_id text NOT NULL,
  date date NOT NULL,
  status text DEFAULT 'submitted'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  lines jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE sessions (
  id text NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE subcontractor_product_prices (
  id text NOT NULL,
  subcontractor_id text NOT NULL,
  product_id text NOT NULL,
  cost_price numeric DEFAULT 0 NOT NULL
);

CREATE TABLE subcontractors (
  id text NOT NULL,
  company_name text NOT NULL,
  contact_person text DEFAULT ''::text NOT NULL,
  email text DEFAULT ''::text NOT NULL,
  phone text DEFAULT ''::text NOT NULL,
  organization_number text DEFAULT ''::text NOT NULL,
  county text DEFAULT ''::text NOT NULL,
  active boolean DEFAULT true NOT NULL
);

CREATE TABLE tender_bid_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tender_bid_id text NOT NULL,
  tender_line_id uuid NOT NULL,
  unit_price numeric DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tender_bids (
  id text NOT NULL,
  tender_id text NOT NULL,
  subcontractor_id text NOT NULL,
  round integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  total_cost numeric DEFAULT 0 NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  is_current boolean DEFAULT true NOT NULL,
  submitted_at timestamp with time zone,
  submitted_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tender_invitations (
  id text NOT NULL,
  tender_id text NOT NULL,
  subcontractor_id text NOT NULL,
  status text DEFAULT 'invited'::text NOT NULL,
  round integer DEFAULT 1 NOT NULL,
  invited_at timestamp with time zone DEFAULT now() NOT NULL,
  opened_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tender_lines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tender_id text NOT NULL,
  product_id text,
  description text DEFAULT ''::text NOT NULL,
  unit text DEFAULT 'stk'::text NOT NULL,
  quantity numeric DEFAULT 0 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tenders (
  id text NOT NULL,
  project_id text NOT NULL,
  title text DEFAULT ''::text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  deadline_at timestamp with time zone,
  current_round integer DEFAULT 1 NOT NULL,
  awarded_subcontractor_id text,
  awarded_at timestamp with time zone,
  awarded_by text,
  created_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE time_types (
  id text NOT NULL,
  name text NOT NULL,
  cost_per_hour numeric DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL
);

CREATE TABLE ue_invoices (
  id text NOT NULL,
  subcontractor_id text NOT NULL,
  project_id text,
  amount numeric NOT NULL,
  invoice_date date NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE users (
  id text NOT NULL,
  email text NOT NULL,
  password text NOT NULL,
  role text NOT NULL,
  full_name text NOT NULL,
  subcontractor_id text,
  active boolean DEFAULT true NOT NULL
);

CREATE TABLE weekly_report_lines (
  id text NOT NULL,
  weekly_report_id text NOT NULL,
  project_budget_line_id text NOT NULL,
  reported_quantity numeric DEFAULT 0 NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  status text NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_by text,
  billed_at timestamp with time zone
);

CREATE TABLE weekly_reports (
  id text NOT NULL,
  project_id text NOT NULL,
  subcontractor_id text NOT NULL,
  year integer NOT NULL,
  week_number integer NOT NULL,
  submission_number integer DEFAULT 1 NOT NULL,
  status text NOT NULL,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by text,
  admin_comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================================
-- PRIMARY KEYS
-- ============================================================================
ALTER TABLE access_requests ADD CONSTRAINT access_requests_pkey PRIMARY KEY (id);
ALTER TABLE activity_log ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);
ALTER TABLE budget_versions ADD CONSTRAINT budget_versions_pkey PRIMARY KEY (id);
ALTER TABLE change_order_consequence_lines ADD CONSTRAINT change_order_consequence_lines_pkey PRIMARY KEY (id);
ALTER TABLE change_order_lines ADD CONSTRAINT change_order_lines_pkey PRIMARY KEY (id);
ALTER TABLE change_orders ADD CONSTRAINT change_orders_pkey PRIMARY KEY (id);
ALTER TABLE forecast_periods ADD CONSTRAINT forecast_periods_pkey PRIMARY KEY (id);
ALTER TABLE hour_entries ADD CONSTRAINT hour_entries_pkey PRIMARY KEY (id);
ALTER TABLE invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);
ALTER TABLE lump_sum_codes ADD CONSTRAINT lump_sum_codes_pkey PRIMARY KEY (code);
ALTER TABLE milestones ADD CONSTRAINT milestones_pkey PRIMARY KEY (id);
ALTER TABLE password_resets ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);
ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE project_budget_lines ADD CONSTRAINT project_budget_lines_pkey PRIMARY KEY (id);
ALTER TABLE project_checklist_items ADD CONSTRAINT project_checklist_items_pkey PRIMARY KEY (id);
ALTER TABLE project_forecast_extras ADD CONSTRAINT project_forecast_extras_pkey PRIMARY KEY (id);
ALTER TABLE project_forecast_months ADD CONSTRAINT project_forecast_months_pkey PRIMARY KEY (id);
ALTER TABLE project_forecasts ADD CONSTRAINT project_forecasts_pkey PRIMARY KEY (id);
ALTER TABLE project_hour_budgets ADD CONSTRAINT project_hour_budgets_pkey PRIMARY KEY (id);
ALTER TABLE project_internal_costs ADD CONSTRAINT project_internal_costs_pkey PRIMARY KEY (id);
ALTER TABLE project_invoices ADD CONSTRAINT project_invoices_pkey PRIMARY KEY (id);
ALTER TABLE project_managers ADD CONSTRAINT project_managers_pkey PRIMARY KEY (id);
ALTER TABLE project_month_plans ADD CONSTRAINT project_month_plans_pkey PRIMARY KEY (id);
ALTER TABLE project_subcontractors ADD CONSTRAINT project_subcontractors_pkey PRIMARY KEY (id);
ALTER TABLE project_type_checklist_items ADD CONSTRAINT project_type_checklist_items_pkey PRIMARY KEY (id);
ALTER TABLE project_types ADD CONSTRAINT project_types_pkey PRIMARY KEY (id);
ALTER TABLE projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE rate_limits ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);
ALTER TABLE report_lines ADD CONSTRAINT report_lines_pkey PRIMARY KEY (id);
ALTER TABLE reports ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
ALTER TABLE sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE subcontractor_product_prices ADD CONSTRAINT subcontractor_product_prices_pkey PRIMARY KEY (id);
ALTER TABLE subcontractors ADD CONSTRAINT subcontractors_pkey PRIMARY KEY (id);
ALTER TABLE tender_bid_lines ADD CONSTRAINT tender_bid_lines_pkey PRIMARY KEY (id);
ALTER TABLE tender_bids ADD CONSTRAINT tender_bids_pkey PRIMARY KEY (id);
ALTER TABLE tender_invitations ADD CONSTRAINT tender_invitations_pkey PRIMARY KEY (id);
ALTER TABLE tender_lines ADD CONSTRAINT tender_lines_pkey PRIMARY KEY (id);
ALTER TABLE tenders ADD CONSTRAINT tenders_pkey PRIMARY KEY (id);
ALTER TABLE time_types ADD CONSTRAINT time_types_pkey PRIMARY KEY (id);
ALTER TABLE ue_invoices ADD CONSTRAINT ue_invoices_pkey PRIMARY KEY (id);
ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE weekly_report_lines ADD CONSTRAINT weekly_report_lines_pkey PRIMARY KEY (id);
ALTER TABLE weekly_reports ADD CONSTRAINT weekly_reports_pkey PRIMARY KEY (id);

-- ============================================================================
-- UNIQUE CONSTRAINTS
-- ============================================================================
ALTER TABLE project_managers ADD CONSTRAINT project_managers_project_id_user_id_key UNIQUE (project_id, user_id);
ALTER TABLE project_subcontractors ADD CONSTRAINT project_subcontractors_project_id_subcontractor_id_key UNIQUE (project_id, subcontractor_id);
ALTER TABLE project_types ADD CONSTRAINT project_types_name_key UNIQUE (name);
ALTER TABLE sessions ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);
ALTER TABLE subcontractor_product_prices ADD CONSTRAINT subcontractor_product_prices_subcontractor_id_product_id_key UNIQUE (subcontractor_id, product_id);
ALTER TABLE tender_bid_lines ADD CONSTRAINT tender_bid_lines_unique UNIQUE (tender_bid_id, tender_line_id);
ALTER TABLE tender_invitations ADD CONSTRAINT tender_invitations_unique UNIQUE (tender_id, subcontractor_id);
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

-- ============================================================================
-- CHECK CONSTRAINTS  (these encode the application's status / enum values)
-- ============================================================================
ALTER TABLE access_requests ADD CONSTRAINT access_requests_desired_role_check CHECK ((desired_role = ANY (ARRAY['project_manager'::text, 'sub'::text])));
ALTER TABLE access_requests ADD CONSTRAINT access_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check CHECK ((action = ANY (ARRAY['approved'::text, 'rejected'::text, 'reverted'::text, 'commented'::text, 'edited'::text, 'sent_to_customer'::text, 'revision_requested'::text, 'resubmitted'::text, 'submitted'::text, 'sent'::text, 'awarded'::text, 'cancelled'::text, 'deadline_extended'::text, 'bid_revised'::text])));
ALTER TABLE activity_log ADD CONSTRAINT activity_log_entity_type_check CHECK ((entity_type = ANY (ARRAY['weekly_report'::text, 'change_order'::text, 'tender'::text])));
ALTER TABLE change_order_consequence_lines ADD CONSTRAINT change_order_consequence_lines_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE change_orders ADD CONSTRAINT change_orders_em_type_check CHECK ((em_type = ANY (ARRAY['economic'::text, 'spec_deviation'::text, 'time'::text])));
ALTER TABLE change_orders ADD CONSTRAINT change_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'revision_requested'::text])));
ALTER TABLE forecast_periods ADD CONSTRAINT forecast_periods_name_check CHECK ((name = ANY (ARRAY['P1'::text, 'P2'::text, 'P3'::text, 'P4'::text])));
ALTER TABLE forecast_periods ADD CONSTRAINT forecast_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'locked'::text])));
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK ((role = ANY (ARRAY['project_manager'::text, 'sub'::text])));
ALTER TABLE project_budget_lines ADD CONSTRAINT project_budget_lines_line_type_check CHECK ((line_type = ANY (ARRAY['subcontractor_work'::text, 'internal_cost'::text, 'material'::text])));
ALTER TABLE project_budget_lines ADD CONSTRAINT project_budget_lines_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'change_order'::text])));
ALTER TABLE project_forecast_extras ADD CONSTRAINT project_forecast_extras_role_check CHECK ((role = ANY (ARRAY['pm'::text, 'bl'::text, 'dok'::text])));
ALTER TABLE project_forecast_extras ADD CONSTRAINT project_forecast_extras_type_check CHECK ((type = ANY (ARRAY['role'::text, 'custom'::text, 'comment'::text])));
ALTER TABLE project_forecasts ADD CONSTRAINT project_forecasts_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'draft'::text, 'submitted'::text, 'approved'::text, 'returned'::text, 'locked'::text])));
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text])));
ALTER TABLE report_lines ADD CONSTRAINT report_lines_reported_quantity_nonneg CHECK ((reported_quantity >= (0)::numeric));
ALTER TABLE report_lines ADD CONSTRAINT report_lines_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE tender_bid_lines ADD CONSTRAINT tender_bid_lines_unit_price_nonneg_chk CHECK ((unit_price >= (0)::numeric));
ALTER TABLE tender_bids ADD CONSTRAINT tender_bids_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])));
ALTER TABLE tender_invitations ADD CONSTRAINT tender_invitations_status_chk CHECK ((status = ANY (ARRAY['invited'::text, 'opened'::text, 'not_answered'::text, 'bid_submitted'::text, 'bid_revised'::text, 'expired'::text, 'won'::text, 'lost'::text])));
ALTER TABLE tender_lines ADD CONSTRAINT tender_lines_quantity_nonneg_chk CHECK ((quantity >= (0)::numeric));
ALTER TABLE tenders ADD CONSTRAINT tenders_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'open'::text, 'expired'::text, 'under_review'::text, 'awarded'::text, 'closed'::text, 'cancelled'::text])));
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['company'::text, 'project_manager'::text, 'subcontractor'::text, 'main'::text, 'sub'::text])));
ALTER TABLE weekly_report_lines ADD CONSTRAINT weekly_report_lines_reported_quantity_nonneg CHECK ((reported_quantity >= (0)::numeric));
ALTER TABLE weekly_report_lines ADD CONSTRAINT weekly_report_lines_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE weekly_reports ADD CONSTRAINT weekly_reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'partially_approved'::text, 'rejected'::text])));

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================
ALTER TABLE budget_versions ADD CONSTRAINT budget_versions_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE change_order_consequence_lines ADD CONSTRAINT change_order_consequence_lines_change_order_id_fkey FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE CASCADE;
ALTER TABLE change_order_lines ADD CONSTRAINT change_order_lines_change_order_id_fkey FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE CASCADE;
ALTER TABLE change_order_lines ADD CONSTRAINT change_order_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE change_orders ADD CONSTRAINT change_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE change_orders ADD CONSTRAINT change_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE change_orders ADD CONSTRAINT change_orders_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE hour_entries ADD CONSTRAINT hour_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE hour_entries ADD CONSTRAINT hour_entries_time_type_id_fkey FOREIGN KEY (time_type_id) REFERENCES time_types(id) ON DELETE RESTRICT;
ALTER TABLE milestones ADD CONSTRAINT milestones_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE milestones ADD CONSTRAINT milestones_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE SET NULL;
ALTER TABLE password_resets ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE project_budget_lines ADD CONSTRAINT project_budget_lines_assigned_subcontractor_id_fkey FOREIGN KEY (assigned_subcontractor_id) REFERENCES subcontractors(id) ON DELETE SET NULL;
ALTER TABLE project_budget_lines ADD CONSTRAINT project_budget_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE project_budget_lines ADD CONSTRAINT project_budget_lines_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_checklist_items ADD CONSTRAINT project_checklist_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_forecast_extras ADD CONSTRAINT project_forecast_extras_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_forecast_months ADD CONSTRAINT project_forecast_months_project_forecast_id_fkey FOREIGN KEY (project_forecast_id) REFERENCES project_forecasts(id) ON DELETE CASCADE;
ALTER TABLE project_forecasts ADD CONSTRAINT project_forecasts_forecast_period_id_fkey FOREIGN KEY (forecast_period_id) REFERENCES forecast_periods(id) ON DELETE CASCADE;
ALTER TABLE project_forecasts ADD CONSTRAINT project_forecasts_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_forecasts ADD CONSTRAINT project_forecasts_project_manager_id_fkey FOREIGN KEY (project_manager_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_hour_budgets ADD CONSTRAINT project_hour_budgets_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_hour_budgets ADD CONSTRAINT project_hour_budgets_time_type_id_fkey FOREIGN KEY (time_type_id) REFERENCES time_types(id) ON DELETE CASCADE;
ALTER TABLE project_internal_costs ADD CONSTRAINT project_internal_costs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_invoices ADD CONSTRAINT project_invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_managers ADD CONSTRAINT project_managers_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_managers ADD CONSTRAINT project_managers_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_managers ADD CONSTRAINT project_managers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE project_month_plans ADD CONSTRAINT project_month_plans_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_subcontractors ADD CONSTRAINT project_subcontractors_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_subcontractors ADD CONSTRAINT project_subcontractors_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE project_type_checklist_items ADD CONSTRAINT project_type_checklist_items_project_type_id_fkey FOREIGN KEY (project_type_id) REFERENCES project_types(id) ON DELETE CASCADE;
ALTER TABLE projects ADD CONSTRAINT projects_project_type_id_fkey FOREIGN KEY (project_type_id) REFERENCES project_types(id);
ALTER TABLE report_lines ADD CONSTRAINT report_lines_project_budget_line_id_fkey FOREIGN KEY (project_budget_line_id) REFERENCES project_budget_lines(id) ON DELETE CASCADE;
ALTER TABLE report_lines ADD CONSTRAINT report_lines_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE report_lines ADD CONSTRAINT report_lines_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE subcontractor_product_prices ADD CONSTRAINT subcontractor_product_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE subcontractor_product_prices ADD CONSTRAINT subcontractor_product_prices_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE tender_bid_lines ADD CONSTRAINT tender_bid_lines_tender_bid_id_fkey FOREIGN KEY (tender_bid_id) REFERENCES tender_bids(id) ON DELETE CASCADE;
ALTER TABLE tender_bid_lines ADD CONSTRAINT tender_bid_lines_tender_line_id_fkey FOREIGN KEY (tender_line_id) REFERENCES tender_lines(id) ON DELETE CASCADE;
ALTER TABLE tender_bids ADD CONSTRAINT tender_bids_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE tender_bids ADD CONSTRAINT tender_bids_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE tender_invitations ADD CONSTRAINT tender_invitations_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE tender_invitations ADD CONSTRAINT tender_invitations_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE tender_lines ADD CONSTRAINT tender_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE tender_lines ADD CONSTRAINT tender_lines_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
ALTER TABLE tenders ADD CONSTRAINT tenders_awarded_subcontractor_id_fkey FOREIGN KEY (awarded_subcontractor_id) REFERENCES subcontractors(id) ON DELETE SET NULL;
ALTER TABLE tenders ADD CONSTRAINT tenders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ue_invoices ADD CONSTRAINT ue_invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE ue_invoices ADD CONSTRAINT ue_invoices_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;
ALTER TABLE users ADD CONSTRAINT users_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE SET NULL;
ALTER TABLE weekly_report_lines ADD CONSTRAINT weekly_report_lines_project_budget_line_id_fkey FOREIGN KEY (project_budget_line_id) REFERENCES project_budget_lines(id) ON DELETE CASCADE;
ALTER TABLE weekly_report_lines ADD CONSTRAINT weekly_report_lines_weekly_report_id_fkey FOREIGN KEY (weekly_report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE;
ALTER TABLE weekly_reports ADD CONSTRAINT weekly_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE weekly_reports ADD CONSTRAINT weekly_reports_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE;

-- ============================================================================
-- INDEXES  (non-constraint; PK/unique-constraint indexes are created above)
-- ============================================================================
CREATE INDEX activity_log_created_idx ON public.activity_log USING btree (created_at DESC);
CREATE INDEX activity_log_entity_idx ON public.activity_log USING btree (entity_type, entity_id);
CREATE INDEX activity_log_metadata_idx ON public.activity_log USING gin (metadata) WHERE (metadata IS NOT NULL);
CREATE INDEX budget_versions_project_idx ON public.budget_versions USING btree (project_id);
CREATE INDEX change_order_lines_em_idx ON public.change_order_lines USING btree (change_order_id, sort_order);
CREATE INDEX change_order_lines_product_idx ON public.change_order_lines USING btree (product_id);
CREATE INDEX change_orders_product_idx ON public.change_orders USING btree (product_id);
CREATE INDEX change_orders_project_idx ON public.change_orders USING btree (project_id);
CREATE INDEX change_orders_project_status_idx ON public.change_orders USING btree (project_id, status);
CREATE INDEX change_orders_sent_idx ON public.change_orders USING btree (sent_to_customer_at) WHERE (sent_to_customer_at IS NOT NULL);
CREATE INDEX change_orders_status_idx ON public.change_orders USING btree (status);
CREATE INDEX change_orders_sub_idx ON public.change_orders USING btree (subcontractor_id);
CREATE INDEX hour_entries_date_idx ON public.hour_entries USING btree (date);
CREATE INDEX hour_entries_project_idx ON public.hour_entries USING btree (project_id);
CREATE INDEX hour_entries_time_type_idx ON public.hour_entries USING btree (time_type_id);
CREATE INDEX idx_access_requests_created_at ON public.access_requests USING btree (created_at DESC);
CREATE INDEX idx_access_requests_status ON public.access_requests USING btree (status);
CREATE INDEX idx_change_order_consequence_lines_co ON public.change_order_consequence_lines USING btree (change_order_id);
CREATE INDEX idx_project_managers_project ON public.project_managers USING btree (project_id);
CREATE INDEX idx_project_managers_user ON public.project_managers USING btree (user_id);
CREATE INDEX invitations_email_open_idx ON public.invitations USING btree (email) WHERE (accepted_at IS NULL);
CREATE INDEX invitations_token_hash_idx ON public.invitations USING btree (token_hash);
CREATE INDEX milestones_project_idx ON public.milestones USING btree (project_id);
CREATE INDEX milestones_subcontractor_idx ON public.milestones USING btree (subcontractor_id);
CREATE INDEX password_resets_token_hash_idx ON public.password_resets USING btree (token_hash);
CREATE INDEX password_resets_user_active_idx ON public.password_resets USING btree (user_id) WHERE (used_at IS NULL);
CREATE INDEX project_budget_lines_assigned_idx ON public.project_budget_lines USING btree (assigned_subcontractor_id) WHERE (assigned_subcontractor_id IS NOT NULL);
CREATE INDEX project_budget_lines_product_idx ON public.project_budget_lines USING btree (product_id);
CREATE INDEX project_budget_lines_project_idx ON public.project_budget_lines USING btree (project_id);
CREATE INDEX project_checklist_items_project_idx ON public.project_checklist_items USING btree (project_id, sort_order);
CREATE INDEX project_forecast_extras_project_idx ON public.project_forecast_extras USING btree (project_id);
CREATE INDEX project_forecast_months_forecast_idx ON public.project_forecast_months USING btree (project_forecast_id);
CREATE INDEX project_forecasts_period_idx ON public.project_forecasts USING btree (forecast_period_id);
CREATE INDEX project_forecasts_pm_idx ON public.project_forecasts USING btree (project_manager_id);
CREATE INDEX project_forecasts_project_idx ON public.project_forecasts USING btree (project_id);
CREATE INDEX project_hour_budgets_project_idx ON public.project_hour_budgets USING btree (project_id);
CREATE INDEX project_hour_budgets_time_type_idx ON public.project_hour_budgets USING btree (time_type_id);
CREATE INDEX project_internal_costs_project_idx ON public.project_internal_costs USING btree (project_id);
CREATE INDEX project_invoices_date_idx ON public.project_invoices USING btree (invoice_date);
CREATE INDEX project_invoices_project_idx ON public.project_invoices USING btree (project_id);
CREATE INDEX project_managers_assigned_by_idx ON public.project_managers USING btree (assigned_by);
CREATE INDEX project_month_plans_project_idx ON public.project_month_plans USING btree (project_id);
CREATE INDEX project_subcontractors_sub_idx ON public.project_subcontractors USING btree (subcontractor_id);
CREATE INDEX project_type_checklist_items_type_idx ON public.project_type_checklist_items USING btree (project_type_id, sort_order);
CREATE INDEX projects_active_idx ON public.projects USING btree (deleted) WHERE (deleted = false);
CREATE INDEX projects_type_idx ON public.projects USING btree (project_type_id);
CREATE INDEX report_lines_bl_idx ON public.report_lines USING btree (project_budget_line_id);
CREATE INDEX report_lines_project_idx ON public.report_lines USING btree (project_id);
CREATE INDEX report_lines_sub_idx ON public.report_lines USING btree (subcontractor_id);
CREATE INDEX sessions_expires_idx ON public.sessions USING btree (expires_at);
CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);
CREATE INDEX subcontractor_product_prices_product_idx ON public.subcontractor_product_prices USING btree (product_id);
CREATE INDEX subcontractor_product_prices_sub_idx ON public.subcontractor_product_prices USING btree (subcontractor_id);
CREATE INDEX tender_bid_lines_bid_id_idx ON public.tender_bid_lines USING btree (tender_bid_id);
CREATE INDEX tender_bid_lines_line_id_idx ON public.tender_bid_lines USING btree (tender_line_id);
CREATE INDEX tender_bids_current_idx ON public.tender_bids USING btree (tender_id, subcontractor_id, is_current);
CREATE INDEX tender_bids_subcontractor_id_idx ON public.tender_bids USING btree (subcontractor_id);
CREATE INDEX tender_bids_tender_id_idx ON public.tender_bids USING btree (tender_id);
CREATE INDEX tender_invitations_subcontractor_id_idx ON public.tender_invitations USING btree (subcontractor_id);
CREATE INDEX tender_invitations_tender_id_idx ON public.tender_invitations USING btree (tender_id);
CREATE INDEX tender_lines_tender_id_idx ON public.tender_lines USING btree (tender_id);
CREATE INDEX tenders_project_id_idx ON public.tenders USING btree (project_id);
CREATE INDEX tenders_status_idx ON public.tenders USING btree (status);
CREATE INDEX ue_invoices_project_idx ON public.ue_invoices USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX ue_invoices_sub_idx ON public.ue_invoices USING btree (subcontractor_id);
CREATE UNIQUE INDEX uq_change_orders_project_number ON public.change_orders USING btree (project_id, change_order_number);
CREATE INDEX users_email_idx ON public.users USING btree (lower(email));
CREATE INDEX users_subcontractor_idx ON public.users USING btree (subcontractor_id) WHERE (subcontractor_id IS NOT NULL);
CREATE INDEX weekly_report_lines_bl_idx ON public.weekly_report_lines USING btree (project_budget_line_id);
CREATE INDEX weekly_report_lines_report_idx ON public.weekly_report_lines USING btree (weekly_report_id);
CREATE INDEX weekly_report_lines_status_idx ON public.weekly_report_lines USING btree (status) WHERE (status = 'approved'::text);
CREATE INDEX weekly_reports_project_idx ON public.weekly_reports USING btree (project_id);
CREATE INDEX weekly_reports_status_idx ON public.weekly_reports USING btree (status);
CREATE INDEX weekly_reports_sub_idx ON public.weekly_reports USING btree (subcontractor_id);
CREATE UNIQUE INDEX weekly_reports_unique_submission ON public.weekly_reports USING btree (project_id, subcontractor_id, year, week_number, submission_number);
CREATE INDEX weekly_reports_year_week_idx ON public.weekly_reports USING btree (year, week_number);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================
-- Assigns the next per-project change_order_number on insert, serialized by a
-- transaction-scoped advisory lock. search_path is pinned to '' for safety
-- (all object refs are schema-qualified).
CREATE OR REPLACE FUNCTION public.assign_change_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.change_order_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));

    SELECT COALESCE(MAX(change_order_number), 0) + 1
      INTO NEW.change_order_number
      FROM public.change_orders
      WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE TRIGGER trg_assign_change_order_number
  BEFORE INSERT ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION assign_change_order_number();

-- ============================================================================
-- ROW LEVEL SECURITY  (default-deny backstop — enabled, no policies)
-- ============================================================================
-- Every table has RLS enabled with no policies, so anon/authenticated match no
-- rows. The app uses the service_role key (bypasses RLS) and enforces authz in
-- lib/api-guard.ts. Keep this on for any new table (see lib/supabase.ts).
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_consequence_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE hour_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lump_sum_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_forecast_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_forecast_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_hour_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_internal_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_month_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_type_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_bid_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE ue_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_report_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- END OF BASELINE
-- ============================================================================

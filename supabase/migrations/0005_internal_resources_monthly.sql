-- Resources are planned per MONTH, not as a single annual/total lump: rename
-- the column for clarity. The pool's monthly capacity is spread across the
-- projects active each month (active span taken from the fremdriftsplan),
-- weighted by revenue — see lib/resource-allocation.ts.
--
-- The table is empty (no deployed consumers yet), so this is a pure rename with
-- no data migration.
alter table public.internal_resources rename column hours to hours_per_month;

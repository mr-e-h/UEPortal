-- Tilpasset Excel-kolonneoppsett per prosjekttype, så hver kunde/type kan ha
-- sitt eget arkformat uten kodeendring. jsonb { startRow, code, name, price,
-- qty, fixedPrice } — se lib/excel-map.ts (ImportColumnMap). null = bruk
-- standardoppsettet (gammel hardkodet layout).
alter table public.project_types
  add column if not exists import_config jsonb;

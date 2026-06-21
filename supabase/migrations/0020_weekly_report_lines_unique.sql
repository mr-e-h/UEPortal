-- 0020: Fjern duplikate weekly_report_lines + håndhev unikhet per (rapport, budsjettlinje).
--
-- Bakgrunn: PUT /api/weekly-reports/[id]/lines gjorde read-then-insert uten unik
-- constraint og uten transaksjon → samtidige autosaves (mengde-/kommentar-blur +
-- innsending) la inn duplikatrader som ble DOBBELTTELLT i fakturagrunnlag,
-- budsjettbruk og ukesrapport-oppsummering. 7 duplikatpar fantes i prod — alle
-- «stale 0 + ekte verdi» (eller to like), ingen fakturert (ue_invoice_id null).
--
-- Vi beholder raden med høyest reported_quantity per par (= den ekte verdien;
-- 0-raden er stale pre-save-tilstand), bryter likhet på id. Deretter en unik
-- indeks som onConflict-upserten i route.ts kan bruke. Begge kolonner er NOT NULL
-- i prod (verifisert), så plain unik indeks holder.
--
-- Idempotent: dedup er no-op uten duplikater, indeks er IF NOT EXISTS.
-- apply_migration / supabase db push wrapper håndterer transaksjonen.

-- 1. Dedup: behold én rad per (weekly_report_id, project_budget_line_id).
DELETE FROM weekly_report_lines l
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY weekly_report_id, project_budget_line_id
           ORDER BY reported_quantity::numeric DESC, id ASC
         ) AS rn
  FROM weekly_report_lines
) ranked
WHERE l.id = ranked.id
  AND ranked.rn > 1;

-- 2. Håndhev «én linje per (rapport, budsjettlinje)».
CREATE UNIQUE INDEX IF NOT EXISTS uidx_wrl_report_budget_line
  ON weekly_report_lines (weekly_report_id, project_budget_line_id);

-- Koble en registrert UE-faktura (ue_invoices) til de godkjente
-- ukesrapport-linjene (weekly_report_lines) den dekker, slik at «Gjenstår å
-- fakturere» kan bli en EKTE avstemming i stedet for ren aritmetikk, og
-- frontend kan vise «Fakturert / Ikke fakturert» per linje (UE-rapport 4.7).
--
-- ADDITIVT: kun én ny nullable kolonne. weekly_report_lines.billed_at finnes
-- allerede (baseline 0000), så den røres ikke. Eksisterende rader får
-- ue_invoice_id = NULL og oppfører seg nøyaktig som før (= ikke fakturert).
--
-- PK-typer: ue_invoices.id og weekly_report_lines.id er begge `text` i
-- baseline — FK-kolonnen MÅ derfor være text for å matche. (Tidligere har
-- text/uuid-mismatch skapt problemer; her er begge text.)
--
-- on delete set null: når en faktura slettes, mister linjene koblingen, men
-- selve linjene består. App-laget nullstiller i tillegg billed_at ved sletting
-- (faktura DELETE), så en linje blir «ikke fakturert» igjen og dukker opp i
-- grunnlaget på nytt.

alter table public.weekly_report_lines
  add column if not exists ue_invoice_id text
    references public.ue_invoices(id) on delete set null;

-- Oppslag «hvilke linjer hører til denne fakturaen» + delvis indeks for å
-- finne ufakturerte linjer raskt (grunnlaget filtrerer på dette).
create index if not exists weekly_report_lines_ue_invoice_idx
  on public.weekly_report_lines using btree (ue_invoice_id)
  where (ue_invoice_id is not null);

-- weekly_report_lines har allerede RLS aktivert (baseline) med 0 policies
-- (default-deny; all tilgang via service_role i app-laget). En ny nullable
-- kolonne trenger ingen policy-endring.

-- Koble en registrert UE-faktura (ue_invoices) til de godkjente
-- endringsmeldingene (change_orders) den dekker — speiling av mønsteret som
-- 0016 innførte på weekly_report_lines. Med dette kan «Gjenstår å fakturere»
-- også avstemme CO-linjer mot ekte fakturaer, og UE-frontend kan vise
-- «Fakturert / Ikke fakturert» per CO-linje i stedet for at CO alltid er null.
--
-- ADDITIVT: kun to nye nullable kolonner. Eksisterende rader får
-- billed_at = NULL og ue_invoice_id = NULL og oppfører seg nøyaktig som før
-- (= ikke fakturert), så grunnlaget er uendret for historiske CO.
--
-- PK-typer: change_orders.id og ue_invoices.id er begge `text` i baseline
-- (0000) — FK-kolonnen MÅ derfor være text for å matche. (Samme valg som 0016,
-- der weekly_report_lines.id/ue_invoices.id begge er text.)
--
-- on delete set null: når en faktura slettes, mister CO-en koblingen, men selve
-- CO-en består. App-laget (ue-invoices DELETE) nullstiller i tillegg billed_at
-- ved sletting, slik at CO-en blir «ikke fakturert» igjen og dukker opp i
-- grunnlaget på nytt — identisk livssyklus som for rapportlinjene.

alter table public.change_orders
  add column if not exists billed_at timestamptz;

alter table public.change_orders
  add column if not exists ue_invoice_id text
    references public.ue_invoices(id) on delete set null;

-- Oppslag «hvilke CO hører til denne fakturaen» + delvis indeks for å finne
-- ufakturerte CO raskt (grunnlaget/avstemmingen filtrerer på dette).
create index if not exists change_orders_ue_invoice_idx
  on public.change_orders using btree (ue_invoice_id)
  where (ue_invoice_id is not null);

-- change_orders har allerede RLS aktivert (baseline). To nye nullable kolonner
-- trenger ingen policy-endring (additiv, default-NULL).

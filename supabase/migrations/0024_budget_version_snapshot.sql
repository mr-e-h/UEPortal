-- 0024: Per-produkt øyeblikksbilde på budsjettversjoner.
--
-- Lar versjonshistorikken vise en DIFF («hva endret seg fra forrige versjon til
-- denne») i stedet for bare totalsummer. Hver import lagrer hele linjelista
-- (product_id, custom_label, mengde, kundepris, UE-kost, tildeling, line_type)
-- som JSON. Diffen sammenligner to versjoners øyeblikksbilder per produkt.
--
-- Inneholder KUNDEPRIS + UE-kost → maskeres i app-laget for UE/byggeleder
-- (admin-loader nuller snapshot for ikke-økonomi-roller, som for total_sales_value).
--
-- ADDITIV + idempotent. Eksisterende versjoner får null (ingen diff bakover —
-- øyeblikksbilder fanges kun fremover fra og med neste import).

alter table public.budget_versions
  add column if not exists snapshot jsonb;

-- 0023: Egendefinert etikett på budsjettlinjer.
--
-- Brukes for UE-splittlinjer (f.eks. «UPFA2303 - Blåsing») der en del av et
-- produkt settes ut til en UE med EGEN pris, mens hovedlinja gjøres intern.
-- Tom streng = ingen etikett → vis produktnavnet som før.
--
-- ADDITIV + idempotent. Eksisterende rader får '' (ingen etikett).

alter table public.project_budget_lines
  add column if not exists custom_label text not null default '';

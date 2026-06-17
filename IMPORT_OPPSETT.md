# Import-oppsett per Prosjekttype (design, ikke bygget ennå)

Mål: gjøre Excel-importen **data-styrt** i stedet for hardkodet, så du selv kan
tilpasse hvilke kolonner som betyr hva når en kunde endrer regnearket — uten
kodeendring. Oppsettet bor på **Prosjekttype**, så ulike kunder/typer får hvert
sitt mønster.

> Merk: dette løser «kunden endrer kolonne-layout»-klassen. Den separate
> dedup-buggen (fastpris-linjer med samme navn kollapset til én) er allerede
> fikset i `lib/excel-import.ts`.

## Dagens tilstand (hardkodet)
`lib/excel.ts` → `parseExcelBuffer` antar ett fast oppsett (sett på en ekte
Telenor-fil, «Arbeidsprodukter»):

| Rad | Innhold |
|---|---|
| 0–2 | Prosjektnummer / Prosjektnavn / Ordrenummer (verdi etter `:`) |
| 4 | Overskrift: Kategori · Produktkode · Produktnavn · Pris1 · Antall1 · Pris2 · Antall2 · Fast pris |
| 5+ | Produktrader |

Faste kolonneindekser: kode = B(1), navn = C(2), pris2 = F(5), antall2 = G(6),
fastpris = H(7). Prislogikk: `fastpris > 0` → pris=fastpris, antall=1; ellers
`pris2 === 1 && antall2 > 1` → pris=antall2, antall=1; ellers pris=pris2,
antall=antall2. Lump-sum-koder (`lib/lump-sum-codes.ts`) → pris=1, antall=beløp.

## Datamodell
Ny kolonne på `project_types`:

```sql
alter table project_types add column if not exists import_config jsonb;
```

`import_config`-form (null = bruk dagens hardkodede standard, så eksisterende
typer virker uendret):

```jsonc
{
  "sheet": 0,                 // arkindeks eller navn
  "startRow": 5,             // 0-basert første produktrad
  "meta": {                  // valgfritt — header-felt (verdi etter ":")
    "projectNumber": { "row": 0, "col": 0 },
    "projectName":   { "row": 1, "col": 0 },
    "orderNumber":   { "row": 2, "col": 0 }
  },
  "columns": {               // 0-basert kolonneindeks per felt
    "code": 1, "name": 2, "category": 0,
    "price": 5, "quantity": 6, "fixedPrice": 7,
    "altPrice": 3, "altQuantity": 4   // Pris1/Antall1 (valgfritt)
  },
  "priceRules": {
    "fixedPriceWins": true,            // fastpris-kolonne overstyrer
    "onePriceMeansQtyIsPrice": true,   // pris==1 & antall>1 → pris=antall, antall=1
    "lumpSumFromCodeList": true        // bruk lump-sum-kodelisten (pris=1, antall=beløp)
  }
}
```

## Parser-endring
- `parseExcelBuffer(buffer, config?)` tar imot oppsettet; uten config brukes
  dagens defaults (back-compat). All kolonne-/rad-logikk leses fra `config`.
- Import-ruta (`app/api/projects/[id]/import/route.ts`) slår opp prosjektets
  `project_type_id` → henter `import_config` → sender til parseren. Mangler type
  eller config: fall tilbake til standard.

## UI under Prosjekttype
Egen «Import-oppsett»-seksjon per type (i `app/admin/project-types`):
1. **Last opp eksempel-Excel** (lagres ikke — kun for å konfigurere).
2. **Rutenett** viser de første ~15 radene med kolonnebokstaver (A, B, C…).
3. For hvert felt (kode, navn, pris, antall, fastpris, kategori, meta-rader):
   **nedtrekk** for kolonne + felt for **startrad**.
4. **Live forhåndsvisning**: kjør parseren med valgt config mot eksempel-fila og
   vis tolkede linjer (kode · navn · pris · antall) + antall lest / hoppet over.
5. **Lagre** på prosjekttypen.

Trenger en preview-endpoint som parser et opplastet eksempel med en gitt config
**uten** å lagre noe (POST `/api/project-types/[id]/import-preview`).

## Åpne valg (avklares ved bygging)
- **Lump-sum-koder**: behold global liste (`lib/lump-sum-codes.ts`) eller flytt
  inn i `priceRules` per type? (Anbefalt v1: behold global, legg til override
  senere.)
- **Kunde vs type**: oppsettet ligger på type nå. Hvis flere kunder deler én
  type med ulike Excel-format, kan det trenge et eget «import-profil»-nivå.
- **Header-gjenkjenning**: v1 bruker fast startRow; kan utvides til å finne
  header-raden automatisk på overskriftstekst.

## Filer som berøres (estimat)
- migrasjon `00XX_project_type_import_config.sql`
- `types/index.ts` (ProjectType += import_config)
- `lib/excel.ts` (config-parameter)
- `app/api/projects/[id]/import/route.ts` (slå opp + send config)
- `app/api/project-types/[id]/import-preview/route.ts` (ny)
- `app/admin/project-types/page.tsx` (Import-oppsett-UI + opplasting + preview)
- `lib/api.ts` (preview/lagre-klient)

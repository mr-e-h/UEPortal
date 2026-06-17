# Økonomimodell og fordelingsregler (MinUE)

Dette er **sannheten** for hvordan ordreverdi, kostnader og timer flyter gjennom
systemet. Claude leser denne ved økonomi-relaterte oppgaver, og **oppdaterer den
hver gang modellen endres eller noe nytt legges inn**. Hold den kort og presis.

> Status pr. nå: HELE ombyggingen er implementert + verifisert (Pakke 1 + 2 + 3
> ferdig). P1–P4 er PERIODE-rapporter (ikke kvartal) som speiler jobb-levering og
> består — forhåndsfylles nå fra den løpende prognosen.

---

## 1. Ordreverdi → måneder (fremdriftsplan-fordeling)
**1a. Fordeling:** Hver fase i fremdriftsplanen har en *andel* av ordreverdien.
Andelen fordeles **jevnt over månedene fasen er aktiv** (start–slutt). En måneds
ordreverdi = **summen av alle aktive fasers bidrag** den måneden.
- Eksempel: graving = 40 % over en periode, blåsing = 10 % i samme periode, og de
  er de eneste aktive ⇒ **50 % av ordreverdien legges i den perioden**. Resten
  havner i periodene de øvrige fasene faktisk pågår.

**1b. Hvor andelen kommer fra (VEDTATT):** Andelen **avledes fra
budsjettlinjene** som er tagget til fasen:
`fase-andel = Σ(fasens budsjettlinjer: mengde × kundepris) / total ordreverdi`.
Manuell vekt kan overstyre i unntak. (I dag er vekten kun manuell — se byggeplan.)

## 2. UE-kost → måneder
Samme prinsipp som ordreverdi: budsjettert UE-kost fordeles per fase-andel, jevnt
over fasens måneder, summeres ved overlapp.

## 3. Interne timer + internkost → ressurspool, per måned, vektet på omsetning (VEDTATT)
- **Interne ressurser** (`internal_resources`): du legger selv inn **timer/måned**
  og **timeskost** per ressurs. Dette er eneste kilde til interne timer.
- Pool per måned: `timer = Σ timer/mnd`, `kost = Σ(timer/mnd × timeskost)`.
- Hver måned fordeles poolen på **aktive prosjekter**, vektet på prosjektets
  **omsetning DEN måneden** (fra punkt 1):
  `prosjektets timer = pool-timer × (prosjektets omsetning denne mnd / Σ aktive prosjekters omsetning denne mnd)`.
  - Eksempel: 100 t til disp; A omsetter 500k, B 250k, C 250k den mnd ⇒ A 50 t, B 25 t, C 25 t.
- **Internkost per prosjekt-måned = tildelte timer × timeskost.**
- **Rolle-timer (PL/BL/dok) og manuell `internal_hours` utgår** — ressurspoolen er
  eneste kilde til interne timer/kost.

## 4. Internkost-poster (engangs/løpende)
`ProjectInternalCostEntry` (rigg, leie o.l.): plasseres i sine egne måneder (egen
dato), løper til fremdriftsplanens slutt. **Ikke** fase-vektet — den har allerede
egen tidsplassering. (Egen post-type, skilt fra ressurspool-internkost i punkt 3.)

## 5. Prognose-modell — løpende vs. periode (to LEGITIME lag, ikke dobbeltføring)
- `project_month_plans` = den **LØPENDE** prognosen per prosjekt, auto-avledet
  fra fremdriftsplan + ressurspool (punkt 1–3). Endrer seg fortløpende.
- `project_forecasts` / `project_forecast_months` = **PERIODE-prognosene**
  (P1, P2, P3, P4 …) — øyeblikksbilder som leveres/rapporteres per periode, med
  send-inn → godkjenn → lås-flyt. Periodene er IKKE bundet til kvartal; de
  speiler hvordan prognoser faktisk leveres på jobb. **SKAL bestå.**

Forbedring (Pakke 3): forhåndsfyll en periode-prognose fra den løpende prognosen
(slipp å taste månedstall på nytt) og utled header-totalene fra månedsradene
(fjern intern dobbeltlagring) — uten å røre selve rapporterings-arbeidsflyten.

## 6. Resultat vs. Prognose (hero på prosjekt)
- **Resultat** = faktisk hittil: opptjent (godkjente rapportlinjer × kundepris) −
  påløpt UE-kost − påløpt internkost.
- **Prognose** = forventet ved ferdig: ordreverdi − budsjett-UE-kost − internkost
  (hele perioden). `expected_profit` er alltid server-avledet.

## 7. Fakturering
Manuelt registrert (`project_invoices`). «Angre fakturering» kun på
administrasjonsnivå (main/company).

---

## Byggeplan (rekkefølge)
- **Pakke 1 — Avledet fasevekt ✅ FERDIG:** budsjettlinjer kobles til faser
  (`phase_id`, migrasjon 0014), «Fase»-nedtrekk per linje i budsjett-fanen,
  fasevekt avledes fra taggede linjer (1b) i `forecast-distribution.ts`. Manuell
  vekt overstyrer.
- **Pakke 2 — Timer/internkost fra ressurspool per måned ✅ FERDIG:** poolen
  vektes på *månedlig* omsetning (`allocatePoolByMonthlyRevenue` +
  `/api/projects/[id]/allocated-hours` returnerer `monthly[{hours,cost}]`).
  Prognosens interne timer + internkost er nå AVLEDET (read-only, «· pool») fra
  dette per måned. Rolle-timer (PL/BL/dok) + «Timeoversikt» + manuell
  `internal_hours` er FJERNET (punkt 3). Verifisert end-to-end i nettleser.
- **Pakke 3 — Koble løpende → periode (P1–P4 BESTÅR) ✅ FERDIG:** «Hent fra
  løpende prognose»-knapp i periode-prognosen forhåndsfyller månedene fra
  `month_plans` (omsetning/UE/annen/risiko) + pool-avledet internkost fra
  `allocated-hours`, avgrenset til periodens år. Header-totalene er nå AVLEDET
  (read-only) fra månedsradene, og `POST /api/project-forecast-months` setter
  header = Σ måneder ved lagring (fjernet intern dobbeltlagring). Send-inn →
  godkjenn → returner → lås er urørt. Verifisert i nettleser.

## Vedlikehold
Når en regel/formel endres eller en ny økonomimekanisme legges inn: oppdater riktig
punkt her i samme slengen, og noter det i «Status»/«Byggeplan».

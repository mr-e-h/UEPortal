# UE-siden: Prioritert forbedringsrapport

> Full UX/struktur-gjennomgang av underentreprenør-porten, sammenlignet med admin-siden.
> Metode: 62-agents multi-agent-gjennomgang (kartlegg → analyser → adversariell verifisering → syntese).
> 47 forslag · 44 verifisert mot faktisk kode · 3 forkastet · 0 UE-isolasjonsbrudd. Datert 2026-06-17.

## 1. Helhetsvurdering

UE-siden har et solid fundament: rollebeskyttelse er på plass server-side (delt `subcontractor/layout.tsx`), UE-pris-isolasjonen holder konsekvent (kun `subcontractor_cost_price_snapshot`, kundepris strippes overalt), og admin-siden gir et tydelig mønsterbibliotek å kopiere fra. Men siden er **amputert i forhold til sine egne data**: backend regner ut og sender mer enn frontend faktisk viser, og to av brukerens fire kjernemål — «se budsjett/gjenstående» (Mål 3) og «se hva som kan faktureres» (Mål 4) — er enten halvt eller dårlig dekket der UE faktisk er. Den største daglige friksjonen ligger i ukesrapportering (blank tabell hver uke, ekstra klikk, stum kvittering) og i at oversiktssidene er fattigere enn dashbordet de lenker fra. Det finnes også **to reelle bugs** (én datafeil, én økonomisk feilberegning) som bør fikses uavhengig av alt UX-arbeid.

---

## Mål 1 — Sende endringsmeldinger (EM)

### 1.1 BUG: Manglende felter i `change_orders`-SELECT skjuler HVORFOR en EM må revideres `[S / høy]`
`dashboard/route.ts:63` henter ikke `em_type`, `submitted_by` eller `admin_comment`, men koden leser dem (`page.tsx:157,182,184,186`). Følgen: den oransje «Trenger revisjon»-boksen — det eneste ekte oppgavesignalet til UE på dashbordet — viser tom kommentar, feil type-badge og ingen innsender. UE ser AT noe må rettes, men ikke HVA.
- **Løsning:** Legg de tre feltene til i SELECT-strengen. Ingen ny spørring, ingen ytelseskostnad.
- **Merk:** Samme datamangel rammer også «til behandling»-listen (`page.tsx:317,344`), så fiksen treffer bredere enn dashbordboksen.
- **Fil:** `app/api/subcontractor/dashboard/route.ts`

### 1.3 Legg «Send endringsmelding»-knapp direkte på samlesiden `[S / middels]`
Samlesiden `/subcontractor/change-orders` har ingen «ny EM»-knapp (`page.tsx:235-240`). En UE som er der for å sjekke status må navigere bort for å sende en ny.
- **Løsning:** Primærknapp i headeren som åpner `ProjectPickerModal` (finnes og brukes allerede). Prosjektlisten er allerede lastet (`page.tsx:60,86-90`).
- **Fil:** `app/subcontractor/change-orders/page.tsx`

### 1.4 Vis admin-kommentar / «trenger revisjon» på samlesiden, ikke bare på prosjektsiden `[S / middels]`
Prosjektsiden viser admin-kommentaren inline; samlesiden viser bare en oransje badge (`change-orders/page.tsx:131-227`). UE som filtrerer på «Trenger revisjon» ser ikke hva admin ba om uten å klikke inn på prosjektet. `admin_comment` ligger allerede på wire (strippes ikke i `route.ts:58-64`) — ingen API-endring.
- **Fil:** `app/subcontractor/change-orders/page.tsx`

### 1.5 Vis «Trenger revisjon»-teller på selve EM-sidene, ikke bare på dashbordet `[S / middels]`
Oppgaveboksen finnes kun på dashbordet. På samlesiden og prosjektsiden — der UE faktisk jobber med EM — er det eneste signalet en svak oransje radfarge. Legg et lite oransje varselbånd over tabellen med knapp som setter `statusFilter='revision_requested'`. Telleren kan utledes klient-side fra data som alt er lastet.
- **Filer:** `app/subcontractor/change-orders/page.tsx`, `app/subcontractor/projects/[id]/page.tsx`

### 1.6 Egen EM-detaljside (lese-modus) for alle statuser `[L / høy]`
UE har ingen detaljside for EM. Raden er kun klikkbar for `draft`/`revision_requested`; for `pending`/`approved`/`rejected` kan UE ikke åpne noe, beskrivelse trunkeres til 50 tegn, og løsning/linjer/historikk vises aldri. Admin har full detaljside med versjonslogg.
- **Løsning:** Lag `/subcontractor/change-orders/[id]` som speiler admin-detaljen minus all kundeøkonomi (gjenbruk strip-mønsteret fra `route.ts:58-64`). Rad-klikk åpner siden for alle statuser; edit-modal beholdes bak en eksplisitt «Rediger/Revider»-knapp.
- **Admin-ref:** `app/admin/change-orders/[id]/page.tsx` (`canSeeEconomy`-gating viser at økonomi alt maskeres rollebasert).

### 1.7 Vis UE når EMen faktisk er sendt videre til kunde `[M / høy]`
Når admin markerer EMen sendt (`sent_to_customer_at`), ser UE fortsatt bare gul «Venter». UE kan ikke skille «ligger ubehandlet hos admin» fra «er ute hos kunde». Feltet er ikke kundepris og kan trygt eksponeres.
- **Løsning:** Legg `sent_to_customer_at` til i UE-svaret (`change-orders/route.ts:58-64`) og rendre en egen blå tilstand når `pending` + feltet er satt. Gjenbruk `changeOrderPill` (`lib/statuses.ts:66-76`) → label **«Sendt kunde»** (blå), konsistent med admin.
- **Filer:** `change-orders/route.ts`, `Badge.tsx`, `change-orders/page.tsx`, `projects/[id]/page.tsx`

### 1.8 Gjør vedleggsopplasting trygg i to-stegs-flyten `[M / middels]`
EMen sendes i steg 1, vedlegg lastes opp i steg 2 (`ChangeOrderModal.tsx:265-295`). Feiler steg 2, er EMen allerede innsendt som `pending` uten vedlegg, og et nytt klikk på «Send» lager en **duplikat-EM** (ingen `orderId`-i-state).
- **Løsning:** Ved vedleggsfeil — ikke kall `onSuccess()`; behold `orderId`, vis «EMen er lagret, men vedlegget ble ikke lastet opp» med en målrettet «Last opp på nytt»-knapp som kun POSTer til `/attachment`. Alternativt: opprett som `draft`, last opp vedlegg, flytt til `pending` til slutt.
- **Filer:** `ChangeOrderModal.tsx`, `app/api/change-orders/[id]/attachment/route.ts`

---

## Mål 2 — Ukesrapportering

> Dette er flyten med mest daglig friksjon. De fire første er små grep med stor effekt.

### 2.1 Picker-snarveien skal lande UE utfyllingsklar (auto-scroll + auto-draft via `?action`) `[S / høy]`
«Send ukesrapport» åpner picker, men `pick()` ruter til prosjektet **uten** action-param (`ProjectPickerModal.tsx:58-64`). UE lander på toppen av en ~1150-linjers side og må selv scrolle ned og klikke «Ny innsending». (Modal-kommentaren påstår feilaktig at siden «lands on the weekly-report flow by default».)
- **Løsning:** Gjenbruk den fungerende EM-mekanismen: rut til `?action=weekly-report`, og utvid `useEffect` (`page.tsx:112-118`) til å scrolle «Lever rapport»-kortet inn i view + kalle `createNewDraft()` automatisk.
- **Filer:** `ProjectPickerModal.tsx`, `projects/[id]/page.tsx`

### 2.2 Forhåndsutfyll ny ukesrapport fra forrige uke («Kopier forrige uke») `[M / høy]`
`createNewDraft()` nullstiller alt (`page.tsx:292`). En UE som rapporterer samme budsjettlinjer uke etter uke må taste hver mengde på nytt fra blank. **Dette er det største enkeltfriksjonspunktet i hele flyten.** Dataene finnes: `allReports` er allerede lastet og sortert (`page.tsx:180-186`).
- **Løsning:** Minimum en «Kopier forrige uke»-knapp som fyller Antall-kolonnen med forrige innsendte ukes mengder; UE justerer kun det som er endret. (Ikke hard-prefill ukritisk — gjør det til et bevisst klikk for å unngå feilsendte tall.)
- **Fil:** `projects/[id]/page.tsx`

### 2.3 Vis utfyllingstabellen direkte — slå sammen «Ny innsending» + tom tabell `[M / middels]`
Tabellen er gated på `hasActiveDraft` (`page.tsx:736`), så UE må først klikke «Ny innsending uke X» FØR den vises i det hele tatt. For en uke uten draft ser UE bare en knapp og ingen produkter.
- **Løsning:** Vis budsjettlinje-tabellen umiddelbart (read-only) med en tydelig «Start rapport»-knapp, ELLER lazy-opprett draft ved første tastetrykk. Behold eksplisitt knapp kun for «innsending #2».
- **Fil:** `projects/[id]/page.tsx`

### 2.4 Positiv bekreftelse etter innsending `[S / middels]`
`handleSubmit()` gir ingen kvittering ved suksess — draften forsvinner uten et ord (`page.tsx:342-343`). Bare feil vises (rød tekst). For et ukentlig gjentaksarbeid skaper stum suksess usikkerhet om rapporten gikk gjennom.
- **Løsning:** Vis en kort suksess-banner/toast («Rapport for uke {n} sendt — venter på godkjenning») og fremhev den nye raden i innsendingslista. (Ingen ferdig suksess-toast å gjenbruke — `ConfirmDialog` er bekreft/avbryt — en liten inline-banner må bygges.)
- **Fil:** `projects/[id]/page.tsx`

### 2.5 Forklar hvorfor «Send inn»-knappen er grå `[S / lav]`
Knappen er disabled til minst ett felt har mengde > 0 (`hasAnyInput`, `page.tsx:391,800`), men UI gir ingen forklaring.
- **Løsning:** Statisk hjelpetekst «Skriv inn minst én mengde for å sende inn» ved siden av knappen når `hasAnyInput` er false (`page.tsx:798-803`).
- **Fil:** `projects/[id]/page.tsx`

### 2.6 Egen UE-landingsside for ukesrapporter på tvers av prosjekter `[L / høy]`
Det finnes egne cross-project-sider for EM og fakturagrunnlag, men ingen `/subcontractor/weekly-reports`. Rapportering ligger begravd inne på hver prosjekt-detaljside. En UE på flere prosjekter samme uke må gjenta hele flyten per prosjekt uten en samlet «hva mangler jeg å rapportere denne uka»-visning.
- **Løsning:** Lag `/subcontractor/weekly-reports` som UE-motstykke til admin-køen: ukesnavigator øverst (gjenbruk `prevISOWeek`/`nextISOWeek`/`formatWeekLabel`) + liste over prosjekter for valgt uke med status-badge (ikke rapportert / draft / innsendt / godkjent). Legg menypunktet i samme nav som change-orders/invoice-basis.
- **Admin-ref:** `app/admin/weekly-reports/page.tsx` (statusteller + filtrerbar liste).

---

## Mål 3 — Oversikt: budsjett, gjenstående budsjett og status

> Kjernen i Mål 3 er svakest dekket på selve landingssiden. Backend regner alt — frontend viser lite.

### 3.1 Vis alle 5 KPI-ene på dashbordet — budsjett og gjenstående mangler helt `[S / høy]`
API-et beregner og serialiserer 5 KPI-er (`route.ts:301-302`), men dashbordet rendrer kun 2: «fakturerbart» og «produsertIkkeBedt» (`page.tsx:167,177`). **Budsjett (ordreverdi), fakturert og gjenstående budsjett hentes over nettet, men vises aldri i overordnet oversikt** — selve kjernen i Mål 3 finnes ikke på landingssiden.
- **Løsning:** Utvid KPI-raden til en kompakt 4–5-tallsoversikt: Budsjett → Fakturert → Gjenstår å fakturere → Klart til fakturering → Venter på godkjenning. Ren rendering, ingen nytt API-kall.
- **Admin-ref:** Admin viser hele økonomibildet på dashbordet (`admin/page.tsx:238-279`).
- **Fil:** `app/subcontractor/page.tsx`

### 3.2 Legg «Gjenstår»-KPI i kroner på prosjektsiden `[S / høy]`
UE har ingen «gjenstående budsjett i kroner» noe sted. De fire kortene (`page.tsx:478-520`) viser ikke differansen; UE må mentalt regne Budsjett − Godkjent.
- **Løsning:** Suppler med et «Gjenstår»-kort = `totalBudgetValue − totalApprovedValue` (begge regnes alt på `page.tsx:371-389`). Undertekst «X% igjen av ordreverdi».
- **Admin-ref:** `SubcontractorsSection.tsx:149-150` / `ProjectStatusHero.tsx:169`.

### 3.3 Vis gjenstående mengde i «Mine produktlinjer» — ikke gjemt bak en kladd `[S / høy]`
Den eneste «Gjenstående»-mengdekolonnen finnes i innsendingstabellen og vises KUN når `hasActiveDraft` er sann (`page.tsx:736,749,767`). Vil UE bare SE restmengde uten å rapportere, må de først klikke «Ny innsending». Verdien finnes alt: `usage.remaining` fra `budgetUsage.ts:41`.
- **Løsning:** Legg «Gjenstående»-kolonne i «Mine produktlinjer», rød hvis negativ.
- **Filer:** `projects/[id]/page.tsx`, `lib/utils/budgetUsage.ts`

### 3.4 Gjør fremdriftsbaren stablet med «Gjenstår»-segment + kronetooltip `[M / middels]`
UE-baren er enkel ett-farges på godkjent/budsjett (`page.tsx:523-543`) og viser ikke «til behandling» (`totalPendingValue` regnes men brukes ikke).
- **Løsning:** Stablet bar med tre segmenter — Godkjent / Til behandling / Gjenstår — hver med kronetooltip.
- **Admin-ref:** `ProjectStatusHero.tsx:166-170` (nesten 1:1).

### 3.5 Vis gjenstående budsjett (kr) per prosjekt i prosjektlisten `[S / middels]`
Prosjektlisten (`projects/page.tsx:137-209`) har ingen «Gjenstår»-kolonne. `budget_value` og `approved_value` finnes alt på raden.
- **Caveat (vær ærlig overfor UE):** `budget_value` («Ordreverdi») er opprinnelig budsjett uten godkjente EM, mens `approved_value` inkluderer godkjente EM. Differansen kan bli negativ når UE har produsert/EM-et utover opprinnelig ordre. Merk kolonnen tydelig.
- **Fil:** `app/subcontractor/projects/page.tsx`

### 3.6 Legg fremdrift- og frist-kolonne på prosjektlisten (paritet med dashbordet) `[S / middels]`
Dashbordets «Mine prosjekter» har fremdriftsbar OG frist med dager-igjen/forsinket-farging; den dedikerte listen har ingen av delene. UE som klikker «Se alle» får **mindre** info, ikke mer.
- **Løsning:** Fremdrift-kolonne (`approved_value/budget_value`) + Frist-kolonne (`end_date` med overdue/soon-farging). Flytt `daysUntil`-helperen til `lib/` for deling.
- **Filer:** `app/subcontractor/projects/page.tsx`, `app/subcontractor/page.tsx`

### 3.7 Legg saks-pills på prosjektlisten (EM/rapport venter, trenger revisjon) `[M / høy]`
Listen er en flat tabell uten ett eneste varsel. UE kan ikke se hvilke prosjekter som har EM/rapporter til behandling eller en EM i revisjon uten å åpne hvert prosjekt. Dashboard-API-et beregner allerede pending-tall per prosjekt (`dashboard/route.ts:229-238,295-296`), men `/api/subcontractor/projects` gjør det IKKE — så dette krever å utvide den routen.
- **Løsning:** «Saker»-kolonne med fargede pills, gjenbruk mønsteret fra `ProjectsOverviewTable.tsx:181-202` og `lib/attention.ts`.
- **Filer:** `projects/page.tsx`, `projects/route.ts`, `lib/attention.ts`

### 3.8 Lenk dashbordets KPI-kort til Fakturering- og EM-sidene `[S / middels]`
Dashbordets bokser lenker kun til per-prosjekt-sider. De to dedikerte oversiktssidene (invoice-basis, change-orders) er KUN nåbare via sidebaren.
- **Løsning:** Gjør KPI-kortene klikkbare (group-hover + ChevronRight som `admin/page.tsx:239-266`): fakturering-kortene → `/subcontractor/invoice-basis`; venter/EM → `/subcontractor/change-orders?status=revision_requested`.
- **Fil:** `app/subcontractor/page.tsx`

### 3.10 Statusteller-chips på prosjektlisten i stedet for skjult dropdown `[S / lav]`
Statusfilteret defaulter til «active» (`projects/page.tsx:73`), så en UE som leter etter et nylig **fullført** prosjekt (f.eks. for siste faktura) ser ingenting og må gjette at filteret må byttes.
- **Løsning:** Klikkbare teller-chips: «Aktive N · Fullført N · Arkivert N · Alle N» (admin-mønster `ProjectsOverviewTable.tsx:88-105`).
- **Fil:** `projects/page.tsx`

---

## Mål 4 — Fakturering: hva kan faktureres + registrere fakturert

### 4.1 BUG: Dato-filteret gjør «Gjenstår å fakturere» matematisk feil `[M / høy]`
Dato-filteret (fra/til) filtrerer «Godkjent total» (`fetchBasis`, `page.tsx:79-80`), men `fetchInvoices` filtrerer KUN på prosjekt, aldri dato (`page.tsx:88-94`). I en datoavgrenset visning sammenlignes derfor datoavgrenset godkjent mot **alle** registrerte fakturaer → `totalRemaining` (`page.tsx:154`) blir feil og kan vises negativt/rødt uten grunn.
- **Løsning (ekte fiks):** Send fra/til også til `/api/subcontractor/ue-invoices` og filtrer på `invoice_date`. (Subsidiært: grå ut «Gjenstår»-kortet når datofilter er aktivt.)
- **Filer:** `invoice-basis/page.tsx`, `app/api/subcontractor/ue-invoices/route.ts`

### 4.2 Vis feilmelding (rød banner) når faktura-lagring/-sletting feiler `[S / middels]`
`registerInvoice` og `deleteInvoice` (`page.tsx:103-128`) sjekker aldri `res.ok`. UI tømmer feltene uansett, så UE tror fakturaen ble lagret selv om POST returnerte 400/500.
- **Løsning:** `invError`-state + rød banner ved `!res.ok`, og ikke tøm feltene ved feil.
- **Admin-ref:** `app/admin/projects/[id]/InvoicesSection.tsx:48-60,120-122`.

### 4.3 Krev prosjekt valgt ved fakturaregistrering `[S / middels]`
Skjemaet defaulter til «Alle prosjekter» → `project_id=null`. Null-fakturaer telles ikke i per-prosjekt-visning, så «Gjenstår» spriker mellom «alle» og enkeltprosjekt.
- **Løsning:** Default tom «Velg prosjekt…» og krev valg (inline feil, gjenbruk banneren fra 4.2).
- **Admin-ref:** Admin krever prosjekt (`admin/invoice-basis/page.tsx:74,284`).

### 4.4 «Fyll inn gjenstående»-snarvei i beløpsfeltet `[S / høy]`
Beløpsfeltet er fri manuell innskriving uten kobling til grunnlaget (`page.tsx:231-241`). UE må lese av «Gjenstår»-tallet og skrive det inn på nytt — lett å taste feil.
- **Løsning:** «Fyll inn gjenstående (X kr)»-knapp som setter `invoiceAmount = totalRemaining` (synk scope med prosjektfilteret).

### 4.5 Tusenskille på fakturabeløp `[S / lav]`
Rått `<input type="number">` uten gruppering — 1250000 vises uten skille, lett å feiltaste en null på et felt der det gjør «Gjenstår» direkte feil.
- **Ærlig merknad:** Ingen input i appen formaterer tusenskille while-typing i dag (også admin-feltet er rått). Dette ville være et nytt mønster, ikke «paritet». Lav prioritet.

### 4.6 Koble fakturering til prosjektdetaljen `[M / høy]`
**Mål 4 finnes ikke på prosjektdetaljsiden.** Ingen «hva kan faktureres her»-tall, ingen lenke til fakturering. `invoiced_value` finnes per prosjekt i API-et men brukes ikke på detaljsiden.
- **Løsning (minimum):** Femte KPI-kort «Klart til fakturering» = `totalApprovedValue + approvedEMValue − invoiced_value`, med lenke til `/subcontractor/invoice-basis?project=<id>`. **Helst:** en «Fakturering»-fane som gjenbruker UE-fakturasiden forhåndsfiltrert.
- **Admin-ref:** Admin har «Fakturagrunnlag» som fane PÅ prosjektdetaljen.

### 4.7 Fakturagrunnlag linje-for-linje med fakturert-status `[L / høy]`
«Gjenstår å fakturere» er ren aritmetikk (`page.tsx:152-154`), ikke en avstemming. Å registrere en faktura merker INGEN linjer som fakturert: `billed_at` settes aldri, og UE-grunnlaget ekskluderer aldri fakturerte linjer (`invoice-basis.ts:313`). «Godkjente linjer»-tabellen viser derfor ALLTID alt godkjent, også det som alt er fakturert.
- **Løsning:** Minste versjon — per-linje «Fakturert»/«Ikke fakturert»-pill. Full versjon — avkrysning + «Fakturer valgte» som setter `weekly_report_lines.billed_at` og kobler EM til `ue_invoices`. **Merk:** `ue_invoices` har ingen linje-kobling i dag, så full versjon krever ny koblingsstruktur (migrasjon).

---

## Mål-overgripende: Tilbud/anbud (tenders)

### T.1 Blokker tom innsending — krev minst én pris før «Send inn tilbud» `[S / høy]`
UE kan sende inn et tilbud uten å fylle ut én eneste pris; server tolker tomme felter som 0 og lagrer `total_cost=0` + `bid_submitted` uten advarsel. Hos admin fremstår 0-budet som **det laveste** og kan bli tildelt feilaktig. Reell forretningsrisiko.
- **Løsning:** Klient — ErrorBox hvis 0 utfylte linjer; gråne ut knappen når `total===0`. Server — 400 hvis `submit && total===0`. Kladd med 0 fortsatt lov.
- **Filer:** `tenders/[id]/page.tsx`, `app/api/subcontractor/tenders/[id]/route.ts`

### T.2 Bekreftelsessteg med totalsum før forpliktende innsending `[S / middels]`
«Send inn tilbud» sender ved ett klikk uten oppsummering. Et anbud er bindende. `useConfirm()` er etablert mønster ellers.
- **Løsning:** `await confirm({...})` med totalsum før fetch; gjelder kun `submit=true`.

### T.3 Sorter/grupper tilbudslista: «trenger svar» / innsendt / utløpt `[M / høy]`
API returnerer anbud uordnet, lista rendrer rått. Ingen arbeidskø øverst.
- **Løsning:** Server `.order('deadline_at')`; klient tre seksjoner, nærmeste frist først.

### T.4 Frist-nærhet + omfang (antall linjer) på listekortene `[M / middels]`
Kortet viser kun absolutt frist, ingen «om N dager» og ingen omfangsindikasjon. Legg relativ frist-badge + `line_count` i API-et.

### T.5 «Fyll fra forrige»/kopier enhetspris for lange anbud `[M / lav]`
Prising linje-for-linje uten repetisjonshjelp. «Kopier ned» til påfølgende tomme linjer.

---

## Struktur & UX på tvers

### S.1 Faner på prosjekt-detaljsiden `[L / høy]`
Detaljsiden er én 1151-linjers vertikal scroll uten faner. Handlingen UE oftest gjør (send EM) ligger nederst. Admin er fane-basert.
- **Løsning:** Faner med handling først: Oversikt / Budsjett / Rapportering / Endringsmeldinger / Fakturering. Seksjonene er alt diskrete `Card`-blokker og tunge deler lazy-lastes alt.

### S.2 «Hva venter på meg»-oppsummeringslinje øverst på dashbordet `[S / middels]`
Admin har en statuslinje under H1; UE har bare «Hei, {fornavn}» + dato.
- **Løsning:** Oppgave-linje basert på `revisionChangeOrders.length`. Hold «til behandling»-boksene utenfor — de venter på admin, ikke UE.

### S.3 Badges/tellere i UE-sidebaren `[M / middels]`
`SubcontractorNav` har ingen tellere. Admin-sidebaren har ferdig badge+poll-mekanikk (`AdminSidebarNav.tsx:130-133,181-185`) som kan kopieres nesten 1:1.

### S.4 Gjør dashbordet til server-komponent (RSC) `[L / middels]`
UE-dashbordet er `'use client'` med full-skjerm «Laster…»-blank. Admin er ren RSC.
- **Løsning:** Konverter til RSC (gjenbruk `resolveEffectiveSub`), trekk picker-knappene ut som klient-øyer. Behold subId fra sesjon. Minimum: erstatt «Laster…» med skjelett.

### S.5 Egen per-prosjekt-rute i stedet for å laste alle prosjekter `[M / middels]`
`loadProject` henter HELE porteføljen og `.find()`-er ett. Samme tunge endepunkt brukes også av invoice-basis bare for en dropdown.
- **Løsning:** `GET /api/subcontractor/projects/[id]` scopet på ett id, verifisert via `project_subcontractors`.

### S.6 Fjern dobbel dashboard-fetch på mobil `[M / lav]`
`MobileQuickActions` henter HELE dashboard-payloaden på nytt bare for prosjektlista til pickeren — to fulle dashboard-spørringer per mobilvisning. Begge sender også en `?subcontractor_id`-param som API-et ignorerer.

### S.7 Entydige etiketter — «Ordreverdi» betyr to ting `[S / middels]`
KPI-kortet «Ordreverdi» er UE-ens **kostbudsjett**, mens samme ord hos admin betyr **salgsverdi mot kunde**. «Gjenstående» har også to betydninger (budsjett-mengde vs «gjenstår å fakturere»).
- **Løsning:** «Mitt budsjett»/«Avtalt verdi» på kortet; merk gjenstående-kortene «Gjenstår budsjett» vs «Gjenstår å fakturere».

### S.8 Vis UE-ens egen avtalte enhetspris som kolonne `[S / lav]`
`subcontractor_cost_price_snapshot` brukes til kroneverdier men vises aldri som tall, så UE kan ikke verifisere at avtalt pris stemmer. Trygt — det er UE-ens egen pris.

---

## Allerede bra — ingen endring nødvendig

- **Rollebeskyttelse av UE-sidene er på plass.** `app/subcontractor/layout.tsx:16-25` redirecter ikke-sub-roller bort FØR siden lastes. Ingen ny vakt trengs.
- **Revisjonsboksen drukner IKKE blant venter-på-admin-boksene.** Den har alt distinkt oransje kort/header/badge + inline admin-kommentar (`page.tsx:250-301`). Eneste gjenstående er en kosmetisk «Krever din handling»-overskrift.
- **UE-pris-isolasjonen holder.** Kundepris strippes konsekvent i alle UE-lese-API-er. Ingen av forslagene over bryter dette.
- **Forkastet:** «åpne EM-modal in-place» — ville fortsatt kreve nytt per-prosjekt-fetch (budsjettlinjer ligger ikke i dashboard-payloaden), så det flytter et lastetrinn snarere enn å fjerne det. Dagens `?action=new-em`-flyt er god nok.

---

## Anbefalt rekkefølge

### Runde 1 — Quick wins (S, høy impact) + de to bug-fiksene først
1. **1.1 Fiks `change_orders`-SELECT** (bug — revisjonsboksen er ødelagt i dag).
2. **4.1 Fiks dato-filterets «Gjenstår»-feilberegning** (bug — viser feil tall).
3. **3.1 Vis alle 5 KPI-ene på dashbordet** (Mål 3-kjernen mangler på landingssiden).
4. **2.1 Picker-snarvei lander utfyllingsklar** (fjerner scroll/klikk i daglig flyt).
5. **3.2 «Gjenstår»-KPI i kroner på prosjektsiden.**
6. **3.3 «Gjenstående»-kolonne i «Mine produktlinjer».**
7. **4.4 «Fyll inn gjenstående»-snarvei + 4.2 rød feilbanner + 4.3 krev prosjekt** (faktura-trioen).
8. **T.1 Blokker tomt 0-bud** (forretningsrisiko, lite arbeid).

### Runde 2 — Små/middels med god effekt
9. **2.4 Suksess-kvittering + 2.5 forklar grå knapp.**
10. **3.8 Lenk dashbord-KPI til oversiktssidene + 1.3 «Send EM» på samlesiden + 1.4/1.5 revisjon-kontekst.**
11. **3.5/3.6 fremdrift/frist/gjenstår-kolonner + 3.10 statuschips** på prosjektlisten.
12. **S.2 «Hva venter på meg» + S.7 entydige etiketter.**
13. **T.2 bekreftelsessteg** for tilbud.

### Runde 3 — Middels strukturgrep
14. **2.2 «Kopier forrige uke» + 2.3 vis tabell direkte.**
15. **3.4 stablet fremdriftsbar + 3.7 saks-pills på prosjektlisten.**
16. **1.7 «Sendt kunde»-status + 1.8 trygg vedleggsopplasting.**
17. **4.6 fakturering på prosjektdetaljen + S.3 sidebar-badges.**
18. **T.3/T.4 sortert tilbudsliste + frist/omfang.**

### Runde 4 — Store grep (når fundamentet over er på plass)
19. **S.1 faner på prosjekt-detaljsiden.**
20. **2.6 egen ukesrapport-landingsside + 1.6 EM-detaljside (lese-modus).**
21. **4.7 fakturagrunnlag linje-for-linje** (krever datamodell-utvidelse).
22. **S.4 RSC-dashbord + S.5 per-prosjekt-rute + S.6 mobil dobbel-fetch** (ytelse/arkitektur).

**Rød tråd:** start med de to bug-fiksene og KPI-rendringen — de gjør at Mål 3 faktisk vises og at det eneste oppgavesignalet (revisjon) virker. Deretter ukesrapport-flyten, som er den UE rører oftest. De store fane-/landingsside-grepene gir mest når de mindre rendrings- og lenke-fiksene allerede har tettet datagapet.

# Test-/staging-miljø — eksperimentér uten å påvirke prod

Mål: kunne prøve ut nye modeller, skjemaendringer og UI **uten** å røre den
ekte databasen eller det kundene ser. Vi skiller to miljøer:

| Miljø | Kode | Database | URL |
|-------|------|----------|-----|
| **Produksjon** | `master`-grenen | prod-Supabase (`uvvxezkqwznisgywpojs`) | hoved-URL-en |
| **Staging/test** | en hvilken som helst gren | eget staging-Supabase-prosjekt | Vercel preview-URL per gren |

Gylden regel: **eksperimenter går aldri på `master` eller mot prod-databasen.**
Lag en gren → test på preview (staging-data) → merge til `master` først når du
er fornøyd.

---

## Engangsoppsett

### 1. Opprett staging-databasen (gratis)
1. Gå til supabase.com → **New project** i samme organisasjon.
2. Navn: `minue-staging`. Region: **samme som prod** (Europe). Velg et
   DB-passord og ta vare på det.
3. Free-tier holder fint til test.

> Si fra med prosjekt-ref-en (står i URL-en: `app.supabase.com/project/<ref>`),
> så kjører jeg punkt 2 og 3 under for deg via verktøyene mine.

### 2. Legg inn skjemaet (alle migrasjoner)
Staging skal ha **samme tabeller** som prod. Kjør migrasjonene `0000`–`0013`
fra `supabase/migrations/` mot staging:

- **Enklest:** Supabase CLI
  ```
  supabase link --project-ref <staging-ref>
  supabase db push          # kjører alle migrasjoner i supabase/migrations/
  ```
- **Eller:** jeg kjører dem via Supabase-verktøyet når du gir meg staging-ref-en.

### 3. Fyll med FALSKE data
Aldri kopier ekte kundedata til staging. Bruk en seed med oppdiktede
prosjekter/UE-er/EM-er (`supabase/seed.sql` — jeg lager den på forespørsel, og
kjører den mot staging).

### 4. Pek preview-miljøet mot staging i Vercel
Vercel-prosjekt → **Settings → Environment Variables**. Sett disse for scope
**Preview** (og gjerne **Development**), uten å røre **Production**:

| Variabel | Preview-verdi |
|----------|---------------|
| `SUPABASE_URL` | staging-prosjektets URL |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role-nøkkel (Settings → API) |
| `SUPER_ADMIN_EMAIL` | din e-post (så «vis som» virker) |
| `RESEND_API_KEY` / `EMAIL_FROM` | **la stå tomme** → staging sender ingen ekte e-post (logges kun) |

Production-scope beholder prod-verdiene. Da treffer hver preview-deploy
staging-databasen automatisk.

### 5. Lokalt
Lag `.env.local` i `entrepenor-rapport/` som peker på staging (eller en lokal
`supabase start`):
```
SUPABASE_URL=<staging-url>
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
SUPER_ADMIN_EMAIL=<din-epost>
```
Kjør `npm run dev` for rask iterasjon mot test-data.

---

## Daglig arbeidsflyt

```
git checkout -b eksperiment/ny-modell      # 1. egen gren
# ... gjør endringer, test lokalt (npm run dev) ...
git push -u origin eksperiment/ny-modell   # 2. Vercel bygger en preview-URL
# 3. test på preview-URL-en — egne (staging-)data, null prod-påvirkning
# 4. fornøyd? slå sammen til master:
git checkout master && git merge eksperiment/ny-modell && git push   # → prod
```

### Skjemaendringer (nye tabeller/kolonner)
1. Skriv en ny migrasjonsfil i `supabase/migrations/` (neste nummer).
2. Kjør den mot **staging/lokalt** og test.
3. Først når den er verifisert: kjør samme migrasjon mot **prod** (ved merge til
   master, eller manuelt).

Aldri kjør eksperiment-SQL eller -migrasjoner rett mot prod.

### Halvferdige funksjoner (f.eks. Test/lab-området)
La dem leve i kodebasen, men gate dem så de bare vises utenfor prod:
```ts
// f.eks. i menyen / siden
const showLab = process.env.NODE_ENV !== 'production'
// eller en egen flagg-variabel: process.env.ENABLE_LAB === '1'
```
Da kan du bygge videre på `/admin/test` i staging uten at det dukker opp i prod.

---

## Hvorfor dette er trygt
- Prod-databasen røres aldri av eksperimenter — staging har sin egen.
- Preview-URL-er er separate fra hoved-URL-en kundene bruker.
- Staging sender ingen ekte e-post (Resend ikke satt).
- Alt merges til `master` bevisst, ikke ved et uhell.

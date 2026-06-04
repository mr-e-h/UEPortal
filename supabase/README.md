# Supabase — schema, migrations & backup runbook

**Phase 0 / "Sikre fundamentet".** This folder exists so the database
**structure lives in the repo**, not only inside the live Supabase project.

- **Project ref:** `uvvxezkqwznisgywpojs`
- **Region:** AWS **eu-west-1 (Ireland)** — inside the EEA (confirm in
  Dashboard → Project Settings → General → Region).
- **Access model:** server-only `service_role` key; **RLS is ENABLED on every
  table with zero policies** (default-deny backstop). Authorization is enforced
  in the app layer (`lib/api-guard.ts`), not by RLS policies. See
  `lib/supabase.ts` for the full security note.

---

## Folder layout

```
supabase/
  migrations/
    0000_baseline_schema.sql   ← full current schema (schema-only). PLACEHOLDER until generated.
    0001_*.sql                 ← every future schema change, in order
  README.md                    ← this file
  .gitignore                   ← blocks data dumps / secrets from being committed
```

---

## 1. How the baseline dump is made

> **Status:** `0000_baseline_schema.sql` is currently an **empty placeholder.**
> It must be filled with a schema-only dump before it is authoritative.
> The automated attempt during Phase 0 was intentionally **stopped** because
> none of the required tooling/credentials were available (no Supabase CLI, no
> `pg_dump`/`psql`, no DB password in `.env.local`, no Supabase MCP). No fake
> schema was written, to avoid a misleading "authoritative" file.

Pick **one** method. **All are read-only** against the database — they read the
schema and never modify it.

### A) Supabase CLI — recommended
```bash
npx supabase login                                   # opens browser, one-time
npx supabase link --project-ref uvvxezkqwznisgywpojs
npx supabase db dump --schema public -f supabase/migrations/0000_baseline_schema.sql
```
`supabase db dump` connects read-only and emits `CREATE TABLE` / constraints /
RLS flags. It does **not** include row data unless you add `--data-only`
(don't — see §3).

### B) pg_dump — if you have the DB password
Get the password from **Dashboard → Settings → Database → Connection string**.
```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.uvvxezkqwznisgywpojs.supabase.co:5432/postgres" \
  --schema-only --no-owner --no-privileges \
  -f supabase/migrations/0000_baseline_schema.sql
```
`--schema-only` guarantees no data is exported.

### C) Supabase MCP — when reconnected
Introspect the `public` schema and write the DDL into the baseline file.

**After generating, always verify before committing:**
```bash
grep -ciE "^\s*(insert|copy)\b" supabase/migrations/0000_baseline_schema.sql
# must print 0 — no data statements
```

---

## 2. How future migrations are handled

From the baseline onward, **the database is changed only through checked-in
migration files** — never by editing tables directly in the Dashboard or via
ad-hoc MCP calls.

1. Create the next file, zero-padded + descriptive:
   `supabase/migrations/0001_add_companies_table.sql`
2. Write forward-only DDL (`CREATE TABLE`, `ALTER TABLE ADD COLUMN`, …).
   - Any new table **must** include `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;`
     to inherit the default-deny backstop (see `lib/supabase.ts`).
3. Review it in a PR **before** applying it to production.
4. Apply with the CLI:
   ```bash
   npx supabase db push        # applies pending migrations to the linked project
   ```
5. Keep `types/index.ts` in sync with the schema change in the same PR.

Rule of thumb: **schema change and the migration file land together.** If it
isn't in `supabase/migrations/`, it didn't happen.

---

## 3. What must NOT be checked in

`supabase/.gitignore` enforces this, but the rule matters:

- ❌ **No production data.** `users` holds bcrypt password hashes + emails;
  business tables hold customer prices / margins. Never `--data-only` into git.
- ❌ No `seed_snapshot.sql`, `*_data.sql`, `*.dump`, `*.backup`, `*.csv`.
- ❌ No DB password, `service_role` key, or `.env*` files.
- ✅ Only **schema** (DDL) and, later, optional **non-sensitive** seed data
  (e.g. a list of Norwegian counties or default time-types) if ever needed —
  and even then, reviewed by hand.

---

## 4. Backup strategy (three layers)

| Layer | Covers | How | Cadence |
|-------|--------|-----|---------|
| **1. Schema in git** | structure | this folder (`0000_baseline` + migrations) | every schema change |
| **2. Supabase managed backups** | data | Dashboard → Database → Backups; confirm daily backups / enable PITR | automatic |
| **3. Own encrypted export** | data + files, off-platform | `pg_dump` (full) + mirror Storage buckets `attachments` & `budget-files` to an encrypted EEA location you control | weekly (manual to start) |

- Layer 1 alone removes the critical "schema only exists live" risk.
- Layer 3 protects against losing the whole Supabase project/account — keep at
  least one copy **outside** the Supabase account.
- Storage has no one-click backup; a small script that lists + downloads both
  buckets is enough initially.

---

## Phase 0 scope reminder

This is **foundation work only**. Do **not**, as part of Phase 0:
- migrate live data or change its region,
- rewrite the ~104 files that call `getSupabaseAdmin()` directly,
- add RLS policies (that's a later hardening step),
- rebrand to "Min Portefølje",
- build new features.

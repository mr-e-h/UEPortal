import type { ProductionSnapshot, ProductionSnapshotLine } from '@/types'

/**
 * Diff-bibliotek for egenproduksjons-snapshots (migrasjon 0019).
 *
 * Strukturen speiler lib/phase-diff.ts: FieldChange på feltnivå, ItemChange
 * per linje, og en hoved-diffSnapshots-funksjon som returnerer en liste av
 * endringer. Linjer matches på project_budget_line_id (stabil nøkkel).
 *
 * INGEN kundeverdi/kr eksponeres — snapshot-formatet (ProductionSnapshot)
 * inneholder kun rå celler: egenprod-mengde, resolution, handled.
 */

/** Én felt-endring på én budsjettlinje. */
export interface FieldChange {
  /** project_budget_line_id for den endrede linjen. */
  lineId: string
  /** Valgfritt visningsnavn for linjen (product_id / label fra kaller). */
  productLabel?: string
  /** Feltnavn (norsk, lesbart for endringslogg-UI). */
  field: string
  /** Verdi før endring (streng for visning). */
  from: string
  /** Verdi etter endring (streng for visning). */
  to: string
}

// ─── Hjelpere ─────────────────────────────────────────────────────────────────

function fmtQty(v: number | null | undefined): string {
  if (v == null) return '—'
  return String(v)
}

function fmtHandled(v: boolean): string {
  return v ? 'Ja' : 'Nei'
}

function diffLine(
  lineId: string,
  o: ProductionSnapshotLine,
  n: ProductionSnapshotLine,
): FieldChange[] {
  const out: FieldChange[] = []

  if ((o.executed_no_cost_quantity ?? null) !== (n.executed_no_cost_quantity ?? null)) {
    out.push({
      lineId,
      field: 'Egenprod-mengde',
      from: fmtQty(o.executed_no_cost_quantity),
      to: fmtQty(n.executed_no_cost_quantity),
    })
  }

  if ((o.resolution ?? '') !== (n.resolution ?? '')) {
    out.push({
      lineId,
      field: 'Kommentar',
      from: o.resolution || '—',
      to: n.resolution || '—',
    })
  }

  if (o.handled !== n.handled) {
    out.push({
      lineId,
      field: 'Behandlet',
      from: fmtHandled(o.handled),
      to: fmtHandled(n.handled),
    })
  }

  return out
}

// ─── Offentlig API ────────────────────────────────────────────────────────────

/**
 * Sammenlign to egenproduksjons-snapshots og returner alle felt-endringer.
 *
 * Linjer matches på project_budget_line_id. Linjer som kun finnes i `prev`
 * eller `next` genererer ingen endringer (batch-upsert sletter 0-mengde-rader,
 * så «borte» er en naturlig tilstand, ikke en sporet endring her).
 *
 * Kaller kan berike resultatet med `productLabel` ved å sende inn en resolver:
 *
 *   const changes = diffSnapshots(prev, next)
 *   changes.forEach(c => { c.productLabel = productMap.get(c.lineId) })
 *
 * @param prev  Siste lagrede versjon (null/undefined = ingen historikk → tom diff).
 * @param next  Ny tilstand som nettopp ble skrevet.
 * @returns     Liste av FieldChange, én per endret felt × linje. Tom = ingen endring.
 */
export function diffSnapshots(
  prev: ProductionSnapshot | null | undefined,
  next: ProductionSnapshot | null | undefined,
): FieldChange[] {
  const prevLines = prev?.lines ?? []
  const nextLines = next?.lines ?? []

  const prevMap = new Map<string, ProductionSnapshotLine>(
    prevLines.map((l) => [l.project_budget_line_id, l]),
  )

  const changes: FieldChange[] = []

  for (const nl of nextLines) {
    const pl = prevMap.get(nl.project_budget_line_id)
    if (!pl) continue // linje kun i ny versjon — ingen «fra»-verdi å diffe
    const lineChanges = diffLine(nl.project_budget_line_id, pl, nl)
    changes.push(...lineChanges)
  }

  return changes
}

/**
 * Sjekk om to snapshots er identiske (brukes av batch-ruten for å hoppe over
 * insert i project_production_versions når ingenting er endret).
 *
 * Normalisering: sorterer linjene på project_budget_line_id før sammenligning
 * slik at rekkefølge i body ikke gir falsk «endring» — samme norm som
 * 0013/phase-diff-mønsteret.
 */
export function snapshotsAreEqual(
  a: ProductionSnapshot | null | undefined,
  b: ProductionSnapshot | null | undefined,
): boolean {
  const aLines = [...(a?.lines ?? [])].sort((x, y) =>
    x.project_budget_line_id.localeCompare(y.project_budget_line_id),
  )
  const bLines = [...(b?.lines ?? [])].sort((x, y) =>
    x.project_budget_line_id.localeCompare(y.project_budget_line_id),
  )
  if (aLines.length !== bLines.length) return false
  for (let i = 0; i < aLines.length; i++) {
    const al = aLines[i]
    const bl = bLines[i]
    if (
      al.project_budget_line_id !== bl.project_budget_line_id
      || (al.executed_no_cost_quantity ?? null) !== (bl.executed_no_cost_quantity ?? null)
      || (al.resolution ?? '') !== (bl.resolution ?? '')
      || al.handled !== bl.handled
    ) return false
  }
  return true
}

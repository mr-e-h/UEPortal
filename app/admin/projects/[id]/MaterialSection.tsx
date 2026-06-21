'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Plus, Trash2, X } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ErrorBox from '@/components/ui/ErrorBox'
import NumberInput from '@/components/NumberInput'
import { useConfirm } from '@/components/ui/useConfirm'
import { fmtNOK as fmt } from '@/lib/format'
import type { ProjectMaterial, ProjectMaterialVersion } from '@/types'

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  materials: ProjectMaterial[]
  materialVersions: ProjectMaterialVersion[]
  onImported: () => void
  saveMaterialReconciliation: (
    rows: { id: string; actual_quantity: number | null; reconciled: boolean; comment: string }[],
  ) => Promise<{ ok: boolean; error?: string }>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }),
  }
}

// ── Draft types ───────────────────────────────────────────────────────────────

type DraftRow = {
  actual: string      // raw string input ("" = not yet set)
  reconciled: boolean
  comment: string
}

function seedDraft(materials: ProjectMaterial[]): Record<string, DraftRow> {
  const map: Record<string, DraftRow> = {}
  for (const m of materials) {
    map[m.id] = {
      actual: m.actual_quantity === null ? '' : String(m.actual_quantity),
      reconciled: m.reconciled,
      comment: m.comment ?? '',
    }
  }
  return map
}

// ── UploadZone sub-component ─────────────────────────────────────────────────

function UploadZone({
  projectId,
  onImported,
}: {
  projectId?: string
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Array<{ row: number; code: string; name: string; reason: string }>>([])
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      if (!projectId) return
      setUploading(true)
      setSuccessMsg(null)
      setSkipped([])
      setUploadError(null)

      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch(`/api/projects/${projectId}/materials/import`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))

      if (!res.ok) {
        setUploadError((data as { error?: string }).error ?? 'Import feilet')
        setUploading(false)
        return
      }

      const typed = data as { imported: number; skipped: typeof skipped; version: number }
      setSuccessMsg(`${typed.imported} materiell-linjer importert (versjon ${typed.version})`)
      setSkipped(typed.skipped ?? [])
      setUploading(false)
      onImported()
    },
    [projectId, onImported],
  )

  return (
    <div
      onClick={() => !uploading && fileRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) handleFile(file)
      }}
      className={`rounded-xl p-6 flex flex-col items-center justify-center text-center gap-4 cursor-pointer transition-colors border-2 border-dashed select-none ${
        dragging
          ? 'bg-blue-100 border-blue-500'
          : uploading
          ? 'bg-blue-50 border-blue-200 cursor-default'
          : 'bg-blue-50 border-blue-300 hover:bg-blue-100 hover:border-blue-400'
      }`}
    >
      <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${dragging ? 'bg-blue-200' : 'bg-blue-100'}`}>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-7 h-7 transition-colors ${dragging ? 'text-blue-700' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0L8 8m4-4l4 4" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-blue-900 text-base">
          {uploading ? 'Importerer...' : dragging ? 'Slipp filen her' : 'Last inn oppdatert materielliste'}
        </p>
        <p className="text-sm text-blue-700 mt-1 max-w-xs">
          {uploading ? 'Behandler Excel-filen…' : 'Dra og slipp en .xlsx-fil hit, eller klikk for å velge'}
        </p>
      </div>
      {!uploading && (
        <span className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm pointer-events-none">
          Velg fil
        </span>
      )}

      {successMsg && (
        <p className="text-xs font-medium text-green-600">{successMsg}</p>
      )}
      {uploadError && (
        <p className="text-xs font-medium text-red-600">{uploadError}</p>
      )}

      {skipped.length > 0 && (
        <div className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-left" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-medium text-amber-800">
            {skipped.length} {skipped.length === 1 ? 'rad hoppet over' : 'rader hoppet over'}
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800 max-h-32 overflow-auto">
            {skipped.map((s, i) => (
              <li key={i}>Rad {s.row}: {s.name || s.code || '(uten navn)'} — {s.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ── VersionHistoryPanel — budsjett-stil: tabell til venstre, upload til høyre ──

function VersionHistoryPanel({
  projectId,
  versions,
  onImported,
}: {
  projectId?: string
  versions: ProjectMaterialVersion[]
  onImported: () => void
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {/* VENSTRE col-span-2: versjonstabell */}
      <div className="col-span-2 bg-white rounded-xl shadow border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
            Materiellversjonhistorikk
          </h3>
        </div>
        {versions.length === 0 ? (
          <div className="px-5 py-6 text-sm text-[var(--color-text-muted)] text-center">
            Ingen materielliste lastet opp ennå.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-left">Versjon</th>
                  <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-right">Antall linjer</th>
                  <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-right">Verdi</th>
                  <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-left">Lastet opp</th>
                  <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-center">Fil</th>
                </tr>
              </thead>
              <tbody>
                {/* versions from API come newest-first (order by version desc) */}
                {versions.map((ver, idx) => {
                  const isLatest = idx === 0
                  const label = ver.version === 0 ? 'Original' : `V${ver.version}`
                  const lineCount = ver.snapshot?.materials?.length ?? 0
                  // Materiellverdi for versjonen = Σ planlagt antall × pris (pris ligger
                  // skjult i snapshotet — vises kun som totalsum her, ikke per linje).
                  const value = (ver.snapshot?.materials ?? []).reduce(
                    (s, m) => s + (Number(m.planned_quantity) || 0) * (Number(m.unit_price) || 0), 0)
                  const { date, time } = fmtDateTime(ver.uploaded_at)
                  return (
                    <tr
                      key={ver.id}
                      className={`border-b border-border ${isLatest ? 'bg-blue-50' : 'hover:bg-muted'}`}
                    >
                      <td className="px-5 py-3">
                        <span className={`font-medium ${isLatest ? 'text-blue-700' : 'text-[var(--color-text-primary)]'}`}>
                          {label}
                        </span>
                        {isLatest && (
                          <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-medium">
                            Gjeldende
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">
                        {lineCount}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-[var(--color-text-primary)] tabular-nums">
                        {fmt(value)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-[var(--color-text-secondary)]">{ver.uploaded_by}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{date} {time}</div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        {ver.file_name && ver.file_name.includes('/') ? (
                          <a
                            href={`/api/projects/${projectId}/materials/versions/${ver.id}/file`}
                            download
                            title="Last ned Excel-fil"
                            className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-green-100 text-green-600 hover:text-green-700 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download size={14} />
                          </a>
                        ) : (
                          <span className="text-gray-300 text-xs">–</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HØYRE col-span-1: drag-drop opplastingskort */}
      <UploadZone projectId={projectId} onImported={onImported} />
    </div>
  )
}

// ── AddMaterialForm — manuell tilføying av én materiell-rad ───────────────────

/**
 * Legg til materiell uten Excel. POSTer én rad til project_materials (ingen
 * versjon — versjoner er kun for Excel-opplastinger) og kaller onAdded() for å
 * friske opp lista. Skjemaet blir stående åpent så flere rader kan legges inn
 * etter hverandre. Pris er valgfri og vises ikke i lista, men teller i økonomien.
 */
function AddMaterialForm({
  projectId,
  onAdded,
}: {
  projectId?: string
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({
    material_name: '', material_code: '', category: '', unit: '',
    planned_quantity: '', unit_price: '', supplier: '',
  })
  const upd = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))
  const reset = () => {
    setF({ material_name: '', material_code: '', category: '', unit: '', planned_quantity: '', unit_price: '', supplier: '' })
    setError(null)
  }

  async function submit() {
    if (!projectId) return
    const name = f.material_name.trim()
    if (!name) { setError('Materiellnavn er påkrevd'); return }
    const qty = Number(f.planned_quantity.replace(',', '.'))
    if (!Number.isFinite(qty) || qty < 0) { setError('Planlagt mengde må være et tall ≥ 0'); return }
    const price = f.unit_price.trim() === '' ? 0 : Number(f.unit_price.replace(',', '.'))
    if (!Number.isFinite(price) || price < 0) { setError('Pris må være et tall ≥ 0'); return }

    setError(null)
    setSaving(true)
    const res = await fetch(`/api/projects/${projectId}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        material_name: name,
        material_code: f.material_code.trim(),
        category: f.category.trim(),
        unit: f.unit.trim(),
        planned_quantity: qty,
        unit_price: price,
        supplier: f.supplier.trim(),
      }),
    })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    setSaving(false)
    if (!res.ok) { setError((data as { error?: string }).error ?? 'Lagring feilet'); return }
    reset()
    onAdded()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!projectId}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-40"
      >
        <Plus size={15} /> Legg til materiell manuelt
      </button>
    )
  }

  const inputCls = 'px-2.5 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary'

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Legg til materiell manuelt</h3>
        <button type="button" onClick={() => { setOpen(false); reset() }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" aria-label="Lukk skjema"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)] col-span-2">
          Materiell *
          <input value={f.material_name} onChange={(e) => upd({ material_name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} placeholder="f.eks. Fiberkabel 24F" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Kode
          <input value={f.material_code} onChange={(e) => upd({ material_code: e.target.value })} placeholder="(valgfri)" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Kategori
          <input value={f.category} onChange={(e) => upd({ category: e.target.value })} placeholder="(valgfri)" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Planlagt mengde *
          <input value={f.planned_quantity} onChange={(e) => upd({ planned_quantity: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} inputMode="decimal" placeholder="0" className={`${inputCls} text-right tabular-nums`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Enhet
          <input value={f.unit} onChange={(e) => upd({ unit: e.target.value })} placeholder="stk, m, …" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Pris (kr/enhet)
          <input value={f.unit_price} onChange={(e) => upd({ unit_price: e.target.value })} inputMode="decimal" placeholder="0" className={`${inputCls} text-right tabular-nums`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Leverandør
          <input value={f.supplier} onChange={(e) => upd({ supplier: e.target.value })} placeholder="(valgfri)" className={inputCls} />
        </label>
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="primary" disabled={saving} onClick={submit}>
          {saving ? 'Lagrer…' : 'Legg til'}
        </Button>
        <button type="button" onClick={() => { setOpen(false); reset() }} className="text-sm text-[var(--color-text-secondary)] hover:underline">
          Lukk
        </button>
        <span className="text-[11px] text-[var(--color-text-muted)]">Pris vises ikke i lista, men teller i prosjektøkonomien (Materiellkost).</span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * «Materiell»-fanen.
 *
 * Datakilde: ProjectMaterial[] (eget mengde-budsjett, ikke budsjettlinjer).
 * Ingen kr/salgsverdi vises — kun mengder og differanser.
 *
 * Tre deler:
 *   (a) Versjonhistorikk-grid: VENSTRE = versjons-tabell med nedlasting,
 *       HØYRE = drag-drop opplastingskort (budsjett-stil)
 *   (b) Regneark: Kategori · Kode · Materiell · Enhet · Planlagt · Faktisk · Diff · Kommentar · Avstemt
 */
export default function MaterialSection({
  projectId,
  materials,
  materialVersions,
  onImported,
  saveMaterialReconciliation,
}: Props) {
  // ── Draft state ───────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Record<string, DraftRow>>(() => seedDraft(materials))

  // Re-seed when server data changes (after import / fetchAll)
  useEffect(() => {
    setDraft(seedDraft(materials))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials])

  function setField<K extends keyof DraftRow>(id: string, key: K, value: DraftRow[K]) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
  }

  // ── Dirty check ───────────────────────────────────────────────────────────
  const dirty = useMemo(() => {
    return materials.some((m) => {
      const d = draft[m.id]
      if (!d) return false
      const dActual = d.actual === '' ? null : (Number(d.actual.replace(',', '.')) || 0)
      if (dActual !== m.actual_quantity) return true
      if (d.reconciled !== m.reconciled) return true
      if (d.comment !== (m.comment ?? '')) return true
      return false
    })
  }, [materials, draft])

  // ── Save ──────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  async function handleSave() {
    setSaveError(null)
    setSaving(true)
    const rows = materials.map((m) => {
      const d = draft[m.id] ?? { actual: '', reconciled: false, comment: '' }
      const actual = d.actual === '' ? null : (Number(d.actual.replace(',', '.')) || 0)
      return {
        id: m.id,
        actual_quantity: actual,
        reconciled: d.reconciled,
        comment: d.comment,
      }
    })
    const res = await saveMaterialReconciliation(rows)
    setSaving(false)
    if (!res.ok) setSaveError(res.error ?? 'Lagring feilet')
  }

  function handleDiscard() {
    setDraft(seedDraft(materials))
    setSaveError(null)
  }

  // ── Slett én materiell-rad (manuelt lagt eller feilført) ───────────────────
  async function handleDelete(m: ProjectMaterial) {
    if (!projectId) return
    const ok = await confirm({
      title: 'Slette materiell?',
      message: `«${m.material_name || m.material_code || 'Uten navn'}» fjernes fra materielliste og kan ikke angres.`,
      confirmLabel: 'Slett',
    })
    if (!ok) return
    setSaveError(null)
    setDeletingId(m.id)
    const res = await fetch(`/api/projects/${projectId}/materials?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) {
      onImported()
    } else {
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      setSaveError((data as { error?: string }).error ?? 'Sletting feilet')
    }
  }

  // ── Group by category for display ─────────────────────────────────────────
  const categories = useMemo(() => {
    const seen = new Map<string, ProjectMaterial[]>()
    for (const m of materials) {
      const cat = m.category || 'Ukategorisert'
      if (!seen.has(cat)) seen.set(cat, [])
      seen.get(cat)!.push(m)
    }
    return seen
  }, [materials])

  // Unresolved count — badge
  const unreconciledCount = useMemo(() => {
    return materials.filter((m) => {
      const d = draft[m.id]
      if (!d) return false
      if (d.reconciled) return false
      if (d.actual === '') return false
      const actual = Number(d.actual.replace(',', '.')) || 0
      return Math.abs(actual - m.planned_quantity) > 1e-9
    }).length
  }, [materials, draft])

  // ── Empty state — show version panel (upload card) + empty message ─────────
  if (materials.length === 0) {
    return (
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Materiell</h2>
        <VersionHistoryPanel
          projectId={projectId}
          versions={materialVersions}
          onImported={onImported}
        />
        <AddMaterialForm projectId={projectId} onAdded={onImported} />
      </section>
    )
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Materiell</h2>
        {unreconciledCount > 0 && (
          <span className="text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
            {unreconciledCount} avvik ikke avstemt
          </span>
        )}
      </div>

      {/* Versjonhistorikk — budsjett-stil grid */}
      <VersionHistoryPanel
        projectId={projectId}
        versions={materialVersions}
        onImported={onImported}
      />

      {/* Legg til materiell manuelt */}
      <AddMaterialForm projectId={projectId} onAdded={onImported} />

      {/* Dirty warning */}
      {dirty && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          Du har ulagrede endringer
        </p>
      )}

      {saveError && <ErrorBox>{saveError}</ErrorBox>}

      {/* Spreadsheet grid
          Kolonner: Kategori · Kode · Materiell · Enhet · Planlagt · Faktisk · Differanse · Kommentar · Avstemt
          table-fixed + colgroup: ingen horisontal scroll.
      */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm table-fixed border-collapse border border-border [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
          <colgroup>
            {/* Kategori */}
            <col style={{ width: '10%' }} />
            {/* Kode */}
            <col style={{ width: '8%' }} />
            {/* Materiell */}
            <col style={{ width: '20%' }} />
            {/* Enhet */}
            <col style={{ width: '6%' }} />
            {/* Planlagt */}
            <col style={{ width: '9%' }} />
            {/* Faktisk (editable) */}
            <col style={{ width: '9%' }} />
            {/* Differanse */}
            <col style={{ width: '9%' }} />
            {/* Kommentar */}
            <col style={{ width: '17%' }} />
            {/* Avstemt */}
            <col style={{ width: '6%' }} />
            {/* Handling (slett) */}
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Kategori
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Kode
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Materiell
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Enhet
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Planlagt
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide bg-blue-50/60">
                Faktisk
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Diff
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Kommentar
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Avstemt
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide" aria-label="Handling" />
            </tr>
          </thead>
          <tbody>
            {Array.from(categories.entries()).map(([cat, rows], catIdx) => (
              rows.map((m, rowIdx) => {
                const d = draft[m.id] ?? { actual: '', reconciled: false, comment: '' }
                const actualNum = d.actual === '' ? null : (Number(d.actual.replace(',', '.')) || 0)
                const diff = actualNum === null ? null : actualNum - m.planned_quantity
                const hasDiff = diff !== null && Math.abs(diff) > 1e-9
                const diffColor = !hasDiff
                  ? 'text-[var(--color-text-muted)]'
                  : diff > 0
                  ? 'text-orange-600 font-medium'
                  : 'text-red-600 font-medium'
                const isFirstInCat = rowIdx === 0

                return (
                  <tr
                    key={m.id}
                    className={`align-middle ${
                      d.reconciled
                        ? 'bg-green-50/40'
                        : catIdx % 2 === 0
                        ? 'even:bg-muted/30'
                        : ''
                    } hover:bg-blue-50/50`}
                  >
                    {/* Kategori — vis kun på første rad i gruppen */}
                    <td className="px-3 py-1.5">
                      {isFirstInCat ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                          {cat}
                        </span>
                      ) : null}
                    </td>

                    {/* Kode */}
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs text-[var(--color-text-muted)]">{m.material_code}</span>
                    </td>

                    {/* Materiell + leverandør som liten grå tekst */}
                    <td className="px-3 py-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="truncate text-xs text-[var(--color-text-primary)]">{m.material_name}</p>
                          {m.source === 'manual' && (
                            <span className="flex-none text-[9px] font-medium uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5" title="Lagt til manuelt — beholdes ved ny Excel-opplasting">
                              Manuell
                            </span>
                          )}
                        </div>
                        {m.supplier && (
                          <p className="truncate text-[10px] text-[var(--color-text-muted)]">{m.supplier}</p>
                        )}
                      </div>
                    </td>

                    {/* Enhet */}
                    <td className="px-3 py-1.5 text-center text-xs text-[var(--color-text-muted)]">
                      {m.unit}
                    </td>

                    {/* Planlagt */}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className="font-medium text-[var(--color-text-primary)]">{m.planned_quantity}</span>
                    </td>

                    {/* Faktisk — redigerbar input */}
                    <td className="p-0 bg-blue-50/40">
                      <NumberInput
                        value={d.actual}
                        onChange={(raw) => setField(m.id, 'actual', raw)}
                        placeholder={String(m.planned_quantity)}
                        tabIndex={catIdx * 1000 + rowIdx + 1}
                        className="w-full h-full px-2 py-1.5 text-sm text-right tabular-nums border-0 bg-transparent rounded-none focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary text-[var(--color-text-primary)]"
                        aria-label={`Faktisk mengde for ${m.material_name}`}
                      />
                    </td>

                    {/* Differanse (faktisk − planlagt) */}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className={diffColor}>
                        {diff === null
                          ? '–'
                          : hasDiff
                          ? `${diff > 0 ? '+' : ''}${diff}`
                          : '0'}
                      </span>
                    </td>

                    {/* Kommentar */}
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={d.comment}
                        onChange={(e) => setField(m.id, 'comment', e.target.value)}
                        placeholder="Kommentar…"
                        className="w-full px-1.5 py-1 text-xs border-0 bg-transparent rounded focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary text-[var(--color-text-primary)]"
                      />
                    </td>

                    {/* Avstemt checkbox */}
                    <td className="px-3 py-1.5 text-center">
                      <label className="inline-flex items-center justify-center cursor-pointer" title={d.reconciled ? 'Avstemt' : 'Ikke avstemt'}>
                        <input
                          type="checkbox"
                          checked={d.reconciled}
                          onChange={(e) => setField(m.id, 'reconciled', e.target.checked)}
                          className="rounded"
                        />
                      </label>
                    </td>

                    {/* Slett-rad */}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(m)}
                        disabled={deletingId === m.id}
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                        title="Slett materiell-linje"
                        aria-label={`Slett ${m.material_name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })
            ))}
          </tbody>
          {materials.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted">
                {/* Kategori */}
                <td className="px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)]">
                  Totalt
                </td>
                {/* Kode */}
                <td />
                {/* Materiell */}
                <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  {materials.length} linjer
                </td>
                {/* Enhet */}
                <td />
                {/* Planlagt sum */}
                <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold text-[var(--color-text-primary)]">
                  –
                </td>
                {/* Faktisk sum */}
                <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold text-[var(--color-text-primary)]">
                  –
                </td>
                {/* Diff */}
                <td />
                {/* Kommentar */}
                <td />
                {/* Avstemt */}
                <td className="px-3 py-2 text-center text-xs text-[var(--color-text-muted)]">
                  {materials.filter((m) => draft[m.id]?.reconciled).length}/{materials.length}
                </td>
                {/* Handling */}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

      {/* Save / discard */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="primary"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? 'Lagrer…' : 'Lagre'}
        </Button>
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={handleDiscard}
          className="text-sm text-[var(--color-text-secondary)] hover:underline disabled:opacity-40"
        >
          Forkast endringer
        </button>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        Fyll inn faktisk forbruk per materiell-linje og huk av «Avstemt» når linjen er kontrollert.
        Differansen er faktisk minus planlagt mengde.
      </p>

      {confirmDialog}
    </section>
  )
}

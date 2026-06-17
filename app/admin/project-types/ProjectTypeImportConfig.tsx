'use client'

import { useEffect, useState } from 'react'
import { Upload, FileSpreadsheet, Save, RotateCcw } from 'lucide-react'
import {
  parseRows, DEFAULT_IMPORT_MAP, IMPORT_FIELDS, FIELD_LABEL, type ImportField,
} from '@/lib/excel-map'
import type { ImportColumnMap } from '@/types'

const colLetter = (c: number): string => (c < 26 ? String.fromCharCode(65 + c) : `K${c + 1}`)
const inputCls = 'px-2 py-1 text-xs border border-border rounded bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary'

/**
 * Visuelt Excel-import-oppsett per prosjekttype. Last opp et eksempel-ark, huk
 * av hvilken kolonne som er kode/navn/pris/antall/fastpris, sett startrad — og
 * se direkte hvor mange produkter som leses vs. hoppes over (med årsak). Hvert
 * prosjekt av typen bruker oppsettet ved import, så ulike kunder kan ha ulike
 * arkformater uten kodeendring. parseRows er delt med server-importen.
 */
export default function ProjectTypeImportConfig({ typeId }: { typeId: string }) {
  const [map, setMap] = useState<ImportColumnMap>(DEFAULT_IMPORT_MAP)
  const [configured, setConfigured] = useState(false)
  const [grid, setGrid] = useState<string[][] | null>(null)
  const [colCount, setColCount] = useState(0)
  const [totalRows, setTotalRows] = useState(0)
  const [fileName, setFileName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/project-types/${typeId}/import-config`)
      .then((r) => (r.ok ? r.json() : { import_config: null }))
      .then((d: { import_config: ImportColumnMap | null }) => {
        if (d.import_config) { setMap(d.import_config); setConfigured(true) }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [typeId])

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setError('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/excel/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }))
        setError(d.error ?? 'Kunne ikke lese filen')
      } else {
        const d = await res.json() as { grid: string[][]; colCount: number; totalRows: number; fileName: string }
        setGrid(d.grid); setColCount(d.colCount); setTotalRows(d.totalRows); setFileName(d.fileName)
      }
    } catch {
      setError('Kunne ikke lese filen')
    }
    setUploading(false)
  }

  function assignColumn(colIdx: number, field: ImportField | '') {
    setMap((prev) => {
      const next = { ...prev }
      for (const f of IMPORT_FIELDS) if (next[f] === colIdx) next[f] = null
      if (field) next[field] = colIdx
      return next
    })
    setDirty(true); setSaved(false)
  }

  function setStartRow(v: number) {
    setMap((prev) => ({ ...prev, startRow: Math.max(1, Math.floor(v) || 1) }))
    setDirty(true); setSaved(false)
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/project-types/${typeId}/import-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ import_config: map }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }))
        setError(d.error ?? 'Lagring feilet')
      } else { setConfigured(true); setDirty(false); setSaved(true) }
    } catch { setError('Lagring feilet') }
    setSaving(false)
  }

  async function resetToDefault() {
    setSaving(true); setError('')
    try {
      await fetch(`/api/project-types/${typeId}/import-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ import_config: null }),
      })
      setMap(DEFAULT_IMPORT_MAP); setConfigured(false); setDirty(false); setSaved(true)
    } catch { setError('Lagring feilet') }
    setSaving(false)
  }

  if (!loaded) return null

  const preview = grid ? parseRows(grid, map) : null
  const fieldForCol = (c: number): ImportField | '' => IMPORT_FIELDS.find((f) => map[f] === c) ?? ''

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">Excel-import</h4>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {configured ? 'Eget kolonneoppsett' : 'Standardoppsett (kol B/C/F/G/H, rad 6)'}
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto text-xs font-medium text-primary hover:underline">
          {open ? 'Skjul' : 'Sett opp'}
        </button>
      </div>

      {open && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted cursor-pointer">
              <Upload size={13} /> Last opp eksempel-Excel
              <input type="file" accept=".xlsx" className="hidden" onChange={onUpload} />
            </label>
            {fileName && (
              <span className="text-[11px] text-[var(--color-text-muted)] inline-flex items-center gap-1">
                <FileSpreadsheet size={12} /> {fileName} · {totalRows} rader
              </span>
            )}
            <label className="text-xs text-[var(--color-text-muted)] inline-flex items-center gap-1.5">
              Produkter starter på rad
              <input type="number" min={1} value={map.startRow} onChange={(e) => setStartRow(Number(e.target.value))} className={`${inputCls} w-16 text-right`} />
            </label>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {uploading && <p className="text-xs text-[var(--color-text-muted)]">Leser fil…</p>}

          {grid && (
            <>
              {preview && (
                <div className="text-xs font-medium">
                  <span className="text-green-700">{preview.lines.length} produkter leses</span>
                  {preview.skipped.length > 0 && <span className="text-amber-700"> · {preview.skipped.length} hoppes over</span>}
                </div>
              )}

              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] font-medium border-r border-border sticky left-0 bg-muted">Rad</th>
                      {Array.from({ length: colCount }).map((_, c) => (
                        <th key={c} className="px-1.5 py-1 border-l border-border align-top" style={{ minWidth: 96 }}>
                          <div className="text-[10px] text-[var(--color-text-muted)] mb-0.5">{colLetter(c)}</div>
                          <select value={fieldForCol(c)} onChange={(e) => assignColumn(c, e.target.value as ImportField | '')} className={`${inputCls} w-full ${fieldForCol(c) ? 'border-primary text-primary' : ''}`}>
                            <option value="">Ignorer</option>
                            {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.slice(0, 12).map((row, ri) => {
                      const rowNum = ri + 1
                      const isData = rowNum >= map.startRow
                      return (
                        <tr key={ri} className={`border-t border-border ${isData ? '' : 'opacity-45'}`}>
                          <td className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] tabular-nums border-r border-border sticky left-0 bg-card">{rowNum}</td>
                          {Array.from({ length: colCount }).map((_, c) => (
                            <td key={c} className={`px-1.5 py-1 border-l border-border whitespace-nowrap max-w-[140px] truncate ${fieldForCol(c) ? 'bg-primary-soft/40 text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`} title={row[c]}>
                              {row[c]}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {preview && preview.skipped.length > 0 && (
                <div className="text-[11px] text-amber-700 space-y-0.5">
                  {preview.skipped.slice(0, 6).map((s) => (
                    <div key={s.row}>Rad {s.row}: {s.reason}{s.name ? ` — ${s.name}` : ''}</div>
                  ))}
                  {preview.skipped.length > 6 && <div className="text-[var(--color-text-muted)]">+{preview.skipped.length - 6} til …</div>}
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50">
              <Save size={13} /> {saving ? 'Lagrer…' : saved && !dirty ? 'Lagret ✓' : 'Lagre oppsett'}
            </button>
            {configured && (
              <button type="button" onClick={resetToDefault} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-50">
                <RotateCcw size={12} /> Bruk standard
              </button>
            )}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Tabellen viser de første radene; «leses / hoppes over» telles over hele arket du lastet opp.
          </p>
        </div>
      )}
    </div>
  )
}

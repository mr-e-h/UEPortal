'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ChangeOrder, Product, Subcontractor } from '@/types'
import SortableTable from '@/components/SortableTable'
import { fmtNOK as fmt } from '@/lib/format'
import { changeOrderStatus } from '@/lib/statuses'

type CORow = {
  id: string
  status: string
  sub_name: string
  product_code: string
  product_name: string
  quantity_str: string
  total_cost: number
  total_customer_value: number
  submitted_date: string
}

interface Props {
  changeOrders: ChangeOrder[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  onStatusChange: (id: string, status: 'approved' | 'rejected') => void
}

export default function ChangeOrdersSection({ changeOrders, allProducts, allSubs, onStatusChange }: Props) {
  const [coStatusFilter, setCoStatusFilter] = useState('all')
  const [coSubFilter, setCoSubFilter] = useState('all')

  const coSubIds = Array.from(new Set(changeOrders.map((co) => co.subcontractor_id)))
  const coSubOptions = allSubs.filter((s) => coSubIds.includes(s.id))

  const filteredCOs = changeOrders.filter((co) => {
    if (coStatusFilter !== 'all' && co.status !== coStatusFilter) return false
    if (coSubFilter !== 'all' && co.subcontractor_id !== coSubFilter) return false
    return true
  })

  const coRows: CORow[] = filteredCOs.map((co) => {
    const prod = allProducts.find((p) => p.id === co.product_id)
    const sub = allSubs.find((s) => s.id === co.subcontractor_id)
    return {
      id: co.id,
      status: co.status,
      sub_name: sub?.company_name ?? '–',
      product_code: prod?.description ?? '–',
      product_name: prod?.name ?? '–',
      quantity_str: `${co.requested_quantity} ${co.unit}`,
      total_cost: co.total_cost,
      total_customer_value: co.total_customer_value,
      submitted_date: co.submitted_at?.split('T')[0] ?? '–',
    }
  })

  const coColumns = [
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row: CORow) => {
        const m = changeOrderStatus(row.status)
        return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
      },
    },
    {
      key: 'sub_name',
      label: 'UE / Produkt',
      sortable: true,
      render: (row: CORow) => (
        <div>
          <div className="text-xs text-gray-500 truncate" title={row.sub_name}>{row.sub_name}</div>
          <div className="truncate" title={row.product_name}>{row.product_name}</div>
          <div className="text-xs text-gray-400">{row.product_code}</div>
        </div>
      ),
    },
    { key: 'total_cost', label: 'Kostnad', sortable: true, render: (row: CORow) => fmt(row.total_cost) },
    {
      key: 'total_customer_value',
      label: 'Salgsverdi',
      sortable: true,
      render: (row: CORow) => <span className="font-medium">{fmt(row.total_customer_value)}</span>,
    },
    { key: 'submitted_date', label: 'Dato', sortable: true },
    {
      key: 'actions',
      label: '',
      render: (row: CORow) => (
        <div className="flex gap-2">
          <Link href={`/admin/change-orders/${row.id}`} className="text-xs text-blue-600 hover:underline">
            Detaljer
          </Link>
          {row.status === 'pending' && (
            <>
              <button
                onClick={() => onStatusChange(row.id, 'approved')}
                className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
              >
                Godkjenn
              </button>
              <button
                onClick={() => onStatusChange(row.id, 'rejected')}
                className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
              >
                Avvis
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Endringsmeldinger <span className="font-normal text-gray-500">({changeOrders.length})</span>
      </h2>
      <div className="flex gap-3 mb-3">
        <select
          value={coStatusFilter}
          onChange={(e) => setCoStatusFilter(e.target.value)}
          className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
        >
          <option value="all">Alle statuser</option>
          <option value="pending">Venter</option>
          <option value="approved">Godkjent</option>
          <option value="rejected">Avvist</option>
        </select>
        <select
          value={coSubFilter}
          onChange={(e) => setCoSubFilter(e.target.value)}
          className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
        >
          <option value="all">Alle UE-er</option>
          {coSubOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.company_name}</option>
          ))}
        </select>
      </div>
      <div className="bg-white rounded-lg shadow">
        <SortableTable columns={coColumns} data={coRows} emptyText="Ingen endringsmeldinger" />
      </div>
    </section>
  )
}

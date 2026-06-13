'use client'

import { useState, type ReactNode } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'

type ConfirmOpts = {
  title: string
  message: string
  confirmLabel?: string
}

/**
 * Dialog-modulen: promise-basert bekreftelse via den kanoniske
 * ConfirmDialog-komponenten. Bruk denne i stedet for nettleserens
 * confirm()/alert() — samme utseende overalt, og testbart.
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   ...
 *   if (!(await confirm({ title: 'Slett?', message: '...' }))) return
 *   ...
 *   return <>{...}{confirmDialog}</>
 */
export function useConfirm(): {
  confirm: (opts: ConfirmOpts) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (ok: boolean) => void }) | null>(null)

  const confirm = (opts: ConfirmOpts) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }))

  const confirmDialog = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel ?? 'Bekreft'}
      onConfirm={() => { state.resolve(true); setState(null) }}
      onCancel={() => { state.resolve(false); setState(null) }}
    />
  ) : null

  return { confirm, confirmDialog }
}

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { requireAdmin } from '@/lib/api-guard'
import type { AccessRequest } from '@/types'

const MAX_LEN = {
  full_name: 100,
  email: 200,
  company: 100,
  phone: 40,
  message: 1000,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Public endpoint — anyone can request access without authentication.
 * Rate-limited per-IP and per-email to deter spam.
 *
 * We always return 200/201 even on dup/error to avoid leaking signal
 * about which emails are already in the system.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const byIp = await rateLimit({ key: `access-request:ip:${ip}`, limit: 5, windowMs: 60_000 })
  if (!byIp.ok) {
    return NextResponse.json({ error: 'For mange forsøk, prøv igjen om et minutt' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({})) as Partial<{
    full_name: string
    email: string
    company: string
    phone: string
    message: string
    desired_role: 'project_manager' | 'subcontractor'
  }>

  const full_name = String(body.full_name ?? '').trim().slice(0, MAX_LEN.full_name)
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, MAX_LEN.email)
  const company = body.company ? String(body.company).trim().slice(0, MAX_LEN.company) : null
  const phone = body.phone ? String(body.phone).trim().slice(0, MAX_LEN.phone) : null
  const message = body.message ? String(body.message).trim().slice(0, MAX_LEN.message) : null
  const desired_role = body.desired_role === 'project_manager' || body.desired_role === 'subcontractor'
    ? body.desired_role
    : null

  if (!full_name) return NextResponse.json({ error: 'Fullt navn er påkrevd' }, { status: 400 })
  if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: 'Gyldig e-post er påkrevd' }, { status: 400 })

  // Per-email rate limit so the same address can't flood pending rows.
  const byEmail = await rateLimit({ key: `access-request:email:${email}`, limit: 3, windowMs: 3600_000 })
  if (!byEmail.ok) {
    // Generic ok response to avoid leaking dup state.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const sb = getSupabaseAdmin()

  // If there's already a pending request for the same email, don't create a duplicate.
  const { data: existing } = await sb
    .from('access_requests')
    .select('id')
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const { error } = await sb.from('access_requests').insert({
    full_name,
    email,
    company,
    phone,
    message,
    desired_role,
  })

  if (error) {
    console.error('access-request insert failed:', error.message)
    // Stay generic in the response — internal failures shouldn't leak.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

/**
 * Admin-only: list access requests. Filter by status via ?status=pending|approved|rejected|all.
 * Default: pending only (the actionable bucket).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const status = new URL(req.url).searchParams.get('status') ?? 'pending'
  const sb = getSupabaseAdmin()
  let query = sb.from('access_requests').select('*').order('created_at', { ascending: false })
  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []) as AccessRequest[])
}

/**
 * Typed client-side wrappers for the internal REST API. Centralizes:
 *   - URL paths (one place to update if a route moves)
 *   - JSON serialization + error unwrapping
 *   - Method/credentials defaults
 *
 * Call from client components. For server-side data fetching, call Supabase
 * directly via getSupabaseAdmin() — there's no point routing through HTTP.
 */

import type {
  AccessRequest,
  AccessRequestStatus,
  GanttMilestone,
  InternalResource,
  InternalHoursMonthly,
  Invitation,
  PhaseType,
  Product,
  ProjectPhase,
  Subcontractor,
  SubcontractorProductPrice,
  User,
  UserRole,
} from '@/types'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

type Json = Record<string, unknown> | unknown[] | null

async function request<T>(
  path: string,
  opts: { method: string; json?: Json; headers?: Record<string, string> },
): Promise<T> {
  const init: RequestInit = {
    method: opts.method,
    credentials: 'same-origin',
    headers: {
      ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  }
  const res = await fetch(path, init)
  const text = await res.text()
  const body: unknown = text ? safeJson(text) : null
  if (!res.ok) {
    const msg = typeof body === 'object' && body && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Request failed: ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  return body as T
}

/** Trekk ut en brukervennlig feilmelding fra et kastet api-kall. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

const get = <T>(path: string) => request<T>(path, { method: 'GET' })
const post = <T>(path: string, json?: Json) => request<T>(path, { method: 'POST', json: json ?? null })
const patch = <T>(path: string, json?: Json) => request<T>(path, { method: 'PATCH', json: json ?? null })
const put = <T>(path: string, json?: Json) => request<T>(path, { method: 'PUT', json: json ?? null })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

export type SafeUser = Omit<User, 'password'>

// Server returns `subcontractors_overview` with a precomputed missing_prices.
export type SubWithMissing = Subcontractor & { missing_prices: number }

export const api = {
  me: {
    get: () => get<SafeUser>('/api/me'),
  },
  auth: {
    login: (email: string, password: string) =>
      post<{ id: string; role: UserRole; full_name: string; subcontractor_id: string | null }>(
        '/api/auth/login', { email, password }),
    logout: () => post<{ ok: true }>('/api/auth/logout'),
    forgotPassword: (email: string) =>
      post<{ ok: true }>('/api/auth/forgot-password', { email }),
  },
  users: {
    list: () => get<SafeUser[]>('/api/users'),
    get: (id: string) => get<SafeUser>(`/api/users/${id}`),
    create: (body: { email: string; password: string; full_name: string; role: 'main' | 'sub'; subcontractor_id?: string | null }) =>
      post<SafeUser>('/api/users', body),
    update: (id: string, body: Partial<Pick<User, 'full_name' | 'email' | 'role' | 'subcontractor_id' | 'active'>> & { password?: string }) =>
      patch<SafeUser>(`/api/users/${id}`, body as unknown as Json),
    remove: (id: string) =>
      del<{ ok: true }>(`/api/users?id=${encodeURIComponent(id)}`),
  },
  invitations: {
    list: () => get<Invitation[]>('/api/invitations'),
    create: (body: { email: string; role: 'project_manager' | 'sub' }) =>
      post<Invitation>('/api/invitations', body),
  },
  subcontractors: {
    list: () => get<Subcontractor[]>('/api/subcontractors'),
    create: (body: Omit<Subcontractor, 'id'>) =>
      post<Subcontractor>('/api/subcontractors', body as unknown as Json),
    overview: () => get<{ subcontractors: SubWithMissing[]; product_count: number }>(
      '/api/admin/subcontractors-overview'),
  },
  products: {
    list: () => get<Product[]>('/api/products'),
  },
  subcontractorPrices: {
    listAll: () => get<SubcontractorProductPrice[]>('/api/subcontractor-prices'),
    listFor: (subcontractorId: string) =>
      get<SubcontractorProductPrice[]>(
        `/api/subcontractor-prices?subcontractor_id=${encodeURIComponent(subcontractorId)}`),
    upsert: (body: { subcontractor_id: string; product_id: string; cost_price: number }) =>
      post<SubcontractorProductPrice>('/api/subcontractor-prices', body),
    update: (id: string, cost_price: number) =>
      put<SubcontractorProductPrice>('/api/subcontractor-prices', { id, cost_price }),
  },
  // ── Fremdriftsplan: fasetyper (globalt register) ──────────────────────────
  phaseTypes: {
    list: () => get<PhaseType[]>('/api/phase-types'),
    create: (body: { name: string; color: string }) =>
      post<PhaseType>('/api/phase-types', body),
    update: (body: { id: string; name: string; color: string }) =>
      patch<PhaseType>('/api/phase-types', body),
    remove: (id: string) =>
      del<{ ok: true }>(`/api/phase-types?id=${encodeURIComponent(id)}`),
  },
  // ── Fremdriftsplan: faser på prosjekt ─────────────────────────────────────
  projectPhases: {
    list: (projectId: string) =>
      get<ProjectPhase[]>(`/api/project-phases?project_id=${encodeURIComponent(projectId)}`),
    create: (body: {
      project_id: string
      phase_type_id: string
      name?: string | null
      start_date: string
      end_date?: string | null
      status?: ProjectPhase['status']
      progress_percent?: number
    }) => post<ProjectPhase>('/api/project-phases', body),
    update: (id: string, body: Partial<Pick<ProjectPhase,
      'phase_type_id' | 'name' | 'start_date' | 'end_date' | 'status' | 'progress_percent'>>) =>
      patch<ProjectPhase>(`/api/project-phases/${id}`, body as unknown as Json),
    remove: (id: string) =>
      del<{ ok: true }>(`/api/project-phases/${id}`),
    applyStandard: (projectId: string) =>
      post<{ ok: true }>('/api/project-phases/apply-standard', { project_id: projectId }),
  },
  // ── Fremdriftsplan: milepæler (legacy Gantt) ──────────────────────────────
  milestones: {
    list: (projectId: string) =>
      get<GanttMilestone[]>(`/api/milestones?project_id=${encodeURIComponent(projectId)}`),
    update: (body: { id: string; title?: string; start_date?: string; end_date?: string }) =>
      put<GanttMilestone>('/api/milestones', body),
    remove: (id: string) =>
      del<{ ok: true }>(`/api/milestones?id=${encodeURIComponent(id)}`),
  },
  // ── Type prosjekt: standardfaser-mal ──────────────────────────────────────
  defaultPhases: {
    get: (typeId: string) =>
      get<{ configured: boolean; phase_type_ids: string[] }>(
        `/api/project-types/${typeId}/default-phases`),
    save: (typeId: string, phaseTypeIds: string[]) =>
      put<{ ok: true }>(`/api/project-types/${typeId}/default-phases`, { phase_type_ids: phaseTypeIds }),
  },
  accessRequests: {
    list: (status: AccessRequestStatus | 'all' = 'pending') =>
      get<AccessRequest[]>(`/api/access-requests?status=${status}`),
    create: (body: {
      full_name: string
      email: string
      company?: string
      phone?: string
      desired_role?: 'project_manager' | 'sub'
      message?: string
    }) => post<{ ok: true }>('/api/access-requests', body),
    decide: (id: string, body: { action: 'approve' | 'reject'; role?: 'project_manager' | 'sub'; note?: string | null }) =>
      patch<{ ok: true; status: 'approved' | 'rejected' }>(`/api/access-requests/${id}`, body),
    remove: (id: string) =>
      del<{ ok: true }>(`/api/access-requests/${id}`),
  },
  // ── Intern ressurspool (main/company) ─────────────────────────────────────
  internalResources: {
    list: () => get<InternalResource[]>('/api/internal-resources'),
    create: (body: { name: string; hours_per_month: number; hourly_cost: number }) =>
      post<InternalResource>('/api/internal-resources', body),
    update: (body: { id: string; name?: string; hours_per_month?: number; hourly_cost?: number }) =>
      patch<InternalResource>('/api/internal-resources', body),
    remove: (id: string) =>
      del<{ ok: true }>(`/api/internal-resources?id=${encodeURIComponent(id)}`),
  },
  // ── Avstemming: faktiske interntimer per måned (main/company) ──────────────
  internalHoursMonthly: {
    list: () => get<InternalHoursMonthly[]>('/api/internal-hours-monthly'),
    save: (body: { year: number; month: number; total_hours: number }) =>
      put<InternalHoursMonthly>('/api/internal-hours-monthly', body),
    remove: (year: number, month: number) =>
      del<{ ok: true }>(`/api/internal-hours-monthly?year=${year}&month=${month}`),
  },
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type LoginResponse =
  | { id: string; role: 'company' | 'project_manager' | 'subcontractor' | 'main' | 'sub'; full_name: string; subcontractor_id: string | null }
  | { error: string }

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json() as LoginResponse

    if (!res.ok || 'error' in data) {
      setError('error' in data ? data.error : 'Innlogging feilet')
      setLoading(false)
      return
    }

    localStorage.setItem('user_id', data.id)
    localStorage.setItem('user_role', data.role)
    localStorage.setItem('user_name', data.full_name)
    if (data.subcontractor_id) {
      localStorage.setItem('subcontractor_id', data.subcontractor_id)
    }

    const dest = data.role === 'company' ? '/company'
      : (data.role === 'project_manager' || data.role === 'main') ? '/admin'
      : (data.role === 'subcontractor' || data.role === 'sub') ? '/subcontractor'
      : '/subcontractor'
    router.push(dest)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Logg inn</h1>
          <p className="mt-2 text-sm text-gray-600">Underentreprenør-rapportering</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              E-post
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Passord
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Logger inn...' : 'Logg inn'}
          </button>

          <div className="text-center">
            <Link href="/forgot-password" className="text-sm text-gray-600 hover:text-blue-600 hover:underline">
              Glemt passord?
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/admin', '/subcontractor', '/company']

/**
 * Edge guard: redirect unauthenticated requests to /login before they hit
 * the server component. Keeps the layout-level localStorage check as a
 * client UX fallback, but no longer relies on it for security.
 *
 * The cookie value is opaque to the edge (real validation happens server-side
 * via lib/auth.getSession()), so we treat "cookie present" as "let through,
 * the page will re-check". This stops drive-by hits to unauth pages.
 */
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
  if (!isProtected) return NextResponse.next()

  const hasSession = request.cookies.has('session')
  if (!hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', path)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/subcontractor/:path*', '/company/:path*'],
}

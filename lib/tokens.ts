import { randomBytes, createHash, timingSafeEqual } from 'crypto'

/**
 * Generate a cryptographically secure 256-bit token, base64url-encoded.
 * Used for password reset and invitation links.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Hash a token with SHA-256. Store this in the database, not the raw token,
 * so a DB compromise does not give attackers usable tokens.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time comparison of two hex hashes. Use instead of `===` to avoid
 * timing-based token enumeration.
 */
export function safeCompareHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

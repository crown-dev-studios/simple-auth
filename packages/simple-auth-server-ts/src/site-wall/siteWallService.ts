import { createHmac, timingSafeEqual } from 'crypto'
import type { SiteWallResult, SiteWallServiceOptions, CookieConfig } from './types'

const DEFAULTS = {
  tokenTtlSeconds: 2_592_000, // 30 days
  cookieName: 'site_wall',
  tokenVersion: 'v1',
} as const

export class SiteWallService {
  constructor(private readonly options: SiteWallServiceOptions) {}

  verifyPassword(
    password: string
  ): SiteWallResult<{ token: string; expiresAt: number; cookie: CookieConfig }> {
    const trimmed = password.trim()

    if (!constantTimeEqual(trimmed, this.options.password)) {
      return {
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Invalid password.' },
      }
    }

    const ttl = this.options.tokenTtlSeconds ?? DEFAULTS.tokenTtlSeconds
    const expiresAt = Math.floor(Date.now() / 1000) + ttl
    const token = this.createToken(expiresAt)

    return {
      success: true,
      data: { token, expiresAt, cookie: this.getCookieConfig() },
    }
  }

  verifyAccessToken(token: string): SiteWallResult<{ expiresAt: number }> {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return {
        success: false,
        error: { code: 'INVALID_ACCESS_TOKEN', message: 'Malformed access token.' },
      }
    }

    const [version, expiresAtStr, signature] = parts

    if (version !== DEFAULTS.tokenVersion) {
      return {
        success: false,
        error: { code: 'INVALID_ACCESS_TOKEN', message: 'Invalid token version.' },
      }
    }

    const expiresAt = Number(expiresAtStr)
    if (!Number.isFinite(expiresAt)) {
      return {
        success: false,
        error: { code: 'INVALID_ACCESS_TOKEN', message: 'Invalid token expiry.' },
      }
    }

    if (expiresAt <= Math.floor(Date.now() / 1000)) {
      return {
        success: false,
        error: { code: 'INVALID_ACCESS_TOKEN', message: 'Access token has expired.' },
      }
    }

    const expectedSignature = this.sign(`${DEFAULTS.tokenVersion}.${expiresAtStr}`)
    if (!constantTimeEqual(signature, expectedSignature)) {
      return {
        success: false,
        error: { code: 'INVALID_ACCESS_TOKEN', message: 'Invalid access token.' },
      }
    }

    return { success: true, data: { expiresAt } }
  }

  getCookieConfig(): CookieConfig {
    return {
      name: this.options.cookieName ?? DEFAULTS.cookieName,
      httpOnly: true,
      sameSite: 'lax',
      secure: this.options.env === 'production',
      path: '/',
      maxAge: this.options.tokenTtlSeconds ?? DEFAULTS.tokenTtlSeconds,
    }
  }

  private createToken(expiresAt: number): string {
    const payload = `${DEFAULTS.tokenVersion}.${expiresAt}`
    const signature = this.sign(payload)
    return `${payload}.${signature}`
  }

  private sign(data: string): string {
    const key = `${this.options.secret}:${this.options.password}`
    return createHmac('sha256', key).update(data).digest('hex')
  }
}

const constantTimeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time, then return false
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

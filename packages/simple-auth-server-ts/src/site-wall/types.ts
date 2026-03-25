export type SiteWallResult<T> =
  | { success: true; data: T }
  | { success: false; error: SiteWallError }

export type SiteWallError =
  | { code: 'INVALID_PASSWORD'; message: string }
  | { code: 'INVALID_ACCESS_TOKEN'; message: string }

export interface CookieConfig {
  name: string
  httpOnly: boolean
  sameSite: 'lax'
  secure: boolean
  path: string
  maxAge: number
}

export interface SiteWallServiceOptions {
  env: 'production' | 'development' | 'test'
  password: string
  secret: string
  tokenTtlSeconds?: number
  cookieName?: string
}

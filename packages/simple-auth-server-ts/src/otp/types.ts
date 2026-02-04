export type OtpResult<T> =
  | { success: true; data: T }
  | { success: false; error: OtpError }

export type OtpError =
  | { code: 'RATE_LIMITED'; message: string; retryAfterSeconds: number }
  | { code: 'INVALID_CODE'; message: string; attemptsRemaining: number }
  | { code: 'EXPIRED'; message: string }
  | { code: 'MAX_ATTEMPTS'; message: string }
  | { code: 'NOT_FOUND'; message: string }

export interface OtpServiceOptions {
  env: 'production' | 'development' | 'test'
  bypassCode?: string
  ttlSeconds?: number
  maxAttempts?: number
  rateLimit?: {
    windowSeconds?: number
    maxRequests?: number
  }
  keyPrefix?: {
    email?: string
    phone?: string
    rateLimit?: string
  }
}


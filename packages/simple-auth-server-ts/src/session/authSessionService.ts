import { z } from 'zod'
import type { RedisLike } from '../redis/types'

const AUTH_SESSION_PREFIX = 'auth_session:'
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60
const SESSION_ID_REGEX = /^[0-9a-f]{64}$/i

const normalizeSessionId = (sessionId: string): string => sessionId.trim().toLowerCase()

const PendingOAuthSchema = z.object({
  provider: z.enum(['google', 'apple']),
  sub: z.string(),
  email: z.string(),
  emailVerified: z.boolean().optional(),
  rawData: z.record(z.string(), z.unknown()),
  refreshToken: z.string().optional(),
})

export type PendingOAuth = z.infer<typeof PendingOAuthSchema>

const AuthSessionSchema = z.object({
  email: z.string(),
  emailVerified: z.boolean(),
  phoneNumber: z.string().nullable(),
  phoneVerified: z.boolean(),
  createdAt: z.number(),
  expiresAt: z.number(),
  pendingOAuth: PendingOAuthSchema.nullable().optional(),
  existingUserId: z.string().nullable().optional(),
})

export type AuthSession = z.infer<typeof AuthSessionSchema>

export type SessionResult<T> = { success: true; data: T } | { success: false; error: string }

const generateSessionId = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface AuthSessionServiceOptions {
  sessionTtlSeconds?: number
  keyPrefix?: string
}

export class AuthSessionService {
  private readonly ttlSeconds: number
  private readonly keyPrefix: string

  constructor(
    private readonly redis: RedisLike,
    options: AuthSessionServiceOptions = {}
  ) {
    this.ttlSeconds = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS
    this.keyPrefix = options.keyPrefix ?? AUTH_SESSION_PREFIX
  }

  async createSession(email: string): Promise<SessionResult<string>> {
    const sessionId = generateSessionId()
    const key = `${this.keyPrefix}${sessionId}`
    const now = Date.now()

    const session: AuthSession = {
      email: email.toLowerCase().trim(),
      emailVerified: false,
      phoneNumber: null,
      phoneVerified: false,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
    }

    await this.redis.setex(key, this.ttlSeconds, JSON.stringify(session))
    return { success: true, data: sessionId }
  }

  async getSession(sessionId: string): Promise<SessionResult<AuthSession>> {
    const normalizedSessionId = normalizeSessionId(sessionId)
    if (!SESSION_ID_REGEX.test(normalizedSessionId)) {
      return { success: false, error: 'Session not found or expired' }
    }

    const key = `${this.keyPrefix}${normalizedSessionId}`
    const stored = await this.redis.get(key)
    if (!stored) return { success: false, error: 'Session not found or expired' }

    let parsed: ReturnType<typeof AuthSessionSchema.safeParse>
    try {
      parsed = AuthSessionSchema.safeParse(JSON.parse(stored))
    } catch {
      await this.redis.del(key)
      return { success: false, error: 'Session corrupted, please start over' }
    }

    if (!parsed.success) {
      await this.redis.del(key)
      return { success: false, error: 'Session corrupted, please start over' }
    }

    if (Date.now() > parsed.data.expiresAt) {
      await this.redis.del(key)
      return { success: false, error: 'Session expired' }
    }

    return { success: true, data: parsed.data }
  }

  async updateSession(sessionId: string, updater: (session: AuthSession) => AuthSession): Promise<SessionResult<void>> {
    const normalizedSessionId = normalizeSessionId(sessionId)
    if (!SESSION_ID_REGEX.test(normalizedSessionId)) {
      return { success: false, error: 'Session not found' }
    }

    const key = `${this.keyPrefix}${normalizedSessionId}`
    const stored = await this.redis.get(key)
    if (!stored) return { success: false, error: 'Session not found' }

    let parsed: ReturnType<typeof AuthSessionSchema.safeParse>
    try {
      parsed = AuthSessionSchema.safeParse(JSON.parse(stored))
    } catch {
      await this.redis.del(key)
      return { success: false, error: 'Session corrupted, please start over' }
    }

    if (!parsed.success) {
      await this.redis.del(key)
      return { success: false, error: 'Session corrupted, please start over' }
    }

    const updated = updater(parsed.data)
    const ttl = await this.redis.ttl(key)
    if (ttl > 0) {
      await this.redis.setex(key, ttl, JSON.stringify(updated))
    }

    return { success: true, data: undefined }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const normalizedSessionId = normalizeSessionId(sessionId)
    if (!SESSION_ID_REGEX.test(normalizedSessionId)) return

    const key = `${this.keyPrefix}${normalizedSessionId}`
    await this.redis.del(key)
  }
}

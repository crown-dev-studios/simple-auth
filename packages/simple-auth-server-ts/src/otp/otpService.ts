import { z } from 'zod'
import { OTP_CODE_LENGTH } from '@crown-dev-studios/simple-auth-shared-types'
import type { RedisLike } from '../redis/types'
import type { OtpResult, OtpServiceOptions } from './types'

const StoredOtpSchema = z.object({
  code: z.string(),
  attempts: z.number(),
  createdAt: z.number(),
})

type StoredOtp = z.infer<typeof StoredOtpSchema>

const DEFAULTS = {
  ttlSeconds: 300,
  otpLength: OTP_CODE_LENGTH,
  maxAttempts: 5,
  rateLimitWindowSeconds: 60,
  rateLimitMaxRequests: 3,
  prefixes: {
    email: 'otp:email:',
    phone: 'otp:phone:',
    rateLimit: 'rate:otp:',
  },
} as const

const normalizeEmail = (email: string): string => email.toLowerCase().trim()

const normalizePhone = (phone: string): string => phone.replace(/[^\d+]/g, '')

const generateRandomCode = (): string => {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  const max = 10 ** DEFAULTS.otpLength
  return (array[0] % max).toString().padStart(DEFAULTS.otpLength, '0')
}

const constantTimeEqual = (a: string, b: string): boolean => {
  const maxLength = Math.max(a.length, b.length)
  let result = a.length ^ b.length
  for (let i = 0; i < maxLength; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return result === 0
}

const shouldBypass = (env: OtpServiceOptions['env'], bypassCode?: string): boolean => {
  return env !== 'production' && Boolean(bypassCode)
}

const checkRateLimit = async (
  redis: RedisLike,
  key: string,
  windowSeconds: number,
  maxRequests: number
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> => {
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, windowSeconds)
  }

  if (count > maxRequests) {
    const ttl = await redis.ttl(key)
    return { allowed: false, retryAfterSeconds: Math.max(ttl, 1) }
  }

  return { allowed: true }
}

export class OtpService {
  constructor(
    private readonly redis: RedisLike,
    private readonly options: OtpServiceOptions
  ) {}

  async generateEmailOtp(email: string): Promise<OtpResult<string>> {
    const normalized = normalizeEmail(email)
    return this.generateOtp('email', normalized)
  }

  async verifyEmailOtp(email: string, code: string): Promise<OtpResult<void>> {
    const normalized = normalizeEmail(email)
    return this.verifyOtp('email', normalized, code)
  }

  async generatePhoneOtp(phone: string): Promise<OtpResult<string>> {
    const normalized = normalizePhone(phone)
    return this.generateOtp('phone', normalized)
  }

  async verifyPhoneOtp(phone: string, code: string): Promise<OtpResult<void>> {
    const normalized = normalizePhone(phone)
    return this.verifyOtp('phone', normalized, code)
  }

  private async generateOtp(type: 'email' | 'phone', identifier: string): Promise<OtpResult<string>> {
    const ttlSeconds = this.options.ttlSeconds ?? DEFAULTS.ttlSeconds
    const windowSeconds = this.options.rateLimit?.windowSeconds ?? DEFAULTS.rateLimitWindowSeconds
    const maxRequests = this.options.rateLimit?.maxRequests ?? DEFAULTS.rateLimitMaxRequests

    const prefixes = {
      email: this.options.keyPrefix?.email ?? DEFAULTS.prefixes.email,
      phone: this.options.keyPrefix?.phone ?? DEFAULTS.prefixes.phone,
      rateLimit: this.options.keyPrefix?.rateLimit ?? DEFAULTS.prefixes.rateLimit,
    }

    const rateKey = `${prefixes.rateLimit}${type}:${identifier}`
    const rateCheck = await checkRateLimit(this.redis, rateKey, windowSeconds, maxRequests)
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many OTP requests. Please wait before trying again.',
          retryAfterSeconds: rateCheck.retryAfterSeconds!,
        },
      }
    }

    const code = shouldBypass(this.options.env, this.options.bypassCode)
      ? (this.options.bypassCode as string)
      : generateRandomCode()

    const storedOtp: StoredOtp = { code, attempts: 0, createdAt: Date.now() }
    const key = `${type === 'email' ? prefixes.email : prefixes.phone}${identifier}`

    await this.redis.setex(key, ttlSeconds, JSON.stringify(storedOtp))
    return { success: true, data: code }
  }

  private async verifyOtp(
    type: 'email' | 'phone',
    identifier: string,
    code: string
  ): Promise<OtpResult<void>> {
    const maxAttempts = this.options.maxAttempts ?? DEFAULTS.maxAttempts

    const prefixes = {
      email: this.options.keyPrefix?.email ?? DEFAULTS.prefixes.email,
      phone: this.options.keyPrefix?.phone ?? DEFAULTS.prefixes.phone,
    }

    const key = `${type === 'email' ? prefixes.email : prefixes.phone}${identifier}`
    const stored = await this.redis.get(key)

    if (!stored) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'No OTP found. Please request a new code.' } }
    }

    let parseResult: ReturnType<typeof StoredOtpSchema.safeParse>
    try {
      parseResult = StoredOtpSchema.safeParse(JSON.parse(stored))
    } catch {
      await this.redis.del(key)
      return { success: false, error: { code: 'NOT_FOUND', message: 'No OTP found. Please request a new code.' } }
    }

    if (!parseResult.success) {
      await this.redis.del(key)
      return { success: false, error: { code: 'NOT_FOUND', message: 'No OTP found. Please request a new code.' } }
    }

    const otpData = parseResult.data
    if (otpData.attempts >= maxAttempts) {
      await this.redis.del(key)
      return {
        success: false,
        error: {
          code: 'MAX_ATTEMPTS',
          message: 'Maximum verification attempts exceeded. Please request a new code.',
        },
      }
    }

    const ttl = await this.redis.ttl(key)
    if (ttl <= 0) {
      await this.redis.del(key)
      return { success: false, error: { code: 'NOT_FOUND', message: 'No OTP found. Please request a new code.' } }
    }

    const updatedOtpData = { ...otpData, attempts: otpData.attempts + 1 }
    await this.redis.setex(key, ttl, JSON.stringify(updatedOtpData))

    if (!constantTimeEqual(otpData.code, code)) {
      const attemptsRemaining = maxAttempts - updatedOtpData.attempts
      return {
        success: false,
        error: {
          code: 'INVALID_CODE',
          message: 'Invalid code. Please try again.',
          attemptsRemaining,
        },
      }
    }

    await this.redis.del(key)
    return { success: true, data: undefined }
  }
}

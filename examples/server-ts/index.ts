import { Elysia } from 'elysia'
import { z } from 'zod'

import { createRedisClient } from '../../packages/simple-auth-server-ts/src/redis/redisClient'
import { OtpService } from '../../packages/simple-auth-server-ts/src/otp/otpService'
import { OTP_CODE_LENGTH } from '../../packages/shared-types/src'

const redis = createRedisClient({ keyPrefix: 'simple_auth_example' })
const otpService = new OtpService(redis, {
  env: (process.env.APP_ENV === 'production' ? 'production' : 'development') as 'production' | 'development' | 'test',
  bypassCode: process.env.AUTH_BYPASS_CODE ?? undefined,
})

const isProduction = process.env.APP_ENV === 'production'
const shouldLogOtp =
  !isProduction && (process.env.SIMPLE_AUTH_LOG_OTP === 'true' || process.env.SIMPLE_AUTH_LOG_OTP === '1')

const EmailSchema = z.object({ email: z.email() })
const VerifySchema = z.object({ email: z.email(), code: z.string().length(OTP_CODE_LENGTH) })

export const app = new Elysia()
  .post('/auth/email/request-otp', async ({ body, set }) => {
    const parsed = EmailSchema.safeParse(body)
    if (!parsed.success) {
      set.status = 400
      return { error: 'VALIDATION_ERROR', message: 'Invalid request body', details: z.treeifyError(parsed.error) }
    }

    const result = await otpService.generateEmailOtp(parsed.data.email)
    if (!result.success) {
      set.status = result.error.code === 'RATE_LIMITED' ? 429 : 500
      return {
        error: result.error.code,
        message: result.error.message,
        retryAfterSeconds: result.error.code === 'RATE_LIMITED' ? result.error.retryAfterSeconds : undefined,
      }
    }

    // DO NOT USE IN PRODUCTION:
    // Logging OTPs makes it easy to copy/paste into a real server and leak codes into logs.
    if (shouldLogOtp) {
      console.log('[simple-auth example] email OTP (dev only):', { email: parsed.data.email, code: result.data })
    } else {
      console.log('[simple-auth example] email OTP generated. Deliver via email/SMS in production.')
    }

    return { success: true }
  })
  .post('/auth/email/verify-otp', async ({ body, set }) => {
    const parsed = VerifySchema.safeParse(body)
    if (!parsed.success) {
      set.status = 400
      return { error: 'VALIDATION_ERROR', message: 'Invalid request body', details: z.treeifyError(parsed.error) }
    }

    const result = await otpService.verifyEmailOtp(parsed.data.email, parsed.data.code)
    if (!result.success) {
      set.status = 400
      return { error: result.error.code, message: result.error.message, attemptsRemaining: result.error.attemptsRemaining }
    }

    return { success: true }
  })
  .listen(3005)

console.log('simple-auth example server running on http://localhost:3005')

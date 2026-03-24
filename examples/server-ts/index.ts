/**
 * Simple Auth — Example Server (Hono + Bun)
 *
 * Demonstrates a full auth flow using simple-auth-server-ts primitives:
 *   - Email OTP → verify → phone OTP → verify → mint tokens
 *   - Google OAuth → 3-way response (authenticated / needs_phone / needs_linking)
 *   - Session resume (return to in-progress onboarding)
 *   - Token refresh
 *
 * NOT production-ready: uses in-memory stores instead of a database.
 * See docs/credentials.md for what your production app should persist.
 */

import { Hono } from 'hono'
import { SignJWT, jwtVerify } from 'jose'

import { SimpleAuthServerConfigSchema } from '../../packages/shared-types/src'
import { OTP_CODE_LENGTH } from '../../packages/shared-types/src'
import {
  createRedisClientFromConfig,
  OtpService,
  AuthSessionService,
  GoogleOAuthService,
} from '../../packages/simple-auth-server-ts/src'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = SimpleAuthServerConfigSchema.parse({
  env: process.env.APP_ENV ?? 'development',
  redis: {
    url: process.env.REDIS_URL,
    keyPrefix: process.env.REDIS_KEY_PREFIX,
  },
  otp: {
    bypassCode: process.env.AUTH_BYPASS_CODE,
  },
  providers: {
    emailOtp: { enabled: true },
    phoneOtp: { enabled: true },
    google: process.env.GOOGLE_CLIENT_ID
      ? {
          enabled: true,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }
      : undefined,
  },
})

// Log bypass warning in non-production
if (config.env !== 'production' && config.otp?.bypassCode) {
  console.warn(
    `⚠️  OTP bypass code is active (env=${config.env}). All OTP requests will return the bypass code.`
  )
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const redis = createRedisClientFromConfig(config)
const otpService = new OtpService(redis, {
  env: config.env,
  bypassCode: config.otp?.bypassCode,
})
const sessionService = new AuthSessionService(redis)
const googleOAuth = config.providers.google?.enabled
  ? new GoogleOAuthService({
      clientId: config.providers.google.clientId,
      clientSecret: config.providers.google.clientSecret,
      redirectUri: config.providers.google.redirectUri,
    })
  : undefined

// ---------------------------------------------------------------------------
// JWT helpers (minimal — use a real library/config in production)
// ---------------------------------------------------------------------------

const rawJwtSecret = process.env.JWT_SECRET
if (!rawJwtSecret || rawJwtSecret.length < 32) {
  console.error(
    'JWT_SECRET is required and must be at least 32 characters. Generate one with: openssl rand -base64 32'
  )
  process.exit(1)
}
const JWT_SECRET = new TextEncoder().encode(rawJwtSecret)
const ACCESS_TOKEN_TTL = 15 * 60            // 15 minutes
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 // 30 days

async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
    .sign(JWT_SECRET)
}

async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
    .sign(JWT_SECRET)
}

async function verifyRefreshToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (payload.type !== 'refresh' || typeof payload.sub !== 'string') return null
    return payload.sub
  } catch {
    return null
  }
}

async function mintTokens(userId: string) {
  return {
    accessToken: await signAccessToken(userId),
    refreshToken: await signRefreshToken(userId),
    expiresIn: ACCESS_TOKEN_TTL,
  }
}

// ---------------------------------------------------------------------------
// In-memory stores (replace with your database in production)
// ---------------------------------------------------------------------------

interface User {
  id: string
  email: string
  phoneNumber: string | null
  role: 'user' | 'admin'
}

/** email → User */
const usersByEmail = new Map<string, User>()
/** `${provider}:${sub}` → User.email */
const identityLinks = new Map<string, string>()

function findUserByEmail(email: string): User | undefined {
  return usersByEmail.get(email.toLowerCase().trim())
}

function findUserByIdentity(provider: string, sub: string): User | undefined {
  const email = identityLinks.get(`${provider}:${sub}`)
  return email ? usersByEmail.get(email) : undefined
}

function createUser(email: string, phone: string | null): User {
  const user: User = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    phoneNumber: phone,
    role: 'user',
  }
  usersByEmail.set(user.email, user)
  return user
}

function linkIdentity(provider: string, sub: string, email: string) {
  identityLinks.set(`${provider}:${sub}`, email.toLowerCase().trim())
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? '•'.repeat(phone.length - 4) + phone.slice(-4) : phone
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return local[0] + (local.length > 1 ? '•'.repeat(local.length - 1) : '') + '@' + domain
}

function toUserResponse(user: User) {
  return { id: user.id, email: user.email, role: user.role, phoneNumber: user.phoneNumber }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono()

// ---- Email OTP ----------------------------------------------------------

app.post('/auth/email/request-otp', async (c) => {
  const body = await c.req.json<{ email?: string }>()
  const email = body.email?.trim()
  if (!email) return c.json({ error: 'VALIDATION_ERROR', message: 'email is required' }, 400)

  const result = await otpService.generateEmailOtp(email)
  if (!result.success) {
    const status = result.error.code === 'RATE_LIMITED' ? 429 : 500
    return c.json(result.error, status)
  }

  // Create an onboarding session for this email
  const sessionResult = await sessionService.createSession(email)
  if (!sessionResult.success) {
    return c.json({ error: 'SESSION_CREATE_FAILED', message: sessionResult.error }, 500)
  }

  // In production, deliver the code via email. Never return it in the response.
  // OTP logging is opt-in only; set SIMPLE_AUTH_LOG_OTP=true for local debugging.
  if (config.env !== 'production' && process.env.SIMPLE_AUTH_LOG_OTP === 'true') {
    console.log('[example] email OTP (dev only):', { email, code: result.data })
  }

  return c.json({ success: true, sessionToken: sessionResult.data, message: 'OTP sent' })
})

app.post('/auth/email/verify-otp', async (c) => {
  const body = await c.req.json<{ sessionToken?: string; email?: string; code?: string }>()
  if (!body.email || !body.code || body.code.length !== OTP_CODE_LENGTH || !body.sessionToken) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'email, code, and sessionToken required' }, 400)
  }

  // Validate session and ensure email matches (normalize for case-insensitive comparison)
  const sessionCheck = await sessionService.getSession(body.sessionToken)
  if (!sessionCheck.success) {
    return c.json({ error: 'INVALID_SESSION', message: sessionCheck.error }, 400)
  }
  const normalizedEmail = body.email.toLowerCase().trim()
  if (sessionCheck.data.email !== normalizedEmail) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'email does not match session' }, 400)
  }

  const verify = await otpService.verifyEmailOtp(normalizedEmail, body.code)
  if (!verify.success) {
    return c.json(verify.error, 400)
  }

  // Mark email verified on the session
  await sessionService.updateSession(body.sessionToken, (s) => ({
    ...s,
    emailVerified: true,
  }))

  // Determine flow type
  const existingUser = findUserByEmail(normalizedEmail)
  const flowType = existingUser?.phoneNumber ? 'returning' : 'new'
  const maskedPhone = existingUser?.phoneNumber ? maskPhone(existingUser.phoneNumber) : null

  // For returning users, auto-send phone OTP; fail if generation fails
  if (flowType === 'returning' && existingUser?.phoneNumber) {
    const phoneResult = await otpService.generatePhoneOtp(existingUser.phoneNumber)
    if (!phoneResult.success) {
      const status = phoneResult.error.code === 'RATE_LIMITED' ? 429 : 500
      return c.json(phoneResult.error, status)
    }
    if (config.env !== 'production' && process.env.SIMPLE_AUTH_LOG_OTP === 'true') {
      console.log('[example] phone OTP (dev only):', { phone: existingUser.phoneNumber, code: phoneResult.data })
    }
    await sessionService.updateSession(body.sessionToken, (s) => ({
      ...s,
      phoneNumber: existingUser.phoneNumber,
      existingUserId: existingUser.id,
    }))
  }

  return c.json({
    success: true,
    sessionToken: body.sessionToken,
    emailVerified: true,
    flowType,
    maskedPhone,
  })
})

// ---- Google OAuth --------------------------------------------------------

app.post('/auth/oauth/google', async (c) => {
  if (!googleOAuth) {
    return c.json({ error: 'NOT_IMPLEMENTED', message: 'Google OAuth not configured' }, 501)
  }

  const body = await c.req.json<{ authCode?: string }>()
  if (!body.authCode) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'authCode is required' }, 400)
  }

  const result = await googleOAuth.exchangeAuthCode(body.authCode)
  if (!result.success) {
    return c.json({ error: 'OAUTH_TOKEN_INVALID', message: result.error.message }, 400)
  }

  const { user: googleUser, refreshToken: googleRefreshToken } = result.data

  // 1) Already linked? → authenticate
  const linkedUser = findUserByIdentity('google', googleUser.sub)
  if (linkedUser) {
    return c.json({
      status: 'authenticated',
      user: toUserResponse(linkedUser),
      tokens: await mintTokens(linkedUser.id),
      grantedScopes: result.data.grantedScopes,
    })
  }

  // 2) Email exists but not linked? → needs_linking
  const existingUser = findUserByEmail(googleUser.email)
  if (existingUser) {
    const sessionResult = await sessionService.createSession(googleUser.email)
    if (!sessionResult.success) {
      return c.json({ error: 'SESSION_CREATE_FAILED', message: sessionResult.error }, 500)
    }
    await sessionService.updateSession(sessionResult.data, (s) => ({
      ...s,
      emailVerified: googleUser.emailVerified,
      pendingOAuth: {
        provider: 'google',
        sub: googleUser.sub,
        email: googleUser.email,
        emailVerified: googleUser.emailVerified,
        rawData: googleUser.rawPayload,
        refreshToken: googleRefreshToken,
      },
      existingUserId: existingUser.id,
    }))
    // Send linking OTP — fail if generation fails (e.g. rate-limited)
    const otpResult = await otpService.generateEmailOtp(googleUser.email)
    if (!otpResult.success) {
      const status = otpResult.error.code === 'RATE_LIMITED' ? 429 : 500
      return c.json(otpResult.error, status)
    }
    if (config.env !== 'production' && process.env.SIMPLE_AUTH_LOG_OTP === 'true') {
      console.log('[example] linking OTP (dev only):', { email: googleUser.email, code: otpResult.data })
    }
    return c.json({
      status: 'needs_linking',
      sessionToken: sessionResult.data,
      maskedEmail: maskEmail(googleUser.email),
    })
  }

  // 3) New user → needs_phone
  const sessionResult = await sessionService.createSession(googleUser.email)
  if (!sessionResult.success) {
    return c.json({ error: 'SESSION_CREATE_FAILED', message: sessionResult.error }, 500)
  }
  await sessionService.updateSession(sessionResult.data, (s) => ({
    ...s,
    emailVerified: googleUser.emailVerified,
    pendingOAuth: {
      provider: 'google',
      sub: googleUser.sub,
      email: googleUser.email,
      emailVerified: googleUser.emailVerified,
      rawData: googleUser.rawPayload,
      refreshToken: googleRefreshToken,
    },
  }))

  return c.json({
    status: 'needs_phone',
    sessionToken: sessionResult.data,
    email: googleUser.email,
    flowType: 'new',
    maskedPhone: null,
  })
})

// ---- OAuth Link ---------------------------------------------------------

app.post('/auth/oauth/link', async (c) => {
  const body = await c.req.json<{ sessionToken?: string; code?: string }>()
  if (!body.sessionToken || !body.code) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'sessionToken and code required' }, 400)
  }

  const sessionResult = await sessionService.getSession(body.sessionToken)
  if (!sessionResult.success) {
    return c.json({ error: 'INVALID_SESSION', message: sessionResult.error }, 400)
  }
  const session = sessionResult.data
  if (!session.pendingOAuth) {
    return c.json({ error: 'INVALID_SESSION', message: 'No pending OAuth to link' }, 400)
  }

  const verify = await otpService.verifyEmailOtp(session.email, body.code)
  if (!verify.success) {
    return c.json(verify.error, 400)
  }

  // Link the identity
  linkIdentity(session.pendingOAuth.provider, session.pendingOAuth.sub, session.email)

  const user = findUserByEmail(session.email)
  if (!user) {
    return c.json({ error: 'USER_NOT_FOUND', message: 'User not found' }, 400)
  }
  await sessionService.deleteSession(body.sessionToken)

  return c.json({
    status: 'authenticated',
    user: toUserResponse(user),
    tokens: await mintTokens(user.id),
  })
})

// ---- Phone OTP ----------------------------------------------------------

app.post('/auth/phone/request-otp', async (c) => {
  const body = await c.req.json<{ sessionToken?: string; phoneNumber?: string }>()
  if (!body.sessionToken || !body.phoneNumber) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'sessionToken and phoneNumber required' }, 400)
  }

  const sessionResult = await sessionService.getSession(body.sessionToken)
  if (!sessionResult.success) {
    return c.json({ error: 'INVALID_SESSION', message: sessionResult.error }, 400)
  }
  if (!sessionResult.data.emailVerified) {
    return c.json({ error: 'EMAIL_NOT_VERIFIED', message: 'Verify email first' }, 400)
  }

  const result = await otpService.generatePhoneOtp(body.phoneNumber)
  if (!result.success) {
    const status = result.error.code === 'RATE_LIMITED' ? 429 : 500
    return c.json(result.error, status)
  }

  // Store phone on session
  await sessionService.updateSession(body.sessionToken, (s) => ({
    ...s,
    phoneNumber: body.phoneNumber!,
  }))

  // In production, deliver via SMS
  if (config.env !== 'production' && process.env.SIMPLE_AUTH_LOG_OTP === 'true') {
    console.log('[example] phone OTP (dev only):', { phone: body.phoneNumber, code: result.data })
  }

  return c.json({ success: true, message: 'OTP sent', maskedPhone: maskPhone(body.phoneNumber) })
})

app.post('/auth/phone/verify-otp', async (c) => {
  const body = await c.req.json<{ sessionToken?: string; code?: string }>()
  if (!body.sessionToken || !body.code) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'sessionToken and code required' }, 400)
  }

  const sessionResult = await sessionService.getSession(body.sessionToken)
  if (!sessionResult.success) {
    return c.json({ error: 'INVALID_SESSION', message: sessionResult.error }, 400)
  }
  const session = sessionResult.data
  if (!session.phoneNumber) {
    return c.json({ error: 'NO_PHONE', message: 'No phone number on session' }, 400)
  }

  const verify = await otpService.verifyPhoneOtp(session.phoneNumber, body.code)
  if (!verify.success) {
    return c.json(verify.error, 400)
  }

  // Find or create user
  let user = session.existingUserId
    ? Array.from(usersByEmail.values()).find((u) => u.id === session.existingUserId)
    : findUserByEmail(session.email)

  if (user) {
    // Update phone
    user.phoneNumber = session.phoneNumber
  } else {
    user = createUser(session.email, session.phoneNumber)
  }

  // If there was a pending OAuth, link it
  if (session.pendingOAuth) {
    linkIdentity(session.pendingOAuth.provider, session.pendingOAuth.sub, user.email)
  }

  await sessionService.deleteSession(body.sessionToken)

  return c.json({
    user: toUserResponse(user),
    tokens: await mintTokens(user.id),
  })
})

// ---- Refresh ------------------------------------------------------------

app.post('/auth/refresh', async (c) => {
  const body = await c.req.json<{ refreshToken?: string }>()
  if (!body.refreshToken) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'refreshToken required' }, 400)
  }

  const userId = await verifyRefreshToken(body.refreshToken)
  if (!userId) {
    return c.json({ error: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' }, 401)
  }

  return c.json(await mintTokens(userId))
})

// ---- Session Resume -----------------------------------------------------

app.post('/auth/session/resume', async (c) => {
  const body = await c.req.json<{ sessionToken?: string }>()
  if (!body.sessionToken) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'sessionToken required' }, 400)
  }

  const sessionResult = await sessionService.getSession(body.sessionToken)
  if (!sessionResult.success) {
    return c.json({ error: 'INVALID_SESSION', message: sessionResult.error }, 400)
  }

  const session = sessionResult.data
  const existingUser = findUserByEmail(session.email)
  const flowType = existingUser?.phoneNumber ? 'returning' : 'new'

  // Determine step (context-bridge = OAuth linking in progress)
  let step: 'email-otp' | 'context-bridge' | 'phone-input' | 'phone-otp'
  if (session.pendingOAuth) {
    step = 'context-bridge'
  } else if (!session.emailVerified) {
    step = 'email-otp'
  } else if (flowType === 'new' && !session.phoneNumber) {
    step = 'phone-input'
  } else {
    step = 'phone-otp'
  }

  return c.json({
    success: true,
    email: session.email,
    emailVerified: session.emailVerified,
    maskedPhone: session.phoneNumber ? maskPhone(session.phoneNumber) : null,
    phoneVerified: session.phoneVerified,
    flowType,
    step,
  })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT ?? 3005)

export default {
  port,
  fetch: app.fetch,
}

console.log(`simple-auth example server running on http://localhost:${port}`)

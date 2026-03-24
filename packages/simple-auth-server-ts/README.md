# @crown-dev-studios/simple-auth-server-ts

Framework-agnostic server primitives for auth flows in TypeScript. This package
gives you Redis-backed OTP and session services plus a Google OAuth auth-code
exchange helper, without forcing a web framework or database model.

## Best For

- OTP onboarding flows backed by Redis
- Google sign-in where the client sends a one-time `authCode`
- Custom auth servers that want primitives instead of a full auth product

## Install

```sh
npm install @crown-dev-studios/simple-auth-server-ts
```

Peer runtime requirements:

- A Redis instance
- A Google OAuth web client if you use `GoogleOAuthService`

## Quick Start

```ts
import {
  createRedisClient,
  OtpService,
  AuthSessionService,
  GoogleOAuthService,
} from '@crown-dev-studios/simple-auth-server-ts'

const redis = createRedisClient({ url: process.env.REDIS_URL })

const otpService = new OtpService(redis, {
  env: 'development',
  bypassCode: '123456',
})

const sessionService = new AuthSessionService(redis)

const googleOAuth = new GoogleOAuthService({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
})
```

## What It Exports

### Redis

- `createRedisClient(options?)`
- `createRedisClientFromConfig(config)`
- `withKeyPrefix(redis, prefix)`
- `type RedisLike`

Example:

```ts
const redis = createRedisClient({
  url: 'redis://localhost:6379',
  keyPrefix: 'myapp:',
})
```

### OTP

Use `OtpService` for email and phone codes with rate limiting and max-attempt
tracking.

```ts
const result = await otpService.generateEmailOtp('user@example.com')

if (result.success) {
  const code = result.data
}
```

Verification returns:

- `RATE_LIMITED`
- `INVALID_CODE`
- `MAX_ATTEMPTS`
- `NOT_FOUND`

In non-production environments, `bypassCode` can replace the random code to make
testing deterministic.

### Sessions

`AuthSessionService` stores onboarding state in Redis.

```ts
const created = await sessionService.createSession('user@example.com')
if (!created.success) throw new Error(created.error)

const sessionToken = created.data

await sessionService.updateSession(sessionToken, (session) => ({
  ...session,
  emailVerified: true,
}))
```

Session records support:

- `email`
- `emailVerified`
- `phoneNumber`
- `phoneVerified`
- `pendingOAuth`
- `existingUserId`

### Google OAuth

`GoogleOAuthService` exchanges a one-time Google auth code for verified user
identity data and optional tokens.

```ts
const exchange = await googleOAuth.exchangeAuthCode(authCode, {
  requiredScopes: ['email', 'profile'],
})

if (exchange.success) {
  const { user, grantedScopes, refreshToken } = exchange.data
}
```

If required scopes are missing, the error is a
`GoogleOAuthMissingScopesError` with `missingScopes` and `grantedScopes`.

## Intended Architecture

This package does not send email, send SMS, mint your JWTs, or persist your user
model. The intended pattern is:

1. Generate and verify OTPs with Redis.
2. Store short-lived onboarding context in sessions.
3. Exchange Google auth codes server-side.
4. Mint your own app tokens once the flow is complete.

## Example App

See `examples/server-ts/index.ts` in this repo for a complete sample with:

- Email OTP request and verify
- Phone OTP request and verify
- Google OAuth returning `authenticated`, `needs_phone`, or `needs_linking`
- Session resume
- Token refresh


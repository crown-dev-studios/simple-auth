# Simple Auth — Server SDKs

This repo includes server-side primitives intended to be app-agnostic:
- Redis-backed OTP (email/phone) with rate limiting and bypass support
- Redis-backed onboarding session store
- Google OAuth auth-code exchange primitive

## TypeScript (Bun/Node)

Package:
- `packages/simple-auth-server-ts`

Modules:
- `redis/` — `createRedisClient`, `withKeyPrefix`
- `otp/` — `OtpService`
- `session/` — `AuthSessionService`
- `oauth/google/` — `GoogleOAuthService`

Example:
- `examples/server-ts/index.ts`

## Python (FastAPI/async)

Package:
- `packages/simple-auth-server-python`

Modules:
- `redis_client.py` — `create_redis_client`, `with_key_prefix`
- `otp.py` — `OtpService`
- `session.py` — `AuthSessionService`
- `oauth_google.py` — `GoogleOAuthService`

Example:
- `examples/server-python/app.py`


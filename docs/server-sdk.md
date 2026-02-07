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

Google exchange API:
- `exchangeAuthCode(authCode, options?)`
  - `options.requiredScopes?: string[]`
  - success payload includes `scope?: string` and `grantedScopes: string[]`
- `revokeToken(token)`

Google exchange notes:
- `redirectUri` is optional; default is to omit it
- only set `redirectUri` if your OAuth client/config requires it (must match exactly)

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

Google exchange API:
- `exchange_auth_code(auth_code, required_scopes=None)`
  - success payload includes `scope` and `grantedScopes`
- `revoke_token(token)`

Example:
- `examples/server-python/app.py`

Development commands (uv):

```sh
uv run --with pytest pytest packages/simple-auth-server-python/tests
uv run --with build python -m build packages/simple-auth-server-python
```

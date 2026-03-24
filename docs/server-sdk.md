# Simple Auth — Server SDKs

Server-side primitives for auth flows. Framework-agnostic, Redis-backed.

- OTP generation and verification (email + phone) with rate limiting
- Onboarding session store with update-via-callback pattern
- Google OAuth auth-code exchange with scope validation

See [Configuration Reference](./configuration.md) for the full config schema.

## Quick Start (TypeScript)

```ts
import {
  createRedisClient,
  OtpService,
  AuthSessionService,
  GoogleOAuthService,
} from '@crown-dev-studios/simple-auth-server-ts'

const redis = createRedisClient({ url: process.env.REDIS_URL })

const otpService = new OtpService(redis, { env: 'development' })
const sessionService = new AuthSessionService(redis)
const googleOAuth = new GoogleOAuthService({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
})
```

## Quick Start (Python)

```python
from simple_auth_server.redis_client import create_redis_client
from simple_auth_server.otp import OtpService
from simple_auth_server.session import AuthSessionService
from simple_auth_server.oauth_google import GoogleOAuthService, GoogleOAuthConfig

redis = create_redis_client()

otp_service = OtpService(redis=redis, env="development")
session_service = AuthSessionService(redis=redis)
google_oauth = GoogleOAuthService(GoogleOAuthConfig(
    client_id="your-client-id",
    client_secret="your-client-secret",
))
```

---

## Redis

### TypeScript

Package: `packages/simple-auth-server-ts`

**`createRedisClient(options?)`** — Create a Redis client backed by ioredis.

```ts
import { createRedisClient } from '@crown-dev-studios/simple-auth-server-ts'

// Defaults to REDIS_URL env var, then redis://localhost:6379
const redis = createRedisClient()

// With explicit URL and key prefix
const redis = createRedisClient({
  url: 'redis://my-host:6379',
  keyPrefix: 'myapp:',
})
```

Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | `REDIS_URL` env var → `redis://localhost:6379` | Redis connection URL. |
| `keyPrefix` | `string` | — | Prefix prepended to every key. |

**`createRedisClientFromConfig(config)`** — Create from a validated `SimpleAuthServerConfig`.

```ts
import { createRedisClientFromConfig } from '@crown-dev-studios/simple-auth-server-ts'

const redis = createRedisClientFromConfig(config)
```

**`withKeyPrefix(redis, prefix)`** — Wrap any `RedisLike` client with a key prefix.

```ts
import { withKeyPrefix } from '@crown-dev-studios/simple-auth-server-ts'

const prefixed = withKeyPrefix(redis, 'auth:')
// prefixed.get('session:abc') actually calls redis.get('auth:session:abc')
```

**`RedisLike` interface** — BYO Redis client by implementing this interface:

```ts
interface RedisLike {
  get(key: string): Promise<string | null>
  setex(key: string, seconds: number, value: string): Promise<unknown>
  del(key: string): Promise<number>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  ttl(key: string): Promise<number>
}
```

### Python

```python
from simple_auth_server.redis_client import create_redis_client, with_key_prefix

# Defaults to redis://localhost:6379
redis = create_redis_client()

# With explicit URL
redis = create_redis_client("redis://my-host:6379")

# Add a key prefix
prefixed = with_key_prefix(redis, "myapp:")
```

The Python `RedisLike` protocol mirrors the TypeScript interface using async methods:

```python
class RedisLike(Protocol):
    async def get(self, key: str) -> Optional[str]: ...
    async def setex(self, key: str, time: int, value: str) -> object: ...
    async def delete(self, key: str) -> int: ...
    async def incr(self, key: str) -> int: ...
    async def expire(self, key: str, time: int) -> bool: ...
    async def ttl(self, key: str) -> int: ...
```

---

## OTP Service

### Constructor (TypeScript)

```ts
import { OtpService } from '@crown-dev-studios/simple-auth-server-ts'

const otpService = new OtpService(redis, {
  env: 'development',
  bypassCode: '123456',        // optional — dev/test only
  ttlSeconds: 300,              // optional — default: 300 (5 min)
  maxAttempts: 5,               // optional — default: 5
  rateLimit: {
    windowSeconds: 60,          // optional — default: 60
    maxRequests: 3,             // optional — default: 3
  },
  keyPrefix: {                  // optional — override Redis key prefixes
    email: 'otp:email:',
    phone: 'otp:phone:',
    rateLimit: 'rate:otp:',
  },
})
```

All options in `OtpServiceOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `env` | `'production' \| 'development' \| 'test'` | — (required) | Controls bypass code guard. |
| `bypassCode` | `string` | — | Fixed OTP for dev/test. Ignored in production. |
| `ttlSeconds` | `number` | `300` | OTP validity window. |
| `maxAttempts` | `number` | `5` | Max incorrect guesses before invalidation. |
| `rateLimit.windowSeconds` | `number` | `60` | Rate limit sliding window. |
| `rateLimit.maxRequests` | `number` | `3` | Max generation requests per window. |
| `keyPrefix.email` | `string` | `otp:email:` | Redis key prefix for email OTPs. |
| `keyPrefix.phone` | `string` | `otp:phone:` | Redis key prefix for phone OTPs. |
| `keyPrefix.rateLimit` | `string` | `rate:otp:` | Redis key prefix for rate limit counters. |

### Generate and verify (TypeScript)

```ts
// Generate
const result = await otpService.generateEmailOtp('user@example.com')
if (result.success) {
  // result.data is the 6-digit code string — send via email/SMS
  await sendEmail(email, result.data)
} else {
  // result.error is an OtpError
  console.error(result.error.code, result.error.message)
}

// Verify
const verify = await otpService.verifyEmailOtp('user@example.com', '123456')
if (verify.success) {
  // OTP valid — proceed with auth flow
} else {
  // verify.error.code is one of: RATE_LIMITED | INVALID_CODE | MAX_ATTEMPTS | NOT_FOUND
  // (expired codes are returned as NOT_FOUND)
}
```

Phone OTP works identically:

```ts
const result = await otpService.generatePhoneOtp('+15551234567')
const verify = await otpService.verifyPhoneOtp('+15551234567', code)
```

### `OtpResult<T>`

```ts
type OtpResult<T> =
  | { success: true; data: T }
  | { success: false; error: OtpError }
```

### `OtpError` discriminated union

```ts
type OtpError =
  | { code: 'RATE_LIMITED'; message: string; retryAfterSeconds: number }
  | { code: 'INVALID_CODE'; message: string; attemptsRemaining: number }
  | { code: 'MAX_ATTEMPTS'; message: string }
  | { code: 'NOT_FOUND'; message: string }
```

### Constructor (Python)

```python
from simple_auth_server.otp import OtpService
from simple_auth_server.config import OtpConfig, OtpRateLimitConfig

otp_service = OtpService(
    redis=redis,
    env="development",
    config=OtpConfig(
        bypass_code="123456",          # optional — dev/test only
        ttl_seconds=300,               # optional — default: 300
        max_attempts=5,                # optional — default: 5
        rate_limit=OtpRateLimitConfig(
            window_seconds=60,         # optional — default: 60
            max_requests=3,            # optional — default: 3
        ),
    ),
)
```

### Generate and verify (Python)

```python
# Generate
ok, result = await otp_service.generate_email_otp("user@example.com")
if ok:
    code = result  # 6-digit string
    await send_email(email, code)
else:
    error = result  # OtpError dict
    print(error["code"], error["message"])

# Verify
ok, error = await otp_service.verify_email_otp("user@example.com", "123456")
if ok:
    pass  # OTP valid
else:
    print(error["code"])  # RATE_LIMITED | INVALID_CODE | MAX_ATTEMPTS | NOT_FOUND (expired → NOT_FOUND)
```

Python `OtpError` is a TypedDict:

```python
class OtpError(TypedDict):
    code: Literal["RATE_LIMITED", "INVALID_CODE", "MAX_ATTEMPTS", "NOT_FOUND"]
    message: str
    retry_after_seconds: NotRequired[int]   # present when RATE_LIMITED
    attempts_remaining: NotRequired[int]     # present when INVALID_CODE
```

---

## Auth Session Service

### Constructor (TypeScript)

```ts
import { AuthSessionService } from '@crown-dev-studios/simple-auth-server-ts'

const sessionService = new AuthSessionService(redis, {
  sessionTtlSeconds: 86400,  // optional — default: 86400 (24 hours)
  keyPrefix: 'auth_session:', // optional — default: 'auth_session:'
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionTtlSeconds` | `number` | `86400` (24h) | How long a session lives in Redis. |
| `keyPrefix` | `string` | `auth_session:` | Redis key prefix for sessions. |

### CRUD (TypeScript)

```ts
// Create — returns a 256-bit hex session ID
const createResult = await sessionService.createSession('user@example.com')
if (createResult.success) {
  const sessionToken = createResult.data // 64-char hex string
}

// Read
const getResult = await sessionService.getSession(sessionToken)
if (getResult.success) {
  const session = getResult.data
  // session.email, session.emailVerified, session.phoneNumber, etc.
}

// Update (callback pattern — read-modify-write with TTL preservation)
await sessionService.updateSession(sessionToken, (session) => ({
  ...session,
  emailVerified: true,
}))

// Delete
await sessionService.deleteSession(sessionToken)
```

### `AuthSession` type

```ts
interface AuthSession {
  email: string
  emailVerified: boolean
  phoneNumber: string | null
  phoneVerified: boolean
  createdAt: number   // ms since epoch
  expiresAt: number   // ms since epoch
  pendingOAuth?: PendingOAuth | null
  existingUserId?: string | null
}
```

### `PendingOAuth` — for storing OAuth data mid-onboarding

When a Google/Apple sign-in resolves to "needs phone" or "needs linking", store the OAuth data
on the session so it's available after the user completes the remaining steps:

```ts
await sessionService.updateSession(sessionToken, (session) => ({
  ...session,
  pendingOAuth: {
    provider: 'google',
    sub: exchangeData.user.sub,
    email: exchangeData.user.email,
    emailVerified: exchangeData.user.emailVerified,
    rawData: exchangeData.user.rawPayload,
    refreshToken: exchangeData.refreshToken,
  },
}))
```

```ts
interface PendingOAuth {
  provider: 'google' | 'apple'
  sub: string
  email: string
  emailVerified?: boolean
  rawData: Record<string, unknown>
  refreshToken?: string
}
```

### `SessionResult<T>`

```ts
type SessionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }
```

### Python

> **Note:** The Python SDK currently provides `create_session`, `get_session`, and `delete_session`.
> An `update_session` method (like the TypeScript callback pattern) is not yet available. Store
> supplementary session fields in your own database or extend the service.

```python
from simple_auth_server.session import AuthSessionService

session_service = AuthSessionService(
    redis=redis,
    session_ttl_seconds=86400,  # optional — default: 86400
)

# Create
session_id = await session_service.create_session("user@example.com")

# Read
session = await session_service.get_session(session_id)
if session:
    print(session["email"], session["emailVerified"])

# Delete
await session_service.delete_session(session_id)
```

---

## Google OAuth Service

### Constructor (TypeScript)

```ts
import { GoogleOAuthService } from '@crown-dev-studios/simple-auth-server-ts'

const googleOAuth = new GoogleOAuthService({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_REDIRECT_URI, // optional
})
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `clientId` | `string` | Yes | Google OAuth Web client ID. |
| `clientSecret` | `string` | Yes | Google OAuth client secret. |
| `redirectUri` | `string` | No | Only needed if your OAuth client requires it. Must match exactly. |

### Exchange auth code (TypeScript)

```ts
const result = await googleOAuth.exchangeAuthCode(authCode, {
  requiredScopes: ['email', 'profile'], // optional — validates granted scopes
})

if (result.success) {
  const { user, refreshToken, accessToken, idToken, grantedScopes } = result.data
  // user.sub, user.email, user.emailVerified, user.firstName, user.lastName
  // user.rawPayload — full Google ID token payload
} else {
  if (result.error instanceof GoogleOAuthMissingScopesError) {
    // result.error.missingScopes — string[]
    // result.error.grantedScopes — string[]
  }
}
```

### `GoogleOAuthExchangeData`

```ts
interface GoogleOAuthExchangeData {
  user: {
    sub: string
    email: string
    emailVerified: boolean
    firstName?: string
    lastName?: string
    rawPayload: Record<string, unknown>
  }
  refreshToken?: string
  accessToken?: string
  idToken: string
  scope?: string
  grantedScopes: string[]
}
```

### Revoke token (TypeScript)

```ts
const revokeResult = await googleOAuth.revokeToken(refreshToken)
if (!revokeResult.success) {
  console.error('Revoke failed:', revokeResult.error.message)
}
```

### Error handling

- `GoogleOAuthMissingScopesError` — returned in the `error` field when `requiredScopes` are not all granted. Import from `@crown-dev-studios/simple-auth-server-ts`. Includes `.missingScopes` and `.grantedScopes` arrays.
- HTTP/network errors from Google are returned as generic `Error` instances in the `error` field.

### Python

```python
from simple_auth_server.oauth_google import GoogleOAuthService, GoogleOAuthConfig

google_oauth = GoogleOAuthService(GoogleOAuthConfig(
    client_id="your-client-id",
    client_secret="your-client-secret",
    redirect_uri=None,  # optional
))

# Exchange
result = await google_oauth.exchange_auth_code(
    auth_code,
    required_scopes=["email", "profile"],  # optional
)
# result is a dict with keys: user, refreshToken, accessToken, idToken, grantedScopes, ...

# Revoke
await google_oauth.revoke_token(refresh_token)
```

---

## Examples

- TypeScript server: [`examples/server-ts/index.ts`](../examples/server-ts/index.ts)
- Python server: [`examples/server-python/app.py`](../examples/server-python/app.py)

## Development

```sh
# TypeScript
pnpm install
pnpm typecheck
pnpm test:unit

# Python
uv run --with pytest pytest packages/simple-auth-server-python/tests
uv run --with build python -m build packages/simple-auth-server-python
```

# Configuration Reference

The server SDKs are configured via `SimpleAuthServerConfig`. The schema is defined in
`@crown-dev-studios/simple-auth-shared-types` (Zod). Python exposes a subset as dataclasses in
`simple_auth_server.config` — provider credentials (e.g. `google.clientId`) are passed separately
to each service (e.g. `GoogleOAuthConfig`), not through the top-level providers object.

## Schema

### Top-level fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `env` | `'production' \| 'development' \| 'test'` | Yes | — | Runtime environment. Controls bypass-code safety guard. |
| `redis` | object | Yes | — | Redis connection settings. |
| `otp` | object | No | See below | OTP generation/verification tuning. |
| `providers` | object | Yes | — | Which auth providers are enabled and their credentials. |

### `redis`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | No | `redis://localhost:6379` | Redis connection URL. Falls back to `REDIS_URL` env var, then localhost. |
| `keyPrefix` | `string` | No | — | Global key prefix applied to every Redis key. |

### `otp`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `ttlSeconds` | `number` (int, > 0) | No | `300` (5 min) | How long an OTP code remains valid. |
| `maxAttempts` | `number` (int, > 0) | No | `5` | Incorrect guesses before the code is invalidated. |
| `rateLimit.windowSeconds` | `number` (int, > 0) | No | `60` | Sliding window for generation rate limiting. |
| `rateLimit.maxRequests` | `number` (int, > 0) | No | `3` | Max OTP generation requests per window per identifier. |
| `bypassCode` | `string` (min 1 char) | No | — | Fixed code returned instead of a random one. **Only active when `env !== 'production'`**. |

### `providers`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `emailOtp.enabled` | `boolean` | No | Enable email OTP provider. |
| `phoneOtp.enabled` | `boolean` | No | Enable phone OTP provider. |
| `google.enabled` | `boolean` | No | Enable Google OAuth. |
| `google.clientId` | `string` | If enabled | Google OAuth **Web** client ID. (TypeScript only; Python uses `GoogleOAuthConfig`.) |
| `google.clientSecret` | `string` | If enabled | Google OAuth client secret. (TypeScript only.) |
| `google.redirectUri` | `string` | No | Only needed if your OAuth client/config requires it. (TypeScript only.) |
| `apple.enabled` | `boolean` | No | Enable Apple Sign-In. (TypeScript schema; Apple not yet implemented in Python.) |
| `apple.clientId` | `string` | If enabled | Apple Services ID. |
| `apple.teamId` | `string` | If enabled | Apple Developer Team ID. |
| `apple.keyId` | `string` | If enabled | Apple Sign-In key ID. |
| `apple.privateKey` | `string` | If enabled | Apple Sign-In private key (PEM). |

## Validating config from env vars (TypeScript)

```ts
import { SimpleAuthServerConfigSchema } from '@crown-dev-studios/simple-auth-shared-types'

const config = SimpleAuthServerConfigSchema.parse({
  env: process.env.APP_ENV ?? 'development',
  redis: {
    url: process.env.REDIS_URL,
    keyPrefix: process.env.REDIS_KEY_PREFIX,
  },
  otp: {
    ttlSeconds: process.env.OTP_TTL_SECONDS ? Number(process.env.OTP_TTL_SECONDS) : undefined,
    maxAttempts: process.env.OTP_MAX_ATTEMPTS ? Number(process.env.OTP_MAX_ATTEMPTS) : undefined,
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
```

## Validating config from env vars (Python)

```python
import os
from simple_auth_server.config import (
    SimpleAuthServerConfig,
    RedisConfig,
    OtpConfig,
    SimpleAuthProvidersConfig,
)

config = SimpleAuthServerConfig(
    env="production" if os.environ.get("APP_ENV") == "production" else "development",
    redis=RedisConfig(url=os.environ.get("REDIS_URL")),
    otp=OtpConfig(
        bypass_code=os.environ.get("AUTH_BYPASS_CODE"),
    ),
    providers=SimpleAuthProvidersConfig(
        email_otp_enabled=True,
        phone_otp_enabled=True,
        google_enabled=bool(os.environ.get("GOOGLE_CLIENT_ID")),
    ),
)
```

## Using config with services

See [Server SDK](./server-sdk.md) for full constructor signatures and usage examples for
`OtpService`, `AuthSessionService`, `GoogleOAuthService`, and Redis client helpers.

## Env var mapping recommendations

| Env Var | Config Path | Notes |
|---------|-------------|-------|
| `APP_ENV` | `env` | `production`, `development`, or `test` |
| `REDIS_URL` | `redis.url` | e.g. `redis://localhost:6379` |
| `REDIS_KEY_PREFIX` | `redis.keyPrefix` | e.g. `myapp:` |
| `OTP_TTL_SECONDS` | `otp.ttlSeconds` | Parse to number |
| `OTP_MAX_ATTEMPTS` | `otp.maxAttempts` | Parse to number |
| `AUTH_BYPASS_CODE` | `otp.bypassCode` | Dev/test only |
| `GOOGLE_CLIENT_ID` | `providers.google.clientId` | Web client ID |
| `GOOGLE_CLIENT_SECRET` | `providers.google.clientSecret` | |
| `GOOGLE_REDIRECT_URI` | `providers.google.redirectUri` | Optional |

## OTP Bypass Code

The bypass code is a fixed string that replaces the randomly generated OTP in non-production
environments. It makes local development and automated testing predictable.

**Safety guarantee:** The bypass code is only used when `env !== 'production'`. In production the
random code path always runs, regardless of whether `bypassCode` is set.

### Usage

```ts
// In development: every OTP request returns "123456"
const otpService = new OtpService(redis, {
  env: 'development',
  bypassCode: '123456',
})
```

### Testing pattern

```ts
// In tests: use a fixed code so assertions are deterministic
const otpService = new OtpService(redis, {
  env: 'test',
  bypassCode: '000000',
})

const result = await otpService.generateEmailOtp('test@example.com')
assert(result.success && result.data === '000000')
```

### Startup warning pattern

Log a warning at startup when the bypass code is active so it's visible in server output:

```ts
function logBypassWarning(config: SimpleAuthServerConfig) {
  if (config.env !== 'production' && config.otp?.bypassCode) {
    console.warn(
      `⚠️  OTP bypass code is active (env=${config.env}). ` +
      `All OTP requests will return the bypass code.`
    )
  }
}

logBypassWarning(config)
```

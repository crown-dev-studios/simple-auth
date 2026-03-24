# @crown-dev-studios/simple-auth-shared-types

Shared Zod schemas and TypeScript types for Simple Auth request and response
contracts. Use this package when your client and server need to agree on auth
payload shapes without duplicating runtime validation logic.

## Best For

- Sharing auth contracts between frontend and backend packages
- Parsing server responses at runtime with Zod
- Keeping OTP, OAuth, and refresh flows type-safe across projects

## Install

```sh
npm install @crown-dev-studios/simple-auth-shared-types zod
```

## What It Exports

- Auth request and response schemas
- Auth error schemas
- Shared common error schemas
- `SimpleAuthServerConfigSchema`

## Example

```ts
import {
  EmailOtpVerifySchema,
  OAuthResponseSchema,
  SimpleAuthServerConfigSchema,
} from '@crown-dev-studios/simple-auth-shared-types'

const verifyPayload = EmailOtpVerifySchema.parse({
  sessionToken: 'session-token',
  email: 'user@example.com',
  code: '123456',
})

const oauthResponse = OAuthResponseSchema.parse(serverJson)

const config = SimpleAuthServerConfigSchema.parse({
  env: 'development',
  redis: {},
  providers: {
    emailOtp: { enabled: true },
    phoneOtp: { enabled: true },
  },
})
```

## Main Contract Areas

### Tokens and Users

- `AuthTokensSchema`
- `AuthUserSchema`
- `AuthUserWithPhoneSchema`
- `RefreshRequestSchema`
- `RefreshResponseSchema`

### OTP Flow

- `EmailOtpRequestSchema`
- `EmailOtpVerifySchema`
- `PhoneOtpRequestSchema`
- `PhoneOtpResendSchema`
- `PhoneOtpVerifySchema`
- `OTP_CODE_LENGTH`
- `E164PhoneRegex`

### OAuth Flow

Includes the discriminated response union for:

- `authenticated`
- `needs_phone`
- `needs_linking`

### Errors

`AuthErrorSchemas` provides central definitions for auth-specific errors such as:

- `INVALID_SESSION`
- `INVALID_CODE`
- `RATE_LIMITED`
- `INVALID_TOKEN`
- `OAUTH_LINKING_REQUIRED`

### Server Config

`SimpleAuthServerConfigSchema` validates the shared server configuration shape:

- `env`
- `redis`
- `otp`
- `providers`

## Why Use This Package

- The same schema can validate both incoming requests and outgoing responses.
- Type inference comes directly from the runtime contract.
- It keeps mobile, web, and server packages aligned as auth flows evolve.


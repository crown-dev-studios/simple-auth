# Simple Auth

Cross-platform auth building blocks:
- Google auth-code sign-in (client gets a one-time `authCode`, server exchanges it)
- Redis-backed OTP + session primitives (server-side)
- Token storage + refresh helpers for mobile clients

## Packages

**React Native / Expo**
- `@crown-dev-studios/simple-auth-react-native` (`packages/simple-auth-react-native`)
  - Token store + token manager
  - Expo config plugin export: `.../plugin`
  - Provider subpath export: `.../google`
- `@crown-dev-studios/google-auth` (`packages/google-auth`)
  - Native module that returns a one-time Google `authCode` for your server to exchange

**Native iOS (SwiftPM)**
- Root `Package.swift` exports:
  - `GoogleAuthNative` (`packages/google-auth-native-ios`) — Google Sign-In wrapper that returns `authCode`
  - `SimpleAuthNative` (`packages/simple-auth-native-ios`) — token store + token manager + small API client

**Server SDKs**
- `@crown-dev-studios/simple-auth-server-ts` (`packages/simple-auth-server-ts`) — Redis OTP/session + Google exchange
- `simple-auth-server` (`packages/simple-auth-server-python`) — Python async equivalent

**Shared contracts**
- `@crown-dev-studios/simple-auth-shared-types` (`packages/shared-types`) — Zod schemas + server config schema

## Typical flow (Google)

1) Client calls Google sign-in and receives `authCode` (one-time).
2) Client sends `authCode` to your app server (e.g. `POST /auth/oauth/google`).
3) Server exchanges `authCode` with Google, finds/creates a user, then mints your own tokens.
4) Client stores tokens and refreshes when needed.

## Examples

- TypeScript server: `examples/server-ts/index.ts`
- Python server: `examples/server-python/app.py`

## Local development

This repo uses `pnpm`.

```sh
pnpm install
pnpm typecheck
```

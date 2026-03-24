# Simple Auth

Cross-platform auth building blocks:
- Google auth-code sign-in (client gets a one-time `authCode`, server exchanges it)
- Redis-backed OTP + session primitives (server-side)
- Token storage + refresh helpers for mobile clients

## Packages

### Server SDKs

**TypeScript (Bun/Node)**

```sh
npm install @crown-dev-studios/simple-auth-server-ts
```

- `@crown-dev-studios/simple-auth-server-ts` (`packages/simple-auth-server-ts`)
  - Redis OTP/session + Google exchange

**Python**

```sh
pip install -e packages/simple-auth-server-python
# or
uv pip install -e packages/simple-auth-server-python
```

- `simple-auth-server` (`packages/simple-auth-server-python`)
  - Async Python equivalent

### React Native / Expo

```sh
npm install @crown-dev-studios/simple-auth-react-native
npm install @crown-dev-studios/google-auth
# peer dependency
npm install expo-secure-store
```

- `@crown-dev-studios/simple-auth-react-native` (`packages/simple-auth-react-native`)
  - Token store + token manager
  - Expo config plugin export: `.../plugin`
  - Provider subpath export: `.../google`
- `@crown-dev-studios/google-auth` (`packages/google-auth`)
  - Native module that returns a one-time Google `authCode` for your server to exchange

### Native iOS (SwiftPM)

Add via `Package.swift` or Xcode → File → Add Package Dependencies, pointing to this repo.

- `GoogleAuthNative` (`packages/google-auth-native-ios`) — Google Sign-In wrapper that returns `authCode`
- `SimpleAuthNative` (`packages/simple-auth-native-ios`) — token store + token manager + API client

### Native Android (Gradle)

Include as local modules in `settings.gradle` (see [Android guide](docs/android-native.md) for setup):

- `google-auth-native-android` (`packages/google-auth-native-android`) — Google auth-code flow
- `simple-auth-native-android` (`packages/simple-auth-native-android`) — token store + token manager + API client

### Shared contracts

```sh
npm install @crown-dev-studios/simple-auth-shared-types
```

- `@crown-dev-studios/simple-auth-shared-types` (`packages/shared-types`) — Zod schemas + server config schema

## Documentation

| Guide | Description |
|-------|-------------|
| [Configuration Reference](docs/configuration.md) | Full `SimpleAuthServerConfig` schema, env var mapping, OTP bypass code |
| [Server SDK](docs/server-sdk.md) | TypeScript + Python usage snippets for every service |
| [React Native Client](docs/react-native.md) | Token manager, authenticated fetch, Google auth integration |
| [Android Native](docs/android-native.md) | Gradle setup, GoogleAuthClient, TokenManager, integration example |
| [Google Auth](docs/google-auth.md) | Google auth-code flow across all platforms |
| [Credentials & Storage](docs/credentials.md) | What to persist in your database, token rotation strategy |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Typical flow (Google)

1) Client calls Google sign-in and receives `authCode` (one-time).
2) Client sends `authCode` to your app server (e.g. `POST /auth/oauth/google`).
3) Server exchanges `authCode` with Google, finds/creates a user, then mints your own tokens.
4) Client stores tokens and refreshes when needed.

## Examples

- **TypeScript server** (`examples/server-ts/index.ts`) — Full auth flow with Hono: email OTP, phone OTP, Google OAuth (3-way response), session resume, token refresh. Uses in-memory stores as DB placeholders.
- **Python server** (`examples/server-python/app.py`) — Equivalent FastAPI server with the same route set.

```sh
# From repo root first (examples use workspace packages)
pnpm install

# TypeScript (requires Redis running)
# Copy examples/server-ts/.env.example to .env and set JWT_SECRET (e.g. openssl rand -base64 32)
cd examples/server-ts && bun install && bun run dev

# Python (requires Redis running)
# Copy examples/server-python/.env.example to .env and set JWT_SECRET
cd examples/server-python && pip install -r requirements.txt && pip install -e ../../packages/simple-auth-server-python && uvicorn app:app
```

## Quick start (build + compile)

```sh
pnpm install
pnpm typecheck   # compile/type-check all packages
pnpm build       # build all packages with a build script
```

Python package build (uv):

```sh
uv run --with build python -m build packages/simple-auth-server-python
```

## Local development

```sh
pnpm test:unit
```

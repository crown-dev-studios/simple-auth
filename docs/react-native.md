# React Native Client Guide

Client-side auth helpers for React Native / Expo apps. Handles token storage, automatic
refresh, and Google auth-code sign-in.

## Installation

```sh
npm install @crown-dev-studios/simple-auth-react-native
# peer dependency
npm install expo-secure-store
```

For Google sign-in:

```sh
npm install @crown-dev-studios/google-auth
```

> **Expo Go is not supported** — the Google auth module requires a custom dev client.
> Run `npx expo prebuild` and use `npx expo run:ios` / `npx expo run:android`.

## Token Manager Setup

```ts
import { createSecureStoreTokenStore } from '@crown-dev-studios/simple-auth-react-native'
import { createSimpleAuthApiClient } from '@crown-dev-studios/simple-auth-react-native'
import { TokenManager } from '@crown-dev-studios/simple-auth-react-native'

const store = createSecureStoreTokenStore('auth_tokens')
const api = createSimpleAuthApiClient({ baseUrl: 'https://api.example.com' })
const tokenManager = new TokenManager(store, api)
```

## Token Manager API

### `getAccessToken(): Promise<string | null>`

Returns the current access token. If the token expires within the refresh leeway window
(default 30 seconds), it automatically refreshes first. Concurrent callers share one
in-flight refresh — no duplicate requests.

```ts
const token = await tokenManager.getAccessToken()
```

### `setTokensFromAuthTokens(tokens: AuthTokens): Promise<void>`

Store tokens from a server auth response. Converts `expiresIn` (seconds) to an absolute
`expiresAt` timestamp.

```ts
// After login/signup, store the tokens from the server response
await tokenManager.setTokensFromAuthTokens(response.tokens)
```

### `clearTokens(): Promise<void>`

Remove all stored tokens (logout).

```ts
await tokenManager.clearTokens()
```

### `refreshTokens(): Promise<StoredTokens>`

Manually trigger a token refresh. Deduplicates concurrent calls.

```ts
const refreshed = await tokenManager.refreshTokens()
```

### `fetchWithAuth(input, init?): Promise<Response>`

Convenience wrapper around `fetch` that injects the `Authorization: Bearer` header and
retries once on 401 after refreshing.

```ts
const response = await tokenManager.fetchWithAuth('https://api.example.com/me')
```

## Authenticated Fetch Pattern

If you prefer a standalone helper over `fetchWithAuth`:

```ts
async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenManager.getAccessToken()
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, { ...init, headers })

  if (response.status === 401) {
    // Try one refresh
    const refreshed = await tokenManager.refreshTokens().catch(() => null)
    if (refreshed) {
      headers.set('Authorization', `Bearer ${refreshed.accessToken}`)
      return fetch(url, { ...init, headers })
    }
  }

  return response
}
```

## Google Auth Integration

### 1. Configure

Call once at app startup (e.g. in your root component or auth context):

```ts
import { configureGoogleAuth } from '@crown-dev-studios/simple-auth-react-native/google'

await configureGoogleAuth({
  iosClientId: 'your-ios-client-id.apps.googleusercontent.com',
  webClientId: 'your-web-client-id.apps.googleusercontent.com',
  scopes: ['openid', 'email', 'profile'], // optional — these are the defaults
})
```

### 2. Sign in

```ts
import { signInWithGoogle } from '@crown-dev-studios/simple-auth-react-native/google'

const { authCode, grantedScopes } = await signInWithGoogle()
```

### 3. Exchange auth code with your server

```ts
import { exchangeGoogleAuthCode } from '@crown-dev-studios/simple-auth-react-native/google'

const result = await exchangeGoogleAuthCode({
  baseUrl: 'https://api.example.com',
  authCode,
})

// result is a discriminated union on 'status':
switch (result.status) {
  case 'authenticated':
    // result.user, result.tokens — store tokens and navigate to home
    await tokenManager.setTokensFromAuthTokens(result.tokens)
    break
  case 'needs_phone':
    // result.sessionToken, result.email, result.flowType
    // Navigate to phone verification screen
    break
  case 'needs_linking':
    // result.sessionToken, result.maskedEmail
    // Navigate to OTP verification for account linking
    break
}
```

## Expo Config Plugin

In your `app.config.ts`:

```ts
export default {
  plugins: [
    [
      '@crown-dev-studios/google-auth/plugin',
      {
        iosClientId: 'your-ios-client-id.apps.googleusercontent.com',
        webClientId: 'your-web-client-id.apps.googleusercontent.com',
      },
    ],
  ],
}
```

Both `iosClientId` and `webClientId` are required. The plugin writes `GIDClientID` and
`GIDServerClientID` to Info.plist for native iOS Google Sign-In.

## Scope Management

After initial sign-in, you can request additional Google scopes:

```ts
import {
  updateGoogleScopes,
  getGoogleGrantedScopes,
  revokeGoogleAccess,
  signOutGoogle,
} from '@crown-dev-studios/simple-auth-react-native/google'

// Request additional scopes (adds to existing)
const result = await updateGoogleScopes({
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  mode: 'add',
})
// result.authCode — exchange with server to get new tokens with expanded scopes
// result.grantedScopes — all currently granted scopes

// Replace scopes entirely (can remove previously granted scopes)
await updateGoogleScopes({
  scopes: ['openid', 'email'],
  mode: 'replace',
})

// Check what scopes are currently granted
const scopes = await getGoogleGrantedScopes()

// Revoke all Google access (removes all scopes, disconnects app)
await revokeGoogleAccess()

// Sign out of Google (preserves granted scopes for next sign-in)
await signOutGoogle()
```

## Custom Token Store

If you don't want to use Expo SecureStore, implement the `TokenStore` interface:

```ts
import type { TokenStore, StoredTokens } from '@crown-dev-studios/simple-auth-react-native'

const myStore: TokenStore = {
  async getTokens(): Promise<StoredTokens | null> {
    // Read from your storage
  },
  async setTokens(tokens: StoredTokens): Promise<void> {
    // Write to your storage
  },
  async clearTokens(): Promise<void> {
    // Delete from your storage
  },
}

const tokenManager = new TokenManager(myStore, api)
```

Or use `createSecureStoreTokenStore` with a custom `SecureStoreAdapter`:

```ts
import { createSecureStoreTokenStore } from '@crown-dev-studios/simple-auth-react-native'

const store = createSecureStoreTokenStore('auth_tokens', {
  getItem: (key) => MyStorage.get(key),
  setItem: (key, value) => MyStorage.set(key, value),
  deleteItem: (key) => MyStorage.delete(key),
})
```

## Custom API Client

If your refresh endpoint differs from the default `POST /auth/refresh`, implement the
`SimpleAuthApiClient` interface:

```ts
import type { SimpleAuthApiClient } from '@crown-dev-studios/simple-auth-react-native'
import type { AuthTokens } from '@crown-dev-studios/simple-auth-shared-types'

const myApiClient: SimpleAuthApiClient = {
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const response = await fetch('https://api.example.com/custom/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: refreshToken }),
    })
    return response.json()
  },
}

const tokenManager = new TokenManager(store, myApiClient)
```

Or use the built-in client with a custom path:

```ts
const api = createSimpleAuthApiClient({
  baseUrl: 'https://api.example.com',
  refreshPath: '/custom/refresh', // default: '/auth/refresh'
})
```

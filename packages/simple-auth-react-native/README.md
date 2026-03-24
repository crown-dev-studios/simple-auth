# @crown-dev-studios/simple-auth-react-native

Client-side auth helpers for React Native and Expo apps using a server-owned auth
flow. This package handles secure token persistence, refresh deduplication, and
Google auth-code exchange helpers for apps built on the Simple Auth response
contracts.

## Best For

- React Native or Expo apps that receive access and refresh tokens from a backend
- Apps using OTP onboarding or Google OAuth with a server-side exchange step
- Teams that want a small token manager instead of a full auth framework

## Install

```sh
npm install @crown-dev-studios/simple-auth-react-native
npm install expo-secure-store
```

For Google sign-in support:

```sh
npm install @crown-dev-studios/google-auth
```

This package includes native dependencies through `expo-secure-store` and the
optional Google auth module. Expo Go is not supported for Google sign-in.

## Token Manager Quick Start

```ts
import {
  createSecureStoreTokenStore,
  createSimpleAuthApiClient,
  TokenManager,
} from '@crown-dev-studios/simple-auth-react-native'

const store = createSecureStoreTokenStore('auth_tokens')
const api = createSimpleAuthApiClient({ baseUrl: 'https://api.example.com' })
const tokenManager = new TokenManager(store, api)
```

## Core API

### `createSecureStoreTokenStore(key)`

Creates a token store backed by Expo Secure Store.

```ts
const store = createSecureStoreTokenStore('auth_tokens')
```

Stored tokens look like:

```ts
type StoredTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
```

### `createSimpleAuthApiClient({ baseUrl, refreshPath? })`

Creates the minimal API client used by `TokenManager`.

```ts
const api = createSimpleAuthApiClient({
  baseUrl: 'https://api.example.com',
  refreshPath: '/auth/refresh',
})
```

### `new TokenManager(store, api, options?)`

Main helper for token lifecycle management.

Useful methods:

- `getAccessToken()`
- `getTokens()`
- `setTokens(tokens)`
- `setTokensFromAuthTokens(tokens)`
- `clearTokens()`
- `refreshTokens()`
- `fetchWithAuth(input, init?)`

Example:

```ts
const token = await tokenManager.getAccessToken()

await tokenManager.setTokensFromAuthTokens({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 900,
})
```

`TokenManager` automatically:

- Refreshes shortly before expiry
- Deduplicates concurrent refresh calls
- Clears invalid refresh tokens
- Retries one `401` response in `fetchWithAuth`

## Google Auth Helpers

Import Google helpers from the `/google` entrypoint:

```ts
import {
  configureGoogleAuth,
  signInWithGoogle,
  exchangeGoogleAuthCode,
} from '@crown-dev-studios/simple-auth-react-native/google'

await configureGoogleAuth({
  iosClientId: 'your-ios-client-id.apps.googleusercontent.com',
  webClientId: 'your-web-client-id.apps.googleusercontent.com',
})

const { authCode } = await signInWithGoogle()

const result = await exchangeGoogleAuthCode({
  baseUrl: 'https://api.example.com',
  authCode,
})
```

`exchangeGoogleAuthCode` expects your server to return the shared Simple Auth
OAuth response union:

- `status: 'authenticated'`
- `status: 'needs_phone'`
- `status: 'needs_linking'`

## Common Pattern

```ts
switch (result.status) {
  case 'authenticated':
    await tokenManager.setTokensFromAuthTokens(result.tokens)
    break
  case 'needs_phone':
    // Continue onboarding with result.sessionToken
    break
  case 'needs_linking':
    // Continue account-linking flow
    break
}
```

## Notes

- This package assumes your backend owns token minting and refresh.
- It is storage and transport glue, not a UI kit.
- If you are not using the Simple Auth response contracts, you can still use the
  token store and `TokenManager` with your own refresh client.


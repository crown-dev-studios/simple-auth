# @crown-dev-studios/google-auth

React Native Google sign-in that returns a one-time server `authCode` instead of
doing token exchange on-device. Use this when your backend owns Google OAuth and
your mobile app only needs to start the flow and hand the code to your server.

## What It Includes

- Native Google auth-code sign-in for iOS and Android
- Scope management helpers for incremental consent flows
- Expo config plugin for wiring the native setup in prebuilt apps
- A small JS API surface with no opinion about your backend

## Install

```sh
npm install @crown-dev-studios/google-auth
```

Peer dependency:

```sh
npm install react-native
```

If you are using Expo, use a custom dev client or a prebuilt app. Expo Go is not
supported because this package ships native code.

## Quick Start

```ts
import {
  configureGoogleAuth,
  signInWithGoogle,
} from '@crown-dev-studios/google-auth'

await configureGoogleAuth({
  iosClientId: 'your-ios-client-id.apps.googleusercontent.com',
  webClientId: 'your-web-client-id.apps.googleusercontent.com',
  scopes: ['openid', 'email', 'profile'],
})

const { authCode, grantedScopes } = await signInWithGoogle()
// Send authCode to your server for exchange.
```

## API

### `configureGoogleAuth(config)`

Configures the native Google SDKs.

```ts
await configureGoogleAuth({
  iosClientId: 'ios-client-id',
  webClientId: 'web-client-id',
  scopes: ['openid', 'email', 'profile'],
})
```

Notes:

- `webClientId` is always required.
- `iosClientId` is required on iOS.
- If `scopes` is omitted, the default is `['openid', 'email', 'profile']`.

### `signInWithGoogle()`

Starts Google sign-in and resolves to:

```ts
type GoogleAuthResult = {
  authCode: string
  grantedScopes: string[]
}
```

### `updateGoogleScopes(request)`

Requests additional scopes or replaces the previously granted set.

```ts
import { updateGoogleScopes } from '@crown-dev-studios/google-auth'

await updateGoogleScopes({
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  mode: 'add',
})
```

`mode`:

- `'add'` adds new scopes to the current session
- `'replace'` replaces the current set

### `getGoogleGrantedScopes()`

Returns the scopes currently known to be granted for the active session.

### `revokeGoogleAccess()`

Disconnects the app from the Google account and revokes the granted access.

### `signOutGoogle()`

Signs out locally without necessarily revoking previously granted access.

## Expo Config Plugin

Add the plugin in `app.config.ts` or `app.json`:

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

The plugin requires both `iosClientId` and `webClientId`. If either is missing,
native Google Sign-In configuration is skipped.

## Typical Use Case

1. Configure the package at app startup.
2. Call `signInWithGoogle()`.
3. Post the returned `authCode` to your backend.
4. Exchange the code server-side and continue your auth flow.

This package intentionally does not store access tokens or refresh tokens for you.


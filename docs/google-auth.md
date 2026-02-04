# Simple Auth — Google auth-code flow

This repo contains an extracted Google auth-code flow that returns a one-time `serverAuthCode` (aka `authCode`) for your application server to exchange.

## React Native (Expo / Bare)

### JS API

React Native bridge package:
- `@crown-dev-studios/google-auth`

- `configureGoogleAuth({ iosClientId, webClientId, scopes? })`
- `signInWithGoogle() -> { authCode }`
- `signOutGoogle()`

### Expo config plugin (iOS)

Expo config plugin:
- `@crown-dev-studios/google-auth/plugin` (CJS)
- `@crown-dev-studios/google-auth/app.plugin.js`

It sets:
- `GIDClientID`
- `GIDServerClientID`
- iOS URL scheme (`CFBundleURLTypes`) for the reversed client ID.

## Native iOS (SwiftPM)

SwiftPM entrypoint is at repo root `Package.swift`.

Library:
- `GoogleAuthNative`

API:
- `GoogleAuthClient.configure(GoogleAuthConfiguration(...))`
- `GoogleAuthClient.signIn(presentingViewController:) -> String` (returns auth code)
- `GoogleAuthClient.signOut()`

Sources:
- `packages/google-auth-native-ios/Sources/GoogleAuthNative`

## Native Android (Gradle module)

Pure native SDK module:
- `packages/google-auth-native-android`

API:
- `GoogleAuthClient.configure(GoogleAuthConfig(...))`
- `beginSignIn(activity)` → `Completed(authCode)` or `RequiresResolution(intentSenderRequest)`
- `completeSignIn(resultCode, data)` → `authCode`
- `signOut()`

Repo-local build integration:
- Add `packages/google-auth-native-android` as a Gradle module in your app (via `settings.gradle`) and depend on it.

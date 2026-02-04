# Simple Auth — Google auth-code flow

This repo contains an extracted Google auth-code flow that returns a one-time `serverAuthCode` (aka `authCode`) for your application server to exchange.

## Integration checklist (must match on both sides)

1) **iOS client uses two IDs**
- `iosClientId` = your **iOS** OAuth client ID
- `webClientId` = your **Web** OAuth client ID (used as `serverClientID` to obtain `serverAuthCode`)

2) **Server exchanges using the same Web client**
- `clientId` = the same **Web** client ID used above
- `clientSecret` = the secret for that Web client

3) **Redirect URI**
- Default: **omit** `redirectUri`
- Only set `redirectUri` when your OAuth client/config requires it

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

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `invalid_grant` on server exchange | wrong client secret, wrong client-id pairing, reused/expired code, redirect mismatch | verify Web client id/secret pairing and whether redirectUri must be set |
| `redirect_uri_mismatch` | redirect URI configured incorrectly | set `redirectUri` to the exact value required by the OAuth client, or omit it if not required |
| iOS returns `auth_code_failed` / missing auth code | GoogleSignIn config issue | verify `webClientId` is a **Web** client id and `GIDServerClientID` is set |

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

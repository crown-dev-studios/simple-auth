# Simple Auth — Troubleshooting

## “native module is not installed” (Expo Go)

`@crown-dev-studios/google-auth` requires a development build. Expo Go cannot load custom native modules.

## iOS: Google sign-in returns missing auth code

If sign-in completes but `serverAuthCode` is empty, double-check:
- you configured the correct **Web Client ID** (`webClientId`)
- the iOS app bundle is authorized in Google Console
- the reversed client ID URL scheme exists in `Info.plist` (Expo plugin should set it)

## Server: Google code exchange fails (invalid_grant / redirect_uri_mismatch)

If your server exchange fails with `invalid_grant` or `redirect_uri_mismatch`, the most common causes are:
- wrong **Web client** `clientId` or wrong `clientSecret`
- iOS using the wrong `webClientId` (must be a **Web** OAuth client ID used as `serverClientID`)
- an `authCode` that was already exchanged (auth codes are one-time use) or has expired
- redirect URI mismatch (only set `redirectUri` when required, and it must match exactly)

## Android: Gradle build fails with “Unable to locate a Java Runtime”

Gradle requires a JDK installed and discoverable via `JAVA_HOME` (or system Java).

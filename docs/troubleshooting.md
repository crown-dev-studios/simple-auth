# Simple Auth — Troubleshooting

## “native module is not installed” (Expo Go)

`@crown-dev-studios/google-auth` requires a development build. Expo Go cannot load custom native modules.

## iOS: Google sign-in returns missing auth code

If sign-in completes but `serverAuthCode` is empty, double-check:
- you configured the correct **Web Client ID** (`webClientId`)
- the iOS app bundle is authorized in Google Console
- the reversed client ID URL scheme exists in `Info.plist` (Expo plugin should set it)

## Android: Gradle build fails with “Unable to locate a Java Runtime”

Gradle requires a JDK installed and discoverable via `JAVA_HOME` (or system Java).

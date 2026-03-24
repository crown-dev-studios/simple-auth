# google-auth-native-android

Pure Kotlin Google auth-code sign-in for native Android apps. This module starts
Google Sign-In, returns a one-time server auth code, and supports incremental
scope updates without any React Native dependency.

## Best For

- Native Android apps with a backend-owned Google OAuth exchange
- Apps that want Kotlin-first Google auth helpers
- Projects using Activity Result APIs and coroutines

## Add to Your Project

Include the module in `settings.gradle`:

```groovy
include ':google-auth-native-android'
project(':google-auth-native-android').projectDir =
    file('../simple-auth/packages/google-auth-native-android')
```

Then add the dependency:

```groovy
dependencies {
    implementation project(':google-auth-native-android')
}
```

Requirements:

- Min SDK 24
- Kotlin 1.9.24+
- Compile SDK 34

## Quick Start

```kotlin
val googleAuthClient = GoogleAuthClient(applicationContext)

googleAuthClient.configure(
    GoogleAuthConfig(
        webClientId = "your-web-client-id.apps.googleusercontent.com",
        scopes = listOf("openid", "email", "profile"),
    )
)
```

Start sign-in:

```kotlin
when (val step = googleAuthClient.beginSignIn(activity)) {
    is GoogleAuthSignInStep.Completed -> {
        val authCode = step.result.authCode
    }
    is GoogleAuthSignInStep.RequiresResolution -> {
        launcher.launch(step.intentSenderRequest)
    }
}
```

Complete sign-in from your Activity Result callback:

```kotlin
val result = googleAuthClient.completeSignIn(resultCode, data)
```

## Main API

- `GoogleAuthClient`
- `GoogleAuthConfig`
- `GoogleAuthResult`
- `GoogleAuthSignInStep`
- `GoogleAuthScopeMode`
- `GoogleAuthException`
- `GoogleAuthErrorCode`

## Scope Management

```kotlin
googleAuthClient.updateScopes(
    activity = activity,
    scopes = listOf("https://www.googleapis.com/auth/calendar.readonly"),
    mode = GoogleAuthScopeMode.ADD,
)
```

Other helpers:

- `getGrantedScopes()`
- `revokeAccess()`
- `signOut()`

## Error Codes

- `CONFIG_ERROR`
- `SIGN_IN_IN_PROGRESS`
- `SIGN_IN_TIMEOUT`
- `SIGN_IN_CANCELED`
- `ACTIVITY_ERROR`
- `AUTH_CODE_FAILED`
- `SIGN_IN_FAILED`
- `NOT_SIGNED_IN`
- `NO_SCOPE_CHANGE_REQUIRED`
- `REVOKE_FAILED`
- `SIGN_OUT_FAILED`

## Intended Flow

1. Configure the client once.
2. Start sign-in with `beginSignIn(activity)`.
3. Handle any required resolution UI.
4. Send the resulting `authCode` to your backend for exchange.


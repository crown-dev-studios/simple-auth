# simple-auth-native-android

Pure Kotlin client helpers for native Android apps using a server-owned auth
flow. This module provides encrypted token storage, token refresh management, and
an API client for refresh and Google auth-code exchange endpoints.

## Best For

- Native Android apps receiving app tokens from a backend
- Apps using Google auth-code exchange with follow-up onboarding steps
- Teams that want lightweight auth primitives without a full Android auth stack

## Add to Your Project

Include the module in `settings.gradle`:

```groovy
include ':simple-auth-native-android'
project(':simple-auth-native-android').projectDir =
    file('../simple-auth/packages/simple-auth-native-android')
```

Then add the dependency:

```groovy
dependencies {
    implementation project(':simple-auth-native-android')
}
```

Requirements:

- Min SDK 24
- Kotlin 1.9.24+
- Compile SDK 34

## Quick Start

```kotlin
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

val tokenStore = EncryptedSharedPreferencesTokenStore(applicationContext)
val apiClient = SimpleAuthApiClient(baseUrl = "https://api.example.com")
val tokenManager = TokenManager(store = tokenStore, api = apiClient)

lifecycleScope.launch {
    val token = tokenManager.getAccessToken()
}
```

## Main Components

### `EncryptedSharedPreferencesTokenStore`

Encrypted on-device token persistence using `EncryptedSharedPreferences`.

```kotlin
val store = EncryptedSharedPreferencesTokenStore(
    context = applicationContext,
    prefsName = "simple_auth_secure_store",
    key = "tokens",
)
```

### `SimpleAuthApiClient`

Calls your auth server for refresh and Google auth-code exchange.

```kotlin
val api = SimpleAuthApiClient(
    baseUrl = "https://api.example.com",
    refreshPath = "/auth/refresh",
    googleOAuthPath = "/auth/oauth/google",
)
```

### `TokenManager`

Handles token refresh, expiry checks, and refresh deduplication.

Useful methods:

- `getAccessToken()`
- `setTokens(tokens)`
- `setTokensFromResponse(tokens)`
- `clearTokens()`
- `refreshTokens()`

Example:

```kotlin
lifecycleScope.launch {
    val token = tokenManager.getAccessToken()
}
```

`getAccessToken()`, `setTokens(...)`, `setTokensFromResponse(...)`, `clearTokens()`,
and `refreshTokens()` are suspend APIs and must be called from a coroutine.

## OAuth Response Shapes

`exchangeGoogleAuthCode(authCode)` returns one of:

- `OAuthResponse.Authenticated`
- `OAuthResponse.NeedsPhone`
- `OAuthResponse.NeedsLinking`

That lets your app either store tokens immediately or continue the server-driven
onboarding flow with the returned `sessionToken`.

## Typical Flow

1. Use `google-auth-native-android` to obtain a Google `authCode`.
2. Call `apiClient.exchangeGoogleAuthCode(authCode)`.
3. If authenticated, store returned tokens with `tokenManager`.
4. Otherwise continue onboarding using the returned session data.

## Notes

- Invalid refresh tokens are cleared from storage.
- Refresh requests are deduplicated across concurrent callers.
- This module assumes your backend follows the Simple Auth JSON response contracts.

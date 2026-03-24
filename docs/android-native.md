# Android Native Guide

Pure Kotlin auth components for native Android apps. No React Native dependency.

## Gradle Setup

### `settings.gradle`

Include the library modules from wherever you've placed them (local path, git submodule, etc.):

```groovy
include ':google-auth-native-android'
project(':google-auth-native-android').projectDir = file('../simple-auth/packages/google-auth-native-android')

include ':simple-auth-native-android'
project(':simple-auth-native-android').projectDir = file('../simple-auth/packages/simple-auth-native-android')
```

### `app/build.gradle`

```groovy
android {
    compileSdk 34

    defaultConfig {
        minSdk 24
    }
}

dependencies {
    implementation project(':google-auth-native-android')
    implementation project(':simple-auth-native-android')
}
```

**Requirements:**
- Min SDK: 24
- Kotlin: 1.9.24+
- Compile SDK: 34

---

## Google Auth (`GoogleAuthClient`)

### Configure

```kotlin
import dev.crown.simpleauth.googleauth.GoogleAuthClient
import dev.crown.simpleauth.googleauth.GoogleAuthConfig

val googleAuthClient = GoogleAuthClient(applicationContext)

googleAuthClient.configure(GoogleAuthConfig(
    webClientId = "your-web-client-id.apps.googleusercontent.com",
    scopes = listOf("openid", "email", "profile"), // optional — these are the defaults
))
```

### Sign in

Sign-in is a two-step process because Google may require user interaction via an Activity
result. Most SDK methods are `suspend` and must be called from a coroutine:

```kotlin
import dev.crown.simpleauth.googleauth.GoogleAuthSignInStep

lifecycleScope.launch {
    when (val step = googleAuthClient.beginSignIn(activity)) {
        is GoogleAuthSignInStep.Completed -> {
        // No user interaction needed — authCode is ready
            val authCode = step.result.authCode
            val grantedScopes = step.result.grantedScopes
        }
        is GoogleAuthSignInStep.RequiresResolution -> {
            // Launch the Google consent UI
            activityResultLauncher.launch(step.intentSenderRequest)
        }
    }
}
```

### Handle Activity result

```kotlin
val activityResultLauncher = registerForActivityResult(
    ActivityResultContracts.StartIntentSenderForResult()
) { result ->
    lifecycleScope.launch {
        try {
            val authResult = googleAuthClient.completeSignIn(result.resultCode, result.data)
            // authResult.authCode — send to your server
            // authResult.grantedScopes — scopes the user granted
        } catch (e: GoogleAuthException) {
            // Handle error (see error codes below)
        }
    }
}
```

### Scope management

```kotlin
import dev.crown.simpleauth.googleauth.GoogleAuthScopeMode

lifecycleScope.launch {
    // Request additional scopes (adds to existing)
    val step = googleAuthClient.updateScopes(
        activity = activity,
        scopes = listOf("https://www.googleapis.com/auth/calendar.readonly"),
        mode = GoogleAuthScopeMode.ADD,
    )
    // Handle the step the same way as beginSignIn

    // Replace scopes (can remove previously granted)
    googleAuthClient.updateScopes(
        activity = activity,
        scopes = listOf("openid", "email"),
        mode = GoogleAuthScopeMode.REPLACE,
    )

    // Check currently granted scopes
    val scopes = googleAuthClient.getGrantedScopes()

    // Revoke all access
    googleAuthClient.revokeAccess()

    // Sign out (preserves granted scopes for next sign-in)
    googleAuthClient.signOut()
}
```

### Error codes

| Code | Description |
|------|-------------|
| `CONFIG_ERROR` | `configure()` not called or `webClientId` blank. |
| `SIGN_IN_IN_PROGRESS` | Another sign-in is already running. |
| `SIGN_IN_TIMEOUT` | Sign-in took longer than 60 seconds. |
| `SIGN_IN_CANCELED` | User dismissed the consent UI. |
| `ACTIVITY_ERROR` | Activity is finishing or null. |
| `AUTH_CODE_FAILED` | Google returned no server auth code. |
| `SIGN_IN_FAILED` | General sign-in failure. |
| `NOT_SIGNED_IN` | `updateScopes` called with no active session. |
| `NO_SCOPE_CHANGE_REQUIRED` | Requested scopes already match granted scopes. |
| `REVOKE_FAILED` | Failed to revoke Google access. |
| `SIGN_OUT_FAILED` | Failed to clear credentials. |

All errors are thrown as `GoogleAuthException(errorCode, message, cause?)`.

---

## Token Storage (`EncryptedSharedPreferencesTokenStore`)

Encrypted on-device token storage using Android's `EncryptedSharedPreferences` with
AES-256-GCM encryption.

```kotlin
import dev.crown.simpleauth.native.EncryptedSharedPreferencesTokenStore

val tokenStore = EncryptedSharedPreferencesTokenStore(
    context = applicationContext,
    prefsName = "simple_auth_secure_store",  // optional — default shown
    key = "tokens",                           // optional — default shown
)
```

### `TokenStore` interface

Implement this for custom storage backends:

```kotlin
import dev.crown.simpleauth.native.TokenStore
import dev.crown.simpleauth.native.StoredTokens

class MyTokenStore : TokenStore {
    override suspend fun getTokens(): StoredTokens? { /* ... */ }
    override suspend fun setTokens(tokens: StoredTokens) { /* ... */ }
    override suspend fun clearTokens() { /* ... */ }
}
```

### `StoredTokens`

```kotlin
data class StoredTokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMs: Long,  // absolute milliseconds since epoch
)
```

---

## API Client (`SimpleAuthApiClient`)

HTTP client for calling your auth server. Uses OkHttp.

```kotlin
import dev.crown.simpleauth.native.SimpleAuthApiClient

val apiClient = SimpleAuthApiClient(
    baseUrl = "https://api.example.com",
    okHttpClient = OkHttpClient(),          // optional — custom client
    refreshPath = "/auth/refresh",          // optional — default shown
    googleOAuthPath = "/auth/oauth/google", // optional — default shown
)
```

### `refresh(refreshToken)`

```kotlin
lifecycleScope.launch {
    val tokens: AuthTokensResponse = apiClient.refresh(refreshToken)
    // tokens.accessToken, tokens.refreshToken, tokens.expiresIn
}
```

### `exchangeGoogleAuthCode(authCode)`

```kotlin
import dev.crown.simpleauth.native.OAuthResponse

lifecycleScope.launch {
    when (val response = apiClient.exchangeGoogleAuthCode(authCode)) {
        is OAuthResponse.Authenticated -> {
            // response.user.id, response.user.email
            // response.tokens — store and navigate to home
        }
        is OAuthResponse.NeedsPhone -> {
            // response.sessionToken, response.email, response.flowType, response.maskedPhone
            // Navigate to phone verification
        }
        is OAuthResponse.NeedsLinking -> {
            // response.sessionToken, response.maskedEmail
            // Navigate to OTP linking verification
        }
    }
}
```

### `OAuthResponse` sealed interface

```kotlin
sealed interface OAuthResponse {
    data class Authenticated(val user: SimpleAuthUser, val tokens: AuthTokensResponse) : OAuthResponse
    data class NeedsPhone(val sessionToken: String, val email: String, val flowType: String, val maskedPhone: String?) : OAuthResponse
    data class NeedsLinking(val sessionToken: String, val maskedEmail: String) : OAuthResponse
}
```

---

## Token Manager

Manages token lifecycle with automatic refresh and deduplication.

```kotlin
import dev.crown.simpleauth.native.TokenManager

val tokenManager = TokenManager(
    store = tokenStore,
    api = apiClient,
    refreshLeewaySeconds = 30,  // optional — default: 30
)
```

### `getAccessToken(): String?`

Returns the current access token. Automatically refreshes if the token expires within
the leeway window. Returns `null` if no tokens are stored. Must be called from a coroutine.

```kotlin
lifecycleScope.launch {
    val token = tokenManager.getAccessToken()
}
```

### `setTokensFromResponse(tokens)`

Store tokens from a server auth response. Converts `expiresIn` (seconds) to an absolute
`expiresAtMs` timestamp. Must be called from a coroutine.

```kotlin
lifecycleScope.launch {
    tokenManager.setTokensFromResponse(response.tokens)
}
```

### `clearTokens()`

Remove all stored tokens (logout). Must be called from a coroutine.

```kotlin
lifecycleScope.launch {
    tokenManager.clearTokens()
}
```

### `refreshTokens(): StoredTokens`

Manually trigger a refresh. Concurrent callers share one in-flight request. Must be called from a coroutine.

```kotlin
lifecycleScope.launch {
    val refreshed = tokenManager.refreshTokens()
}
```

---

## Integration Example

Minimal Activity showing the full Google sign-in flow:

```kotlin
class AuthActivity : AppCompatActivity() {
    private lateinit var googleAuthClient: GoogleAuthClient
    private lateinit var tokenManager: TokenManager
    private lateinit var apiClient: SimpleAuthApiClient

    private val signInLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        lifecycleScope.launch {
            try {
                val authResult = googleAuthClient.completeSignIn(result.resultCode, result.data)
                handleAuthCode(authResult.authCode)
            } catch (e: GoogleAuthException) {
                showError(e.message ?: "Sign-in failed")
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        googleAuthClient = GoogleAuthClient(this)
        googleAuthClient.configure(GoogleAuthConfig(
            webClientId = "your-web-client-id.apps.googleusercontent.com",
        ))

        val tokenStore = EncryptedSharedPreferencesTokenStore(this)
        apiClient = SimpleAuthApiClient(baseUrl = "https://api.example.com")
        tokenManager = TokenManager(store = tokenStore, api = apiClient)

        // Trigger sign-in (e.g., on button click)
        findViewById<Button>(R.id.signInButton).setOnClickListener {
            lifecycleScope.launch { startSignIn() }
        }
    }

    private suspend fun startSignIn() {
        try {
            when (val step = googleAuthClient.beginSignIn(this)) {
                is GoogleAuthSignInStep.Completed -> handleAuthCode(step.result.authCode)
                is GoogleAuthSignInStep.RequiresResolution -> signInLauncher.launch(step.intentSenderRequest)
            }
        } catch (e: GoogleAuthException) {
            showError(e.message ?: "Sign-in failed")
        }
    }

    private suspend fun handleAuthCode(authCode: String) {
        when (val response = apiClient.exchangeGoogleAuthCode(authCode)) {
            is OAuthResponse.Authenticated -> {
                tokenManager.setTokensFromResponse(response.tokens)
                // Navigate to home
            }
            is OAuthResponse.NeedsPhone -> {
                // Navigate to phone verification with response.sessionToken
            }
            is OAuthResponse.NeedsLinking -> {
                // Navigate to OTP linking with response.sessionToken
            }
        }
    }

    private fun showError(message: String) {
        // Show error to user
    }
}
```

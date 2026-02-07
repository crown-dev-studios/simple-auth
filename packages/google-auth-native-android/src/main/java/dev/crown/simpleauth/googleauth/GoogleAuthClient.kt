package dev.crown.simpleauth.googleauth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.result.IntentSenderRequest
import androidx.core.content.ContextCompat
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialStateException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.gms.auth.api.identity.AuthorizationClient
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

private const val DEFAULT_SIGN_IN_TIMEOUT_MS = 60_000L
private const val SIGN_OUT_TIMEOUT_MS = 10_000L

data class GoogleAuthConfig(
    val webClientId: String,
    val scopes: List<String> = listOf("openid", "email", "profile"),
)

enum class GoogleAuthScopeMode {
    ADD,
    REPLACE,
}

data class GoogleAuthResult(
    val authCode: String,
    val grantedScopes: List<String>,
)

sealed interface GoogleAuthSignInStep {
    data class Completed(val result: GoogleAuthResult) : GoogleAuthSignInStep
    data class RequiresResolution(val intentSenderRequest: IntentSenderRequest) : GoogleAuthSignInStep
}

enum class GoogleAuthErrorCode(val code: String) {
    CONFIG_ERROR("config_error"),
    SIGN_IN_IN_PROGRESS("sign_in_in_progress"),
    SIGN_IN_TIMEOUT("sign_in_timeout"),
    SIGN_IN_CANCELED("sign_in_canceled"),
    ACTIVITY_ERROR("activity_error"),
    AUTH_CODE_FAILED("auth_code_failed"),
    SIGN_IN_FAILED("sign_in_failed"),
    NOT_SIGNED_IN("not_signed_in"),
    NO_SCOPE_CHANGE_REQUIRED("no_scope_change_required"),
    REVOKE_FAILED("revoke_failed"),
    SIGN_OUT_FAILED("sign_out_failed"),
}

class GoogleAuthException(
    val errorCode: GoogleAuthErrorCode,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * Pure native Google auth-code flow (no React Native dependency).
 */
class GoogleAuthClient(context: Context) {
    private val appContext = context.applicationContext
    private val credentialManager = CredentialManager.create(appContext)
    private val authorizationClient: AuthorizationClient = Identity.getAuthorizationClient(appContext)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var config: GoogleAuthConfig? = null

    private var signInStartedAtMs: Long? = null
    private var signInTimeoutRunnable: Runnable? = null
    private var lastTimedOutAtMs: Long? = null

    private var cachedGrantedScopes: List<String> = emptyList()
    private var pendingRequestedScopes: List<String> = emptyList()
    private var pendingMode: GoogleAuthScopeMode = GoogleAuthScopeMode.REPLACE

    fun configure(config: GoogleAuthConfig) {
        if (config.webClientId.isBlank()) {
            throw GoogleAuthException(GoogleAuthErrorCode.CONFIG_ERROR, "webClientId is required")
        }

        this.config = GoogleAuthConfig(
            webClientId = config.webClientId,
            scopes = normalizeScopes(config.scopes),
        )
    }

    fun getGrantedScopes(): List<String> {
        return cachedGrantedScopes
    }

    suspend fun beginSignIn(activity: Activity): GoogleAuthSignInStep {
        val authConfig = config
            ?: throw GoogleAuthException(GoogleAuthErrorCode.CONFIG_ERROR, "Google auth not configured")

        return startSignIn(
            activity = activity,
            requestedScopes = authConfig.scopes,
            mode = GoogleAuthScopeMode.REPLACE,
        )
    }

    suspend fun updateScopes(
        activity: Activity,
        scopes: List<String>,
        mode: GoogleAuthScopeMode,
    ): GoogleAuthSignInStep {
        val authConfig = config
            ?: throw GoogleAuthException(GoogleAuthErrorCode.CONFIG_ERROR, "Google auth not configured")

        if (cachedGrantedScopes.isEmpty()) {
            throw GoogleAuthException(GoogleAuthErrorCode.NOT_SIGNED_IN, "No Google session available")
        }

        val normalizedTarget = normalizeScopes(scopes)
        val current = cachedGrantedScopes
        val currentSet = current.toSet()
        val targetSet = normalizedTarget.toSet()

        val requestedScopes = when (mode) {
            GoogleAuthScopeMode.ADD -> {
                val toAdd = normalizedTarget.filterNot { currentSet.contains(it) }
                if (toAdd.isEmpty()) {
                    throw GoogleAuthException(
                        GoogleAuthErrorCode.NO_SCOPE_CHANGE_REQUIRED,
                        "Requested scopes are already granted",
                    )
                }
                toAdd
            }

            GoogleAuthScopeMode.REPLACE -> {
                if (targetSet == currentSet) {
                    throw GoogleAuthException(
                        GoogleAuthErrorCode.NO_SCOPE_CHANGE_REQUIRED,
                        "Requested scopes match current granted scopes",
                    )
                }

                val hasRemovals = !currentSet.all { targetSet.contains(it) }
                if (hasRemovals) {
                    revokeAccess()
                }
                normalizedTarget
            }
        }

        // If caller passes empty list in replace mode, fall back to configured baseline scopes.
        val finalRequested = if (requestedScopes.isEmpty()) authConfig.scopes else requestedScopes

        return startSignIn(
            activity = activity,
            requestedScopes = finalRequested,
            mode = mode,
        )
    }

    suspend fun completeSignIn(resultCode: Int, data: Intent?): GoogleAuthResult {
        val startedAtMs = signInStartedAtMs
        if (startedAtMs == null) {
            val timedOutRecently = lastTimedOutAtMs?.let { SystemClock.elapsedRealtime() - it <= DEFAULT_SIGN_IN_TIMEOUT_MS }
                ?: false
            if (timedOutRecently) {
                throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_TIMEOUT, "Google sign-in timed out")
            }
            throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_FAILED, "No Google sign-in in progress")
        }

        val elapsedMs = SystemClock.elapsedRealtime() - startedAtMs
        if (elapsedMs > DEFAULT_SIGN_IN_TIMEOUT_MS) {
            clearSignInState()
            lastTimedOutAtMs = SystemClock.elapsedRealtime()
            throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_TIMEOUT, "Google sign-in timed out")
        }

        if (resultCode != Activity.RESULT_OK) {
            clearSignInState()
            throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_CANCELED, "Google sign-in canceled")
        }

        if (data == null) {
            clearSignInState()
            throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_CANCELED, "Google sign-in canceled")
        }

        return try {
            val result = authorizationClient.getAuthorizationResultFromIntent(data)
            val authCode = result.serverAuthCode
            if (authCode.isNullOrBlank()) {
                throw GoogleAuthException(GoogleAuthErrorCode.AUTH_CODE_FAILED, "Missing server auth code")
            }

            val fallback = when (pendingMode) {
                GoogleAuthScopeMode.ADD -> normalizeScopes(cachedGrantedScopes + pendingRequestedScopes)
                GoogleAuthScopeMode.REPLACE -> normalizeScopes(pendingRequestedScopes)
            }
            val grantedScopes = extractGrantedScopes(result, fallback)

            val authResult = GoogleAuthResult(
                authCode = authCode,
                grantedScopes = grantedScopes,
            )
            cachedGrantedScopes = grantedScopes
            clearSignInState()
            authResult
        } catch (e: Exception) {
            clearSignInState()
            throw mapException(e)
        }
    }

    suspend fun completeSignIn(data: Intent?): GoogleAuthResult {
        return completeSignIn(Activity.RESULT_OK, data)
    }

    suspend fun revokeAccess() {
        try {
            signOut()
        } catch (e: Exception) {
            throw GoogleAuthException(
                GoogleAuthErrorCode.REVOKE_FAILED,
                e.localizedMessage ?: "Failed to revoke Google access",
                e,
            )
        }
    }

    suspend fun signOut() {
        try {
            awaitWithTimeout(
                timeoutMs = SIGN_OUT_TIMEOUT_MS,
                onTimeout = {},
                timeoutException = GoogleAuthException(
                    GoogleAuthErrorCode.SIGN_OUT_FAILED,
                    "Failed to clear credentials",
                ),
            ) { callback ->
                val executor = ContextCompat.getMainExecutor(appContext)
                credentialManager.clearCredentialStateAsync(
                    ClearCredentialStateRequest(),
                    null,
                    executor,
                    object : CredentialManagerCallback<Void?, ClearCredentialStateException> {
                        override fun onResult(result: Void?) {
                            callback(Result.success(Unit))
                        }

                        override fun onError(e: ClearCredentialStateException) {
                            callback(Result.failure(e))
                        }
                    },
                )
            }

            cachedGrantedScopes = emptyList()
        } catch (e: Exception) {
            throw mapException(e)
        }
    }

    private suspend fun startSignIn(
        activity: Activity,
        requestedScopes: List<String>,
        mode: GoogleAuthScopeMode,
    ): GoogleAuthSignInStep {
        if (activity.isFinishing) {
            throw GoogleAuthException(GoogleAuthErrorCode.ACTIVITY_ERROR, "Activity is finishing")
        }

        val authConfig = config
            ?: throw GoogleAuthException(GoogleAuthErrorCode.CONFIG_ERROR, "Google auth not configured")

        if (signInStartedAtMs != null) {
            throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_IN_PROGRESS, "Google sign-in already in progress")
        }

        val normalizedRequestedScopes = normalizeScopes(requestedScopes)

        val startedAtMs = SystemClock.elapsedRealtime()
        signInStartedAtMs = startedAtMs
        pendingRequestedScopes = normalizedRequestedScopes
        pendingMode = mode
        scheduleSignInTimeout()

        try {
            val googleIdOption = GetGoogleIdOption.Builder()
                .setServerClientId(authConfig.webClientId)
                .setFilterByAuthorizedAccounts(false)
                .setAutoSelectEnabled(true)
                .build()

            val credentialRequest = GetCredentialRequest.Builder()
                .addCredentialOption(googleIdOption)
                .build()

            val credentialResponse = awaitWithTimeout(
                timeoutMs = DEFAULT_SIGN_IN_TIMEOUT_MS,
                onTimeout = {
                    lastTimedOutAtMs = SystemClock.elapsedRealtime()
                    clearSignInState()
                },
                timeoutException = GoogleAuthException(
                    GoogleAuthErrorCode.SIGN_IN_TIMEOUT,
                    "Google sign-in timed out",
                ),
            ) { callback ->
                credentialManager.getCredentialAsync(
                    activity,
                    credentialRequest,
                    null,
                    ContextCompat.getMainExecutor(appContext),
                    object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                        override fun onResult(result: GetCredentialResponse) {
                            callback(Result.success(result))
                        }

                        override fun onError(e: GetCredentialException) {
                            callback(Result.failure(e))
                        }
                    },
                )
            }

            val credential = credentialResponse.credential
            if (credential is androidx.credentials.CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                try {
                    GoogleIdTokenCredential.createFrom(credential.data)
                } catch (e: Exception) {
                    throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_FAILED, "Invalid Google credential", e)
                }
            } else {
                throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_FAILED, "Unexpected credential type")
            }

            val scopes = normalizedRequestedScopes.map { Scope(it) }
            val authorizationRequest = AuthorizationRequest.Builder()
                .setRequestedScopes(scopes)
                .requestOfflineAccess(authConfig.webClientId)
                .build()

            val remainingMs = remainingTimeoutMs(startedAtMs)
            if (remainingMs <= 0) {
                throw GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_TIMEOUT, "Google sign-in timed out")
            }

            val authorizationResult = awaitWithTimeout(
                timeoutMs = remainingMs,
                onTimeout = {
                    lastTimedOutAtMs = SystemClock.elapsedRealtime()
                    clearSignInState()
                },
                timeoutException = GoogleAuthException(
                    GoogleAuthErrorCode.SIGN_IN_TIMEOUT,
                    "Google sign-in timed out",
                ),
            ) { callback ->
                authorizationClient.authorize(authorizationRequest)
                    .addOnSuccessListener { result -> callback(Result.success(result)) }
                    .addOnFailureListener { error -> callback(Result.failure(error)) }
            }

            if (authorizationResult.hasResolution() && authorizationResult.pendingIntent != null) {
                val pendingIntent = authorizationResult.pendingIntent
                    ?: throw GoogleAuthException(GoogleAuthErrorCode.AUTH_CODE_FAILED, "Missing pending intent")

                val request = IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                return GoogleAuthSignInStep.RequiresResolution(request)
            }

            val authCode = authorizationResult.serverAuthCode
            if (authCode.isNullOrBlank()) {
                throw GoogleAuthException(GoogleAuthErrorCode.AUTH_CODE_FAILED, "Missing server auth code")
            }

            val fallback = when (mode) {
                GoogleAuthScopeMode.ADD -> normalizeScopes(cachedGrantedScopes + normalizedRequestedScopes)
                GoogleAuthScopeMode.REPLACE -> normalizedRequestedScopes
            }
            val grantedScopes = extractGrantedScopes(authorizationResult, fallback)

            val authResult = GoogleAuthResult(
                authCode = authCode,
                grantedScopes = grantedScopes,
            )
            cachedGrantedScopes = grantedScopes
            clearSignInState()
            return GoogleAuthSignInStep.Completed(authResult)
        } catch (e: Exception) {
            clearSignInState()
            throw mapException(e)
        }
    }

    private fun extractGrantedScopes(result: AuthorizationResult, fallback: List<String>): List<String> {
        val extracted = try {
            val getGrantedScopes = result.javaClass.methods.firstOrNull {
                it.name == "getGrantedScopes" && it.parameterCount == 0
            }
            val raw = getGrantedScopes?.invoke(result)

            when (raw) {
                is Iterable<*> -> raw.mapNotNull { scopeObj ->
                    val getScopeUri = scopeObj?.javaClass?.methods?.firstOrNull {
                        it.name == "getScopeUri" && it.parameterCount == 0
                    }
                    getScopeUri?.invoke(scopeObj) as? String
                }

                else -> emptyList()
            }
        } catch (_: Exception) {
            emptyList()
        }

        return normalizeScopes(if (extracted.isNotEmpty()) extracted else fallback)
    }

    private fun normalizeScopes(scopes: List<String>): List<String> {
        val seen = linkedSetOf<String>()
        for (scope in scopes) {
            val trimmed = scope.trim()
            if (trimmed.isNotEmpty()) {
                seen.add(trimmed)
            }
        }
        return seen.toList()
    }

    private fun scheduleSignInTimeout() {
        signInTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        val runnable = Runnable {
            lastTimedOutAtMs = SystemClock.elapsedRealtime()
            clearSignInState()
        }
        signInTimeoutRunnable = runnable
        mainHandler.postDelayed(runnable, DEFAULT_SIGN_IN_TIMEOUT_MS)
    }

    private fun clearSignInState() {
        signInTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        signInTimeoutRunnable = null
        signInStartedAtMs = null
        pendingRequestedScopes = emptyList()
        pendingMode = GoogleAuthScopeMode.REPLACE
    }

    private fun remainingTimeoutMs(startedAtMs: Long): Long {
        val elapsedMs = SystemClock.elapsedRealtime() - startedAtMs
        return DEFAULT_SIGN_IN_TIMEOUT_MS - elapsedMs
    }

    private suspend fun <T> awaitWithTimeout(
        timeoutMs: Long,
        onTimeout: () -> Unit,
        timeoutException: Exception,
        block: (callback: (Result<T>) -> Unit) -> Unit,
    ): T {
        val clampedTimeoutMs = timeoutMs.coerceAtLeast(1)

        return suspendCoroutine { continuation ->
            var didFinish = false
            val timeoutRunnable = Runnable {
                if (didFinish) return@Runnable
                didFinish = true
                onTimeout()
                continuation.resumeWithException(timeoutException)
            }

            mainHandler.postDelayed(timeoutRunnable, clampedTimeoutMs)

            block { result ->
                if (didFinish) return@block
                didFinish = true
                mainHandler.removeCallbacks(timeoutRunnable)

                result.fold(
                    onSuccess = { continuation.resume(it) },
                    onFailure = { continuation.resumeWithException(it) },
                )
            }
        }
    }

    private fun mapException(error: Exception): Exception {
        return when (error) {
            is GoogleAuthException -> error
            is GetCredentialCancellationException -> GoogleAuthException(
                GoogleAuthErrorCode.SIGN_IN_CANCELED,
                "Google sign-in canceled",
                error,
            )

            is GetCredentialException -> GoogleAuthException(
                GoogleAuthErrorCode.SIGN_IN_FAILED,
                error.localizedMessage ?: "Google sign-in failed",
                error,
            )

            is ApiException -> {
                if (error.statusCode == CommonStatusCodes.CANCELED) {
                    GoogleAuthException(GoogleAuthErrorCode.SIGN_IN_CANCELED, "Google sign-in canceled", error)
                } else {
                    GoogleAuthException(
                        GoogleAuthErrorCode.AUTH_CODE_FAILED,
                        error.localizedMessage ?: "Authorization failed",
                        error,
                    )
                }
            }

            is ClearCredentialStateException -> GoogleAuthException(
                GoogleAuthErrorCode.SIGN_OUT_FAILED,
                error.localizedMessage ?: "Failed to clear credentials",
                error,
            )

            else -> GoogleAuthException(
                GoogleAuthErrorCode.SIGN_IN_FAILED,
                error.localizedMessage ?: "Google sign-in failed",
                error,
            )
        }
    }
}

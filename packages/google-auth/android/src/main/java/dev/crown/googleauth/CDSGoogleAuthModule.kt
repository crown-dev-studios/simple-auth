package dev.crown.googleauth

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import dev.crown.simpleauth.googleauth.GoogleAuthClient
import dev.crown.simpleauth.googleauth.GoogleAuthConfig
import dev.crown.simpleauth.googleauth.GoogleAuthException
import dev.crown.simpleauth.googleauth.GoogleAuthSignInStep
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import android.os.Handler
import android.os.Looper

private const val AUTH_REQUEST_CODE = 9112
private const val SIGN_IN_TIMEOUT_MS = 60_000L

class CDSGoogleAuthModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener, LifecycleEventListener {

    private val client = GoogleAuthClient(reactContext)
    private var pendingPromise: Promise? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingTimeoutRunnable: Runnable? = null
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    init {
        reactContext.addActivityEventListener(this)
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "CDSGoogleAuth"

    @ReactMethod
    fun configure(options: ReadableMap, promise: Promise) {
        try {
            val webClientId = options.getString("webClientId")
            if (webClientId.isNullOrEmpty()) {
                promise.reject("config_error", "webClientId is required")
                return
            }

            val scopes = options.getArray("scopes")?.toArrayList()?.mapNotNull { it as? String }
                ?: listOf("openid", "email", "profile")

            client.configure(GoogleAuthConfig(webClientId = webClientId, scopes = scopes))
            promise.resolve(null)
        } catch (e: GoogleAuthException) {
            promise.reject(e.errorCode.code, e.message, e)
        } catch (e: Exception) {
            promise.reject("config_error", e.localizedMessage ?: "Failed to configure Google auth", e)
        }
    }

    @ReactMethod
    fun signIn(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("activity_error", "Current activity is not available")
            return
        }

        if (pendingPromise != null) {
            promise.reject("sign_in_in_progress", "Google sign-in already in progress")
            return
        }

        pendingPromise = promise
        val runnable = Runnable {
            rejectPending("sign_in_timeout", "Google sign-in timed out", null)
        }
        pendingTimeoutRunnable = runnable
        mainHandler.postDelayed(runnable, SIGN_IN_TIMEOUT_MS)

        coroutineScope.launch {
            try {
                when (val step = client.beginSignIn(activity)) {
                    is GoogleAuthSignInStep.Completed -> {
                        val response = Arguments.createMap()
                        response.putString("authCode", step.authCode)
                        resolvePending(response)
                    }

                    is GoogleAuthSignInStep.RequiresResolution -> {
                        activity.startIntentSenderForResult(
                            step.intentSenderRequest.intentSender,
                            AUTH_REQUEST_CODE,
                            null,
                            0,
                            0,
                            0,
                        )
                    }
                }
            } catch (e: GoogleAuthException) {
                rejectPending(e.errorCode.code, e.message ?: "Google sign-in failed", e)
            } catch (e: Exception) {
                rejectPending("sign_in_failed", e.localizedMessage ?: "Google sign-in failed", e)
            }
        }
    }

    @ReactMethod
    fun signOut(promise: Promise) {
        if (pendingPromise != null) {
            rejectPending("sign_in_canceled", "Google sign-in canceled", null)
        }

        coroutineScope.launch {
            try {
                client.signOut()
                promise.resolve(null)
            } catch (e: GoogleAuthException) {
                promise.reject(e.errorCode.code, e.message ?: "Failed to sign out", e)
            } catch (e: Exception) {
                promise.reject("sign_out_failed", e.localizedMessage ?: "Failed to clear credentials", e)
            }
        }
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != AUTH_REQUEST_CODE) return

        coroutineScope.launch {
            try {
                val authCode = client.completeSignIn(resultCode, data)
                val response = Arguments.createMap()
                response.putString("authCode", authCode)
                resolvePending(response)
            } catch (e: GoogleAuthException) {
                rejectPending(e.errorCode.code, e.message ?: "Google sign-in failed", e)
            } catch (e: Exception) {
                rejectPending("auth_code_failed", e.localizedMessage ?: "Authorization failed", e)
            }
        }
    }

    override fun onNewIntent(intent: Intent?) = Unit

    override fun onHostResume() = Unit

    override fun onHostPause() = Unit

    override fun onHostDestroy() {
        rejectPending("sign_in_canceled", "Google sign-in canceled", null)
        coroutineScope.launch {
            try {
                client.completeSignIn(Activity.RESULT_CANCELED, null)
            } catch (_: Exception) {
                // Intentionally ignore - we only want to clear internal SDK state.
            }
        }
    }

    override fun onCatalystInstanceDestroy() {
        reactContext.removeActivityEventListener(this)
        reactContext.removeLifecycleEventListener(this)
        rejectPending("sign_in_canceled", "Google sign-in canceled", null)
        coroutineScope.launch {
            try {
                client.completeSignIn(Activity.RESULT_CANCELED, null)
            } catch (_: Exception) {
                // Intentionally ignore - we only want to clear internal SDK state.
            }
        }
        coroutineScope.cancel()
        super.onCatalystInstanceDestroy()
    }

    private fun resolvePending(result: Any?) {
        pendingTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        pendingTimeoutRunnable = null
        pendingPromise?.resolve(result)
        pendingPromise = null
    }

    private fun rejectPending(code: String, message: String, error: Throwable?) {
        pendingTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        pendingTimeoutRunnable = null
        pendingPromise?.reject(code, message, error)
        pendingPromise = null
    }
}

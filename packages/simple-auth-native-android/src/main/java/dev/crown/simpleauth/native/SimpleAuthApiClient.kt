package dev.crown.simpleauth.native

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class AuthTokensResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

class SimpleAuthApiClient(
    private val baseUrl: String,
    private val okHttpClient: OkHttpClient = OkHttpClient(),
    private val refreshPath: String = "/auth/refresh",
    private val googleOAuthPath: String = "/auth/oauth/google",
) {
    suspend fun refresh(refreshToken: String): AuthTokensResponse = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}${refreshPath}"
        val json = JSONObject()
        json.put("refreshToken", refreshToken)

        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody("application/json".toMediaType()))
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw SimpleAuthException("Refresh failed (${response.code})")
            }

            val body = response.body?.string() ?: throw SimpleAuthException("Missing response body")
            val parsed = JSONObject(body)

            val accessToken = parsed.optString("accessToken")
            val newRefreshToken = parsed.optString("refreshToken")
            val expiresIn = parsed.optInt("expiresIn", -1)

            if (accessToken.isBlank() || newRefreshToken.isBlank() || expiresIn <= 0) {
                throw SimpleAuthException("Invalid refresh response")
            }

            AuthTokensResponse(
                accessToken = accessToken,
                refreshToken = newRefreshToken,
                expiresIn = expiresIn,
            )
        }
    }

    suspend fun exchangeGoogleAuthCode(authCode: String): OAuthResponse = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}${googleOAuthPath}"
        val json = JSONObject()
        json.put("authCode", authCode)

        val request = Request.Builder()
            .url(url)
            .post(json.toString().toRequestBody("application/json".toMediaType()))
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw SimpleAuthException("Google OAuth exchange failed (${response.code})")
            }

            val body = response.body?.string() ?: throw SimpleAuthException("Missing response body")
            val parsed = JSONObject(body)
            val status = parsed.optString("status")

            when (status) {
                "authenticated" -> {
                    val userJson = parsed.optJSONObject("user") ?: throw SimpleAuthException("Missing user")
                    val tokensJson = parsed.optJSONObject("tokens") ?: throw SimpleAuthException("Missing tokens")

                    val tokens = AuthTokensResponse(
                        accessToken = tokensJson.optString("accessToken"),
                        refreshToken = tokensJson.optString("refreshToken"),
                        expiresIn = tokensJson.optInt("expiresIn", -1),
                    )

                    if (tokens.accessToken.isBlank() || tokens.refreshToken.isBlank() || tokens.expiresIn <= 0) {
                        throw SimpleAuthException("Invalid tokens")
                    }

                    OAuthResponse.Authenticated(
                        user = SimpleAuthUser(
                            id = userJson.optString("id"),
                            email = userJson.optString("email"),
                        ),
                        tokens = tokens,
                    )
                }
                "needs_phone" -> OAuthResponse.NeedsPhone(
                    sessionToken = parsed.optString("sessionToken"),
                    email = parsed.optString("email"),
                    flowType = parsed.optString("flowType"),
                    maskedPhone = parsed.optString("maskedPhone").takeIf { it.isNotBlank() },
                )
                "needs_linking" -> OAuthResponse.NeedsLinking(
                    sessionToken = parsed.optString("sessionToken"),
                    maskedEmail = parsed.optString("maskedEmail"),
                )
                else -> throw SimpleAuthException("Invalid OAuth response")
            }
        }
    }
}

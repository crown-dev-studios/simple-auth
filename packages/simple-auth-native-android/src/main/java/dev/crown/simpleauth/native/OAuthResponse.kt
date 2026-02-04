package dev.crown.simpleauth.native

data class SimpleAuthUser(
    val id: String,
    val email: String,
)

sealed interface OAuthResponse {
    data class Authenticated(
        val user: SimpleAuthUser,
        val tokens: AuthTokensResponse,
    ) : OAuthResponse

    data class NeedsPhone(
        val sessionToken: String,
        val email: String,
        val flowType: String,
        val maskedPhone: String?,
    ) : OAuthResponse

    data class NeedsLinking(
        val sessionToken: String,
        val maskedEmail: String,
    ) : OAuthResponse
}

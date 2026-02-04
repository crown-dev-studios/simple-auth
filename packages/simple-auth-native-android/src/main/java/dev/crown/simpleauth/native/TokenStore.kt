package dev.crown.simpleauth.native

data class StoredTokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMs: Long,
)

interface TokenStore {
    suspend fun getTokens(): StoredTokens?
    suspend fun setTokens(tokens: StoredTokens)
    suspend fun clearTokens()
}

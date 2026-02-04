package dev.crown.simpleauth.native

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class TokenManager(
    private val store: TokenStore,
    private val api: SimpleAuthApiClient,
    private val refreshLeewaySeconds: Int = 30,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    private val mutex = Mutex()
    private var inFlightRefresh: CompletableDeferred<StoredTokens>? = null
    private val maxRefreshTokenLength = 4096

    private fun isValidRefreshToken(token: String): Boolean {
        if (token.isBlank()) return false
        if (token.length > maxRefreshTokenLength) return false
        if (token.any { it.isWhitespace() }) return false
        return true
    }

    suspend fun getAccessToken(): String? {
        val tokens = store.getTokens() ?: return null

        val shouldRefresh = tokens.expiresAtMs - refreshLeewaySeconds * 1000L <= nowMs()
        if (!shouldRefresh) return tokens.accessToken

        return refreshTokens().accessToken
    }

    suspend fun setTokens(tokens: StoredTokens) {
        store.setTokens(tokens)
    }

    suspend fun setTokensFromResponse(tokens: AuthTokensResponse) {
        val expiresAtMs = nowMs() + tokens.expiresIn * 1000L
        store.setTokens(
            StoredTokens(
                accessToken = tokens.accessToken,
                refreshToken = tokens.refreshToken,
                expiresAtMs = expiresAtMs,
            ),
        )
    }

    suspend fun clearTokens() {
        store.clearTokens()
    }

    suspend fun refreshTokens(): StoredTokens {
        val existingDeferred = mutex.withLock { inFlightRefresh }
        if (existingDeferred != null) {
            return existingDeferred.await()
        }

        val deferred = CompletableDeferred<StoredTokens>()
        mutex.withLock {
            val doubleCheck = inFlightRefresh
            if (doubleCheck != null) {
                return doubleCheck.await()
            }
            inFlightRefresh = deferred
        }

        try {
            val current = store.getTokens()
            if (current == null) {
                deferred.completeExceptionally(SimpleAuthException("No refresh token available"))
                throw SimpleAuthException("No refresh token available")
            }

            if (!isValidRefreshToken(current.refreshToken)) {
                store.clearTokens()
                deferred.completeExceptionally(SimpleAuthException("Invalid refresh token"))
                throw SimpleAuthException("Invalid refresh token")
            }

            val refreshed = api.refresh(current.refreshToken)
            val expiresAtMs = nowMs() + refreshed.expiresIn * 1000L

            val updated = StoredTokens(
                accessToken = refreshed.accessToken,
                refreshToken = refreshed.refreshToken,
                expiresAtMs = expiresAtMs,
            )

            store.setTokens(updated)
            deferred.complete(updated)
            return updated
        } catch (e: Exception) {
            store.clearTokens()
            deferred.completeExceptionally(e)
            throw e
        } finally {
            mutex.withLock {
                if (inFlightRefresh === deferred) {
                    inFlightRefresh = null
                }
            }
        }
    }
}

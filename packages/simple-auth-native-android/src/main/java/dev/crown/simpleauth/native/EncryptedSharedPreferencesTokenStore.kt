package dev.crown.simpleauth.native

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class EncryptedSharedPreferencesTokenStore(
    context: Context,
    private val prefsName: String = "simple_auth_secure_store",
    private val key: String = "tokens",
) : TokenStore {
    private val appContext = context.applicationContext
    private val prefs = EncryptedSharedPreferences.create(
        appContext,
        prefsName,
        MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override suspend fun getTokens(): StoredTokens? = withContext(Dispatchers.IO) {
        val raw = prefs.getString(key, null) ?: return@withContext null
        try {
            val json = JSONObject(raw)
            StoredTokens(
                accessToken = json.optString("accessToken"),
                refreshToken = json.optString("refreshToken"),
                expiresAtMs = json.optLong("expiresAtMs"),
            ).takeIf { it.accessToken.isNotBlank() && it.refreshToken.isNotBlank() && it.expiresAtMs > 0 }
        } catch (_: Exception) {
            null
        }
    }

    override suspend fun setTokens(tokens: StoredTokens) = withContext(Dispatchers.IO) {
        val json = JSONObject()
        json.put("accessToken", tokens.accessToken)
        json.put("refreshToken", tokens.refreshToken)
        json.put("expiresAtMs", tokens.expiresAtMs)
        prefs.edit().putString(key, json.toString()).apply()
    }

    override suspend fun clearTokens() = withContext(Dispatchers.IO) {
        prefs.edit().remove(key).apply()
    }
}

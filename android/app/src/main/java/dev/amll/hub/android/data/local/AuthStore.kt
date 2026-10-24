package dev.amll.hub.android.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "amll_auth")

/** 登录态持久化：token（Keystore 加密）+ 用户资料，替代网页端的 localStorage */
@Singleton
class AuthStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val tokenKey = stringPreferencesKey("amll_hub_token")
    private val userKey = stringPreferencesKey("amll_hub_user")
    private val cipher = TokenCipher()

    /** 内存缓存：OkHttp 拦截器同步读取，不能挂起 */
    @Volatile
    var cachedToken: String? = null
        private set

    val tokenFlow: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[tokenKey]?.let { stored ->
            // 历史明文数据（没有 v1: 前缀）直接透传，下次 save 时会被替换为密文
            if (stored.startsWith("v1:")) cipher.decrypt(stored) else stored
        }
    }

    suspend fun token(): String? {
        cachedToken?.let { return it }
        val stored = context.dataStore.data.first()[tokenKey] ?: return null
        val plain = if (stored.startsWith("v1:")) cipher.decrypt(stored) else stored
        cachedToken = plain
        // 旧明文迁移为密文；迁移失败也不影响本次登录态
        if (plain != null && !stored.startsWith("v1:")) {
            runCatching { context.dataStore.edit { it[tokenKey] = cipher.encrypt(plain) } }
        }
        return plain
    }

    suspend fun save(token: String) {
        cachedToken = token
        val encrypted = cipher.encrypt(token)
        context.dataStore.edit { it[tokenKey] = encrypted }
    }

    suspend fun clear() {
        cachedToken = null
        context.dataStore.edit { prefs ->
            prefs.remove(tokenKey)
            prefs.remove(userKey)
        }
    }
}

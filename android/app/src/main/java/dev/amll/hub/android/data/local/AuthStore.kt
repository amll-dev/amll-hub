package dev.amll.hub.android.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "amll_auth")

/** 登录态持久化：token + 用户资料，替代网页端的 localStorage */
@Singleton
class AuthStore @Inject constructor(
    private val context: Context,
) {
    private val tokenKey = stringPreferencesKey("amll_hub_token")
    private val userKey = stringPreferencesKey("amll_hub_user")

    /** 内存缓存：OkHttp 拦截器同步读取，不能挂起 */
    @Volatile
    var cachedToken: String? = null
        private set

    val tokenFlow: Flow<String?> = context.dataStore.data.map { it[tokenKey] }

    suspend fun token(): String? {
        cachedToken?.let { return it }
        val stored = context.dataStore.data.first()[tokenKey]
        cachedToken = stored
        return stored
    }

    suspend fun save(token: String) {
        cachedToken = token
        context.dataStore.edit { it[tokenKey] = token }
    }

    suspend fun clear() {
        cachedToken = null
        context.dataStore.edit { prefs ->
            prefs.remove(tokenKey)
            prefs.remove(userKey)
        }
    }
}

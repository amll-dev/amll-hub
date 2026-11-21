package dev.amll.hub.android.data.remote

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.amll.hub.android.data.local.AuthStore
import okhttp3.Interceptor
import okhttp3.Response
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 统一注入 Authorization: Bearer <token> 与 X-Device-ID。
 * 对应网页端 lib/api.ts 的请求管道。
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val authStore: AuthStore,
    private val sessionEvents: AuthSessionEvents,
    @ApplicationContext context: Context,
) : Interceptor {

    // 本机安装的稳定设备标识，供后端判定「新设备登录」
    private val deviceId: String by lazy {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_DEVICE_ID, it).apply()
        }
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val builder = request.newBuilder().header("X-Device-ID", deviceId)
        val path = request.url.encodedPath

        // 登录相关接口本身不需要 token
        val isAuthEndpoint = path.contains("/auth/login") || path.contains("/auth/oneclick/")
        if (!isAuthEndpoint) {
            val token = authStore.cachedToken
            if (!token.isNullOrBlank()) {
                builder.header("Authorization", "Bearer $token")
            }
        }

        val newRequest = builder.build()
        val response = chain.proceed(newRequest)

        // 带 token 的请求被后端判定失效：广播给全局会话，统一回登录页
        if (response.code == 401 && newRequest.header("Authorization") != null) {
            sessionEvents.notifyUnauthorized()
        }
        return response
    }

    private companion object {
        const val PREFS = "amll_hub_device"
        const val KEY_DEVICE_ID = "device_id"
    }
}

package dev.amll.hub.android.data.remote

import dev.amll.hub.android.data.local.AuthStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 统一注入 Authorization: Bearer <token>。
 * 对应网页端 lib/api.ts 的请求管道。
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val authStore: AuthStore,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()

        // 登录相关接口本身不需要 token
        if (request.url.encodedPath.contains("/auth/login")) {
            return chain.proceed(request)
        }

        // OkHttp 拦截器是同步的，这里用 runBlocking 读内存缓存（正常已有值，不会真正阻塞）
        val token = authStore.cachedToken ?: runBlocking { authStore.token() }

        val newRequest = if (token.isNullOrBlank()) {
            request
        } else {
            request.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(newRequest)
    }
}

package dev.amll.hub.android.data.remote

import dev.amll.hub.android.data.local.AuthStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 认证仓库：统一处理后端 {code, message, data} 包装与错误映射。
 * 对应网页端 lib/api.ts 的 request() 管道。
 */
@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val authStore: AuthStore,
) {

    val tokenFlow get() = authStore.tokenFlow

    suspend fun login(username: String, password: String): LoginResult {
        val resp = call { api.login(LoginRequest(username.trim(), password)) }
        return resp.also { authStore.save(it.token) }
    }

    suspend fun loginByCode(dest: String, code: String): LoginResult {
        val resp = call { api.loginByCode(LoginByCodeRequest(dest.trim(), code.trim())) }
        return resp.also { authStore.save(it.token) }
    }

    suspend fun sendCode(checkType: String, dest: String) {
        call { api.sendCode(SendCodeRequest(checkType = checkType, dest = dest.trim())) }
    }

    suspend fun profile(): UserProfile = call { api.profile() }

    suspend fun currentToken(): String? = authStore.token()

    suspend fun logout() = authStore.clear()

    // ---- 扫码登录 ----

    /** 确认把当前账号授权给该票据 */
    suspend fun confirmQrLogin(ticket: String) {
        call { api.confirmQr(TicketRequest(ticket)) }
    }

    /** 取消本次扫码登录 */
    suspend fun cancelQrLogin(ticket: String) {
        call { api.cancelQr(TicketRequest(ticket)) }
    }

    /**
     * 调用后端接口并解包统一响应。
     * code !== 200 时抛出携带后端 message 的 [ApiException]，UI 直接展示即可。
     */
    private suspend fun <T> call(block: suspend () -> ApiResponse<T>): T =
        withContext(Dispatchers.IO) {
            val resp = try {
                block()
            } catch (e: HttpException) {
                throw if (e.code() == 401) UnauthorizedException() else NetworkException("服务异常（HTTP ${e.code()}）")
            } catch (e: IOException) {
                throw NetworkException()
            }

            if (resp.code != 200) {
                if (resp.code == 401) throw UnauthorizedException(resp.message)
                throw ApiException(resp.code, resp.message.ifBlank { "请求失败（${resp.code}）" })
            }
            resp.data ?: throw ApiException(resp.code, "服务端返回空数据")
        }
}

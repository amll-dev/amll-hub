package dev.amll.hub.android.data.remote

import dev.amll.hub.android.data.local.AuthStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** 解析错误响应体用的轻量 Json */
private val errorJson = Json { ignoreUnknownKeys = true }

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
        request { api.sendCode(SendCodeRequest(checkType = checkType, dest = dest.trim())) }
    }

    suspend fun profile(): UserProfile = call { api.profile() }

    suspend fun currentToken(): String? = authStore.token()

    suspend fun logout() = authStore.clear()

    // ---- 扫码登录 ----

    /** 确认把当前账号授权给该票据 */
    suspend fun confirmQrLogin(ticket: String) {
        request { api.confirmQr(TicketRequest(ticket)) }
    }

    /** 取消本次扫码登录 */
    suspend fun cancelQrLogin(ticket: String) {
        request { api.cancelQr(TicketRequest(ticket)) }
    }

    /**
     * 需要数据体的接口：`data` 缺失视为异常。
     */
    private suspend fun <T : Any> call(block: suspend () -> ApiResponse<T>): T =
        request(block) ?: throw ApiException(200, "服务端返回空数据")

    /**
     * 统一请求管道：解包 {code, message, data} 并映射错误。
     *
     * - `data` 允许为空：后端 `OKWithMsg(c, nil, ...)`（发码、扫码确认/取消等）因
     *   `json:"data,omitempty"` 会直接省略 data 字段。网页端 request() 同样只校验 code，
     *   不要求 data 非空 —— 必须保持一致，否则发码接口永远报「服务端返回空数据」。
     * - HTTP 非 2xx 时尽量取出响应体里的后端 message（如「验证码错误」），
     *   而不是统一映射成「服务异常」，否则用户无法判断错在哪。
     */
    private suspend fun <T> request(block: suspend () -> ApiResponse<T>): T? =
        withContext(Dispatchers.IO) {
            val resp = try {
                block()
            } catch (e: HttpException) {
                val backendMsg = errorMessage(e)
                if (e.code() == 401) {
                    // 401 既可能是 token 失效，也可能是「用户名或密码错误」，
                    // 用后端文案覆盖默认提示；类型仍是 UnauthorizedException。
                    throw if (backendMsg == null) UnauthorizedException() else UnauthorizedException(backendMsg)
                }
                throw ApiException(e.code(), backendMsg ?: "服务异常（HTTP ${e.code()}）")
            } catch (e: IOException) {
                throw NetworkException()
            }

            if (resp.code != 200) {
                if (resp.code == 401) throw UnauthorizedException(resp.message)
                throw ApiException(resp.code, resp.message.ifBlank { "请求失败（${resp.code}）" })
            }
            resp.data
        }

    /** 后端错误响应体形如 {"code":400,"message":"验证码错误"}，取出 message 供 UI 展示 */
    private fun errorMessage(e: HttpException): String? = runCatching {
        e.response()?.errorBody()?.string()
            ?.let { errorJson.decodeFromString<ApiResponse<Unit>>(it).message }
            ?.takeIf { it.isNotBlank() }
    }.getOrNull()
}

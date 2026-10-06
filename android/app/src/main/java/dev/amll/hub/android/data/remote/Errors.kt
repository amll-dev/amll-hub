package dev.amll.hub.android.data.remote

/** 后端业务错误：响应体 code !== 200 */
class ApiException(
    val code: Int,
    override val message: String,
) : Exception(message)

/** 网络层错误（无响应、超时等） */
class NetworkException(
    override val message: String = "网络连接失败，请检查网络后重试",
) : Exception(message)

/** 401：登录态失效 */
class UnauthorizedException(
    override val message: String = "登录状态已过期，请重新登录",
) : Exception(message)

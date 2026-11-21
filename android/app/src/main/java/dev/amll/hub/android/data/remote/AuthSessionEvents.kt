package dev.amll.hub.android.data.remote

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 全局登录态失效事件。
 *
 * 任意带 token 的请求收到 401 时由 [AuthInterceptor] 广播，
 * [dev.amll.hub.android.ui.session.SessionViewModel] 统一清理本地 token 并切回登录页，
 * 避免只有当前页报错、App 仍停留在已登录界面。
 */
@Singleton
class AuthSessionEvents @Inject constructor() {
    private val _unauthorized = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val unauthorized: SharedFlow<Unit> = _unauthorized.asSharedFlow()

    fun notifyUnauthorized() {
        _unauthorized.tryEmit(Unit)
    }
}

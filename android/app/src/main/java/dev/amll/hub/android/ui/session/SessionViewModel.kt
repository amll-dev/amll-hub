package dev.amll.hub.android.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.AuthRepository
import dev.amll.hub.android.data.remote.UnauthorizedException
import dev.amll.hub.android.data.remote.UserProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** App 级登录态，决定冷启动落在登录页还是首页 */
sealed interface SessionState {
    /** 正在读取本地 token */
    data object Loading : SessionState

    /** 已登录；profile 允许为空（启动时先放行，联网后再补拉资料） */
    data class LoggedIn(val profile: UserProfile?) : SessionState

    /** 未登录，或后端明确判定登录态失效（401） */
    data object LoggedOut : SessionState
}

/**
 * 全局登录态。修复「重启即退出登录」：
 * - token 由 [dev.amll.hub.android.data.local.AuthStore] 持久化在 DataStore，重启后仍在
 * - 冷启动只读本地 token（不阻塞等网络），有 token 直接进首页，资料随后补拉
 * - 只有后端返回 401 才清除本地登录态；离线等临时故障保留登录态
 */
@HiltViewModel
class SessionViewModel @Inject constructor(
    private val repo: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val token = repo.currentToken()
            _state.value = if (token.isNullOrBlank()) {
                SessionState.LoggedOut
            } else {
                SessionState.LoggedIn(null)
            }
        }
    }

    /** 已登录但资料缺失时补拉；顺带校验 token，失效则退回登录页 */
    fun refreshProfile() {
        val current = _state.value as? SessionState.LoggedIn ?: return
        viewModelScope.launch {
            runCatching { repo.profile() }
                .onSuccess { profile -> _state.value = SessionState.LoggedIn(profile) }
                .onFailure { e ->
                    if (e is UnauthorizedException) {
                        repo.logout()
                        _state.value = SessionState.LoggedOut
                    } else {
                        // 网络异常：token 依然有效，保留登录态与已有资料
                        _state.value = SessionState.LoggedIn(current.profile)
                    }
                }
        }
    }

    /** 登录成功后由 UI 回传资料 */
    fun onLoggedIn(profile: UserProfile?) {
        _state.value = SessionState.LoggedIn(profile)
    }

    /** 退出登录 */
    fun logout() {
        viewModelScope.launch {
            repo.logout()
            _state.value = SessionState.LoggedOut
        }
    }
}

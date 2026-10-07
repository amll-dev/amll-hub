package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.ApiException
import dev.amll.hub.android.data.remote.AuthRepository
import dev.amll.hub.android.data.remote.LoginResult
import dev.amll.hub.android.data.remote.UnauthorizedException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 登录方式 */
enum class LoginTab { PASSWORD, CODE }

/** 验证码类型 */
enum class CodeType(val apiValue: String) { PHONE("phone"), EMAIL("email") }

/** 登录页 UI 状态 */
data class LoginUiState(
    val tab: LoginTab = LoginTab.PASSWORD,
    val codeType: CodeType = CodeType.PHONE,
    val username: String = "",
    val password: String = "",
    val dest: String = "",
    val code: String = "",
    val passwordVisible: Boolean = false,
    val submitting: Boolean = false,
    val sendingCode: Boolean = false,
    /** 验证码发送成功后的倒计时秒数，0 表示未在倒计时 */
    val countdown: Int = 0,
    val error: String? = null,
) {
    val canSubmit: Boolean
        get() = !submitting && when (tab) {
            LoginTab.PASSWORD -> username.isNotBlank() && password.isNotBlank()
            LoginTab.CODE -> dest.isNotBlank() && code.isNotBlank()
        }
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val repo: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private var countdownJob: Job? = null

    fun switchTab(tab: LoginTab) = _uiState.update {
        it.copy(tab = tab, error = null, countdown = 0)
    }

    fun switchCodeType(type: CodeType) = _uiState.update {
        it.copy(codeType = type, error = null, dest = "", countdown = 0)
    }

    fun onUsernameChange(v: String) = _uiState.update { it.copy(username = v, error = null) }
    fun onPasswordChange(v: String) = _uiState.update { it.copy(password = v, error = null) }
    fun onDestChange(v: String) = _uiState.update { it.copy(dest = v, error = null) }
    fun onCodeChange(v: String) = _uiState.update { it.copy(code = v, error = null) }

    fun togglePasswordVisible() =
        _uiState.update { it.copy(passwordVisible = !it.passwordVisible) }

    fun dismissError() = _uiState.update { it.copy(error = null) }

    fun sendCode() {
        val state = _uiState.value
        if (state.dest.isBlank() || state.sendingCode || state.countdown > 0) return

        _uiState.update { it.copy(sendingCode = true, error = null) }
        viewModelScope.launch {
            runCatching { repo.sendCode(state.codeType.apiValue, state.dest) }
                .onSuccess { startCountdown(60) }
                .onFailure { e ->
                    _uiState.update { it.copy(sendingCode = false, error = e.userMessage()) }
                }
        }
    }

    private fun startCountdown(seconds: Int) {
        countdownJob?.cancel()
        _uiState.update { it.copy(sendingCode = false, countdown = seconds) }
        countdownJob = viewModelScope.launch {
            for (i in seconds - 1 downTo 0) {
                delay(1000)
                _uiState.update { it.copy(countdown = i) }
            }
        }
    }

    /** 提交登录，成功后回调返回 LoginResult */
    fun submit(onSuccess: (LoginResult) -> Unit) {
        val state = _uiState.value
        if (!state.canSubmit) return

        _uiState.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            runCatching {
                when (state.tab) {
                    LoginTab.PASSWORD -> repo.login(state.username, state.password)
                    LoginTab.CODE -> repo.loginByCode(state.dest, state.code)
                }
            }
                .onSuccess { result ->
                    _uiState.update {
                        it.copy(submitting = false, password = "", code = "")
                    }
                    onSuccess(result)
                }
                .onFailure { e ->
                    _uiState.update { it.copy(submitting = false, error = e.userMessage()) }
                }
        }
    }
}

/** 把异常转成可直接展示给用户的中文文案 */
fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message
    is UnauthorizedException -> message
    else -> message ?: "操作失败，请稍后重试"
}

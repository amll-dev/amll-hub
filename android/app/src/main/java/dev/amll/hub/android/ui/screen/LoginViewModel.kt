package dev.amll.hub.android.ui.screen

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.ApiException
import dev.amll.hub.android.data.remote.AuthRepository
import dev.amll.hub.android.data.remote.CaptchaConfig
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

/** 登录页当前展示：检测中 / 一键登录页 / 密码验证码表单 */
enum class LoginMode { CHECKING, ONE_CLICK, FORM }

/** 验证码类型 */
enum class CodeType(val apiValue: String) { PHONE("phone"), EMAIL("email") }

/** 登录页 UI 状态 */
data class LoginUiState(
    val mode: LoginMode = LoginMode.FORM,
    val tab: LoginTab = LoginTab.PASSWORD,
    val codeType: CodeType = CodeType.PHONE,
    val username: String = "",
    val password: String = "",
    val dest: String = "",
    val code: String = "",
    val passwordVisible: Boolean = false,
    val submitting: Boolean = false,
    /** 正在预取号，判断是否展示一键登录页 */
    val oneClickChecking: Boolean = false,
    /** 预取号成功，可一键登录 */
    val oneClickAvailable: Boolean = false,
    /** 正在拉起授权页 / 用运营商 token 换登录态 */
    val oneClickLoading: Boolean = false,
    /** check-user 与拉取人机验证配置的短暂过程 */
    val preparingCode: Boolean = false,
    val sendingCode: Boolean = false,
    /** 验证码发送成功后的倒计时秒数，0 表示未在倒计时 */
    val countdown: Int = 0,
    val error: String? = null,
    /** 非空表示需要人机验证，值为阿里云所需配置 */
    val captcha: CaptchaConfig? = null,
    /** null = 等待验证；true = 业务成功；false = 业务失败（SDK 会自动重置） */
    val captchaVerified: Boolean? = null,
) {
    val canSubmit: Boolean
        get() = when (tab) {
            LoginTab.PASSWORD -> !submitting && username.isNotBlank() && password.isNotBlank()
            LoginTab.CODE -> !submitting && dest.isNotBlank() && code.isNotBlank()
        }

    val canSendCode: Boolean
        get() = tab == LoginTab.CODE &&
            dest.isNotBlank() &&
            countdown == 0 &&
            !sendingCode &&
            !preparingCode
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val repo: AuthRepository,
    private val pnvs: PnvsAuthManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private var countdownJob: Job? = null
    private var captchaConfig: CaptchaConfig? = null

    init {
        if (pnvs.enabled) {
            _uiState.update { it.copy(mode = LoginMode.CHECKING, oneClickChecking = true) }
            pnvs.prefetch { available ->
                _uiState.update {
                    it.copy(
                        oneClickChecking = false,
                        oneClickAvailable = available,
                        mode = if (available) LoginMode.ONE_CLICK else LoginMode.FORM,
                    )
                }
            }
        }
    }

    /** 授权页切换登录方式 / 取消：回到密码验证码表单 */
    fun switchToForm() {
        _uiState.update {
            it.copy(mode = LoginMode.FORM, oneClickLoading = false, error = null)
        }
    }

    /** 从表单切回一键登录页 */
    fun switchToOneClick() {
        val state = _uiState.value
        if (!state.oneClickAvailable) return
        _uiState.update { it.copy(mode = LoginMode.ONE_CLICK, error = null) }
    }

    /** 拉起运营商授权页，拿到运营商 token 后换本地登录态 */
    fun loginOneClick(activity: Activity, onSuccess: (LoginResult) -> Unit) {
        if (_uiState.value.oneClickLoading) return
        _uiState.update { it.copy(oneClickLoading = true, error = null) }

        pnvs.login(
            activity = activity,
            onToken = { token ->
                viewModelScope.launch {
                    runCatching { repo.loginOneClickNative(token) }
                        .onSuccess { result ->
                            _uiState.update { it.copy(oneClickLoading = false) }
                            onSuccess(result)
                        }
                        .onFailure { e ->
                            _uiState.update {
                                it.copy(
                                    oneClickLoading = false,
                                    mode = LoginMode.FORM,
                                    error = e.userMessage(),
                                )
                            }
                        }
                }
            },
            onSwitch = { switchToForm() },
            onError = { message ->
                _uiState.update {
                    it.copy(oneClickLoading = false, mode = LoginMode.FORM, error = message)
                }
            },
        )
    }

    fun switchTab(tab: LoginTab) {
        countdownJob?.cancel()
        _uiState.update {
            it.copy(tab = tab, error = null, countdown = 0, captcha = null, captchaVerified = null)
        }
    }

    fun switchCodeType(type: CodeType) {
        countdownJob?.cancel()
        _uiState.update {
            it.copy(codeType = type, error = null, dest = "", countdown = 0, captcha = null, captchaVerified = null)
        }
    }

    fun onUsernameChange(v: String) = _uiState.update { it.copy(username = v, error = null) }
    fun onPasswordChange(v: String) = _uiState.update { it.copy(password = v, error = null) }
    fun onDestChange(v: String) = _uiState.update { it.copy(dest = v, error = null) }
    fun onCodeChange(v: String) = _uiState.update { it.copy(code = v, error = null) }

    fun togglePasswordVisible() =
        _uiState.update { it.copy(passwordVisible = !it.passwordVisible) }

    fun dismissError() = _uiState.update { it.copy(error = null) }

    fun dismissCaptcha() = _uiState.update { it.copy(captcha = null, captchaVerified = null) }

    /**
     * 与网页端一致的三步：
     * 1. check-user 确认账号存在（能给出「未注册」而不是笼统失败）
     * 2. 拉取人机验证配置；需要验证就先弹阿里云滑块
     * 3. 拿到 token 后带 captchaType / captchaToken 发码
     */
    fun sendCode() {
        val state = _uiState.value
        if (!state.canSendCode) return

        _uiState.update { it.copy(preparingCode = true, error = null, captchaVerified = null) }
        viewModelScope.launch {
            try {
                repo.checkUser(state.codeType.apiValue, state.dest)
                val config = repo.captchaConfig()
                captchaConfig = config
                if (config.required) {
                    _uiState.update { it.copy(preparingCode = false, captcha = config) }
                } else {
                    _uiState.update { it.copy(preparingCode = false) }
                    sendCodeNow(config, "")
                }
            } catch (e: Throwable) {
                _uiState.update { it.copy(preparingCode = false, error = e.userMessage()) }
            }
        }
    }

    /** 人机验证回调：拿到阿里云 verifyParam 后真正发码 */
    fun onCaptchaToken(token: String) {
        val config = captchaConfig ?: return
        if (token.isBlank()) return
        _uiState.update { it.copy(captchaVerified = null, error = null) }
        viewModelScope.launch { sendCodeNow(config, token) }
    }

    private suspend fun sendCodeNow(config: CaptchaConfig, captchaToken: String) {
        val state = _uiState.value
        _uiState.update { it.copy(sendingCode = true, error = null) }
        runCatching {
            repo.sendCode(
                checkType = state.codeType.apiValue,
                dest = state.dest,
                captchaType = if (captchaToken.isBlank()) "" else config.type,
                captchaToken = captchaToken,
            )
        }
            .onSuccess {
                val inCaptcha = _uiState.value.captcha != null
                _uiState.update {
                    it.copy(
                        sendingCode = false,
                        captchaVerified = if (inCaptcha) true else it.captchaVerified,
                    )
                }
                startCountdown(60)
                if (inCaptcha) {
                    // 留一点时间让 SDK 播完「验证成功」再关闭弹层
                    delay(600)
                    _uiState.update { it.copy(captcha = null, captchaVerified = null) }
                }
            }
            .onFailure { e ->
                val inCaptcha = _uiState.value.captcha != null
                _uiState.update {
                    it.copy(
                        sendingCode = false,
                        error = e.userMessage(),
                        captchaVerified = if (inCaptcha) false else it.captchaVerified,
                    )
                }
            }
    }

    private fun startCountdown(seconds: Int) {
        countdownJob?.cancel()
        _uiState.update { it.copy(countdown = seconds) }
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

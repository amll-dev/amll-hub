package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.AuthRepository
import dev.amll.hub.android.data.remote.UserProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 扫码确认页状态 */
sealed interface ScanState {
    /** 等待用户扫码 */
    data object Idle : ScanState

    /** 已扫到合法二维码，等待用户确认授权 */
    data class AwaitingConfirm(val ticket: String) : ScanState

    /** 提交中 */
    data class Submitting(val ticket: String) : ScanState

    /** 已确认成功 */
    data class Success(val profile: UserProfile?) : ScanState

    /** 出错 */
    data class Error(val message: String) : ScanState
}

/**
 * 扫码登录 ViewModel。
 * 流程：扫到码 → 确认授权 → 后端把 token 交给网页端。
 */
@HiltViewModel
class ScanViewModel @Inject constructor(
    private val repo: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<ScanState>(ScanState.Idle)
    val state: StateFlow<ScanState> = _state.asStateFlow()

    /**
     * 解析扫码结果，取出 ticket。
     * 兼容 amllhub://qrlogin?ticket=xxx 与直接传 ticket 字符串。
     */
    fun onScanned(raw: String) {
        val ticket = extractTicket(raw)
        if (ticket.isBlank()) {
            _state.value = ScanState.Error("这不是 AMLl Hub 的登录二维码")
            return
        }
        _state.value = ScanState.AwaitingConfirm(ticket)
    }

    /** 用户确认授权 */
    fun confirm() {
        val current = _state.value as? ScanState.AwaitingConfirm ?: return
        _state.value = ScanState.Submitting(current.ticket)

        viewModelScope.launch {
            runCatching { repo.confirmQrLogin(current.ticket) }
                .onSuccess {
                    val profile = runCatching { repo.profile() }.getOrNull()
                    _state.value = ScanState.Success(profile)
                }
                .onFailure { e ->
                    _state.value = ScanState.Error(e.userMessage())
                }
        }
    }

    /** 用户放弃本次扫码 */
    fun cancel() {
        val ticket = (_state.value as? ScanState.AwaitingConfirm)?.ticket
        if (ticket != null) {
            viewModelScope.launch { runCatching { repo.cancelQrLogin(ticket) } }
        }
        _state.value = ScanState.Idle
    }

    fun reset() {
        _state.value = ScanState.Idle
    }

    private fun extractTicket(raw: String): String {
        val trimmed = raw.trim()
        val marker = "ticket="
        val index = trimmed.indexOf(marker)
        return if (index >= 0) {
            trimmed.substring(index + marker.length).substringBefore('&').trim()
        } else {
            trimmed
        }
    }
}

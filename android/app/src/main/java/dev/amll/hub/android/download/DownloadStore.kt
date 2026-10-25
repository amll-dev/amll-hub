package dev.amll.hub.android.download

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 下载进度单例：前台服务写入，解析页读取。
 * 批量下载暂时只能有一个任务，新任务会覆盖上一次的完成状态。
 */
@Singleton
class DownloadStore @Inject constructor() {

    data class State(
        val running: Boolean = false,
        val total: Int = 0,
        val done: Int = 0,
        val failed: Int = 0,
        val currentName: String = "",
        val zip: Boolean = false,
        val message: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    fun start(total: Int, zip: Boolean) = _state.update {
        State(running = true, total = total, zip = zip)
    }

    fun progress(done: Int, failed: Int, currentName: String) = _state.update {
        it.copy(running = true, done = done, failed = failed, currentName = currentName, message = null)
    }

    fun finish(message: String? = null) = _state.update {
        it.copy(running = false, currentName = "", message = message)
    }
}

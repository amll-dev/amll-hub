package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.data.remote.SearchIpSubmissionDto
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.data.remote.SubmissionStatsDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 创作中心：歌词管理 + 每日推荐投稿 + 搜索 IP 投稿 + 稿件详情 */
@HiltViewModel
class CreatorViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    val submissions = MutableStateFlow(ListUi<SubmissionDto>())
    val submissionStatus = MutableStateFlow("all")
    val submissionStats = MutableStateFlow<SubmissionStatsDto?>(null)
    val dailySubmissions = MutableStateFlow(ListUi<DailyRecDto>())
    val searchIpSubmissions = MutableStateFlow(ListUi<SearchIpSubmissionDto>())
    val submissionDetail = MutableStateFlow<SubmissionDto?>(null)

    /** 歌词管理：列表 + 顶部统计，状态筛选与网页端一致 */
    fun loadSubmissions(status: String = submissionStatus.value) {
        submissionStatus.value = status
        viewModelScope.launch {
            submissions.update { it.copy(loading = true, error = null) }
            val result = repo.submissions(status)
            val items = result.getOrDefault(emptyList())
            submissions.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = result.exceptionOrNull()?.message
                        ?: if (items.isEmpty()) "暂无稿件" else null,
                )
            }
        }
    }

    fun loadSubmissionStats() {
        viewModelScope.launch { submissionStats.value = repo.submissionStats().getOrNull() }
    }

    fun loadDailySubmissions() {
        viewModelScope.launch {
            dailySubmissions.update { it.copy(loading = true, error = null) }
            val result = repo.dailySubmissions()
            val items = result.getOrDefault(emptyList())
            dailySubmissions.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = result.exceptionOrNull()?.message
                        ?: if (items.isEmpty()) "暂无每日推荐投稿" else null,
                )
            }
        }
    }

    fun loadSearchIpSubmissions() {
        viewModelScope.launch {
            searchIpSubmissions.update { it.copy(loading = true, error = null) }
            val result = repo.searchIpSubmissions()
            val items = result.getOrDefault(emptyList())
            searchIpSubmissions.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = result.exceptionOrNull()?.message
                        ?: if (items.isEmpty()) "暂无搜索 IP 投稿" else null,
                )
            }
        }
    }

    /** 稿件详情：按路由参数里的 id 拉取 */
    fun loadSubmission(id: Long) {
        if (id <= 0L) return
        submissionDetail.value = submissionDetail.value?.takeIf { it.id == id }
        viewModelScope.launch {
            repo.submission(id).getOrNull()?.let { submissionDetail.value = it }
        }
    }

    /** 稿件操作：成功后就地刷新列表与统计 */
    fun closeSubmission(id: Long, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val ok = repo.closeSubmission(id).getOrDefault(false)
            if (ok) refreshCreator()
            onDone(ok)
        }
    }

    fun adoptRevision(id: Long, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val ok = repo.adoptRevision(id).getOrDefault(false)
            if (ok) refreshCreator()
            onDone(ok)
        }
    }

    fun rejectRevision(id: Long, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val ok = repo.rejectRevision(id).getOrDefault(false)
            if (ok) refreshCreator()
            onDone(ok)
        }
    }

    private suspend fun refreshCreator() {
        val items = repo.submissions(submissionStatus.value).getOrDefault(emptyList())
        submissions.update { it.copy(items = items, loading = false) }
        submissionStats.value = repo.submissionStats().getOrNull()
        // 详情页标题栏的状态也要跟着变
        submissionDetail.value = submissionDetail.value?.let { d ->
            items.firstOrNull { it.id == d.id } ?: d
        }
    }
}

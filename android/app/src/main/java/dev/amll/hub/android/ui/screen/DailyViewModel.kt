package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DailyViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    val daily = MutableStateFlow(ListUi<DailyRecDto>())
    val likedDaily = MutableStateFlow<Set<Long>>(emptySet())

    /** 每日推荐投稿成功后要定位的日期；由 DailyScreen 进入时消费 */
    var pendingSelectDate: String? = null

    fun loadDaily() {
        viewModelScope.launch {
            daily.update { it.copy(loading = true, error = null) }
            val result = repo.daily()
            val items = result.getOrDefault(emptyList()).sortedByDescending { it.date }
            daily.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = result.exceptionOrNull()?.message
                        ?: if (items.isEmpty()) "暂无推荐" else null,
                )
            }
        }
    }

    /** 进入某张卡片时同步服务端点赞状态（与网页端一致） */
    fun loadLikeStatus(rec: DailyRecDto) {
        if (rec.id == 0L) return
        viewModelScope.launch {
            repo.likeStatus(rec.id).onSuccess { status ->
                likedDaily.update { if (status.liked) it + rec.id else it - rec.id }
                daily.update { ui ->
                    ui.copy(
                        items = ui.items.map {
                            if (it.id == rec.id) it.copy(likeCount = status.likeCount) else it
                        },
                    )
                }
            }
        }
    }

    fun toggleDailyLike(rec: DailyRecDto) {
        if (rec.id == 0L) return
        val liked = rec.id in likedDaily.value
        // 先本地翻转，失败再回滚
        likedDaily.update { if (liked) it - rec.id else it + rec.id }
        daily.update { ui ->
            ui.copy(
                items = ui.items.map {
                    if (it.id == rec.id) {
                        it.copy(likeCount = (it.likeCount + if (liked) -1 else 1).coerceAtLeast(0))
                    } else {
                        it
                    }
                },
            )
        }
        viewModelScope.launch {
            val result = repo.toggleLike(rec.id).getOrNull()
            if (result == null) {
                likedDaily.update { if (liked) it + rec.id else it - rec.id }
                daily.update { ui ->
                    ui.copy(
                        items = ui.items.map {
                            if (it.id == rec.id) {
                                it.copy(likeCount = (it.likeCount + if (liked) 1 else -1).coerceAtLeast(0))
                            } else {
                                it
                            }
                        },
                    )
                }
            } else {
                likedDaily.update { if (result.liked) it + rec.id else it - rec.id }
                daily.update { ui ->
                    ui.copy(items = ui.items.map { if (it.id == rec.id) it.copy(likeCount = result.likeCount) else it })
                }
            }
        }
    }
}

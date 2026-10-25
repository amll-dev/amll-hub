package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.LatestSongDto
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.remote.StatsDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUi(
    val loading: Boolean = true,
    val stats: StatsDto? = null,
    val today: DailyRecDto? = null,
    val latest: List<LatestSongDto> = emptyList(),
    val ranking: List<RankingItemDto> = emptyList(),
    val error: String? = null,
)

/** 首页 / 发现 / 最新收录共用：同一份内容缓存，切 Tab 不重复请求 */
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    val home = MutableStateFlow(HomeUi())

    fun loadHome() {
        viewModelScope.launch {
            home.update { it.copy(loading = true, error = null) }
            val stats = repo.stats()
            val today = repo.today()
            val latest = repo.latest()
            val ranking = repo.ranking(7)
            home.update {
                it.copy(
                    loading = false,
                    stats = stats.getOrNull(),
                    today = today.getOrNull(),
                    // 首页只展示前几条，完整列表在「最新收录」页
                    latest = latest.getOrDefault(emptyList()),
                    // 首页排行榜展示前 5 条，与网页端 NotFoundRanking 一致
                    ranking = ranking.getOrDefault(emptyList()).take(5),
                    error = latest.exceptionOrNull()?.message
                        ?: stats.exceptionOrNull()?.message,
                )
            }
        }
    }
}

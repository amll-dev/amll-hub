package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RankingViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    val ranking = MutableStateFlow(ListUi<RankingItemDto>())
    val rankingDays = MutableStateFlow(7)

    fun loadRanking(days: Int = rankingDays.value) {
        rankingDays.value = days
        viewModelScope.launch {
            ranking.update { it.copy(loading = true, error = null) }
            val result = repo.ranking(days)
            val items = result.getOrDefault(emptyList())
            ranking.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = result.exceptionOrNull()?.message
                        ?: if (items.isEmpty()) "暂无榜单数据" else null,
                )
            }
        }
    }
}

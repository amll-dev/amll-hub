package dev.amll.hub.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.lyric.LyricLine
import dev.amll.hub.android.data.lyric.TtmlParser
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.LatestSongDto
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.data.remote.UserProfile
import dev.amll.hub.android.data.remote.MessageDto
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.remote.StatsDto
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.data.repo.ContentRepository
import dev.amll.hub.android.playback.PlayerController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * 一个 Activity 级的共享 ViewModel：各页面共用同一份缓存与同一个播放器，
 * 避免切 Tab 重新请求、也避免播放状态分叉。
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    private val repo: ContentRepository,
    private val player: PlayerController,
) : ViewModel() {

    data class HomeUi(
        val loading: Boolean = true,
        val stats: StatsDto? = null,
        val today: DailyRecDto? = null,
        val latest: List<LatestSongDto> = emptyList(),
        val ranking: List<RankingItemDto> = emptyList(),
        val error: String? = null,
    )

    data class ListUi<T>(
        val loading: Boolean = true,
        val items: List<T> = emptyList(),
        val error: String? = null,
    )

    data class LyricUi(
        val loading: Boolean = false,
        val songId: String = "",
        val title: String = "",
        val artist: String = "",
        val cover: String? = null,
        val lines: List<LyricLine> = emptyList(),
        val ttml: String = "",
        val error: String? = null,
    )

    val home = MutableStateFlow(HomeUi())
    val ranking = MutableStateFlow(ListUi<RankingItemDto>())
    val rankingDays = MutableStateFlow(7)
    val daily = MutableStateFlow(ListUi<DailyRecDto>())
    val messages = MutableStateFlow(ListUi<MessageDto>())
    val submissions = MutableStateFlow(ListUi<SubmissionDto>())
    val lyric = MutableStateFlow(LyricUi())

    val playerState: StateFlow<PlayerController.State> = player.state

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
                    stats = stats,
                    today = today,
                    // 首页只展示前几条，完整列表在「最新收录」页
                    latest = latest,
                    ranking = ranking.take(2),
                    error = if (stats == null && latest.isEmpty()) "加载失败，请检查网络" else null,
                )
            }
        }
    }

    fun loadRanking(days: Int = rankingDays.value) {
        rankingDays.value = days
        viewModelScope.launch {
            ranking.update { it.copy(loading = true, error = null) }
            val items = repo.ranking(days)
            ranking.update {
                it.copy(loading = false, items = items, error = if (items.isEmpty()) "暂无榜单数据" else null)
            }
        }
    }

    fun loadDaily() {
        viewModelScope.launch {
            daily.update { it.copy(loading = true, error = null) }
            val items = repo.daily().sortedByDescending { it.date }
            daily.update {
                it.copy(loading = false, items = items, error = if (items.isEmpty()) "暂无推荐" else null)
            }
        }
    }

    fun loadMessages() {
        viewModelScope.launch {
            messages.update { it.copy(loading = true, error = null) }
            val items = repo.notifications()
            messages.update {
                it.copy(loading = false, items = items, error = if (items.isEmpty()) "暂无消息" else null)
            }
        }
    }

    fun loadSubmissions() {
        viewModelScope.launch {
            submissions.update { it.copy(loading = true, error = null) }
            val items = repo.submissions()
            submissions.update {
                it.copy(loading = false, items = items, error = if (items.isEmpty()) "暂无稿件" else null)
            }
        }
    }

    /**
     * 打开一首歌：拉 TTML + 音频直链，同时把曲目塞进播放器。
     * 拿不到音源时仍可浏览歌词（状态栏会提示）。
     */
    fun openTrack(songId: String, title: String, artist: String, cover: String?) {
        if (songId.isBlank()) {
            lyric.value = LyricUi(
                loading = false,
                title = title,
                artist = artist,
                cover = cover,
                error = "该歌曲没有关联的歌词 ID",
            )
            return
        }
        if (lyric.value.songId == songId && lyric.value.lines.isNotEmpty()) return

        lyric.value = LyricUi(
            loading = true,
            songId = songId,
            title = title,
            artist = artist,
            cover = cover,
        )
        viewModelScope.launch {
            val ttml = repo.lyricTtml(songId).orEmpty()
            val lines = withContext(Dispatchers.Default) {
                if (ttml.isBlank()) emptyList() else TtmlParser.parse(ttml)
            }
            val url = repo.audioUrl(songId)
            lyric.update {
                it.copy(
                    loading = false,
                    ttml = ttml,
                    lines = lines,
                    error = when {
                        ttml.isBlank() -> "暂无歌词文件"
                        lines.isEmpty() -> "歌词解析失败"
                        else -> null
                    },
                )
            }
            player.play(
                PlayerController.Track(
                    songId = songId,
                    title = title,
                    artist = artist,
                    coverUrl = cover,
                    streamUrl = url,
                    lyricTtml = ttml,
                ),
                url,
            )
        }
    }

    fun togglePlay() = player.toggle()

    fun seekTo(positionMs: Long) = player.seekTo(positionMs)

    /* ===== 资料 / 搜索 / 稿件详情 / 点赞 / 已读 ===== */

    data class SearchUi(
        val query: String = "",
        val loading: Boolean = false,
        /** all / song / artist / album / lyric / id，与网页端一致 */
        val field: String = "all",
        val hits: List<SearchHitDto> = emptyList(),
        val error: String? = null,
    )

    val profile = MutableStateFlow<UserProfile?>(null)
    val submissionDetail = MutableStateFlow<SubmissionDto?>(null)
    val search = MutableStateFlow(SearchUi())
    val likedDaily = MutableStateFlow<Set<Long>>(emptySet())

    /** 活动记录（真实数据，来自 /users/me/activity） */
    val activity = MutableStateFlow<UserActivityDto?>(null)
    val activityLoading = MutableStateFlow(false)

    fun loadProfile() {
        if (profile.value != null) return
        viewModelScope.launch { profile.value = repo.profile() }
    }

    fun loadActivity(year: Int? = null) {
        if (activityLoading.value) return
        // 已有当年数据就不再重复请求；显式传 year 时才刷新
        if (year == null && activity.value != null) return
        viewModelScope.launch {
            activityLoading.value = true
            val data = repo.activity(year)
            activity.value = data
            activityLoading.value = false
        }
    }

    fun saveDisplayName(name: String, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val updated = repo.updateDisplayName(name)
            if (updated != null) profile.value = updated
            onDone(updated != null)
        }
    }

    /** 打开稿件详情：先把列表项塞进去占位，再拉完整数据 */
    fun openSubmission(item: SubmissionDto?) {
        submissionDetail.value = item
        val id = item?.id ?: return
        viewModelScope.launch {
            repo.submission(id)?.let { submissionDetail.value = it }
        }
    }

    fun runSearch(keyword: String, field: String = search.value.field) {
        val trimmed = keyword.trim()
        search.update {
            it.copy(query = trimmed, field = field, loading = trimmed.isNotBlank(), error = null)
        }
        if (trimmed.isBlank()) {
            search.update { it.copy(hits = emptyList(), loading = false) }
            return
        }
        viewModelScope.launch {
            val hits = repo.search(trimmed, field)
            // 输入变化过快时丢弃旧请求的结果
            search.update { ui ->
                if (ui.query != trimmed || ui.field != field) {
                    ui
                } else {
                    ui.copy(
                        loading = false,
                        hits = hits,
                        error = if (hits.isEmpty()) "没有找到歌词" else null,
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
            ui.copy(items = ui.items.map {
                if (it.id == rec.id) it.copy(likeCount = (it.likeCount + if (liked) -1 else 1).coerceAtLeast(0)) else it
            })
        }
        viewModelScope.launch {
            val result = repo.toggleLike(rec.id)
            if (result == null) {
                likedDaily.update { if (liked) it + rec.id else it - rec.id }
                daily.update { ui ->
                    ui.copy(items = ui.items.map {
                        if (it.id == rec.id) it.copy(likeCount = (it.likeCount + if (liked) 1 else -1).coerceAtLeast(0)) else it
                    })
                }
            } else {
                likedDaily.update { if (result.liked) it + rec.id else it - rec.id }
                daily.update { ui ->
                    ui.copy(items = ui.items.map { if (it.id == rec.id) it.copy(likeCount = result.likeCount) else it })
                }
            }
        }
    }

    fun markRead(id: Long) {
        viewModelScope.launch {
            repo.markRead(id)
            messages.update { ui ->
                ui.copy(items = ui.items.map { if (it.id == id) it.copy(read = true) else it })
            }
        }
    }

    fun markAllRead() {
        viewModelScope.launch {
            repo.markAllRead()
            messages.update { ui -> ui.copy(items = ui.items.map { it.copy(read = true) }) }
        }
    }

    override fun onCleared() {
        player.release()
        super.onCleared()
    }
}

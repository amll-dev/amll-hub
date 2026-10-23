package dev.amll.hub.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.lyric.LrcParser
import dev.amll.hub.android.data.lyric.LyricLine
import dev.amll.hub.android.data.lyric.TtmlParser
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.LatestSongDto
import dev.amll.hub.android.data.remote.MessageDto
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.data.remote.SearchIpSubmissionDto
import dev.amll.hub.android.data.remote.StatsDto
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.data.remote.SubmissionStatsDto
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.data.remote.UserProfile
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

    /** 创作中心：统计 + 当前筛选 + 另外两类投稿 */
    val submissionStats = MutableStateFlow<SubmissionStatsDto?>(null)
    val submissionStatus = MutableStateFlow("all")
    val dailySubmissions = MutableStateFlow(ListUi<DailyRecDto>())
    val searchIpSubmissions = MutableStateFlow(ListUi<SearchIpSubmissionDto>())

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

    /** 歌词管理：列表 + 顶部统计，状态筛选与网页端一致 */
    fun loadSubmissions(status: String = submissionStatus.value) {
        submissionStatus.value = status
        viewModelScope.launch {
            submissions.update { it.copy(loading = true, error = null) }
            val items = repo.submissions(status)
            submissions.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = if (items.isEmpty()) "暂无稿件" else null,
                )
            }
        }
    }

    fun loadSubmissionStats() {
        viewModelScope.launch { submissionStats.value = repo.submissionStats() }
    }

    fun loadDailySubmissions() {
        viewModelScope.launch {
            dailySubmissions.update { it.copy(loading = true, error = null) }
            val items = repo.dailySubmissions()
            dailySubmissions.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = if (items.isEmpty()) "暂无每日推荐投稿" else null,
                )
            }
        }
    }

    fun loadSearchIpSubmissions() {
        viewModelScope.launch {
            searchIpSubmissions.update { it.copy(loading = true, error = null) }
            val items = repo.searchIpSubmissions()
            searchIpSubmissions.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = if (items.isEmpty()) "暂无搜索 IP 投稿" else null,
                )
            }
        }
    }

    /** 稿件操作：成功后就地刷新列表与统计 */
    fun closeSubmission(id: Long, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val ok = repo.closeSubmission(id)
            if (ok) refreshCreator()
            onDone(ok)
        }
    }

    fun adoptRevision(id: Long, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val ok = repo.adoptRevision(id)
            if (ok) refreshCreator()
            onDone(ok)
        }
    }

    fun rejectRevision(id: Long, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val ok = repo.rejectRevision(id)
            if (ok) refreshCreator()
            onDone(ok)
        }
    }

    private suspend fun refreshCreator() {
        val items = repo.submissions(submissionStatus.value)
        submissions.update { it.copy(items = items, loading = false) }
        submissionStats.value = repo.submissionStats()
        // 详情页标题栏的状态也要跟着变
        submissionDetail.value = submissionDetail.value?.let { d ->
            items.firstOrNull { it.id == d.id } ?: d
        }
    }

    /**
     * 打开一首歌：先解析音源（顺带把封面 / 歌手 / 标题补齐），再按优先级找歌词。
     *
     * 歌词来源与网页端 PlayerBoot 完全一致，逐级回退：
     * 1. 词库 TTML（搜索命中的 rawLyricFile）
     * 2. ncm-lyrics 目录下的 TTML
     * 3. parse-music 返回的 LRC（+ tlyric 合并翻译）
     * 都没有才真的没歌词 —— 但音频照常播放。
     */
    fun openTrack(
        songId: String,
        title: String,
        artist: String,
        cover: String?,
        rawLyricFile: String? = null,
    ) {
        val id = songId.trim()
        if (id.isBlank()) {
            lyric.value = LyricUi(
                loading = false,
                title = title,
                artist = artist,
                cover = cover,
                error = "该歌曲没有关联的网易云 ID",
            )
            return
        }
        // 同一首歌已经加载过就不再重复请求
        if (lyric.value.songId == id && lyric.value.lines.isNotEmpty() &&
            player.state.value.track?.songId == id
        ) {
            return
        }

        lyric.value = LyricUi(loading = true, songId = id, title = title, artist = artist, cover = cover)
        viewModelScope.launch {
            val music = repo.parseMusic(id)

            // 解析必须兜住：viewModelScope 里漏出去的异常会直接崩掉进程。
            // 后端偶尔会返回非 TTML 的内容（错误页等），解析器会抛
            val (lines, ttml) = withContext(Dispatchers.Default) {
                runCatching {
                    loadLyric(id, rawLyricFile, music?.lyric.orEmpty(), music?.tlyric.orEmpty())
                }.getOrElse { emptyList<LyricLine>() to "" }
            }

            val resolvedTitle = music?.displayName?.takeIf { it.isNotBlank() } ?: title
            val resolvedArtist = music?.displayArtist?.takeIf { it.isNotBlank() } ?: artist
            val resolvedCover = music?.displayCover?.takeIf { it.isNotBlank() } ?: cover

            lyric.update {
                it.copy(
                    loading = false,
                    songId = id,
                    title = resolvedTitle,
                    artist = resolvedArtist,
                    cover = resolvedCover,
                    ttml = ttml,
                    lines = lines,
                    error = null,
                )
            }
            val url = music?.displayUrl?.takeIf { it.isNotBlank() }
            player.play(
                PlayerController.Track(
                    songId = id,
                    title = resolvedTitle,
                    artist = resolvedArtist,
                    coverUrl = resolvedCover,
                    streamUrl = url,
                    lyricTtml = ttml,
                ),
                url,
            )
        }
    }

    /**
     * 歌词三级回退。返回解析好的行和原始 TTML（LRC 兜底时 ttml 为空）。
     */
    private suspend fun loadLyric(
        songId: String,
        rawLyricFile: String?,
        ncmLyric: String,
        ncmTLyric: String,
    ): Pair<List<LyricLine>, String> {
        val candidates = listOfNotNull(
            rawLyricFile?.takeIf { it.isNotBlank() }?.let { repo.rawLyricTtml(it) },
            repo.lyricTtml(songId),
        )
        candidates.firstOrNull { !it.isNullOrBlank() }?.let { ttml ->
            val parsed = TtmlParser.parse(ttml)
            if (parsed.isNotEmpty()) return parsed to ttml
        }

        if (ncmLyric.isNotBlank()) {
            val parsed = LrcParser.withTranslation(LrcParser.parse(ncmLyric), ncmTLyric)
            if (parsed.isNotEmpty()) return parsed to ""
        }
        return emptyList<LyricLine>() to ""
    }


    /** 从播放条进歌词页前调用：当前曲目的歌词还没加载就补一次 */
    fun ensurePlayerLyric() {
        val track = player.state.value.track ?: return
        if (lyric.value.songId == track.songId && lyric.value.lines.isNotEmpty()) return
        openTrack(track.songId, track.title, track.artist, track.coverUrl)
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

    fun toggleDailyLike(rec: DailyRecDto) {        if (rec.id == 0L) return
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

}

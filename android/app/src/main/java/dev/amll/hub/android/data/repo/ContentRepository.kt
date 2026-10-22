package dev.amll.hub.android.data.repo

import dev.amll.hub.android.data.remote.ContentApi
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.LatestSongDto
import dev.amll.hub.android.data.remote.LikeStatusDto
import dev.amll.hub.android.data.remote.MessageDto
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.remote.ProfileUpdateRequest
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.remote.RawApi
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.data.remote.StatsDto
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.data.remote.UserProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 内容仓库：接口失败一律降级为空，UI 走空态/错误态，不把异常抛到 Composable。
 */
@Singleton
class ContentRepository @Inject constructor(
    private val api: ContentApi,
    private val raw: RawApi,
) {
    suspend fun stats(): StatsDto? = io { runCatching { api.stats().data }.getOrNull() }

    suspend fun latest(): List<LatestSongDto> = io {
        runCatching { api.latestSongs().data.orEmpty() }.getOrDefault(emptyList())
    }

    suspend fun daily(): List<DailyRecDto> = io {
        runCatching { api.dailyRecommendations().data.orEmpty() }.getOrDefault(emptyList())
    }

    suspend fun today(): DailyRecDto? = io { runCatching { api.todayRecommendation().data }.getOrNull() }

    suspend fun ranking(days: Int): List<RankingItemDto> = io {
        runCatching { api.notFoundRanking(days = days).data?.items.orEmpty() }
            .getOrDefault(emptyList())
    }

    suspend fun notifications(type: String? = null): List<MessageDto> = io {
        runCatching { api.notifications(type = type).data?.items.orEmpty() }.getOrDefault(emptyList())
    }

    suspend fun submissions(status: String? = null): List<SubmissionDto> = io {
        runCatching { api.submissions(status = status).data?.items.orEmpty() }
            .getOrDefault(emptyList())
    }

    /** TTML 原文，用于歌词页与沉浸页 */
    suspend fun lyricTtml(songId: String): String? = io {
        runCatching { raw.ncmLyric(songId).string() }.getOrNull()
    }

    /** ncm 解析出的音频直链；接口返回的不是统一包装，用正则兜底 */
    suspend fun audioUrl(songId: String): String? = io {
        runCatching {
        val body = raw.parseMusicRaw(songId).string()
        Regex("\"url\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
        }.getOrNull()
    }

    suspend fun profile(): UserProfile? = io { runCatching { api.profile().data }.getOrNull() }

    suspend fun updateDisplayName(name: String): UserProfile? = io {
        runCatching { api.updateProfile(ProfileUpdateRequest(displayName = name)).data }.getOrNull()
    }

    suspend fun search(keyword: String, field: String = "all"): List<SearchHitDto> = io {
        runCatching { api.search(keyword, field = field).data?.hits.orEmpty() }
            .getOrDefault(emptyList())
    }

    suspend fun ncmSearch(keyword: String): List<NcmSongDto> = io {
        runCatching { api.ncmSearch(keyword).data?.all.orEmpty() }.getOrDefault(emptyList())
    }

    suspend fun submission(id: Long): SubmissionDto? =
        io { runCatching { api.submission(id).data }.getOrNull() }

    /** 年度活动统计；未登录或接口异常返回 null，UI 走空态 */
    suspend fun activity(year: Int? = null): UserActivityDto? =
        io { runCatching { api.activity(year).data }.getOrNull() }

    suspend fun markAllRead() {
        io { runCatching { api.markAllNotificationsRead() } }
    }

    suspend fun markRead(id: Long) {
        io { runCatching { api.markNotificationRead(id) } }
    }

    suspend fun toggleLike(id: Long): LikeStatusDto? =
        io { runCatching { api.toggleDailyLike(id).data }.getOrNull() }

    suspend fun likeStatus(id: Long): LikeStatusDto? =
        io { runCatching { api.dailyLikeStatus(id).data }.getOrNull() }

    private suspend fun <T> io(block: suspend () -> T): T = withContext(Dispatchers.IO) { block() }
}

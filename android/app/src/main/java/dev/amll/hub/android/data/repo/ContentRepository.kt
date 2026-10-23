package dev.amll.hub.android.data.repo

import dev.amll.hub.android.data.remote.ContentApi
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.LatestSongDto
import dev.amll.hub.android.data.remote.LikeStatusDto
import dev.amll.hub.android.data.remote.MessageDto
import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.data.remote.NcmPlaylistDto
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.remote.ProfileUpdateRequest
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.remote.RawApi
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.data.remote.SearchIpSubmissionDto
import dev.amll.hub.android.data.remote.StatsDto
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.data.remote.SubmissionStatsDto
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.data.remote.UserProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.SerializationException
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 内容仓库：接口失败一律降级为空，UI 走空态/错误态，不把异常抛到 Composable。
 *
 * 例外是网易云解析相关接口（[ncmSearch] / [parseMusic] / [ncmPlaylist]）：
 * 失败会抛出带后端原因的异常，由调用方展示——「解析用不了」只显示搜不到的话，
 * 永远查不出是上游没配 Cookie 还是响应结构对不上。
 */
@Singleton
class ContentRepository @Inject constructor(
    private val api: ContentApi,
    private val raw: RawApi,
) {
    /** 从后端错误响应体里抠出 message 字段 */
    private fun apiErrorMessage(e: HttpException): String? = runCatching {
        val body = e.response()?.errorBody()?.string().orEmpty()
        Regex("\"message\"\\s*:\\s*\"([^\"]*)\"").find(body)?.groupValues?.get(1)
    }.getOrNull()

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

    suspend fun submissions(status: String = "all"): List<SubmissionDto> = io {
        runCatching { api.submissions(status = status).data?.items.orEmpty() }
            .getOrDefault(emptyList())
    }

    suspend fun submissionStats(): SubmissionStatsDto? = io {
        runCatching { api.submissionStats().data }.getOrNull()
    }

    /** 每日推荐投稿（创作中心） */
    suspend fun dailySubmissions(): List<DailyRecDto> = io {
        runCatching { api.myDailySubmissions().data?.items.orEmpty() }.getOrDefault(emptyList())
    }

    /** 搜索 IP 投稿（创作中心） */
    suspend fun searchIpSubmissions(): List<SearchIpSubmissionDto> = io {
        runCatching { api.mySearchIpSubmissions().data?.items.orEmpty() }.getOrDefault(emptyList())
    }

    /** 关闭自己的稿件 */
    suspend fun closeSubmission(id: Long): Boolean = io {
        runCatching { api.closeSubmission(id).isSuccessful }.getOrDefault(false)
    }

    /** 确认（采用）审核员修订版 */
    suspend fun adoptRevision(id: Long): Boolean = io {
        runCatching { api.adoptRevision(id).isSuccessful }.getOrDefault(false)
    }

    /** 退回修订版，要求重新修改 */
    suspend fun rejectRevision(id: Long): Boolean = io {
        runCatching { api.rejectRevision(id).isSuccessful }.getOrDefault(false)
    }

    /** TTML 原文，用于歌词页 */
    suspend fun lyricTtml(songId: String): String? = io {
        runCatching { raw.ncmLyric(songId).string() }.getOrNull()
    }

    /** 词库里的 TTML（搜索命中的 rawLyricFile） */
    suspend fun rawLyricTtml(fileName: String): String? = io {
        if (fileName.isBlank()) null
        else runCatching { raw.rawLyric(fileName).string() }.getOrNull()
    }

    /**
     * 解析单曲：音频直链 + 封面 / 歌手 / 标题 / 歌词。
     * 与网页端 playNcmSong 走的是同一个接口，所以「没封面」的歌也能补齐。
     */
    suspend fun parseMusic(songId: String, level: String = "exhigh"): NcmMusicDto? = io {
        try {
            api.ncmParseMusic(songId, level).data
        } catch (e: HttpException) {
            throw IOException(apiErrorMessage(e) ?: "解析失败（HTTP ${e.code()}）")
        } catch (e: SerializationException) {
            throw IOException("响应解析失败：${e.message.orEmpty().take(140)}")
        }
    }

    /** 音频直链（兼容老调用） */
    suspend fun audioUrl(songId: String): String? =
        parseMusic(songId)?.displayUrl?.takeIf { it.isNotBlank() }

    /** 网易云关键词搜索 */
    /**
     * 网易云搜索。
     *
     * 这里不吞错误：上游报错 / HTTP 异常 / 响应解析失败都会抛出带原因的异常，
     * 由 UI 显示具体原因，否则「网易云解析用不了」时只能看到一句搜不到。
     */
    suspend fun ncmSearch(keyword: String, limit: Int = 20): List<NcmSongDto> = io {
        try {
            api.ncmSearch(keyword, limit).data?.songs.orEmpty()
        } catch (e: HttpException) {
            throw IOException(apiErrorMessage(e) ?: "搜索失败（HTTP ${e.code()}）")
        } catch (e: SerializationException) {
            throw IOException("响应解析失败：${e.message.orEmpty().take(140)}")
        }
    }

    /** 网易云歌单解析 */
    suspend fun ncmPlaylist(playlistId: String): NcmPlaylistDto? = io {
        try {
            api.ncmParsePlaylist(playlistId).data?.playlist
        } catch (e: HttpException) {
            throw IOException(apiErrorMessage(e) ?: "歌单解析失败（HTTP ${e.code()}）")
        } catch (e: SerializationException) {
            throw IOException("响应解析失败：${e.message.orEmpty().take(140)}")
        }
    }

    suspend fun profile(): UserProfile? = io { runCatching { api.profile().data }.getOrNull() }

    suspend fun updateDisplayName(name: String): UserProfile? = io {
        runCatching { api.updateProfile(ProfileUpdateRequest(displayName = name)).data }.getOrNull()
    }

    suspend fun search(keyword: String, field: String = "all"): List<SearchHitDto> = io {
        runCatching { api.search(keyword, field = field).data?.hits.orEmpty() }
            .getOrDefault(emptyList())
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

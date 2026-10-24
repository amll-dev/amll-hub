package dev.amll.hub.android.data.repo

import dev.amll.hub.android.data.remote.ApiErrorParser
import dev.amll.hub.android.data.remote.ApiException
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 内容仓库：所有接口都以 [Result] 返回，ViewModel 据此区分
 * 「成功但为空」与「请求失败」，不会再把错误折叠成空列表。
 */
@Singleton
class ContentRepository @Inject constructor(
    private val api: ContentApi,
    private val raw: RawApi,
) {

    suspend fun stats(): Result<StatsDto> = result { api.stats().data ?: fail("服务端返回空数据") }

    suspend fun latest(): Result<List<LatestSongDto>> =
        result { api.latestSongs().data.orEmpty() }

    suspend fun daily(): Result<List<DailyRecDto>> =
        result { api.dailyRecommendations().data.orEmpty() }

    suspend fun today(): Result<DailyRecDto?> = result { api.todayRecommendation().data }

    suspend fun ranking(days: Int): Result<List<RankingItemDto>> =
        result { api.notFoundRanking(days = days).data?.items.orEmpty() }

    suspend fun notifications(type: String? = null): Result<List<MessageDto>> =
        result { api.notifications(type = type).data?.items.orEmpty() }

    suspend fun submissions(status: String = "all"): Result<List<SubmissionDto>> =
        result { api.submissions(status = status).data?.items.orEmpty() }

    suspend fun submissionStats(): Result<SubmissionStatsDto> =
        result { api.submissionStats().data ?: fail("服务端返回空数据") }

    /** 每日推荐投稿（创作中心） */
    suspend fun dailySubmissions(): Result<List<DailyRecDto>> =
        result { api.myDailySubmissions().data?.items.orEmpty() }

    /** 搜索 IP 投稿（创作中心） */
    suspend fun searchIpSubmissions(): Result<List<SearchIpSubmissionDto>> =
        result { api.mySearchIpSubmissions().data?.items.orEmpty() }

    /** 关闭自己的稿件 */
    suspend fun closeSubmission(id: Long): Result<Boolean> =
        result { api.closeSubmission(id).isSuccessful }

    /** 确认（采用）审核员修订版 */
    suspend fun adoptRevision(id: Long): Result<Boolean> =
        result { api.adoptRevision(id).isSuccessful }

    /** 退回修订版，要求重新修改 */
    suspend fun rejectRevision(id: Long): Result<Boolean> =
        result { api.rejectRevision(id).isSuccessful }

    /** TTML 原文，用于歌词页 */
    suspend fun lyricTtml(songId: String): Result<String?> =
        result { raw.ncmLyric(songId).string() }

    /** 词库里的 TTML（搜索命中的 rawLyricFile） */
    suspend fun rawLyricTtml(fileName: String): Result<String?> =
        result { raw.rawLyric(fileName).string() }

    /**
     * 解析单曲：音频直链 + 封面 / 歌手 / 标题 / 歌词。
     * 与网页端 playNcmSong 走的是同一个接口，所以「没封面」的歌也能补齐。
     */
    suspend fun parseMusic(songId: String, level: String = "exhigh"): Result<NcmMusicDto> =
        result("解析失败") {
            api.ncmParseMusic(songId, level).data ?: fail("解析失败（响应为空）")
        }

    /** 音频直链（兼容老调用） */
    suspend fun audioUrl(songId: String): String? =
        parseMusic(songId).getOrNull()?.displayUrl?.takeIf { it.isNotBlank() }

    /** 网易云关键词搜索，失败原因原样交给 UI 展示 */
    suspend fun ncmSearch(keyword: String, limit: Int = 20): Result<List<NcmSongDto>> =
        result("搜索失败") { api.ncmSearch(keyword, limit).data?.songs.orEmpty() }

    /** 网易云歌单解析 */
    suspend fun ncmPlaylist(playlistId: String): Result<NcmPlaylistDto> =
        result("歌单解析失败") {
            api.ncmParsePlaylist(playlistId).data?.playlist ?: fail("歌单解析失败（响应为空）")
        }

    suspend fun updateDisplayName(name: String): Result<UserProfile> =
        result { api.updateProfile(ProfileUpdateRequest(displayName = name)).data ?: fail("服务端返回空数据") }

    suspend fun search(keyword: String, field: String = "all"): Result<List<SearchHitDto>> =
        result { api.search(keyword, field = field).data?.hits.orEmpty() }

    suspend fun submission(id: Long): Result<SubmissionDto> =
        result { api.submission(id).data ?: fail("服务端返回空数据") }

    /** 年度活动统计；未登录或接口异常返回失败，UI 走空态 */
    suspend fun activity(year: Int? = null): Result<UserActivityDto> =
        result { api.activity(year).data ?: fail("服务端返回空数据") }

    suspend fun markAllRead(): Result<Unit> = result { api.markAllNotificationsRead() }

    suspend fun markRead(id: Long): Result<Unit> = result { api.markNotificationRead(id) }

    suspend fun toggleLike(id: Long): Result<LikeStatusDto> =
        result { api.toggleDailyLike(id).data ?: fail("服务端返回空数据") }

    suspend fun likeStatus(id: Long): Result<LikeStatusDto> =
        result { api.dailyLikeStatus(id).data ?: fail("服务端返回空数据") }

    private fun fail(message: String): Nothing = throw ApiException(200, message)

    private suspend fun <T> result(
        fallbackPrefix: String = "请求失败",
        block: suspend () -> T,
    ): Result<T> = withContext(Dispatchers.IO) {
        try {
            Result.success(block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(ApiErrorParser.map(e, fallbackPrefix))
        }
    }
}

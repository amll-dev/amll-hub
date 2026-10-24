package dev.amll.hub.android.data.remote

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * 内容相关接口，路径与 frontend/src/lib/api.ts 保持一致。
 */
interface ContentApi {

    @GET("api/v1/stats")
    suspend fun stats(): ApiResponse<StatsDto>

    @GET("api/v1/latest-songs")
    suspend fun latestSongs(): ApiResponse<List<LatestSongDto>>

    @GET("api/v1/daily-recommendations")
    suspend fun dailyRecommendations(): ApiResponse<List<DailyRecDto>>

    @GET("api/v1/daily-recommendations/today")
    suspend fun todayRecommendation(): ApiResponse<DailyRecDto?>

    @GET("api/v1/daily-recommendations/like/{id}")
    suspend fun dailyLikeStatus(@Path("id") id: Long): ApiResponse<LikeStatusDto>

    @POST("api/v1/daily-recommendations/like/{id}")
    suspend fun toggleDailyLike(@Path("id") id: Long): ApiResponse<LikeStatusDto>

    @GET("api/v1/not-found-ranking")
    suspend fun notFoundRanking(
        @Query("limit") limit: String = "all",
        @Query("days") days: Int = 7,
        @Query("platform") platform: String? = null,
    ): ApiResponse<RankingResultDto>

    @GET("api/v1/notifications")
    suspend fun notifications(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20,
        @Query("type") type: String? = null,
    ): ApiResponse<NotificationListDto>

    @POST("api/v1/notifications/read-all")
    suspend fun markAllNotificationsRead(): ApiResponse<UpdatedDto>

    @POST("api/v1/notifications/{id}/read")
    suspend fun markNotificationRead(@Path("id") id: Long): ApiResponse<UpdatedDto>

    @GET("api/v1/submissions")
    suspend fun submissions(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 50,
        @Query("status") status: String = "all",
        @Query("mode") mode: String = "creator",
    ): ApiResponse<SubmissionListDto>

    /** 投稿统计（创作中心顶部卡片） */
    @GET("api/v1/submissions/stats")
    suspend fun submissionStats(@Query("mode") mode: String = "creator"): ApiResponse<SubmissionStatsDto>

    @GET("api/v1/submissions/{id}")
    suspend fun submission(@Path("id") id: Long): ApiResponse<SubmissionDto>

    @GET("api/v1/search")
    suspend fun search(
        @Query("q") keyword: String,
        @Query("field") field: String = "all",
        @Query("limit") limit: Int = 20,
    ): ApiResponse<SearchResultDto>

    @GET("api/v1/ncm/search")
    suspend fun ncmSearch(
        @Query("q") keyword: String,
        @Query("limit") limit: Int = 20,
    ): ApiResponse<NcmSearchDto>

    /** 网易云单曲解析：拿到音频直链 + 封面 / 歌手 / 歌词 */
    @GET("api/v1/ncm/parse-music")
    suspend fun ncmParseMusic(
        @Query("songId") songId: String,
        @Query("level") level: String = "exhigh",
    ): ApiResponse<NcmMusicDto>

    /** 网易云歌单解析 */
    @GET("api/v1/ncm/parse-playlist")
    suspend fun ncmParsePlaylist(
        @Query("playlistId") playlistId: String,
    ): ApiResponse<NcmPlaylistWrapperDto>

    /** 每日推荐投稿列表（创作中心） */
    @GET("api/v1/daily-recommendations/submissions")
    suspend fun myDailySubmissions(): ApiResponse<DailySubmissionListDto>

    /** 搜索 IP 投稿列表（创作中心） */
    @GET("api/v1/search-ip/submissions")
    suspend fun mySearchIpSubmissions(): ApiResponse<SearchIpListDto>

    /* ===== 稿件操作：只关心 HTTP 是否成功，不解析具体返回体 ===== */

    @POST("api/v1/submissions/{id}/close")
    suspend fun closeSubmission(@Path("id") id: Long): Response<ResponseBody>

    @POST("api/v1/submissions/{id}/revision/adopt")
    suspend fun adoptRevision(@Path("id") id: Long): Response<ResponseBody>

    @POST("api/v1/submissions/{id}/revision/reject")
    suspend fun rejectRevision(@Path("id") id: Long): Response<ResponseBody>

    @PUT("api/v1/auth/profile")
    suspend fun updateProfile(@Body body: ProfileUpdateRequest): ApiResponse<UserProfile>

    /** 个人活动统计（热力图） GET /api/v1/users/me/activity */
    @GET("api/v1/users/me/activity")
    suspend fun activity(@Query("year") year: Int? = null): ApiResponse<UserActivityDto>
}

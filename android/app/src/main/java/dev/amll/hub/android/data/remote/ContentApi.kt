package dev.amll.hub.android.data.remote

import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
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

    /* ===== 投稿流程（网页端 LyricSubmitForm / DailyRecommendForm 同款接口） ===== */

    /** TTML 校验：body 是原始 TTML 文本（text/plain） */
    @POST("api/v1/submissions/validate")
    suspend fun validateTtml(@Body body: RequestBody): ApiResponse<TtmlValidationDto>

    /** TTML 上传到待审核区：multipart file + fileName */
    @Multipart
    @POST("api/v1/uploads/ttml")
    suspend fun uploadTtml(
        @Part file: MultipartBody.Part,
        @Part("fileName") fileName: RequestBody,
    ): ApiResponse<UploadedFileDto>

    /** 创建投稿（字幕文件 + 元数据），返回 { id } */
    @POST("api/v1/submissions")
    suspend fun createSubmission(@Body body: CreateSubmissionRequest): ApiResponse<IdDto>

    /** 投稿音源附件：multipart audio + submissionId */
    @Multipart
    @POST("api/v1/uploads/audio")
    suspend fun uploadAudio(
        @Part audio: MultipartBody.Part,
        @Part("submissionId") submissionId: RequestBody,
    ): Response<ResponseBody>

    /** 每日推荐封面：上传到临时区，返回 { tempKey } */
    @Multipart
    @POST("api/v1/daily-recommendations/upload-temp")
    suspend fun uploadDailyCover(@Part file: MultipartBody.Part): ApiResponse<TempKeyDto>

    /** 每日推荐封面：由后端代理下载网易云封面并转存 */
    @POST("api/v1/daily-recommendations/upload-temp-from-url")
    suspend fun uploadDailyCoverFromUrl(@Body body: UrlRequest): ApiResponse<TempKeyDto>

    /** 每日推荐日期查重 */
    @GET("api/v1/daily-recommendations/check-date")
    suspend fun checkDailyDate(@Query("date") date: String): ApiResponse<DateAvailabilityDto>

    /** 创建每日推荐投稿：multipart 表单 */
    @Multipart
    @POST("api/v1/daily-recommendations")
    suspend fun createDailyRecommendation(
        @Part("songName") songName: RequestBody,
        @Part("artist") artist: RequestBody,
        @Part("coverTempKey") coverTempKey: RequestBody,
        @Part("date") date: RequestBody,
        @Part("comment") comment: RequestBody,
        @Part("ncmId") ncmId: RequestBody,
    ): ApiResponse<IdDto>

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

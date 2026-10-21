package dev.amll.hub.android.data.remote

import okhttp3.ResponseBody
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * 少数接口不套 {code,message,data} 包装：
 * - ncm 解析直接返回 JSON
 * - TTML 歌词直接返回字节流
 */
interface RawApi {

    @GET("api/v1/ncm/parse-music")
    suspend fun parseMusicRaw(
        @Query("songId") songId: String,
        @Query("level") level: String = "exhigh",
    ): ResponseBody

    @GET("api/v1/lyrics/ncm-lyrics/{songId}")
    suspend fun ncmLyric(@Path("songId") songId: String): ResponseBody
}

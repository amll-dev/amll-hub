package dev.amll.hub.android.data.remote

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/** AMLL Hub 认证相关接口，路径与后端 router.go 保持一致 */
interface AuthApi {

    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): ApiResponse<LoginResult>

    @POST("api/v1/auth/login-code")
    suspend fun loginByCode(@Body body: LoginByCodeRequest): ApiResponse<LoginResult>

    @POST("api/v1/auth/send-code")
    suspend fun sendCode(@Body body: SendCodeRequest): ApiResponse<Unit>

    @GET("api/v1/auth/profile")
    suspend fun profile(): ApiResponse<UserProfile>

    // ---- 扫码登录 ----

    /** 申请扫码登录票据（App 侧一般不需要，网页端用） */
    @POST("api/v1/auth/qrcode")
    suspend fun createQrTicket(): ApiResponse<QrTicket>

    /** 轮询票据状态（网页端用） */
    @GET("api/v1/auth/qrcode/status")
    suspend fun qrTicketStatus(@Query("ticket") ticket: String): ApiResponse<QrTicketStatus>

    /** 扫到码、用户尚未确认时上报 */
    @POST("api/v1/auth/qrcode/scanned")
    suspend fun markQrScanned(@Body body: TicketRequest): ApiResponse<Unit>

    /** 确认登录，把当前账号授权给该票据 */
    @POST("api/v1/auth/qrcode/confirm")
    suspend fun confirmQr(@Body body: TicketRequest): ApiResponse<Unit>

    /** 取消本次扫码登录 */
    @POST("api/v1/auth/qrcode/cancel")
    suspend fun cancelQr(@Body body: TicketRequest): ApiResponse<Unit>
}

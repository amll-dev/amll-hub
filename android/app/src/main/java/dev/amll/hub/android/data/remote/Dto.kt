package dev.amll.hub.android.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 后端统一响应包装，对应 backend/internal/pkg/response.go */
@Serializable
data class ApiResponse<T>(
    val code: Int,
    val message: String,
    val data: T? = null,
)

/** 用户资料，对应后端 service.UserProfile */
@Serializable
data class UserProfile(
    val name: String = "",
    @SerialName("displayName") val displayName: String = "",
    val email: String = "",
    val avatar: String = "",
    val phone: String? = null,
    @SerialName("isReviewer") val isReviewer: Boolean = false,
    @SerialName("isAdmin") val isAdmin: Boolean = false,
)

/** 登录结果，对应后端 service.LoginResult */
@Serializable
data class LoginResult(
    val token: String,
    val user: UserProfile,
)

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class LoginByCodeRequest(val dest: String, val code: String)

@Serializable
data class SendCodeRequest(
    val checkType: String,
    val dest: String,
    val method: String = "login",
    val captchaType: String = "none",
    val captchaToken: String = "",
)

/** 扫码登录票据，对应后端 service.QRTicketCreateResult */
@Serializable
data class QrTicket(
    val ticket: String,
    val qrContent: String,
    val expiresIn: Int = 300,
)

/** 扫码票据状态，对应后端 service.QRTicketStatusResult */
@Serializable
data class QrTicketStatus(
    val status: String,
    val token: String? = null,
    val user: UserProfile? = null,
) {
    val isPending: Boolean get() = status == "pending"
    val isScanned: Boolean get() = status == "scanned"
    val isConfirmed: Boolean get() = status == "confirmed"
    val isExpired: Boolean get() = status == "expired"
}

@Serializable
data class TicketRequest(val ticket: String)

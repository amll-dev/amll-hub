package dev.amll.hub.android.ui.screen

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import com.mobile.auth.gatewayauth.AuthUIConfig
import com.mobile.auth.gatewayauth.AuthUIControlClickListener
import com.mobile.auth.gatewayauth.PhoneNumberAuthHelper
import com.mobile.auth.gatewayauth.PreLoginResultListener
import com.mobile.auth.gatewayauth.ResultCode
import com.mobile.auth.gatewayauth.TokenResultListener
import com.mobile.auth.gatewayauth.model.TokenRet
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.amll.hub.android.BuildConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 阿里云号码认证 Android SDK 的薄封装。
 *
 * 流程：setAuthSDKInfo → 预取号判断本机号码可用性 → getLoginToken 拉起授权页。
 * 授权页的「其他登录方式」由 SDK 默认控件提供，点击后关闭授权页并回退到表单。
 */
@Singleton
class PnvsAuthManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    /** 未配置 Android 方案密钥时整个功能关闭 */
    val enabled: Boolean get() = BuildConfig.PNVS_AUTH_SECRET.isNotBlank()

    private var helper: PhoneNumberAuthHelper? = null
    private var configured = false
    private var settled = false

    private fun helper(): PhoneNumberAuthHelper? {
        if (!enabled) return null
        helper?.let { return it }

        val instance = PhoneNumberAuthHelper.getInstance(
            context,
            object : TokenResultListener {
                override fun onTokenSuccess(s: String) = Unit
                override fun onTokenFailed(s: String) = Unit
            },
        )
        if (!configured) {
            instance.setAuthSDKInfo(BuildConfig.PNVS_AUTH_SECRET)
            runCatching { instance.reporter.setLoggerEnable(BuildConfig.DEBUG) }
            configured = true
        }
        helper = instance
        return instance
    }

    /** 预取号：成功说明当前网络能识别本机号码，才展示一键登录页 */
    fun prefetch(onResult: (Boolean) -> Unit) {
        val h = helper()
        if (h == null) {
            onResult(false)
            return
        }
        runCatching {
            h.accelerateLoginPage(
                3000,
                object : PreLoginResultListener {
                    override fun onTokenSuccess(vendor: String) = onResult(true)
                    override fun onTokenFailed(vendor: String, errorMsg: String) = onResult(false)
                },
            )
        }.onFailure { onResult(false) }
    }

    /** 拉起授权页；成功回调运营商 token，取消/切换则回调 onSwitch */
    fun login(
        activity: Activity,
        onToken: (String) -> Unit,
        onSwitch: () -> Unit,
        onError: (String) -> Unit,
    ) {
        val h = helper()
        if (h == null) {
            onError("当前设备不支持本机号码一键登录")
            return
        }

        settled = false
        h.setAuthListener(
            object : TokenResultListener {
                override fun onTokenSuccess(s: String) {
                    val ret = runCatching { TokenRet.fromJson(s) }.getOrNull() ?: return
                    if (ret.code == ResultCode.CODE_SUCCESS && !ret.token.isNullOrBlank()) {
                        if (settled) return
                        settled = true
                        runCatching { h.quitLoginPage() }
                        onToken(ret.token)
                    }
                }

                override fun onTokenFailed(s: String) {
                    if (settled) return
                    val ret = runCatching { TokenRet.fromJson(s) }.getOrNull()
                    when (ret?.code) {
                        ResultCode.CODE_ERROR_USER_SWITCH,
                        ResultCode.CODE_ERROR_USER_CANCEL,
                        ResultCode.CODE_ERROR_USER_CONTROL_CANCEL_BYBTN,
                        ResultCode.CODE_ERROR_USER_CONTROL_CANCEL_BYKEY -> {
                            settled = true
                            runCatching { h.quitLoginPage() }
                            onSwitch()
                        }

                        ResultCode.CODE_START_AUTHPAGE_SUCCESS -> Unit
                        else -> {
                            settled = true
                            onError(ret?.msg ?: "一键登录失败，请使用其他方式登录")
                        }
                    }
                }
            },
        )

        // 默认「其他登录方式」点击后 SDK 会关闭授权页，这里同步把 UI 切回表单
        h.setUIClickListener(
            object : AuthUIControlClickListener {
                override fun onClick(code: String, context: Context, jsonString: String) {
                    when (code) {
                        ResultCode.CODE_ERROR_USER_SWITCH,
                        ResultCode.CODE_ERROR_USER_CANCEL,
                        ResultCode.CODE_ERROR_USER_CONTROL_CANCEL_BYBTN,
                        ResultCode.CODE_ERROR_USER_CONTROL_CANCEL_BYKEY -> {
                            if (!settled) {
                                settled = true
                                runCatching { h.quitLoginPage() }
                                onSwitch()
                            }
                        }
                    }
                }
            },
        )

        h.setAuthUIConfig(buildUiConfig())
        h.getLoginToken(activity, 5000)
    }

    /** 授权页样式对齐网页端参考图：品牌 Logo、协议、一键登录按钮、其他登录方式 */
    private fun buildUiConfig(): AuthUIConfig =
        AuthUIConfig.Builder()
            .setPrivacyBefore("我已阅读并同意")
            .setAppPrivacyOne("《用户协议》", "$BRAND_BASE/terms")
            .setAppPrivacyTwo("《隐私政策》", "$BRAND_BASE/privacy")
            .setPrivacyOperatorIndex(2)
            .setPrivacyState(false)
            .setPrivacyTextSize(10)
            .setNavHidden(false)
            .setNavReturnHidden(false)
            .setLogoHidden(false)
            .setLogoImgPath("ic_launcher_logo")
            .setLogoWidth(72)
            .setLogoHeight(72)
            .setNumberSizeDp(22)
            .setLogBtnText("一键登录")
            .setLogBtnTextSizeDp(16)
            .setLogBtnHeight(48)
            .setLogBtnMarginLeftAndRight(24)
            .setLogBtnBackgroundPath("pnvs_login_btn_bg")
            .setSwitchAccHidden(false)
            .setSloganText(" ")
            .setDialogBottom(false)
            .setScreenOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
            .create()

    companion object {
        private const val BRAND_BASE = "https://beta.amllhub.bikonoo.com"
    }
}

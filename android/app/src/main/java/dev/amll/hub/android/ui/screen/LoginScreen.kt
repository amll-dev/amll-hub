package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.R
import dev.amll.hub.android.data.remote.UserProfile
import dev.amll.hub.android.ui.component.AmllTextField
import dev.amll.hub.android.ui.component.CaptchaDialog
import dev.amll.hub.android.ui.component.ErrorBanner
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.SegmentedTabs
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/**
 * 登录页：与 App 其余页面共用同一套颜色/字号/圆角 token，
 * 发码流程与网页端一致（check-user → 人机验证 → send-code）。
 */
@Composable
fun LoginScreen(
    onLoggedIn: (UserProfile) -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Box(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BrandMark()
            Spacer(Modifier.height(26.dp))
            Text(
                "登录 AMLL Hub",
                style = Font.pageTitle.copy(fontSize = 22.sp),
                color = Amll.colors.ink,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "登录后即可投稿歌词、参与审核",
                style = Font.caption,
                color = Amll.colors.ink3,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(26.dp))

            SegmentedTabs(
                labels = listOf("密码登录", "验证码登录"),
                selectedIndex = if (state.tab == LoginTab.PASSWORD) 0 else 1,
                onSelect = { index ->
                    viewModel.switchTab(if (index == 0) LoginTab.PASSWORD else LoginTab.CODE)
                },
            )

            Spacer(Modifier.height(18.dp))

            state.error?.let { message ->
                ErrorBanner(message = message)
                Spacer(Modifier.height(12.dp))
            }

            when (state.tab) {
                LoginTab.PASSWORD -> PasswordForm(state, viewModel) {
                    viewModel.submit { onLoggedIn(it.user) }
                }
                LoginTab.CODE -> CodeForm(state, viewModel) {
                    viewModel.submit { onLoggedIn(it.user) }
                }
            }

            Spacer(Modifier.height(22.dp))

            PrimaryButton(
                text = if (state.submitting) "登录中…" else "登录",
                enabled = state.canSubmit && !state.submitting,
                onClick = { viewModel.submit { onLoggedIn(it.user) } },
            )

            Spacer(Modifier.height(14.dp))
            Text(
                "登录即表示同意《用户协议》与《隐私政策》",
                style = Font.micro,
                color = Amll.colors.ink3,
                textAlign = TextAlign.Center,
            )
        }

        val captcha = state.captcha
        if (captcha != null) {
            CaptchaDialog(
                config = captcha,
                verified = state.captchaVerified,
                sending = state.sendingCode,
                error = state.error,
                onToken = viewModel::onCaptchaToken,
                onDismiss = viewModel::dismissCaptcha,
            )
        }
    }
}

@Composable
private fun BrandMark() {
    Image(
        painter = painterResource(R.drawable.ic_brand),
        contentDescription = null,
        modifier = Modifier.size(76.dp),
    )
}

@Composable
private fun PasswordForm(
    state: LoginUiState,
    viewModel: LoginViewModel,
    onSubmit: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AmllTextField(
            value = state.username,
            onValueChange = viewModel::onUsernameChange,
            label = "用户名",
            placeholder = "请输入用户名",
            imeAction = ImeAction.Next,
        )
        AmllTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = "密码",
            placeholder = "请输入密码",
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.Done,
            visualTransformation = if (state.passwordVisible) {
                VisualTransformation.None
            } else {
                PasswordVisualTransformation()
            },
            onImeAction = onSubmit,
            trailing = {
                Icon(
                    imageVector = if (state.passwordVisible) {
                        Icons.Filled.VisibilityOff
                    } else {
                        Icons.Filled.Visibility
                    },
                    contentDescription = if (state.passwordVisible) "隐藏密码" else "显示密码",
                    tint = Amll.colors.ink3,
                    modifier = Modifier
                        .size(18.dp)
                        .clickable(onClick = viewModel::togglePasswordVisible),
                )
            },
        )
    }
}

@Composable
private fun CodeForm(
    state: LoginUiState,
    viewModel: LoginViewModel,
    onSubmit: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SegmentedTabs(
            labels = listOf("手机号", "邮箱"),
            selectedIndex = if (state.codeType == CodeType.PHONE) 0 else 1,
            onSelect = { index ->
                viewModel.switchCodeType(if (index == 0) CodeType.PHONE else CodeType.EMAIL)
            },
        )

        AmllTextField(
            value = state.dest,
            onValueChange = viewModel::onDestChange,
            label = if (state.codeType == CodeType.PHONE) "手机号" else "邮箱",
            placeholder = if (state.codeType == CodeType.PHONE) "请输入手机号" else "请输入邮箱",
            keyboardType = if (state.codeType == CodeType.PHONE) KeyboardType.Phone else KeyboardType.Email,
            imeAction = ImeAction.Next,
        )

        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AmllTextField(
                value = state.code,
                onValueChange = viewModel::onCodeChange,
                label = "验证码",
                placeholder = "6 位验证码",
                keyboardType = KeyboardType.Number,
                imeAction = ImeAction.Done,
                modifier = Modifier.weight(1f),
                onImeAction = onSubmit,
            )
            Box(
                Modifier
                    .height(56.dp)
                    .width(112.dp)
                    .clip(RoundedCornerShape(Radius.chip))
                    .background(if (state.canSendCode) Amll.colors.primarySoft else Amll.colors.surface2)
                    .clickable(enabled = state.canSendCode, onClick = viewModel::sendCode),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = when {
                        state.preparingCode -> "检查中…"
                        state.sendingCode -> "发送中…"
                        state.countdown > 0 -> "${state.countdown}s 后重发"
                        else -> "获取验证码"
                    },
                    style = Font.caption.copy(fontWeight = FontWeight.Medium),
                    color = if (state.canSendCode) Amll.colors.primary else Amll.colors.ink3,
                )
            }
        }

        Text(
            "验证码由认证服务发送；未注册的账号会直接提示，不会发码",
            style = Font.micro,
            color = Amll.colors.ink3,
        )
    }
}

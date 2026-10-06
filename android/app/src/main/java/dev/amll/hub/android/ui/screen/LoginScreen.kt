package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.component.ErrorBanner

@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    onScanQr: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 28.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            Text(
                text = "AMLl Hub",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "登录后即可投稿歌词、管理个人资料",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(32.dp))

            // 密码 / 验证码切换
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = state.tab == LoginTab.PASSWORD,
                    onClick = { viewModel.switchTab(LoginTab.PASSWORD) },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                ) { Text("密码登录") }
                SegmentedButton(
                    selected = state.tab == LoginTab.CODE,
                    onClick = { viewModel.switchTab(LoginTab.CODE) },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                ) { Text("验证码登录") }
            }

            Spacer(Modifier.height(24.dp))

            state.error?.let { message ->
                ErrorBanner(message = message)
                Spacer(Modifier.height(16.dp))
            }

            when (state.tab) {
                LoginTab.PASSWORD -> PasswordForm(state, viewModel)
                LoginTab.CODE -> CodeForm(state, viewModel)
            }

            Spacer(Modifier.height(24.dp))

            Button(
                onClick = { viewModel.submit { onLoggedIn() } },
                enabled = state.canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
            ) {
                if (state.submitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text("登录")
                }
            }

            Spacer(Modifier.height(12.dp))

            TextButton(onClick = onScanQr) {
                Text("扫码登录网页端")
            }
        }
    }
}

@Composable
private fun PasswordForm(state: LoginUiState, viewModel: LoginViewModel) {
    Column(modifier = Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = state.username,
            onValueChange = viewModel::onUsernameChange,
            label = { Text("用户名") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("密码") },
            singleLine = true,
            visualTransformation = if (state.passwordVisible) {
                VisualTransformation.None
            } else {
                PasswordVisualTransformation()
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            trailingIcon = {
                IconButton(onClick = viewModel::togglePasswordVisible) {
                    Icon(
                        imageVector = if (state.passwordVisible) {
                            Icons.Filled.VisibilityOff
                        } else {
                            Icons.Filled.Visibility
                        },
                        contentDescription = if (state.passwordVisible) "隐藏密码" else "显示密码",
                    )
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun CodeForm(state: LoginUiState, viewModel: LoginViewModel) {
    Column(modifier = Modifier.fillMaxWidth()) {
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = state.codeType == CodeType.PHONE,
                onClick = { viewModel.switchCodeType(CodeType.PHONE) },
                shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
            ) { Text("手机号") }
            SegmentedButton(
                selected = state.codeType == CodeType.EMAIL,
                onClick = { viewModel.switchCodeType(CodeType.EMAIL) },
                shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
            ) { Text("邮箱") }
        }

        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = state.dest,
            onValueChange = viewModel::onDestChange,
            label = { Text(if (state.codeType == CodeType.PHONE) "手机号" else "邮箱") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (state.codeType == CodeType.PHONE) {
                    KeyboardType.Phone
                } else {
                    KeyboardType.Email
                },
                imeAction = ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(12.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = state.code,
                onValueChange = viewModel::onCodeChange,
                label = { Text("验证码") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(4.dp))
            TextButton(
                onClick = viewModel::sendCode,
                enabled = state.dest.isNotBlank() &&
                    state.countdown == 0 &&
                    !state.sendingCode,
            ) {
                Text(
                    when {
                        state.sendingCode -> "发送中…"
                        state.countdown > 0 -> "${state.countdown}s"
                        else -> "获取验证码"
                    }
                )
            }
        }
    }
}

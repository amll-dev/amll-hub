# AMLl Hub Android 客户端

AMLl Hub 的 Android 原生客户端。当前阶段只实现**账号登录**与**扫码登录**。

## 技术栈

| 用途 | 选型 |
| --- | --- |
| UI | Jetpack Compose + Material 3 |
| DI | Hilt |
| 网络 | Retrofit + OkHttp + kotlinx.serialization |
| 本地存储 | DataStore (Preferences) |
| 导航 | Navigation Compose |
| 扫码 | CameraX + ML Kit 条码识别 |
| 图片 | Coil 3 |
| 构建 | AGP 8.13.2 / Kotlin 2.2.20 / Gradle 8.14.3 / JDK 17 |

配色对齐网页端 `frontend/src/index.css` 的 `--amll-*` 设计 token（深色 `#101014`、品牌红 `#F0424F`）。

## 构建

需要 JDK 17 与 Android SDK（compileSdk 36）。

```bash
cd android

# 配置后端地址（默认已指向 beta 后端）
echo "amll.api.baseUrl=http://10.0.2.2:8080" > local.properties

./gradlew assembleDebug     # 产物：app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest # 单元测试
./gradlew lintDebug         # Lint
```

也可以用环境变量覆盖后端地址：

```bash
AMLL_API_BASE_URL=http://192.168.1.10:8080 ./gradlew assembleDebug
```

> `local.properties` 不进版本库，CI 上通过 `AMLL_API_BASE_URL` 环境变量注入。

## 登录方式

### 账号密码
`POST /api/v1/auth/login`

### 验证码
`POST /api/v1/auth/send-code` + `POST /api/v1/auth/login-code`（手机号 / 邮箱）

### 扫码登录网页端

1. 网页端 `POST /api/v1/auth/qrcode` 拿到 ticket，二维码内容是 deep link `amllhub://qrlogin?ticket=xxx`
2. App 扫码（CameraX + ML Kit）或直接点deep link 唤起
3. App 弹确认框 → `POST /api/v1/auth/qrcode/scanned` → `POST /api/v1/auth/qrcode/confirm`
4. 网页端轮询 `GET /api/v1/auth/qrcode/status?ticket=xxx`，拿到 `confirmed` 与 token 后写入登录态

票据 5 分钟过期，`confirmed` 状态的 token 取出一次即销毁。

## CI

`.github/workflows/android.yml`：JDK 17 → Gradle 校验 → 单元测试 → Lint → `assembleDebug` → APK 上传 artifact（保留 14 天）。

PR 与 push 到 `main` / `master` 时触发，仅在 `android/**` 有变更时运行。

## 目录

```
app/src/main/java/dev/amll/hub/android/
├── MainActivity.kt          # 入口，处理 amllhub:// deep link
├── data/
│   ├── local/AuthStore.kt   # DataStore 存 token
│   └── remote/              # Retrofit API、DTO、错误映射
├── di/AppModule.kt          # Hilt 模块
├── nav/AmllNavGraph.kt      # 登录 / 首页 / 扫码
└── ui/
    ├── component/           # QrScannerView、ErrorBanner
    ├── screen/              # Login / Home / Scan + ViewModel
    └── theme/               # 颜色与字体，对齐网页端 token
```

## 待办

- 个人中心（资料编辑、头像上传、密码修改）
- 投稿与歌词浏览
- 正式签名配置（当前 release 走 debug key）

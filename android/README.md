# AMLL Hub Android 客户端

AMLL Hub 的 Android 原生客户端。当前阶段只实现**账号登录**与**扫码登录**。

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
| 构建 | AGP 9.4.1 / Gradle 9.8.0 / Kotlin 2.3.21 / KSP 2.3.12 / Hilt 2.60.1 / JDK 17 |

配色对齐网页端 `frontend/src/index.css` 的 `--amll-*` 设计 token（深色 `#101014`、品牌红 `#F0424F`）。

## 构建

需要 **JDK 17+**、Android SDK（`platforms;android-36` + `build-tools;36.0.0`）。

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

### AGP 9 说明

项目使用 **AGP 9.4.1** 的内置 Kotlin：

- `gradle.properties` 里 `android.builtInKotlin=true`
- **不要**声明 `org.jetbrains.kotlin.android` 插件（会报 `ClassCastException: BaseExtension`）
- `android.kotlinOptions {}` 已被 AGP 9 移除，改用顶层 `kotlin.compilerOptions {}`
- 仍需保留 `kotlin-compose` 与 `kotlin-serialization` 插件（内置 Kotlin 不含它们）
- **KSP 必须是 2.3.12+**（更早版本不支持 AGP 9 内置 Kotlin）。KSP 2 起改用独立版本号，
  不再是 `2.x.y-ksp` 格式，也不再绑定 Kotlin 版本

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

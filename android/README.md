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

需要 **JDK 17+**、Android SDK（`platforms;android-37`；`build-tools` 由 AGP 自动选）。

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
├── MainActivity.kt              # 入口，处理 amllhub:// deep link
├── data/
│   ├── local/AuthStore.kt       # DataStore 存 token
│   ├── lyric/TtmlParser.kt      # TTML → 逐字行（翻译 / 音译 / 背景行）
│   ├── remote/                  # Retrofit API、DTO、错误映射
│   └── repo/ContentRepository.kt# 内容仓库，接口失败降级为空
├── playback/
│   ├── PlayerController.kt      # Media3 ExoPlayer + 播放状态 StateFlow
│   └── PlaybackService.kt       # MediaSessionService，后台播放与通知栏
├── di/AppModule.kt              # Hilt 模块
├── nav/AmllNavGraph.kt          # 登录态 → 5 Tab + 二级页 + 启动页
└── ui/
    ├── AppNav.kt                # 页面跳转集合
    ├── AppViewModel.kt          # Activity 级共享状态（首页/榜单/歌词/播放）
    ├── component/Common.kt      # TopBar / PillTabBar / SongRow / EmptyState…
    ├── screen/
    │   ├── MainScreens.kt       # 首页 / 发现 / 排行榜 / 每日推荐 / 消息 / 我的
    │   └── FlowScreens.kt       # 歌词详情 / 沉浸播放 / 创作 / 投稿 / 稿件 / 审核
    └── theme/                   # Palette（6 组语义色）+ Dimens（1:1 token）
```

## 沉浸播放的歌词页（react-full）

全屏沉浸播放用 WebView 承载网页端同款歌词渲染（`@applemusic-like-lyrics/react-full` 的
`PrebuiltLyricPlayer` + jotai atoms），源码在 `android/lyrics-web/`，构建产物直接落到
`app/src/main/assets/lyrics/`，APK 内离线可用。

```bash
cd android/lyrics-web

# 复用 frontend 已装好的依赖（避免重复下载）
# Windows: New-Item -ItemType Junction -Path node_modules -Target ../../frontend/node_modules
# macOS/Linux: ln -s ../../frontend/node_modules node_modules

node ../../frontend/node_modules/vite/bin/vite.js build
```

原生侧通过 `WebViewAssetLoader` 以 `https://appassets.androidplatform.net/assets/lyrics/index.html`
加载，避免 `file://` 下 ES Module 的跨域限制；进度与播放态由 `PlayerController` 通过
`window.amllNative` 写入。

## 待办

- 游客态浏览：当前沿用登录门禁，未登录只显示登录页
- 投稿提交：表单已还原，但 TTML 解析与文件上传未接，提交按钮暂未落库
- 头像上传、审核操作（通过 / 驳回）、每日推荐「下载图片」
- 稿件详情的「原文件 / 文件效果」对比视图
- 正式签名配置（当前 release 走 debug key）

## 已接通的交互

- 首页 / 发现的搜索框 → 半屏搜索弹层（词库 `/api/v1/search` + 网易云 `/api/v1/ncm/search`）
- 榜单 / 最新收录 / 推荐卡 → 歌词详情；封面点按 → WebView 沉浸播放
- 每日推荐点赞（乐观更新 + 失败回滚）、消息全部已读 / 单条已读
- 我的页读 `/api/v1/auth/profile`；编辑资料保存昵称走 `PUT /api/v1/auth/profile`
- 创作中心稿件列表 → 稿件详情（`GET /api/v1/submissions/{id}`）


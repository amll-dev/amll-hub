# AMLL Hub

新一代AMLL歌词站，与AMLL歌词生态协作

[AMLL TTML 歌词站](https://amlldb.bikonoo.com) 的重构版本

<img src="https://repository-images.githubusercontent.com/1224275025/803c8329-baee-4113-beae-9c6ee1e6b3f7" width="120" alt="AMLLHub">

## 架构

用户层 React 19 + Vite + TypeScript

API 层 Go (Gin) —— 歌词获取 / 搜索 / 批量查询 / 同步触发 / 状态查询 / 无歌词记录 / 在线搜索

Worker 层 Rust (Tokio) —— RabbitMQ 消费者 / 自动同步 / 索引更新

基础设施 PostgreSQL Redis MinIO RabbitMQ MeiliSearch

### 服务拆分

| 服务 | 技术栈 | 职责 |
|------|--------|------|
| **API** | Go + Gin + GORM | HTTP 接口：歌词获取（含 Range）、搜索、批量查询、同步触发、状态查询、无歌词记录 |
| **Worker** | Rust + Tokio + SeaORM | 后台同步：监听 RabbitMQ 队列，从 GitHub 拉取 TTML 索引，下载文件，入库并更新搜索索引；无歌词解析：网易云 API 分类（纯音乐/云盘/无歌词） |

### 数据流

1. **同步触发**：API 收到同步请求后，向 RabbitMQ 发送消息
2. **任务消费**：Worker 消费消息，获取 GitHub 最新 commit，对比本地状态
3. **差异计算**：解析 `raw-lyrics-index.jsonl`，计算新增/更新/删除的文件列表
4. **并发下载**：使用 semaphore 控制并发数，从 GitHub 下载 TTML 文件并上传到 MinIO
5. **数据入库**：解析 TTML 内容（提取歌词文本、字数、行数、拼音），写入 PostgreSQL
6. **搜索索引**：将歌曲元数据和拼音信息批量写入 MeiliSearch
7. **歌词获取**：API 根据平台 ID 查询 Redis 缓存或 PostgreSQL，返回 MinIO 中的 TTML 文件流
8. **无歌词记录**：歌词不存在时，API 异步记录到 PostgreSQL（Redis 去重），新记录通过 RabbitMQ 发送给 Worker 解析分类（纯音乐/云盘音乐/无歌词）；歌词补全时自动从排行榜删除；每周一清空无歌词记录，白名单永久保留

### 基础设施

| 组件 | 用途 |
|------|------|
| **PostgreSQL** | 关系型数据：歌曲、艺术家、专辑、平台映射、同步历史与进度 |
| **MinIO** | 对象存储：原始 TTML 文件（按 `raw-lyrics/{filename}` 路径存储） |
| **Redis** | 缓存：平台 ID → MinIO 路径映射；分布式锁：防止并发同步；无歌词去重与排行榜缓存 |
| **RabbitMQ** | 消息队列：解耦 API 与 Worker，支持死信队列（DLX/DLQ）；独立队列：无歌词解析任务 |
| **MeiliSearch** | 全文搜索：歌曲名、艺术家、专辑、歌词文本，支持拼音搜索 |

## 鸣谢

-   [xiaowumin-mark/AMLX-MUSIC-API](https://github.com/xiaowumin-mark/AMLX-MUSIC-API)
-   [cybaka520/AMLLHub-Music-API](https://github.com/cybaka520/AMLLHub-Music-API)
-   还有许多被 AMLLHub 使用的框架和库，非常感谢！

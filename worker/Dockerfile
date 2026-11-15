FROM rust:1.92-slim AS builder

WORKDIR /app

# 安装编译所需系统依赖（OpenSSL 在 rustls 下不需要，但仍需要 pkg-config 用于其他 crate）
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 缓存依赖
COPY Cargo.toml Cargo.lock ./
# 创建空壳以加速依赖编译
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && \
    echo "" > src/lib.rs || true

# 真实代码
COPY . .

# 编译 release
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
RUN cargo build --release --bin ttml-worker && \
    cp target/release/ttml-worker /out/ttml-worker 2>/dev/null || \
    (mkdir -p /out && cp target/release/ttml-worker /out/ttml-worker)

# 运行阶段
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata wget && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    useradd -u 10001 -m appuser && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder --chown=appuser:appuser /out/ttml-worker /app/ttml-worker

EXPOSE 9090

USER appuser

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:9090/health || exit 1

ENTRYPOINT ["/app/ttml-worker"]

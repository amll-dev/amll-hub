FROM golang:1.25-alpine AS builder

WORKDIR /app

# 利用缓存加速依赖下载
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# 编译
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/server ./cmd/server

# 运行阶段
FROM alpine:3.20

RUN apk --no-cache add ca-certificates tzdata wget && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    adduser -D -u 10001 appuser

WORKDIR /app
COPY --from=builder --chown=appuser:appuser /out/server /app/server
COPY --from=builder --chown=appuser:appuser /app/migrations /app/migrations

EXPOSE 8080

USER appuser

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/server"]

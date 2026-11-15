APP := server
PKG := github.com/amll-dev/amll-hub/backend
MIGRATE_DSN ?= "postgres://$${DB_USER:-ttml}:$${DB_PASSWORD:-ttml}@localhost:5432/$${DB_NAME:-ttml_db}?sslmode=disable"
MIGRATE_BIN ?= $(shell command -v migrate 2>/dev/null || printf '%s/.dev/bin/migrate' "$(CURDIR)/..")

.PHONY: tidy run build test lint migrate-up migrate-down docker-build docker-help

tidy:
	go mod tidy

run:
	go run ./cmd/server

build:
	go build -v -o $(APP) ./cmd/server

test:
	go test -v ./...

lint:
	golangci-lint run --timeout=5m ./...

migrate-up:
	@if [ ! -x "$(MIGRATE_BIN)" ]; then \
		echo '安装 migrate CLI…'; \
		mkdir -p "$(CURDIR)/../.dev/bin"; \
		GOBIN="$(CURDIR)/../.dev/bin" go install -tags postgres github.com/golang-migrate/migrate/v4/cmd/migrate@v4.18.3; \
	fi
	"$(MIGRATE_BIN)" -path migrations -database $(MIGRATE_DSN) up

migrate-down:
	"$(MIGRATE_BIN)" -path migrations -database $(MIGRATE_DSN) down 1

docker-build:
	docker build -t ttml-api:latest .

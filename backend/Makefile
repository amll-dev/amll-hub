APP := server
PKG := github.com/amll-dev/amll-hub/backend
MIGRATE_DSN ?= "postgres://$${DB_USER:-ttml}:$${DB_PASSWORD:-ttml}@localhost:5432/$${DB_NAME:-ttml_db}?sslmode=disable"

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
	migrate -path migrations -database $(MIGRATE_DSN) up

migrate-down:
	migrate -path migrations -database $(MIGRATE_DSN) down 1

docker-build:
	docker build -t ttml-api:latest .

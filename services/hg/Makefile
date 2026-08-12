# Halal Goes API — developer entry points.
#
#   make up        bring the whole stack up (Traefik, Postgres+PostGIS, Redis, MinIO, 2× API)
#   make run       run the API on the host against the compose dependencies
#   make test      go test ./...
#   make lint      gofmt check, go vet, golangci-lint when installed
#   make migrate   apply the migrations in ./migrations
#   make down      stop the stack
#
# `make help` lists everything.

SHELL := /bin/bash
.DEFAULT_GOAL := help

DEPLOY_DIR := ../../deploy
COMPOSE    := docker compose --project-directory $(DEPLOY_DIR) -f $(DEPLOY_DIR)/docker-compose.yml
ENV_FILE   := $(DEPLOY_DIR)/.env

GO         ?= go
BIN_DIR    := bin
BINARY     := $(BIN_DIR)/hg
VERSION    ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

# Ports the compose stack publishes on the host, for `make run` outside Docker.
HOST_POSTGRES_PORT ?= 5432
HOST_REDIS_PORT    ?= 6379
HOST_MINIO_PORT    ?= 9000

.PHONY: help
help: ## List the available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Build and run
# ---------------------------------------------------------------------------

.PHONY: build
build: ## Compile the binary into ./bin/hg
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="-s -w" -o $(BINARY) ./cmd/hg
	@echo "built $(BINARY) ($(VERSION))"

.PHONY: run
run: ## Run the API on the host against the compose dependencies
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "no $(ENV_FILE) — run: cp $(DEPLOY_DIR)/.env.example $(ENV_FILE)"; exit 1; \
	fi
	@set -a; . $(ENV_FILE); set +a; \
	HG_ENV=$${HG_ENV:-local} \
	HG_SERVICE_VERSION=$(VERSION) \
	HG_HTTP_ADDR=$${HG_HTTP_ADDR:-:8080} \
	HG_POSTGRES_DSN="postgres://$${POSTGRES_USER}:$${POSTGRES_PASSWORD}@localhost:$(HOST_POSTGRES_PORT)/$${POSTGRES_DB}?sslmode=disable" \
	HG_REDIS_ADDR="localhost:$(HOST_REDIS_PORT)" \
	HG_MINIO_ENDPOINT="localhost:$(HOST_MINIO_PORT)" \
	HG_MINIO_ACCESS_KEY="$${MINIO_ROOT_USER}" \
	HG_MINIO_SECRET_KEY="$${MINIO_ROOT_PASSWORD}" \
	$(GO) run ./cmd/hg

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------

.PHONY: test
test: ## Run the test suite (integration tests skip without Docker)
	$(GO) test -race ./...

.PHONY: test-integration
test-integration: ## Run the suite including the container-backed tests
	$(GO) test -race -count=1 ./...

.PHONY: lint
lint: fmt-check vet ## gofmt check, go vet, and golangci-lint when installed
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
	else \
		echo "golangci-lint not installed — ran gofmt and go vet only."; \
		echo "install: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest"; \
	fi

.PHONY: vet
vet: ## go vet ./...
	$(GO) vet ./...

.PHONY: fmt
fmt: ## Format the tree
	gofmt -w ./cmd ./internal

.PHONY: fmt-check
fmt-check: ## Fail when anything is unformatted
	@unformatted=$$(gofmt -l ./cmd ./internal); \
	if [ -n "$$unformatted" ]; then \
		echo "these files are not gofmt-clean:"; echo "$$unformatted"; exit 1; \
	fi

.PHONY: tidy
tidy: ## go mod tidy
	$(GO) mod tidy

.PHONY: check
check: fmt-check vet test ## Everything CI runs

# ---------------------------------------------------------------------------
# Stack
# ---------------------------------------------------------------------------

.PHONY: up
up: ensure-env ## Build and start the whole stack
	$(COMPOSE) up --build -d
	@echo
	@echo "stack up. Traefik fronts 2 API replicas:"
	@echo "  API        http://localhost:$${HG_HTTP_PORT:-8080}/health"
	@echo "  readiness  http://localhost:$${HG_HTTP_PORT:-8080}/health/ready"
	@echo "  deps       docker compose exec -it \$$(docker compose ps -q api | head -1) — /debug/deps is blocked at the edge"
	@echo "  dashboard  http://localhost:$${TRAEFIK_DASHBOARD_PORT:-8081}/dashboard/"

.PHONY: down
down: ## Stop the stack, keeping volumes
	$(COMPOSE) down

.PHONY: down-hard
down-hard: ## Stop the stack and delete its volumes
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Follow the API logs from both replicas
	$(COMPOSE) logs -f api

.PHONY: ps
ps: ## Show stack status
	$(COMPOSE) ps

.PHONY: ensure-env
ensure-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		cp $(DEPLOY_DIR)/.env.example $(ENV_FILE); \
		echo "created $(ENV_FILE) from .env.example — edit the secrets before anything but local"; \
	fi

# ---------------------------------------------------------------------------
# Migrations
#
# ./migrations is owned by a sibling agent and is goose-annotated. The runner is
# built from this service's Dockerfile (target: migrate), so there is one Go
# toolchain in play rather than two.
# ---------------------------------------------------------------------------

.PHONY: migrate
migrate: ensure-env ## Apply all pending migrations
	$(COMPOSE) --profile tools run --rm migrate up

.PHONY: migrate-status
migrate-status: ensure-env ## Show which migrations have been applied
	$(COMPOSE) --profile tools run --rm migrate status

.PHONY: migrate-down
migrate-down: ensure-env ## Roll back one migration
	$(COMPOSE) --profile tools run --rm migrate down

.PHONY: seed
seed: ensure-env ## Load the seed data in ./migrations/seed
	@set -a; . $(ENV_FILE); set +a; \
	$(COMPOSE) exec -T postgres \
		psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 \
		-f /dev/stdin < migrations/seed/seed.sql

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

.PHONY: deps
deps: ## Print the config-reality report from a running replica
	@$(COMPOSE) exec -T api /usr/local/bin/hg --version 2>/dev/null || true
	@echo "querying /debug/deps from inside the network..."
	@$(COMPOSE) run --rm --entrypoint sh migrate -c \
		'wget -qO- http://api:8080/debug/deps' 2>/dev/null \
		|| echo "not reachable — is the stack up? (make up)"

.PHONY: routes
routes: ## Print the registered routes and the public allowlist
	@$(COMPOSE) logs api 2>/dev/null | grep "routes registered" | tail -2 \
		|| echo "no route log found — is the stack up?"

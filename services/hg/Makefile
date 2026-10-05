# HalalGoes API — developer entry points.
#
#   make up        bring the whole stack up (Traefik, Postgres+PostGIS, Valkey, Silo, 2× API)
#   make run       run the API on the host against the compose dependencies, as hg_app
#   make test      go test ./...
#   make lint      gofmt check, go vet, golangci-lint when installed
#   make migrate   apply the migrations in ./migrations, as hg_migrator
#   make down      stop the stack
#
# `make help` lists everything.

SHELL := /bin/bash
.DEFAULT_GOAL := help

DEPLOY_DIR := ../../deploy
ENV_FILE   := $(DEPLOY_DIR)/.env
# HG_ENV as compose reads it: from the shell if set there, else from deploy/.env. Expanded when
# a recipe runs, after ensure-env has written the file.
STACK_ENV   = $(or $(HG_ENV),$(shell sed -n 's/^HG_ENV=//p' $(ENV_FILE) 2>/dev/null | tail -n1 | tr -d '"[:space:]'))
# With HG_ENV=local only, docker-compose.local.yml lets this machine reach /internal and /debug
# through the published port (issue #487). Any other HG_ENV gets the base file alone, as the
# server does (it runs docker-compose.yml with docker-compose.server.yml, never this Makefile).
COMPOSE     = docker compose --project-directory $(DEPLOY_DIR) -f $(DEPLOY_DIR)/docker-compose.yml$(if $(filter local,$(STACK_ENV)), -f $(DEPLOY_DIR)/docker-compose.local.yml)

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
run: ensure-env ## Run the API on the host against the compose dependencies
	@set -a; . $(ENV_FILE); set +a; \
	HG_ENV=$${HG_ENV:-local} \
	HG_SERVICE_VERSION=$(VERSION) \
	HG_HTTP_ADDR=$${HG_HTTP_ADDR:-:8080} \
	HG_POSTGRES_DSN="postgres://hg_app:$${HG_DB_APP_PASSWORD}@localhost:$(HOST_POSTGRES_PORT)/$${POSTGRES_DB}?sslmode=disable" \
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

.PHONY: conformance
conformance: ## Validate every reachable 2xx server response against contracts/openapi.yaml
	$(GO) test -race -run Conformance ./internal/conformance/...

.PHONY: generate-contract
generate-contract: ## Regenerate the Go contract types from contracts/openapi.yaml
	cd internal/contract && $(GO) tool oapi-codegen -config oapi-codegen.yaml ../../../../contracts/openapi.yaml

.PHONY: generate-check
generate-check: ## Fail when the checked-in contract types are stale or hand-edited
	@$(MAKE) generate-contract
	@git diff --exit-code -- internal/contract/types.gen.go \
		|| { echo "internal/contract/types.gen.go is out of date — run 'make generate-contract' and commit"; exit 1; }

.PHONY: check
check: fmt-check vet generate-check test conformance ## Everything CI runs

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
	@echo "  deps       http://localhost:$${HG_HTTP_PORT:-8080}/debug/deps (with HG_ENV=local, from this machine)"
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

# The database role passwords are never copied from .env.example: pgroles makes
# them real login passwords, hg_migrator's included (it owns the schema), and
# Postgres is published on the host. A new .env gets random ones, and a .env made
# before the roles existed has random ones appended. That is safe because pgroles
# re-sets both passwords on every `make up` and `make migrate`, and `make run`
# reads the same .env.
DB_ROLE_ENV := HG_DB_MIGRATOR_PASSWORD HG_DB_APP_PASSWORD

.PHONY: ensure-env
ensure-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		cp $(DEPLOY_DIR)/.env.example $(ENV_FILE).tmp; \
		for k in $(DB_ROLE_ENV); do \
			pw="$$(openssl rand -hex 24)" && [ -n "$$pw" ] || { echo "openssl rand failed; cannot make $$k"; rm -f $(ENV_FILE).tmp; exit 1; }; \
			sed "s/^$$k=.*/$$k=$$pw/" $(ENV_FILE).tmp > $(ENV_FILE).tmp2 && mv $(ENV_FILE).tmp2 $(ENV_FILE).tmp; \
		done; \
		mv $(ENV_FILE).tmp $(ENV_FILE); \
		echo "created $(ENV_FILE) from .env.example, with random database role passwords — edit the other secrets before anything but local"; \
	fi
	@for k in $(DB_ROLE_ENV); do \
		if ! grep -q "^$$k=" $(ENV_FILE); then \
			pw="$$(openssl rand -hex 24)" && [ -n "$$pw" ] || { echo "openssl rand failed; cannot add $$k"; exit 1; }; \
			[ -z "$$(tail -c1 $(ENV_FILE))" ] || echo >> $(ENV_FILE); \
			echo "$$k=$$pw" >> $(ENV_FILE); \
			echo "added $$k to $(ENV_FILE): a random password"; \
		fi; \
	done

# ---------------------------------------------------------------------------
# Migrations
#
# ./migrations is owned by a sibling agent and is goose-annotated. The runner is
# built from this service's Dockerfile (target: migrate), so there is one Go
# toolchain in play rather than two.
#
# goose runs as hg_migrator, which owns the schema. The compose `pgroles` service
# creates that role (as the superuser, from migrations/roles/roles.sql) first.
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

.PHONY: dev-admin
dev-admin: ensure-env ## Provision a login-able dev SUPER_ADMIN (email+password+TOTP) for driving the admin console
	@set -a; . $(ENV_FILE); set +a; \
	EMAIL="$${DEV_ADMIN_EMAIL:-dev-admin@halalgoes.test}"; \
	echo "→ ensuring account $$EMAIL (SUPER_ADMIN)"; \
	$(COMPOSE) exec -T postgres psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -c "INSERT INTO account (email, email_verified_at, status) VALUES ('$$EMAIL', now(), 'ACTIVE') ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(account.email_verified_at, now()); INSERT INTO account_role (account_id, role, scope_type) SELECT a.id, 'SUPER_ADMIN', 'GLOBAL' FROM account a WHERE a.email='$$EMAIL' AND NOT EXISTS (SELECT 1 FROM account_role r WHERE r.account_id=a.id AND r.role='SUPER_ADMIN' AND r.revoked_at IS NULL);"
	@set -a; . $(ENV_FILE); set +a; \
	EMAIL="$${DEV_ADMIN_EMAIL:-dev-admin@halalgoes.test}"; \
	PASSWORD="$${DEV_ADMIN_PASSWORD:-DevAdmin!2026}"; \
	DSN="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@localhost:$${POSTGRES_PORT:-$(HOST_POSTGRES_PORT)}/$$POSTGRES_DB?sslmode=disable"; \
	SEED_EMAIL="$$EMAIL" SEED_PASSWORD="$$PASSWORD" HG_POSTGRES_DSN="$$DSN" $(GO) run ./cmd/seedpw >/dev/null; \
	OUT=$$(SEED_EMAIL="$$EMAIL" HG_APP_DATA_KEY="$$HG_APP_DATA_KEY" HG_POSTGRES_DSN="$$DSN" $(GO) run ./cmd/seedtotp); \
	SECRET=$$(echo "$$OUT" | sed -n 's/^TOTP_SECRET=//p'); \
	echo "$$SECRET" > /tmp/hg-admin-totp-secret.txt; \
	echo "✓ dev admin ready:"; \
	echo "    email    $$EMAIL"; \
	echo "    password $$PASSWORD"; \
	echo "    TOTP     secret written to /tmp/hg-admin-totp-secret.txt"; \
	echo "    code now $$(cd $(CURDIR) && SECRET="$$SECRET" $(GO) run ./cmd/totpnow)"; \
	echo "  drive it:  APP_URL=http://localhost:5173 SEED_EMAIL=$$EMAIL SEED_PASSWORD='$$PASSWORD' node ../../tools/verify/admin-full-drive.mjs"

.PHONY: dev-reset
dev-reset: ## Wipe and re-seed a local database with the stable personas
	@if [ -f $(ENV_FILE) ]; then set -a; . $(ENV_FILE); set +a; fi; \
	export HG_ENV="$${HG_ENV:-local}"; \
	export HG_POSTGRES_DSN="postgres://$${POSTGRES_USER:-hg}:$${POSTGRES_PASSWORD:-hg}@127.0.0.1:$${POSTGRES_PORT:-$(HOST_POSTGRES_PORT)}/$${POSTGRES_DB:-hg}?sslmode=disable"; \
	export HG_REDIS_ADDR="127.0.0.1:$${REDIS_PORT:-$(HOST_REDIS_PORT)}"; \
	export HG_REDIS_PASSWORD="$${REDIS_PASSWORD:-}"; \
	export HG_REDIS_DB="$${HG_REDIS_DB:-0}"; \
	$(GO) run ./cmd/devworld reset

.PHONY: dev-totp
dev-totp: ## Print the current local admin sign-in code (email=… for a staff account an onboarding scenario made)
	@if [ -f $(ENV_FILE) ]; then set -a; . $(ENV_FILE); set +a; fi; \
	export HG_ENV="$${HG_ENV:-local}"; \
	export HG_POSTGRES_DSN="postgres://$${POSTGRES_USER:-hg}:$${POSTGRES_PASSWORD:-hg}@127.0.0.1:$${POSTGRES_PORT:-$(HOST_POSTGRES_PORT)}/$${POSTGRES_DB:-hg}?sslmode=disable"; \
	$(GO) run ./cmd/devworld totp $(email)

.PHONY: dev-scenario
dev-scenario: ## Drive one API scenario against a running local API (s=new-order)
	@if [ -f $(ENV_FILE) ]; then set -a; . $(ENV_FILE); set +a; fi; \
	export HG_ENV="$${HG_ENV:-local}"; \
	export HG_POSTGRES_DSN="postgres://$${POSTGRES_USER:-hg}:$${POSTGRES_PASSWORD:-hg}@127.0.0.1:$${POSTGRES_PORT:-$(HOST_POSTGRES_PORT)}/$${POSTGRES_DB:-hg}?sslmode=disable"; \
	s="$${s:-new-order}"; \
	HG_API_URL="$${HG_API_URL:-http://127.0.0.1:8080}" $(GO) run ./cmd/devworld scenario "$$s"

.PHONY: dev-journey
dev-journey: ## Drive one live order against a running local API (route=short speed=1x auto=none)
	@args="--route=$${route:-short} --speed=$${speed:-1x} --auto=$${auto:-none}"; \
	if [ "$${manual:-}" = "rider" ]; then args="$$args --manual=rider"; fi; \
	HG_API_URL="$${HG_API_URL:-http://127.0.0.1:8080}" $(GO) run ./cmd/devworld journey $$args

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

.PHONY: infra-start infra-stop infra-reset infra-logs \
        redis-cli redis-flush redis-info \
        nats-setup-streams nats-stream-list nats-stream-info \
        ingestor-dev ingestor-build ingestor-start ingestor-test ingestor-test-watch ingestor-format ingestor-lint ingestor-check \
        ingestor-docker-build ingestor-docker-run ingestor-docker-stop ingestor-docker-logs \
        ingestor-e2e-test ingestor-e2e-test-watch ingestor-e2e-verify \
        media-dev media-build media-start media-test media-test-watch media-format media-lint media-check \
        docs-dev docs-build docs-start \
        openapi-generate docs-generate openapi-verify \
        dev build test test-watch test-unit test-integration test-e2e test-ui coverage-summary format lint check-types ci ci-force help

help:
	@echo "WallpaperDB - Available commands:"
	@echo ""
	@echo "Infrastructure:"
	@echo "  make infra-start    - Start all infrastructure services"
	@echo "  make infra-stop     - Stop all infrastructure services"
	@echo "  make infra-reset    - Reset all infrastructure data (WARNING: deletes all data)"
	@echo "  make infra-logs     - Tail logs from all infrastructure services"
	@echo ""
	@echo "Redis:"
	@echo "  make redis-cli      - Connect to Redis CLI"
	@echo "  make redis-flush    - Flush all Redis data (WARNING: deletes all data)"
	@echo "  make redis-info     - Show Redis server info"
	@echo ""
	@echo "NATS:"
	@echo "  make nats-setup-streams - Setup all required NATS JetStream streams"
	@echo "  make nats-stream-list   - List all NATS streams"
	@echo "  make nats-stream-info   - Show info for WALLPAPER stream"
	@echo ""
	@echo "Ingestor Service:"
	@echo "  make ingestor-dev        - Start ingestor in development mode"
	@echo "  make ingestor-build      - Build ingestor for production"
	@echo "  make ingestor-start      - Start ingestor in production mode"
	@echo "  make ingestor-test       - Run ingestor tests"
	@echo "  make ingestor-test-watch - Run ingestor tests in watch mode"
	@echo "  make ingestor-format     - Format ingestor code"
	@echo "  make ingestor-lint       - Lint ingestor code"
	@echo ""
	@echo "Media Service:"
	@echo "  make media-dev        - Start media service in development mode"
	@echo "  make media-build      - Build media service for production"
	@echo "  make media-start      - Start media service in production mode"
	@echo "  make media-test       - Run media service tests"
	@echo "  make media-test-watch - Run media service tests in watch mode"
	@echo "  make media-format     - Format media service code"
	@echo "  make media-lint       - Lint media service code"
	@echo ""
	@echo "Ingestor Docker:"
	@echo "  make ingestor-docker-build - Build ingestor Docker image"
	@echo "  make ingestor-docker-run   - Run ingestor Docker container (uses infra/.env)"
	@echo "  make ingestor-docker-stop  - Stop ingestor Docker container"
	@echo "  make ingestor-docker-logs  - View ingestor Docker container logs"
	@echo ""
	@echo "Ingestor E2E Tests:"
	@echo "  make ingestor-e2e-test       - Run E2E tests against Docker container"
	@echo "  make ingestor-e2e-test-watch - Run E2E tests in watch mode"
	@echo "  make ingestor-e2e-verify     - Verify no app code imports in E2E tests"
	@echo ""
	@echo "Documentation:"
	@echo "  make docs-dev       - Start documentation dev server (http://localhost:3002)"
	@echo "  make docs-build     - Build documentation for production"
	@echo "  make docs-start     - Start documentation production server"
	@echo ""
	@echo "OpenAPI:"
	@echo "  make openapi-generate - Generate OpenAPI specs (swagger.json) for all services"
	@echo "  make docs-generate    - Generate API documentation from OpenAPI specs"
	@echo "  make openapi-verify   - Verify OpenAPI specs can be generated"
	@echo ""
	@echo "All Services:"
	@echo "  make dev        - Start all services in development mode"
	@echo "  make build      - Build all services"
	@echo "  make test       - Run all tests"
	@echo "  make test-watch - Run all tests in watch mode"
	@echo "  make format     - Format all code"
	@echo "  make lint       - Lint all code"
	@echo ""
	@echo "Testing (by intensity):"
	@echo "  make test-unit         - Run unit tests (fast, no containers)"
	@echo "  make test-integration  - Run integration tests (uses Testcontainers)"
	@echo "  make test-e2e          - Run E2E tests (heavy container usage, sequential)"
	@echo "  make test-ui           - Run tests with Vitest UI"
	@echo "  make coverage-summary  - Display AI-friendly coverage summary"
	@echo ""
	@echo "CI/Local Parity:"
	@echo "  make ci                - Run full CI pipeline locally"
	@echo "  make ci-force          - Run full CI pipeline (skip turbo cache)"
	@echo "  make check-types       - Run type checking on all packages"
	@echo ""

infra-start:
	@turbo run start --filter=@wallpaperdb/infra-local

infra-stop:
	@turbo run stop --filter=@wallpaperdb/infra-local

infra-reset:
	@turbo run reset --filter=@wallpaperdb/infra-local

infra-logs:
	@turbo run logs --filter=@wallpaperdb/infra-local

# Redis commands
redis-cli:
	@docker exec -it wallpaperdb-redis redis-cli

redis-flush:
	@docker exec -it wallpaperdb-redis redis-cli FLUSHALL

redis-info:
	@docker exec wallpaperdb-redis redis-cli INFO

# NATS commands
nats-setup-streams:
	@./infra/nats/init/setup-streams.sh

nats-stream-list:
	@nats stream list --server nats://localhost:4222

nats-stream-info:
	@nats stream info WALLPAPER --server nats://localhost:4222

# Ingestor service commands
ingestor-dev:
	@turbo run dev --filter=@wallpaperdb/ingestor

ingestor-build:
	@turbo run build --filter=@wallpaperdb/ingestor

ingestor-start:
	@turbo run start --filter=@wallpaperdb/ingestor

ingestor-test:
	@turbo run test --filter=@wallpaperdb/ingestor

ingestor-test-watch:
	@turbo run test:watch --filter=@wallpaperdb/ingestor

ingestor-format:
	@turbo run format --filter=@wallpaperdb/ingestor

ingestor-lint:
	@turbo run lint --filter=@wallpaperdb/ingestor

ingestor-check:
	@turbo run check --filter=@wallpaperdb/ingestor

# Media service commands
media-dev:
	@turbo run dev --filter=@wallpaperdb/media

media-build:
	@turbo run build --filter=@wallpaperdb/media

media-start:
	@turbo run start --filter=@wallpaperdb/media

media-test:
	@turbo run test --filter=@wallpaperdb/media

media-test-watch:
	@turbo run test:watch --filter=@wallpaperdb/media

media-format:
	@turbo run format --filter=@wallpaperdb/media

media-lint:
	@turbo run lint --filter=@wallpaperdb/media

media-check:
	@turbo run check --filter=@wallpaperdb/media

# Ingestor Docker commands
ingestor-docker-build:
	@echo "Building ingestor Docker image..."
	@docker build -t wallpaperdb-ingestor:latest -f apps/ingestor/Dockerfile .
	@echo "✓ Docker image built: wallpaperdb-ingestor:latest"

ingestor-docker-run:
	@echo "Starting ingestor Docker container..."
	@if [ ! -f infra/.env ]; then \
		echo "Error: infra/.env file not found. Run 'make infra-start' first."; \
		exit 1; \
	fi
	@. ./infra/.env && docker run --rm -d \
		-p 3001:3001 \
		-e NODE_ENV=production \
		-e PORT=3001 \
		-e DATABASE_URL=postgresql://$$POSTGRES_USER:$$POSTGRES_PASSWORD@host.docker.internal:5432/$$POSTGRES_DB \
		-e S3_ENDPOINT=http://host.docker.internal:9000 \
		-e S3_ACCESS_KEY_ID=$$MINIO_ROOT_USER \
		-e S3_SECRET_ACCESS_KEY=$$MINIO_ROOT_PASSWORD \
		-e S3_BUCKET=wallpapers \
		-e NATS_URL=nats://host.docker.internal:4222 \
		-e OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318 \
		--name wallpaperdb-ingestor \
		wallpaperdb-ingestor:latest
	@echo "✓ Ingestor container started on port 3001"
	@echo "  Health: http://localhost:3001/health"
	@echo "  Ready:  http://localhost:3001/ready"

ingestor-docker-stop:
	@echo "Stopping ingestor Docker container..."
	@docker stop wallpaperdb-ingestor 2>/dev/null || echo "Container not running"
	@echo "✓ Ingestor container stopped"

ingestor-docker-logs:
	@docker logs -f wallpaperdb-ingestor

# Ingestor E2E test commands
ingestor-e2e-test:
	@echo "Running E2E tests (builds Docker image first)..."
	@turbo run test --filter=@wallpaperdb/ingestor-e2e

ingestor-e2e-test-watch:
	@turbo run test:watch --filter=@wallpaperdb/ingestor-e2e

ingestor-e2e-verify:
	@echo "Verifying E2E tests don't import application code..."
	@pnpm --filter @wallpaperdb/ingestor-e2e verify-no-imports
	@echo "✓ Verification passed - E2E tests are properly isolated"

# Documentation commands
docs-dev:
	@echo "Starting documentation dev server..."
	@turbo run dev --filter=@wallpaperdb/docs

docs-build:
	@echo "Building documentation..."
	@turbo run build --filter=@wallpaperdb/docs

docs-start:
	@echo "Starting documentation production server..."
	@turbo run start --filter=@wallpaperdb/docs

# OpenAPI commands
openapi-generate:
	@echo "Generating OpenAPI specs..."
	@pnpm --filter @wallpaperdb/ingestor gen:swagger
	@echo "✓ OpenAPI spec generated: apps/ingestor/swagger.json"

docs-generate:
	@echo "Generating API documentation from OpenAPI specs..."
	@pnpm --filter @wallpaperdb/docs gen:swagger-pages
	@echo "✓ API documentation generated in apps/docs/content/docs/openapi/"

openapi-verify:
	@echo "Verifying OpenAPI spec generation..."
	@pnpm --filter @wallpaperdb/ingestor gen:swagger
	@if [ -f apps/ingestor/swagger.json ]; then \
		echo "✓ OpenAPI spec generated successfully"; \
	else \
		echo "✗ Failed to generate OpenAPI spec"; \
		exit 1; \
	fi

# All services commands
dev:
	@turbo run dev

build:
	@turbo run build

test:
	@turbo run test

test-watch:
	@turbo run test:watch

# Test commands by intensity
test-unit:
	@echo "Running unit tests (fast, no containers)..."
	@turbo run test:unit

test-integration:
	@echo "Running integration tests (uses Testcontainers)..."
	@turbo run test:integration --concurrency=1

test-e2e:
	@echo "Running E2E tests (heavy container usage, sequential)..."
	@turbo run test:e2e --concurrency=1

test-ui:
	@echo "Starting Vitest UI..."
	@pnpm test:ui

coverage-summary:
	@node scripts/coverage-summary.js

format:
	@turbo run format --log-order grouped

lint:
	@turbo run lint --log-order grouped

lint-fix:
	@turbo run lint:fix --log-order grouped

install:
	pnpm install

# CI/Local Parity commands
check-types:
	@turbo run check-types

ci:
	@echo "Running full CI checks locally..."
	@start_time=$$(date +%s); \
	turbo run build lint check-types test:unit test:integration && \
	turbo run test:e2e --concurrency=1 && \
	pnpm coverage:merge && \
	end_time=$$(date +%s); \
	duration=$$((end_time - start_time)); \
	echo ""; \
	echo "✓ All CI checks passed in $${duration}s"; \
	echo "✓ Coverage report: coverage/lcov.info"

ci-force:
	@echo "Running full CI checks locally (no cache)..."
	@start_time=$$(date +%s); \
	turbo run build lint check-types test:unit test:integration --force && \
	turbo run test:e2e --concurrency=1 --force && \
	pnpm coverage:merge && \
	end_time=$$(date +%s); \
	duration=$$((end_time - start_time)); \
	echo ""; \
	echo "✓ All CI checks passed in $${duration}s"; \
	echo "✓ Coverage report: coverage/lcov.info"

.PHONY: infra-start infra-stop infra-reset infra-logs \
        redis-cli redis-flush redis-info \
        ingestor-dev ingestor-build ingestor-start ingestor-test ingestor-test-watch ingestor-format ingestor-lint ingestor-check \
        ingestor-docker-build ingestor-docker-run ingestor-docker-stop ingestor-docker-logs \
        ingestor-e2e-test ingestor-e2e-test-watch ingestor-e2e-verify \
        dev build test test-watch format lint help

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
	@echo "Ingestor Service:"
	@echo "  make ingestor-dev        - Start ingestor in development mode"
	@echo "  make ingestor-build      - Build ingestor for production"
	@echo "  make ingestor-start      - Start ingestor in production mode"
	@echo "  make ingestor-test       - Run ingestor tests"
	@echo "  make ingestor-test-watch - Run ingestor tests in watch mode"
	@echo "  make ingestor-format     - Format ingestor code"
	@echo "  make ingestor-lint       - Lint ingestor code"
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
	@echo "All Services:"
	@echo "  make dev        - Start all services in development mode"
	@echo "  make build      - Build all services"
	@echo "  make test       - Run all tests"
	@echo "  make test-watch - Run all tests in watch mode"
	@echo "  make format     - Format all code"
	@echo "  make lint       - Lint all code"
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

# All services commands
dev:
	@turbo run dev

build:
	@turbo run build

test:
	@turbo run test

test-watch:
	@turbo run test:watch

format:
	@turbo run format --log-order grouped

lint:
	@turbo run lint --log-order grouped

lint-fix:
	@turbo run lint:fix --log-order grouped

install:
	pnpm install

.PHONY: infra-start infra-stop infra-reset infra-logs \
        ingestor-dev ingestor-build ingestor-start ingestor-test ingestor-test-watch ingestor-format ingestor-lint \
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
	@echo "Ingestor Service:"
	@echo "  make ingestor-dev        - Start ingestor in development mode"
	@echo "  make ingestor-build      - Build ingestor for production"
	@echo "  make ingestor-start      - Start ingestor in production mode"
	@echo "  make ingestor-test       - Run ingestor tests"
	@echo "  make ingestor-test-watch - Run ingestor tests in watch mode"
	@echo "  make ingestor-format     - Format ingestor code"
	@echo "  make ingestor-lint       - Lint ingestor code"
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
	@turbo run format

lint:
	@turbo run lint

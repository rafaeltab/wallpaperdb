# @wallpaperdb/test-utils

Composable, type-safe test infrastructure for WallpaperDB integration and E2E tests, built around the TesterBuilder pattern.

## Key Capabilities

- **Composable infrastructure setup** — builders for PostgreSQL, MinIO, NATS, Redis, OpenSearch, and Docker are combined via a fluent `.with()` chain; calling `.build()` produces a single class that exposes every registered capability
- **Three-phase lifecycle** — setup, cleanup, and destroy phases are provided as opt-in builders; setup starts containers, cleanup resets state between tests, and destroy stops containers after the suite completes
- **Compile-time dependency enforcement** — if a builder requires another builder to be present (e.g., PostgreSQL requires Docker and lifecycle builders), omitting a prerequisite produces a descriptive TypeScript error rather than a runtime failure
- **Test fixture generation** — generates valid image buffers in multiple formats, minimal video stubs, content hashes, and unique test identifiers without requiring running infrastructure
- **Container reuse** — a semaphore-based mechanism coordinates container startup across parallel test files, avoiding redundant container launches

## Technology Choices

- **Testcontainers** — spins up real PostgreSQL, MinIO, Redis, and custom NATS containers against the actual Docker daemon; tests run against production-equivalent infrastructure rather than mocks
- **Sharp** — used to synthesize image fixtures of specified dimensions and formats directly in test code, without relying on checked-in binary assets
- **Advanced TypeScript generics** — the builder framework uses tuple and intersection types to track which builders have been added and to enforce dependencies, providing precise error messages when prerequisites are missing

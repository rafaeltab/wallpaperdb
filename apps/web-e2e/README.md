# @wallpaperdb/web-e2e

Browser-based end-to-end workspace for the WallpaperDB web application using Playwright against the ingress-routed local stack.

## Key Capabilities

- Dedicated home for browser E2E journeys without adding Playwright to the default `make test` path
- Targets the same Caddy-ingress `/web` route used during integrated local development
- Starts with a Chromium-only, single-worker configuration so future flows can optimize for reliability first
- Verifies the ingress-routed local stack before Playwright starts and prints `/ready` plus `/health` diagnostics when a service is not ready
- Uses a dedicated Playwright auth setup project to log in the seeded base user once and reuse saved browser state across authenticated specs

## Technology Choices

- **Playwright** - browser automation and diagnostics for real web journeys
- **Vitest** - small contract tests that keep workspace wiring and configuration honest
- **dotenv** - loads generated worktree-aware `.env` values before Playwright resolves its base URL

# @wallpaperdb/vitest-config

Shared Vitest configuration for all workspaces in the monorepo, ensuring consistent test behaviour and coverage reporting across every service and package.

## Key capabilities

- Exports a `defineBaseConfig` factory that each workspace wraps with its own overrides, so monorepo-wide defaults stay in one place
- Exports plain `defaults` from `@wallpaperdb/vitest-config/defaults` for workspaces on a different Vitest major. Combine these with that workspace's own `defineConfig` and `mergeConfig` from `vitest/config`; the defaults entry point loads no Vitest runtime.
- Suppresses console output for passing tests and surfaces it only on failure, keeping CI output readable
- Raises the slow-test threshold to accommodate integration tests that exercise real infrastructure without generating noise
- Configures coverage to produce JSON, HTML, LCOV, and JSON-summary reporters — the formats consumed by the root coverage-merge step and the Codecov integration

# Reduce Test Output Plan

**Status:** Pending
**Decision Date:** 2026-03-30
**Last Updated:** 2026-03-30

---

## Problem Statement

Test output in this repository is excessively verbose, making it difficult for agents (and developers) to quickly identify failures, diagnose errors, and understand coverage. Three independent noise sources compound each other:

| Source | Estimated lines per full run | Mechanism |
|---|---|---|
| Individual test names (verbose reporter) | ~657 | Vitest defaults to printing every `it()` name |
| Coverage text table | ~200 | `"text"` in `coverage.reporter` in all 13 vitest configs |
| Builder `console.log` infrastructure logs | ~100+ | `console.log` in 14 builder files + scattered test files |

**Goal:** Passing runs should be nearly silent. Failing runs should surface exactly the information needed to diagnose the failure, nothing more.

---

## Design Decisions

| Question | Decision | Rationale |
|---|---|---|
| Passing run verbosity | Silent (no individual test names) | Vitest's default reporter prints file-level summaries with pass count and duration — sufficient for passing runs |
| Console output on passing tests | Suppressed | Vitest v3 `silent: 'passed-only'` buffers `console.*` per test; discards on pass, shows on fail |
| Coverage text output | Remove `"text"` reporter | File-based reporters (`json`, `html`, `lcov`, `json-summary`) remain; the `text` table printed to stdout is pure noise |
| Builder infrastructure logs | Replaced with pino, gated by `LOG_LEVEL` | `LOG_LEVEL` unset → silent; `LOG_LEVEL=debug` → all logs visible. Works in all environments |
| When to show builder logs | `LOG_LEVEL` env var (default silent) | Set `LOG_LEVEL=debug` when diagnosing failures. Pino bypasses `console.*` so LOG_LEVEL and Vitest's silent option are independent controls |
| Config sharing | New `@wallpaperdb/vitest-config` package | Centralises `silent: 'passed-only'` and the stripped coverage reporters; all 13 configs extend it |
| Logger utility location | New `@wallpaperdb/test-logger` package | Separate from `@wallpaperdb/test-utils` to avoid a circular dependency (`test-utils` depends on `testcontainers`, which would need the logger) |
| Scope | All environments | Quieter output everywhere; developers and agents both benefit |
| Turbo output mode | Leave default | Fixing the vitest reporter and coverage reporters is sufficient |

---

## Architecture

### New Packages

```
packages/
  test-logger/          ← NEW: pino-based logger for test infrastructure
    src/index.ts
    package.json
    tsconfig.json
  vitest-config/        ← NEW: shared vitest base config
    src/index.ts
    package.json
    tsconfig.json
```

### Dependency Graph (new edges only)

```
@wallpaperdb/test-logger
  └── pino

@wallpaperdb/vitest-config
  └── vitest (peer/dev)

All 13 vitest configs
  └── @wallpaperdb/vitest-config (devDep)

packages/test-utils/src/builders/*
apps/*/test/builders/*
apps/*/test/*.test.ts
  └── @wallpaperdb/test-logger

packages/testcontainers
  └── @wallpaperdb/test-logger (devDep)
```

---

## Task Breakdown

### Task 1 — Create `@wallpaperdb/test-logger`

**Files to create:**

`packages/test-logger/package.json`
```json
{
  "name": "@wallpaperdb/test-logger",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.8",
    "typescript": "^5.7.2"
  }
}
```

`packages/test-logger/tsconfig.json` — mirror `packages/events/tsconfig.json`

`packages/test-logger/src/index.ts`
```ts
import pino from "pino";

export function createTestLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "silent",
  });
}
```

**Behaviour:**
- `LOG_LEVEL` unset → `"silent"` → all output discarded
- `LOG_LEVEL=debug` → all infrastructure log lines visible
- Pino writes directly to stdout/stderr via Node.js streams, bypassing `console.*`, so it is not affected by Vitest's `silent: 'passed-only'` option — the two controls are independent

---

### Task 2 — Create `@wallpaperdb/vitest-config`

**Files to create:**

`packages/vitest-config/package.json`
```json
{
  "name": "@wallpaperdb/vitest-config",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "devDependencies": {
    "@biomejs/biome": "^2.3.8",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

`packages/vitest-config/tsconfig.json` — mirror `packages/events/tsconfig.json`

`packages/vitest-config/src/index.ts`
```ts
import { defineConfig, mergeConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";

export function defineBaseConfig(overrides: UserConfig): ReturnType<typeof defineConfig> {
  const base = defineConfig({
    test: {
      silent: "passed-only",  // Vitest v3: buffer console.* per test; discard on pass, show on fail
      coverage: {
        reporter: ["json", "html", "lcov", "json-summary"],  // "text" removed — no more per-file table
      },
    },
  });
  return mergeConfig(base, overrides);
}
```

> `silent: 'passed-only'` is a Vitest v3 built-in. All workspace packages already pin `vitest: "^3.0.0"` — no version changes needed.
> `mergeConfig` correctly deep-merges arrays rather than replacing them, and is the documented Vitest pattern for extending configs.

---

### Task 3 — Migrate All 13 Vitest Configs

**Per config, three changes:**
1. Replace `import { defineConfig } from "vitest/config"` with `import { defineBaseConfig } from "@wallpaperdb/vitest-config"`
2. Replace `export default defineConfig({` with `export default defineBaseConfig({`
3. Remove `"text"` from the `coverage.reporter` array (the base provides all four remaining reporters; each package only needs `provider`, `include`, `exclude`, `reportsDirectory`)

**Per `package.json`, one change:**
- Add `"@wallpaperdb/vitest-config": "workspace:*"` to `devDependencies`

**Affected files:**

| Config | Package.json |
|---|---|
| `packages/core/vitest.config.ts` | `packages/core/package.json` |
| `packages/core/vitest.config.integration.ts` | *(same package.json)* |
| `packages/events/vitest.config.ts` | `packages/events/package.json` |
| `packages/url-ipv4-resolver/vitest.config.ts` | `packages/url-ipv4-resolver/package.json` |
| `packages/test-utils/vitest.config.ts` | `packages/test-utils/package.json` |
| `packages/testcontainers/vitest.config.ts` | `packages/testcontainers/package.json` |
| `packages/react-muuri/vitest.config.ts` | `packages/react-muuri/package.json` |
| `apps/ingestor/vitest.config.ts` | `apps/ingestor/package.json` |
| `apps/media/vitest.config.ts` | `apps/media/package.json` |
| `apps/variant-generator/vitest.config.ts` | `apps/variant-generator/package.json` |
| `apps/gateway/vitest.config.ts` | `apps/gateway/package.json` |
| `apps/ingestor-e2e/vitest.config.ts` | `apps/ingestor-e2e/package.json` |
| `apps/web/vitest.config.ts` | `apps/web/package.json` |

---

### Task 4 — Replace `console.log` with `createTestLogger`

**Pattern for each file:**
```ts
import { createTestLogger } from "@wallpaperdb/test-logger";
const logger = createTestLogger("FileName");
// console.log("Starting foo...") → logger.debug("Starting foo...")
// console.log(`Started: ${url}`) → logger.debug({ url }, "Started")
```

**Package.json changes required** (add `@wallpaperdb/test-logger` as a dependency):

| Package | Type |
|---|---|
| `packages/test-utils/package.json` | dependency |
| `packages/testcontainers/package.json` | devDependency |
| `apps/ingestor/package.json` | devDependency |
| `apps/media/package.json` | devDependency |
| `apps/gateway/package.json` | devDependency |
| `apps/variant-generator/package.json` | devDependency |
| `apps/ingestor-e2e/package.json` | devDependency |

**Builder files (infrastructure lifecycle logging):**

| File | console.log calls |
|---|---|
| `packages/test-utils/src/builders/DockerTesterBuilder.ts` | 3 |
| `packages/test-utils/src/builders/PostgresTesterBuilder.ts` | 3 |
| `packages/test-utils/src/builders/MinioTesterBuilder.ts` | 4 |
| `packages/test-utils/src/builders/NatsTesterBuilder.ts` | 4 |
| `packages/test-utils/src/builders/RedisTesterBuilder.ts` | 3 |
| `packages/test-utils/src/builders/OpenSearchTesterBuilder.ts` | 3 |
| `apps/ingestor/test/builders/InProcessIngestorBuilder.ts` | 6 |
| `apps/ingestor/test/builders/IngestorMigrationsBuilder.ts` | 3 |
| `apps/media/test/builders/InProcessMediaBuilder.ts` | 6 |
| `apps/media/test/builders/MediaMigrationsBuilder.ts` | 3 |
| `apps/gateway/test/builders/InProcessGatewayBuilder.ts` | 6 |
| `apps/variant-generator/test/builders/InProcessVariantGeneratorBuilder.ts` | 6 |
| `apps/ingestor-e2e/test/builders/ContainerizedIngestorBuilder.ts` | 6 |
| `apps/ingestor-e2e/test/builders/IngestorMigrationsTesterBuilder.ts` | 4 |

**Non-builder test files (scattered diagnostic logs):**

| File | console.log calls |
|---|---|
| `apps/ingestor/test/rate-limiting-distributed.test.ts` | 3 |
| `apps/ingestor-e2e/test/rate-limiting-distributed.e2e.test.ts` | ~22 |
| `apps/gateway/test/graphql.test.ts` | 1 |
| `packages/testcontainers/test/nats-container.test.ts` | 1 |

---

### Task 5 — Update `turbo.json` Cache Inputs

Add `globalDependencies` so that changes to either new shared package invalidate all test caches across the repo:

```json
{
  "globalDependencies": [
    "packages/vitest-config/src/**",
    "packages/test-logger/src/**"
  ]
}
```

---

## File Change Summary

| Category | New files | Modified files |
|---|---|---|
| `@wallpaperdb/test-logger` package | 3 | 0 |
| `@wallpaperdb/vitest-config` package | 3 | 0 |
| Vitest configs | 0 | 13 |
| Package.json (workspace) | 0 | 20 |
| Builder files | 0 | 14 |
| Non-builder test files | 0 | 4 |
| `turbo.json` | 0 | 1 |
| **Total** | **6** | **52** |

---

## Expected Outcome

| Scenario | Output |
|---|---|
| All tests pass (no LOG_LEVEL set) | File-level summary per package: name, pass count, duration. No individual test names. No coverage table. No builder logs. |
| A test fails | Full `console.*` output for the failing test shown. Passing tests remain silent. |
| `LOG_LEVEL=debug make test` | All builder and test diagnostic logs visible, regardless of pass/fail. |
| `make coverage-summary` | Unchanged — reads `json-summary` files as before. |
| HTML/JSON/LCOV coverage | Written to `coverage/` as before. |
| Agent running tests | Dramatically reduced output; failures are immediately visible without scrolling past noise. |

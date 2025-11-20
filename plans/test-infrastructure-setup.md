# Test Infrastructure Setup Plan

**Status:** ✅ Complete
**Completed:** 2025-11-20
**Prerequisites:** None (can be done anytime)

---

## Overview

Setup measurable test coverage, package vs service test separation, and CI/CD pipelines.

---

## Goals

1. **Package vs Service Test Separation**
   - `make test-packages` - Fast, no infrastructure
   - `make test-apps` - Integration tests with Testcontainers

2. **Measurable Coverage**
   - Vitest coverage with v8 provider
   - HTML, JSON, LCOV reporters

3. **AI-Friendly Reports**
   - Plain text summary script
   - Easy to parse coverage data

4. **GitHub Actions CI/CD**
   - Automated testing on PR
   - Coverage tracking with Codecov
   - Separate package/app test jobs

---

## Implementation Steps

### Step 1: Vitest Workspace (30 min)

**Create:** `vitest.workspace.ts` at root

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',  // Package tests
  'apps/*/vitest.config.ts',      // App tests
]);
```

**Update:** Root `package.json`

```json
{
  "scripts": {
    "test": "vitest",
    "test:packages": "vitest --project packages/*",
    "test:apps": "vitest --project apps/*",
    "test:coverage": "vitest --coverage",
    "test:ui": "vitest --ui"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "latest",
    "@vitest/ui": "latest"
  }
}
```

### Step 2: Coverage Configuration (30 min)

**Update:** `apps/ingestor/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ingestor',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
```

### Step 3: Make Targets (15 min)

**Update:** `Makefile`

```makefile
.PHONY: test test-packages test-apps test-coverage test-ui

test:
	pnpm test

test-packages:
	@echo "Testing packages (fast, no infrastructure)..."
	pnpm test:packages

test-apps:
	@echo "Testing apps (requires infrastructure)..."
	pnpm test:apps

test-coverage:
	pnpm test:coverage

test-ui:
	pnpm test:ui

coverage-summary:
	@node scripts/coverage-summary.js
```

### Step 4: Coverage Summary Script (1 hour)

**Create:** `scripts/coverage-summary.js`

```javascript
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const coveragePath = path.join(process.cwd(), 'coverage/coverage-summary.json');

if (!fs.existsSync(coveragePath)) {
  console.log('No coverage found. Run: make test-coverage');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
const total = data.total;

console.log('\n=== COVERAGE SUMMARY ===\n');
console.log(`Lines:      ${total.lines.pct}%`);
console.log(`Statements: ${total.statements.pct}%`);
console.log(`Functions:  ${total.functions.pct}%`);
console.log(`Branches:   ${total.branches.pct}%`);

// Files with <50% coverage
console.log('\n=== LOW COVERAGE (<50%) ===\n');
Object.entries(data)
  .filter(([k]) => k !== 'total')
  .filter(([_, s]) => s.lines.pct < 50)
  .forEach(([file, stats]) => {
    console.log(`${stats.lines.pct.toFixed(1)}% - ${file}`);
  });
```

### Step 5: GitHub Actions (2-3 hours)

**Create:** `.github/workflows/test.yml`

```yaml
name: Test

on: [push, pull_request]

jobs:
  test-packages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: make test-packages

  test-apps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: make infra-start
      - run: make test-coverage-apps
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
      - run: make infra-stop
        if: always()
```

**Create:** `.github/workflows/build.yml` (build verification)
**Create:** `.github/workflows/e2e.yml` (E2E tests)

### Step 6: Codecov Setup (30 min)

**Create:** `codecov.yml`

```yaml
coverage:
  status:
    project:
      default:
        target: auto
        threshold: 5%
    patch:
      default:
        target: 70%

flags:
  apps:
    paths: [apps/]
  packages:
    paths: [packages/]
```

**Add Codecov token to GitHub secrets**

---

## Usage

```bash
# Local development
make test-packages          # Fast, no infra
make test-apps              # Full integration tests
make test-coverage          # With coverage report
make coverage-summary       # AI-friendly summary
open coverage/index.html    # View HTML report

# CI automatically runs on push/PR
```

---

## Success Criteria

✅ Package tests run separately from app tests
✅ Coverage measurable and reportable
✅ AI can read coverage via script
✅ GitHub Actions run tests automatically
✅ Codecov tracks coverage over time
✅ Documentation updated

---

## Documentation

See:
- [docs/testing/coverage.md](../docs/testing/coverage.md)
- [docs/testing/ci-cd.md](../docs/testing/ci-cd.md)

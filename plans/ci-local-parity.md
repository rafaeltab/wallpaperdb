# CI/Local Development Parity

**Status:** Ready for implementation
**Priority:** High
**Estimated effort:** 30 minutes

---

## Problem

CI pipelines run commands that don't have easy local equivalents. This makes it:
- Harder to reproduce CI failures locally
- Difficult for developers (and Claude) to verify changes before pushing
- Inconsistent between local development and CI

### Current Gaps

| CI Command | Local Equivalent | Status |
|------------|------------------|--------|
| `turbo run check-types` | None | Missing |
| `pnpm test:apps --coverage` | `make test-coverage` (runs all) | Partial |
| Full CI run | None | Missing |

---

## Tasks

### Task 1: Add `check-types` Make Target

**File:** `Makefile`

Add after the lint targets:

```makefile
check-types:
	@turbo run check-types
```

### Task 2: Add `test-apps-coverage` Make Target

**File:** `Makefile`

Add to the testing section:

```makefile
test-apps-coverage:
	@echo "Testing apps with coverage..."
	@pnpm test:apps --coverage
```

### Task 3: Add `ci` Make Target

**File:** `Makefile`

Add a target that replicates the full CI pipeline:

```makefile
ci:
	@echo "Running full CI checks locally..."
	@$(MAKE) build
	@$(MAKE) lint
	@$(MAKE) check-types
	@$(MAKE) test-packages
	@$(MAKE) test-apps
	@echo ""
	@echo "✓ All CI checks passed!"
```

### Task 4: Ensure All Packages Have `check-types` Script

Check each package's `package.json` and add if missing:

```json
"check-types": "tsc --noEmit"
```

**Packages to verify:**
- [ ] `apps/ingestor` - likely has it
- [ ] `apps/ingestor-e2e` - verify
- [ ] `packages/core` - add if missing
- [ ] `packages/events` - add if missing
- [ ] `packages/testcontainers` - verify
- [ ] `packages/test-utils` - verify
- [ ] `packages/url-ipv4-resolver` - verify

### Task 5: Update `turbo.json` Pipeline

**File:** `turbo.json`

Ensure `check-types` task is defined:

```json
{
  "tasks": {
    "check-types": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

### Task 6: Update `make help` Output

**File:** `Makefile`

Add to the help section:

```makefile
@echo "CI/Local Parity:"
@echo "  make ci              - Run full CI pipeline locally"
@echo "  make check-types     - Run type checking on all packages"
@echo "  make test-apps-coverage - Run app tests with coverage"
```

### Task 7: Update CLAUDE.md

**File:** `CLAUDE.md`

Add a section under "Common Commands":

```markdown
### Replicating CI Locally

Run the full CI pipeline locally before pushing:

```bash
make ci
```

This runs: build → lint → check-types → test-packages → test-apps

Individual CI steps:
```bash
make build           # Build all packages
make lint            # Lint all code
make check-types     # Type check all packages
make test-packages   # Fast package tests (no infra)
make test-apps       # App tests with Testcontainers
```
```

### Task 8: Update `.PHONY` Declaration

**File:** `Makefile`

Add the new targets to the `.PHONY` declaration at the top of the Makefile.

---

## Validation

After implementing all tasks:

1. **Verify `make ci` works:**
   ```bash
   make ci
   ```
   Should run all CI checks and pass.

2. **Verify `make check-types` works:**
   ```bash
   make check-types
   ```
   Should type-check all packages.

3. **Verify `make help` shows new targets:**
   ```bash
   make help
   ```
   Should list `ci`, `check-types`, `test-apps-coverage`.

4. **Verify turbo recognizes check-types:**
   ```bash
   turbo run check-types --dry-run
   ```
   Should show all packages that will be type-checked.

---

## Success Criteria

- [ ] `make ci` replicates the full CI pipeline
- [ ] `make check-types` runs type checking on all packages
- [ ] All packages have a `check-types` script
- [ ] `make help` documents the new targets
- [ ] CLAUDE.md explains how to replicate CI locally

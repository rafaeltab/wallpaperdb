# Development Guidelines

This document outlines the core development principles and practices for the WallpaperDB project. These guidelines ensure consistency, maintainability, and quality across all services and shared packages.

---

## Core Principles

### 1. Test-First Development (TDD)

**Always write tests before implementation.**

#### Why Test-First?

- Clarifies requirements before coding
- Ensures code is testable from the start
- Provides immediate validation
- Prevents regression
- Documents expected behavior

#### Test-First Workflow

```
1. Write failing test that describes desired behavior
2. Run test to verify it fails (for the right reason)
3. Implement minimal code to make test pass
4. Run test to verify it passes
5. Refactor if needed (tests still pass)
6. Commit
7. Repeat
```

#### Example: Adding a New Service Method

```typescript
// ❌ DON'T: Write implementation first
export class StorageService {
  async upload(file: Buffer): Promise<string> {
    // implementation...
  }
}

// ✅ DO: Write test first
describe('StorageService', () => {
  it('should upload file to MinIO and return storage key', async () => {
    const service = new StorageService(mockMinioClient);
    const file = Buffer.from('test');

    const key = await service.upload(file);

    expect(key).toMatch(/^wlpr_.*\/original\.jpg$/);
    expect(mockMinioClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'wallpapers',
          Key: key,
        })
      })
    );
  });
});

// Then implement to make test pass
```

---

### 2. Incremental Changes

**Make small, focused changes. Test after each increment. Never big-bang refactoring.**

#### Why Incremental?

- Easier to review
- Easier to debug when things break
- Easier to revert if needed
- Continuous validation
- Reduces risk

#### Incremental Migration Pattern

```typescript
// ❌ DON'T: Big-Bang Refactoring
// Step 1: Create @wallpaperdb/core with ALL connections
// Step 2: Migrate ENTIRE app to use @wallpaperdb/core
// Step 3: Fix all broken tests
// Step 4: Deploy and hope it works
// ⚠️  High risk, hard to debug, large PR

// ✅ DO: Incremental Migration
// Step 1: Extract BaseConnection to @wallpaperdb/core
//   - Create package structure
//   - Write tests for BaseConnection
//   - Verify tests pass
//   - Commit

// Step 2: Migrate one connection (DatabaseConnection)
//   - Update DatabaseConnection to use @wallpaperdb/core
//   - Run ingestor tests
//   - Verify all tests still pass
//   - Commit

// Step 3: Repeat for next connection (MinioConnection)
//   - Same process
//   - Commit

// Each step is validated, reviewable, and reversible
```

#### Migration Checklist

When migrating code to shared packages or refactoring:

- [ ] Create new structure alongside old (don't delete yet)
- [ ] Write tests for new structure
- [ ] Verify tests pass
- [ ] Migrate ONE component/file
- [ ] Run ALL tests
- [ ] Verify tests still pass
- [ ] Commit
- [ ] Repeat for next component
- [ ] Delete old structure only when fully migrated

---

### 3. Document As You Go

**Update documentation when you make changes. Don't wait.**

#### When to Update Documentation

| Change Type | Documentation to Update |
|------------|------------------------|
| Architecture change | `docs/architecture/` |
| New pattern introduced | `docs/architecture/multi-service-patterns.md` |
| Workflow change | `CLAUDE.md` |
| Strategic decision | `plans/` + ADR in `docs/architecture/decisions/` |
| Testing pattern | `docs/testing/` |
| New service created | `plans/services.md` + service README |
| Shared package change | `docs/architecture/shared-packages.md` + package README |

#### Documentation Checklist

Before completing a PR:

- [ ] Code changes implemented
- [ ] Tests written and passing
- [ ] Relevant docs updated
- [ ] Examples added (if introducing new pattern)
- [ ] CLAUDE.md updated (if workflow changes)
- [ ] ADR created (if architectural decision)

---

## Code Quality Standards

### Testing Requirements

#### Test Types

1. **Unit Tests** - Test business logic in isolation
   - Mock all dependencies
   - Fast execution (<1ms per test)
   - High coverage of edge cases

2. **Integration Tests** - Test service integration with infrastructure
   - Use Testcontainers for real infrastructure
   - Test database operations, MinIO uploads, NATS publishing
   - Slower but more realistic

3. **E2E Tests** - Test entire service in Docker
   - Service runs in container
   - Tests full deployment artifact
   - Slowest but most comprehensive

#### Test Organization

```
apps/ingestor/
├── src/
│   ├── services/
│   │   └── storage.service.ts
│   └── ...
├── test/                          # Integration tests
│   ├── storage.test.ts           # Tests storage service with real MinIO
│   └── upload-flow.test.ts       # Tests full upload workflow
└── apps/ingestor-e2e/
    └── test/                      # E2E tests
        └── upload.e2e.test.ts    # Tests Docker container
```

#### Test Coverage Goals

**Current Status:** Coverage tracking being set up (see `docs/testing/coverage.md`)

**Aspirational Goals:**
- Critical paths: >90% coverage (upload workflow, state machine)
- Services: >80% coverage
- Utilities: >90% coverage
- Error handling: 100% coverage

**Note:** These are goals, not strict requirements (yet). Focus on testing critical paths first.

---

### Code Style

#### Use Project Tooling

- **Biome** for linting and formatting
- Run `make format` before committing
- Run `make lint` to check for issues
- CI will enforce these

#### Naming Conventions

```typescript
// Classes: PascalCase
class UploadOrchestrator {}
class WallpaperRepository {}

// Interfaces: PascalCase, no "I" prefix
interface Logger {}
interface Config {}

// Services: PascalCase + "Service" suffix
class StorageService {}
class EventsService {}

// Files: kebab-case
upload-orchestrator.service.ts
wallpaper.repository.ts
base-connection.ts

// Constants: UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;

// Variables: camelCase
const wallpaperId = 'wlpr_123';
const fileMetadata = { /* ... */ };
```

#### Error Handling

Always use RFC 7807 Problem Details for errors:

```typescript
import { ProblemDetailsError } from '@wallpaperdb/core/errors';

// Define custom error classes
export class StorageUploadFailedError extends ProblemDetailsError {
  constructor() {
    super({
      type: 'https://wallpaperdb.example/problems/storage-upload-failed',
      title: 'Storage Upload Failed',
      status: 500,
      detail: 'Failed to upload file to object storage',
    });
  }
}

// Throw in services
throw new StorageUploadFailedError();

// Fastify will automatically format as application/problem+json
```

---

## Git Workflow

### Branch Naming

```
feature/add-thumbnail-service
fix/storage-timeout-handling
refactor/extract-base-connection
docs/update-testing-guide
```

### Commit Messages

Follow Conventional Commits:

```
feat: add thumbnail extraction service
fix: handle MinIO timeout errors
refactor: extract BaseConnection to @wallpaperdb/core
docs: add observability implementation guide
test: add coverage for state machine transitions
chore: update dependencies
```

### Pull Request Guidelines

#### PR Title

Use conventional commit format:
```
feat: implement repository pattern for wallpaper data access
```

#### PR Description Template

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Created WallpaperRepository
- Migrated UploadOrchestrator to use repository
- Updated tests

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] E2E tests pass (if applicable)

## Documentation
- [ ] CLAUDE.md updated (if needed)
- [ ] Architecture docs updated (if needed)
- [ ] ADR created (if architectural decision)

## Checklist
- [ ] Tests written first (TDD)
- [ ] All tests passing
- [ ] Linter passing
- [ ] Documentation updated
- [ ] Small, incremental change
```

#### PR Size

- **Small:** <200 lines changed (ideal)
- **Medium:** 200-500 lines (acceptable)
- **Large:** >500 lines (needs justification or should be split)

#### Review Process

1. Self-review first (read your own diff)
2. Ensure CI passes
3. Request review
4. Address feedback
5. Squash commits if messy history
6. Merge when approved

---

## Common Patterns

### Service Structure

```typescript
import { inject, singleton } from 'tsyringe';
import type { Logger } from '../core/logger.service.js';

@singleton()
export class MyService {
  constructor(
    @inject(DatabaseConnection) private readonly db: DatabaseConnection,
    @inject('Logger') private readonly logger: Logger
  ) {}

  async doSomething(): Promise<Result> {
    // Implementation
    this.logger.info('Did something', { context });
    return result;
  }
}
```

### Repository Pattern

```typescript
import { inject, singleton } from 'tsyringe';
import type { Logger } from '../core/logger.service.js';

@singleton()
export class WallpaperRepository {
  constructor(
    @inject(DatabaseConnection) private readonly db: DatabaseConnection,
    @inject('Logger') private readonly logger: Logger
  ) {}

  async findById(id: string): Promise<Wallpaper | null> {
    return this.db.getClient().db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, id),
    });
  }

  async create(data: NewWallpaper): Promise<void> {
    await this.db.getClient().db.insert(wallpapers).values(data);
  }
}
```

### Controller Pattern

```typescript
import { inject, singleton } from 'tsyringe';

@singleton()
export class UploadController {
  constructor(
    @inject(UploadOrchestrator) private readonly orchestrator: UploadOrchestrator,
    @inject('Logger') private readonly logger: Logger
  ) {}

  async handleUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await this.orchestrator.handleUpload({
      buffer: request.file.buffer,
      userId: request.userId,
      // ...
    });

    return reply.code(201).send(result);
  }
}
```

---

## Anti-Patterns to Avoid

### ❌ Console Logging

```typescript
// DON'T
console.log('User uploaded file', userId);
console.error('Upload failed', error);

// DO
this.logger.info('User uploaded file', { userId });
this.logger.error('Upload failed', { error, userId });
```

### ❌ Direct Database Access in Routes

```typescript
// DON'T
fastify.post('/upload', async (request, reply) => {
  const result = await db.query.wallpapers.insert(/* ... */);
  return result;
});

// DO
fastify.post('/upload', async (request, reply) => {
  const controller = container.resolve(UploadController);
  return controller.handleUpload(request, reply);
});
```

### ❌ Mixing Business Logic and Infrastructure

```typescript
// DON'T
class UploadService {
  async upload(file: Buffer) {
    // MinIO code here
    const result = await s3Client.send(new PutObjectCommand(/* ... */));
    // Business logic here
    await db.insert(wallpapers).values(/* ... */);
  }
}

// DO
class UploadOrchestrator {
  async upload(file: Buffer) {
    // Delegate to infrastructure services
    const key = await this.storageService.upload(file);
    await this.repository.create({ storageKey: key, /* ... */ });
  }
}
```

### ❌ God Services

```typescript
// DON'T
class WallpaperService {
  async upload() {}
  async process() {}
  async generateThumbnail() {}
  async analyze() {}
  async search() {}
  // ... 20 more methods
}

// DO
class UploadOrchestrator {}
class ProcessingService {}
class ThumbnailService {}
class AnalysisService {}
class SearchService {}
```

---

## Resources

- [Testing Documentation](../testing/README.md)
- [Architecture Patterns](../architecture/multi-service-patterns.md)
- [Shared Packages Guide](../architecture/shared-packages.md)
- [CI/CD Guide](../testing/ci-cd.md)
- [Creating New Services](../guides/creating-new-service.md)

---

## Questions?

If you're unsure about any of these guidelines:
1. Check existing code for patterns
2. Refer to architecture docs
3. Ask in PR/code review
4. Update this document if clarification needed

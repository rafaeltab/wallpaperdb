# OpenSearch Zero-Downtime Migration System

> **Status:** Planned (not yet implemented)
> **Priority:** Future enhancement (when production environment exists)
> **Estimated Effort:** 6-8 weeks
> **Dependencies:** Kubernetes cluster, platform orchestration capability
> **Architecture Pattern:** Kubernetes Operator

## IMPORTANT: Architecture Revision (2025-12-02)

**Original approach:** CLI-based migration tool
**Revised approach:** Kubernetes Operator pattern

**Rationale for operator pattern:**
- Migration is infrastructure-level operation, not application-level
- Need to orchestrate multiple service instances (old + new versions)
- Services running different index versions must coexist during migration
- Network isolation required (new version in private network initially)
- Platform-aware coordination (Kubernetes deployments, services, ingress)
- Atomic cutover at infrastructure layer (traffic routing, DNS, load balancers)
- Too complex for simple CLI - needs declarative state management

**New Architecture Overview:**

```
Migration Operator (separate service)
  ├── Watches MigrationRequest CRDs
  ├── Talks to Kubernetes API
  ├── Orchestrates deployments
  │   ├── Deploy new service version → new index
  │   ├── Keep old service version → old index
  │   └── Coordinate dual-write phase
  ├── Manages network topology
  │   ├── New version: private network only
  │   ├── Old version: public + private
  │   └── Traffic switching at cutover
  └── Handles rollback via K8s rollback mechanisms
```

**Key Differences from Original Plan:**
- Migration is declarative (apply CRD), not imperative (run CLI)
- Operator runs continuously, watching for migration requests
- Multiple service instances orchestrated by operator
- Platform-aware (K8s-native or adaptable to other platforms)
- State stored in K8s resources, not local files

**Implementation Note:** The core logic from the original plan (event replay, validation, dual-write) is still valid, but becomes part of the operator's reconciliation loop rather than a CLI script.

See "Operator Pattern Architecture" section below for detailed design.

## Overview

Design and implement a production-ready, zero-downtime OpenSearch index migration system that:
- Uses versioned indexes with alias-based routing
- Supports dual-write pattern (no consumer pause during migration)
- Provides modular event replay infrastructure reusable across services
- Operates as separate CLI/CI process (not on app startup)
- Enables safe rollback within 7-day window

## Operator Pattern Architecture

### High-Level Design

**Migration Operator Service:**
```typescript
// New service: apps/migration-operator/
// Runs as separate deployment in K8s
// Watches for MigrationRequest custom resources
// Orchestrates entire migration lifecycle
```

**Migration CRD (Custom Resource Definition):**
```yaml
apiVersion: wallpaperdb.io/v1alpha1
kind: MigrationRequest
metadata:
  name: gateway-v1-to-v2
spec:
  service: gateway
  fromVersion: 1
  toVersion: 2
  strategy: event-replay

  # Deployment configuration
  newVersionDeployment:
    replicas: 3
    image: gateway:v2
    network: private  # Initially not exposed publicly

  # Migration phases
  phases:
    - dualWrite        # Write to both indexes
    - replay           # Replay historical events
    - validate         # Validation checks
    - cutover          # Switch traffic
    - cleanup          # Remove old deployment

  # Safety settings
  rollbackWindow: 7d
  validationThreshold: 99.9  # % match required

status:
  phase: InProgress
  currentStep: DualWrite
  progress: 45%
  oldDeployment: gateway-v1-abc123
  newDeployment: gateway-v2-def456
```

**Operator Reconciliation Loop:**
```typescript
async reconcile(migrationRequest: MigrationRequest) {
  const currentPhase = migrationRequest.status.phase;

  switch (currentPhase) {
    case 'Pending':
      await this.validateMigrationRequest(migrationRequest);
      await this.deployNewVersion(migrationRequest);
      await this.updatePhase(migrationRequest, 'DualWrite');
      break;

    case 'DualWrite':
      await this.enableDualWriteMode(migrationRequest);
      await this.updatePhase(migrationRequest, 'Replay');
      break;

    case 'Replay':
      await this.startEventReplay(migrationRequest);
      await this.monitorReplayProgress(migrationRequest);
      if (replayComplete) {
        await this.updatePhase(migrationRequest, 'Validate');
      }
      break;

    case 'Validate':
      const validation = await this.validateMigration(migrationRequest);
      if (validation.passed) {
        await this.updatePhase(migrationRequest, 'Cutover');
      } else {
        await this.handleValidationFailure(migrationRequest, validation);
      }
      break;

    case 'Cutover':
      await this.switchTraffic(migrationRequest);
      await this.updatePhase(migrationRequest, 'Cleanup');
      break;

    case 'Cleanup':
      await this.scheduleOldDeploymentDeletion(migrationRequest);
      await this.updatePhase(migrationRequest, 'Complete');
      break;
  }
}
```

**Platform Abstraction:**
```typescript
// Support multiple platforms via adapter pattern
interface PlatformAdapter {
  deployService(config: DeploymentConfig): Promise<Deployment>;
  scaleService(deployment: Deployment, replicas: number): Promise<void>;
  switchTraffic(from: Deployment, to: Deployment): Promise<void>;
  deleteDeployment(deployment: Deployment): Promise<void>;
}

// Kubernetes implementation
class KubernetesPlatformAdapter implements PlatformAdapter { ... }

// Future: Docker Swarm, Nomad, etc.
class DockerSwarmPlatformAdapter implements PlatformAdapter { ... }
```

### Service Deployment Topology During Migration

**Phase 1: Before Migration**
```
┌─────────────────┐
│   LoadBalancer  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ gateway │  → wallpapers_v1
    │   v1    │
    └─────────┘
```

**Phase 2: New Version Deployed (Private Network)**
```
┌─────────────────┐
│   LoadBalancer  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ gateway │  → wallpapers_v1
    │   v1    │
    └─────────┘

Private Network Only:
    ┌─────────┐
    │ gateway │  → wallpapers_v2 (not publicly accessible yet)
    │   v2    │
    └─────────┘
```

**Phase 3: Dual-Write Mode**
```
┌─────────────────┐
│   LoadBalancer  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ gateway │  → wallpapers_v1 (read/write)
    │   v1    │  → wallpapers_v2 (write only via dual-write)
    └─────────┘

Private Network:
    ┌─────────┐
    │ gateway │  → wallpapers_v2
    │   v2    │     (receiving replayed events)
    └─────────┘
```

**Phase 4: Traffic Cutover**
```
┌─────────────────┐
│   LoadBalancer  │  (traffic switches atomically)
└────────┬────────┘
         │
         ├────────────┐
         │            │
    ┌────▼────┐  ┌───▼─────┐
    │ gateway │  │ gateway │  → wallpapers_v2
    │   v1    │  │   v2    │
    └─────────┘  └─────────┘
       (scaled       (scaled up,
        down)         public)
```

**Phase 5: Cleanup (After 7 Days)**
```
┌─────────────────┐
│   LoadBalancer  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ gateway │  → wallpapers_v2
    │   v2    │
    └─────────┘

(wallpapers_v1 deleted)
(gateway-v1 deployment deleted)
```

## Architecture Decisions

### 1. Operator-Driven Migration (Not App Startup)

**Decision:** Migration is orchestrated by separate operator service, NOT by application startup or CLI.

**Rationale:**
- Migration is infrastructure operation, not application responsibility
- Requires platform-level coordination (K8s deployments, services, networking)
- Declarative approach (apply CRD) vs imperative (run script)
- Operator can watch and react to state changes continuously
- GitOps-friendly (migration as code in version control)
- Aligns with cloud-native patterns

**Implementation:**
- App startup: Detect version mismatch → log warning → continue
- Health endpoint: Report which index version app is using
- Migration: Apply MigrationRequest CRD → operator handles orchestration
- State: Stored in Kubernetes resources (etcd), not local files

### 2. Dual-Write Pattern (Zero True Downtime)

**Decision:** During migration, consumers write to BOTH old and new indexes simultaneously.

**Rationale:**
- No service interruption (reads and writes continue)
- No event queueing or delayed processing
- True zero downtime from user perspective
- No consumer pause needed

**Migration Phases:**

```
Phase 1: Normal Operation
  Events → Consumers → Old Index (wallpapers_v1)

Phase 2: Migration Start (Dual-Write)
  Events → Consumers → [Old Index + New Index]
                        (wallpapers_v1 + wallpapers_v2)

Phase 3: Replay Historical Events
  NATS replay → Migration Consumers → New Index only

Phase 4: Validation
  Compare document counts, validate schema

Phase 5: Read Cutover (Atomic)
  GraphQL alias: wallpapers → wallpapers_v2

Phase 6: Write Cutover
  Events → Consumers → New Index only (wallpapers_v2)

Phase 7: Cleanup (after 7 days)
  Manual deletion of wallpapers_v1
```

**Trade-offs:**
- More complex than pause-based approach
- Temporarily doubles write load
- Requires version-aware repository
- BUT: Zero service interruption, no event queueing

### 3. Modular Event Replay (Shared Package)

**Decision:** Extract event replay logic to `@wallpaperdb/migration-tools` package.

**Rationale:**
- Gateway needs it (when production exists)
- Media service will need it
- Any future service with event sourcing will need it
- Single implementation = consistent behavior
- Shared testing infrastructure

**Package Structure:**

```
packages/migration-tools/
├── src/
│   ├── event-replay/
│   │   ├── event-replay-migrator.ts      # Generic replay orchestrator
│   │   ├── consumer-manager.ts           # Consumer lifecycle management
│   │   └── replay-progress-tracker.ts    # Progress tracking
│   ├── validation/
│   │   ├── index-validator.ts            # Generic validation
│   │   └── document-comparer.ts          # Sample document comparison
│   ├── versioning/
│   │   ├── version-manager.ts            # Version detection
│   │   └── alias-manager.ts              # Alias manipulation
│   └── types.ts                          # Shared types
└── test/
```

**Service-Specific Configuration:**

Each service provides:
- Which NATS consumers to replay
- Which events to process
- Target index configuration
- Custom validation logic (if needed)

### 4. Version Configuration

**Approach:** Code-based versioning with environment override capability.

**Per-Service Files:**

```typescript
// apps/gateway/src/opensearch/versions.ts
export const WALLPAPERS_INDEX_VERSION = 2;
export const WALLPAPERS_INDEX_CONFIG = {
  baseName: 'wallpapers',
  alias: 'wallpapers',
  currentVersion: WALLPAPERS_INDEX_VERSION,
  getMappings: (version: number) => {
    switch (version) {
      case 1: return wallpapersIndexMappingV1;
      case 2: return wallpapersIndexMappingV2;
      default: throw new Error(`Unknown version: ${version}`);
    }
  }
};
```

## Implementation Components

### 1. Migration Operator Service (New)

**Location:** `apps/migration-operator/`

**Purpose:** Kubernetes operator that orchestrates OpenSearch migrations across all services.

**Key Responsibilities:**
- Watch for MigrationRequest CRDs
- Orchestrate service deployments (old + new versions)
- Manage network topology (private → public cutover)
- Coordinate event replay via shared migration-tools package
- Monitor migration progress and health
- Handle rollback scenarios
- Manage cleanup after rollback window expires

**Technology Stack:**
- Kubernetes client library (e.g., `@kubernetes/client-node`)
- Custom Resource Definition (CRD) handling
- Fastify for health/metrics endpoints
- OpenTelemetry for observability
- Uses `@wallpaperdb/migration-tools` for core logic

**Service Structure:**
```
apps/migration-operator/
├── src/
│   ├── index.ts                          # Operator entry point
│   ├── controllers/
│   │   ├── migration-controller.ts       # Main reconciliation loop
│   │   └── rollback-controller.ts        # Handles rollback requests
│   ├── platform/
│   │   ├── platform-adapter.ts           # Platform abstraction
│   │   ├── kubernetes-adapter.ts         # K8s implementation
│   │   └── types.ts                      # Platform-agnostic types
│   ├── reconcilers/
│   │   ├── deployment-reconciler.ts      # Service deployment logic
│   │   ├── network-reconciler.ts         # Network topology management
│   │   ├── replay-reconciler.ts          # Event replay coordination
│   │   └── validation-reconciler.ts      # Post-migration validation
│   └── crds/
│       ├── migration-request.yaml        # CRD definition
│       └── types.ts                      # TypeScript types for CRD
├── deploy/
│   ├── deployment.yaml                   # Operator deployment
│   ├── rbac.yaml                         # K8s permissions
│   └── crds.yaml                         # Install CRDs
└── test/
    └── integration/
        └── migration-e2e.test.ts         # Full migration test
```

### 2. `@wallpaperdb/migration-tools` (Shared Package - Updated Role)

**Purpose:** Reusable migration logic used BY the operator (not a standalone CLI).

**Note:** This package provides the core migration logic (event replay, validation, dual-write), but is now consumed by the migration operator rather than executed directly via CLI.

**Key Components:**

**`EventReplayMigrator`** - Generic event replay orchestration:
```typescript
class EventReplayMigrator {
  async migrate(config: EventReplayConfig): Promise<MigrationResult> {
    // 1. Create new index with new mappings
    // 2. Start dual-write mode (consumers write to both)
    // 3. Create migration consumers (write to new index only)
    // 4. Reset consumer positions to beginning
    // 5. Replay all events to new index
    // 6. Validate migration
    // 7. Switch read alias to new index
    // 8. Stop dual-write (write to new only)
    // 9. Return success/failure
  }
}
```

**`ConsumerManager`** - Lifecycle management:
```typescript
class ConsumerManager {
  async enableDualWrite(consumers: Consumer[], newIndex: string): Promise<void>;
  async disableDualWrite(consumers: Consumer[]): Promise<void>;
  async getConsumerStatus(): Promise<ConsumerStatus[]>;
}
```

**`IndexValidator`** - Post-migration validation:
```typescript
class IndexValidator {
  async validate(old: string, new: string): Promise<ValidationResult>;
  async compareDocumentCounts(): Promise<boolean>;
  async validateSchema(samples: number): Promise<SchemaValidation>;
}
```

**`AliasManager`** - Zero-downtime alias switching:
```typescript
class AliasManager {
  async switchAlias(alias: string, from: string, to: string): Promise<void>;
  async getCurrentIndex(alias: string): Promise<string>;
  async rollbackAlias(alias: string, to: string): Promise<void>;
}
```

**Benefits of Shared Package:**
- Single source of truth for migration logic
- Tested once, works everywhere
- Consistent behavior across services
- Easy to add new services
- Shared types and interfaces

### 3. Gateway-Specific Implementation (Updated)

**New Files:**

**`apps/gateway/src/opensearch/versions.ts`** - Version configuration
**`apps/gateway/src/services/migration/gateway-migration-config.ts`** - Service-specific config
**`apps/gateway/src/services/migration/dual-write-repository.ts`** - Dual-write wrapper
**`apps/gateway/deploy/migration-request.yaml`** - Example MigrationRequest CRD
**`apps/gateway/deploy/v2-deployment.yaml`** - Deployment config for v2

**Modified Files:**

**`apps/gateway/src/app.ts`** - Version detection on startup (warn only)
**`apps/gateway/src/services/index-manager.service.ts`** - Alias-aware index management
**`apps/gateway/src/repositories/wallpaper.repository.ts`** - Support dual-write mode
**`apps/gateway/src/services/health.service.ts`** - Migration status in health check
**`apps/gateway/src/config.ts`** - Migration-related configuration

## Dual-Write Implementation

### Repository Dual-Write Pattern

**Challenge:** Repository must write to two indexes during migration without code changes in consumers.

**Solution:** Wrap repository with dual-write proxy during migration.

```typescript
// apps/gateway/src/services/migration/dual-write-repository.ts

export class DualWriteWallpaperRepository {
  constructor(
    private readonly primaryRepo: WallpaperRepository,    // New index
    private readonly secondaryRepo: WallpaperRepository   // Old index
  ) {}

  async upsert(wallpaper: WallpaperDocument): Promise<void> {
    // Write to both indexes in parallel
    await Promise.all([
      this.primaryRepo.upsert(wallpaper),
      this.secondaryRepo.upsert(wallpaper)
    ]);
  }

  async addVariant(wallpaperId: string, variant: Variant): Promise<void> {
    await Promise.all([
      this.primaryRepo.addVariant(wallpaperId, variant),
      this.secondaryRepo.addVariant(wallpaperId, variant)
    ]);
  }

  // Search only uses primary (reads from old index during migration)
  async search(params: any): Promise<any> {
    return this.primaryRepo.search(params);
  }
}
```

**Consumer Integration:**

```typescript
// During migration, swap repository in DI container
container.register(WallpaperRepository, {
  useFactory: () => {
    if (migrationState.isDualWriteMode) {
      return new DualWriteWallpaperRepository(
        new WallpaperRepository(opensearch, { index: 'wallpapers_v2' }),
        new WallpaperRepository(opensearch, { index: 'wallpapers_v1' })
      );
    }
    return new WallpaperRepository(opensearch, { index: getAliasName() });
  }
});
```

### Migration State Management

**Challenge:** Track which phase of migration we're in.

**Solution:** Migration state file + atomic transitions.

```typescript
// packages/migration-tools/src/state/migration-state.ts

export interface MigrationState {
  phase: 'idle' | 'dual-write' | 'replaying' | 'validating' | 'complete';
  fromVersion: number;
  toVersion: number;
  startedAt: string;
  oldIndex: string;
  newIndex: string;
}

export class MigrationStateManager {
  async load(): Promise<MigrationState | null>;
  async save(state: MigrationState): Promise<void>;
  async clear(): Promise<void>;
  async getCurrentPhase(): Promise<MigrationPhase>;
}
```

**Storage:** OpenSearch index metadata or simple JSON file in `.migration-state/gateway.json`.

## Migration Workflow (Operator-Driven)

### Triggering Migration: Apply CRD

**Declarative Migration Request:**

```yaml
# apps/gateway/deploy/migration-v1-to-v2.yaml
apiVersion: wallpaperdb.io/v1alpha1
kind: MigrationRequest
metadata:
  name: gateway-v1-to-v2
  namespace: wallpaperdb
spec:
  service: gateway
  fromVersion: 1
  toVersion: 2
  strategy: event-replay

  # Source deployment (old version)
  sourceDeployment:
    name: gateway
    namespace: wallpaperdb

  # Target deployment configuration
  targetDeployment:
    image: gateway:v2.0.0
    replicas: 3
    resources:
      requests:
        cpu: "500m"
        memory: "512Mi"
      limits:
        cpu: "1000m"
        memory: "1Gi"
    network:
      type: private  # Not exposed publicly during migration

  # Event replay configuration
  eventReplay:
    natsStream: WALLPAPER
    consumers:
      - wallpaper.uploaded
      - wallpaper.variant.available
    batchSize: 1000
    parallelism: 5

  # Validation requirements
  validation:
    documentCountMatch: required
    schemaSampleSize: 100
    minMatchPercentage: 99.9

  # Rollback settings
  rollback:
    window: 168h  # 7 days
    autoRollbackOnFailure: false
```

**Apply Migration:**

```bash
$ kubectl apply -f apps/gateway/deploy/migration-v1-to-v2.yaml

migrationrequest.wallpaperdb.io/gateway-v1-to-v2 created
```

**Monitor Migration Progress:**

```bash
$ kubectl get migrationrequest gateway-v1-to-v2 -o yaml

apiVersion: wallpaperdb.io/v1alpha1
kind: MigrationRequest
metadata:
  name: gateway-v1-to-v2
spec: ...
status:
  phase: Replay
  progress: 45%
  currentStep: ReplayingEvents

  deployments:
    source:
      name: gateway-abc123
      version: 1
      indexName: wallpapers_v1
      replicas: 3
      state: Running
    target:
      name: gateway-def456
      version: 2
      indexName: wallpapers_v2
      replicas: 3
      state: Running
      network: private

  eventReplay:
    totalEvents: 50000
    processedEvents: 23456
    eventsPerSecond: 523
    estimatedCompletion: "2025-12-02T10:15:00Z"

  validation:
    lastCheck: "2025-12-02T10:12:00Z"
    status: Pending

  conditions:
    - type: Progressing
      status: "True"
      reason: ReplayingEvents
      message: "Replaying historical events: 45% complete"
      lastTransitionTime: "2025-12-02T10:10:00Z"

$ kubectl logs -f deployment/migration-operator -n wallpaperdb

[2025-12-02T10:12:15Z] INFO: Processing MigrationRequest gateway-v1-to-v2
[2025-12-02T10:12:15Z] INFO: Phase: Replay
[2025-12-02T10:12:15Z] INFO: Events replayed: 23,456/50,000 (45%)
[2025-12-02T10:12:15Z] INFO: Rate: 523 events/sec
[2025-12-02T10:12:15Z] INFO: ETA: 3 minutes
```

**Operator Progression (Automatic):**

```
✓ Phase 1: DeployingTarget
  - Created deployment gateway-def456 (v2)
  - Created service gateway-v2 (private network only)
  - Created OpenSearch index wallpapers_v2

✓ Phase 2: DualWrite
  - Enabled dual-write mode in gateway-abc123
  - Writing to both wallpapers_v1 and wallpapers_v2

→ Phase 3: Replay (Current)
  - Replaying events: 23,456/50,000 (45%)
  - Rate: 523 events/sec

  Phase 4: Validate (Pending)
  Phase 5: Cutover (Pending)
  Phase 6: Cleanup (Pending)
```

**Completion:**

```bash
$ kubectl get migrationrequest gateway-v1-to-v2

NAME                  PHASE      PROGRESS   AGE
gateway-v1-to-v2      Complete   100%       8m23s

$ kubectl get migrationrequest gateway-v1-to-v2 -o jsonpath='{.status.summary}'

Migration completed successfully
- Duration: 8m 23s
- Events processed: 50,000
- Validation: PASSED (99.95% match)
- Old deployment: gateway-abc123 (retained for 7 days)
- New deployment: gateway-def456 (live, public)
- Rollback window: 168h remaining
```

### Rollback Workflow

**Create Rollback Request:**

```yaml
# rollback-request.yaml
apiVersion: wallpaperdb.io/v1alpha1
kind: RollbackRequest
metadata:
  name: gateway-rollback-to-v1
spec:
  migrationRequest: gateway-v1-to-v2
  reason: "Validation failures in production"
```

```bash
$ kubectl apply -f rollback-request.yaml

rollbackrequest.wallpaperdb.io/gateway-rollback-to-v1 created

$ kubectl get rollbackrequest gateway-rollback-to-v1

NAME                        PHASE        PROGRESS   AGE
gateway-rollback-to-v1      InProgress   30%        15s
```

**Operator Actions (Automatic):**

```
✓ Scaling down gateway-def456 (v2)
✓ Scaling up gateway-abc123 (v1)
✓ Switching traffic to gateway-abc123
✓ Switching OpenSearch alias: wallpapers → wallpapers_v1
✓ Marking gateway-def456 for manual cleanup
✓ Rollback complete

Duration: 45s
```

## Event Replay Deep Dive

### Generic Event Replay (Shared Package)

**Service Configuration:**

```typescript
// apps/gateway/src/services/migration/gateway-migration-config.ts

export const gatewayMigrationConfig: EventReplayMigrationConfig = {
  serviceName: 'gateway',
  streamName: 'WALLPAPER',

  // Define which consumers to replay
  consumers: [
    {
      eventType: 'wallpaper.uploaded',
      subject: WALLPAPER_UPLOADED_SUBJECT,
      durableName: 'gateway-migration-wallpaper-uploaded',
      handler: WallpaperUploadedConsumer,
    },
    {
      eventType: 'wallpaper.variant.available',
      subject: WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
      durableName: 'gateway-migration-wallpaper-variant-available',
      handler: WallpaperVariantAvailableConsumer,
    }
  ],

  // Index configuration
  indexConfig: WALLPAPERS_INDEX_CONFIG,

  // Validation configuration
  validation: {
    sampleSize: 100,
    requiredFields: ['wallpaperId', 'userId', 'variants'],
    variantFields: ['width', 'height', 'format']
  }
};
```

**Migration Execution:**

```typescript
// apps/gateway/scripts/migrate-index.ts

import { EventReplayMigrator } from '@wallpaperdb/migration-tools';
import { gatewayMigrationConfig } from '../src/services/migration/gateway-migration-config.js';

const migrator = new EventReplayMigrator(gatewayMigrationConfig);

await migrator.migrate({
  fromVersion: 1,
  toVersion: 2,
  onProgress: (progress) => {
    console.log(`[${progress.phase}] ${progress.percentComplete}%`);
  }
});
```

### NATS Consumer Position Reset

**Challenge:** Replay from beginning without affecting production consumers.

**Solution:** Create temporary migration consumers with `DeliverPolicy.All`.

```typescript
// packages/migration-tools/src/event-replay/consumer-position-manager.ts

export class ConsumerPositionManager {
  async createMigrationConsumers(
    streamName: string,
    consumers: ConsumerConfig[]
  ): Promise<void> {
    const jsm = await this.nats.jetstreamManager();

    for (const consumer of consumers) {
      // Delete if exists (cleanup from previous migration)
      try {
        await jsm.consumers.delete(streamName, consumer.durableName);
      } catch { /* ignore */ }

      // Create fresh consumer starting from sequence 1
      await jsm.consumers.add(streamName, {
        durable_name: consumer.durableName,
        deliver_policy: DeliverPolicy.All,  // Start from beginning
        ack_policy: AckPolicy.Explicit,
        filter_subject: consumer.subject,
        max_ack_pending: 1000  // Tuning for faster replay
      });
    }
  }

  async waitForReplayComplete(
    streamName: string,
    consumerName: string
  ): Promise<void> {
    const jsm = await this.nats.jetstreamManager();

    // Poll until lag stabilizes at 0
    let stableCount = 0;
    while (stableCount < 5) {  // 5 seconds stable
      await sleep(1000);
      const info = await jsm.consumers.info(streamName, consumerName);
      const lag = info.num_pending || 0;

      if (lag === 0) {
        stableCount++;
      } else {
        stableCount = 0;
      }
    }
  }

  async cleanupMigrationConsumers(
    streamName: string,
    consumers: ConsumerConfig[]
  ): Promise<void> {
    const jsm = await this.nats.jetstreamManager();
    for (const consumer of consumers) {
      await jsm.consumers.delete(streamName, consumer.durableName);
    }
  }
}
```

## Testing Strategy

### Shared Package Tests (`@wallpaperdb/migration-tools`)

**Unit Tests:**
- Version extraction and comparison
- Alias switching logic
- State management
- Progress tracking

**Integration Tests:**
- Event replay with mock NATS stream
- Consumer position management
- Validation logic
- Error recovery scenarios

### Gateway Tests

**Integration Tests:**

```typescript
// apps/gateway/test/integration/migration-event-replay.test.ts

describe('Event Replay Migration', () => {
  it('should migrate v1 → v2 using event replay', async () => {
    // 1. Populate v1 index via NATS events
    await publishWallpaperEvents(testData);

    // 2. Execute migration
    const migrator = new EventReplayMigrator(gatewayMigrationConfig);
    const result = await migrator.migrate({
      fromVersion: 1,
      toVersion: 2
    });

    // 3. Validate
    expect(result.success).toBe(true);
    expect(result.documentsProcessed).toBe(testData.length);

    // 4. Verify alias points to v2
    const currentIndex = await aliasManager.getCurrentIndex('wallpapers');
    expect(currentIndex).toBe('wallpapers_v2');
  });

  it('should support dual-write during migration', async () => {
    // Start migration (dual-write phase)
    await migrator.startDualWrite();

    // Publish new events during migration
    await publishWallpaperEvent(newWallpaper);

    // Verify written to BOTH indexes
    const v1Doc = await getDocument('wallpapers_v1', newWallpaper.id);
    const v2Doc = await getDocument('wallpapers_v2', newWallpaper.id);

    expect(v1Doc).toBeDefined();
    expect(v2Doc).toBeDefined();
  });

  it('should rollback to previous version', async () => {
    // Migrate v1 → v2
    await migrator.migrate({ fromVersion: 1, toVersion: 2 });

    // Rollback
    await migrator.rollback({ toVersion: 1 });

    // Verify alias points to v1
    const currentIndex = await aliasManager.getCurrentIndex('wallpapers');
    expect(currentIndex).toBe('wallpapers_v1');
  });
});
```

## File Structure

### New Shared Package

```
packages/migration-tools/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                                  # Public API exports
│   ├── event-replay/
│   │   ├── event-replay-migrator.ts             # Main orchestrator
│   │   ├── consumer-position-manager.ts         # NATS consumer management
│   │   └── replay-progress-tracker.ts           # Progress tracking
│   ├── validation/
│   │   ├── index-validator.ts                   # Document count, schema validation
│   │   └── document-comparer.ts                 # Sample comparison
│   ├── versioning/
│   │   ├── version-detector.ts                  # Detect version mismatches
│   │   └── alias-manager.ts                     # OpenSearch alias operations
│   ├── state/
│   │   └── migration-state-manager.ts           # Track migration phase
│   └── types.ts                                 # Shared types
└── test/
    └── integration/
        ├── event-replay.test.ts
        └── alias-switching.test.ts
```

### Gateway Service

```
apps/gateway/
├── src/
│   ├── opensearch/
│   │   ├── versions.ts                          # NEW: Version configuration
│   │   ├── mappings.ts                          # EXISTING
│   │   └── mappings-v2.ts                       # NEW: V2 mappings (example)
│   ├── services/
│   │   ├── migration/
│   │   │   ├── gateway-migration-config.ts      # NEW: Service-specific config
│   │   │   └── dual-write-repository.ts         # NEW: Dual-write wrapper
│   │   ├── index-manager.service.ts             # MODIFIED: Alias support
│   │   └── health.service.ts                    # MODIFIED: Migration status
│   ├── repositories/
│   │   └── wallpaper.repository.ts              # MODIFIED: Version-aware
│   ├── config.ts                                # MODIFIED: Migration config
│   └── app.ts                                   # MODIFIED: Version detection
├── scripts/
│   ├── migrate-index.ts                         # NEW: Migration CLI
│   └── rollback-migration.ts                    # NEW: Rollback CLI
└── test/
    └── integration/
        ├── migration-event-replay.test.ts       # NEW
        └── migration-dual-write.test.ts         # NEW
```

### Configuration Files

```
apps/gateway/
├── .env.example                                 # MODIFIED: Migration vars
└── package.json                                 # MODIFIED: Add scripts

Makefile                                         # MODIFIED: Migration commands
```

## Configuration

### Environment Variables

```bash
# apps/gateway/.env.example

# OpenSearch Migration
OPENSEARCH_INDEX_VERSION=2                       # Optional: Override code version
OPENSEARCH_MIGRATION_ROLLBACK_WINDOW_DAYS=7     # Days to retain old index
```

### Config Schema

```typescript
// apps/gateway/src/config.ts

const OpenSearchConfigSchema = z.object({
  // ... existing fields
  opensearchIndexVersion: z.number().int().positive().optional(),
  opensearchMigrationRollbackWindowDays: z.number().int().positive().default(7),
});
```

## Implementation Phases (Revised for Operator Pattern)

### Phase 1: Platform Abstraction & CRDs (Week 1-2)

**Goal:** Define CRDs and platform abstraction layer.

**Deliverables:**
- MigrationRequest CRD definition
- RollbackRequest CRD definition
- PlatformAdapter interface
- KubernetesPlatformAdapter implementation
- Basic operator scaffolding
- Unit tests for platform adapter

**Validation:** Can deploy/scale/delete services via K8s API

### Phase 2: Migration Controller (Week 2-3)

**Goal:** Implement core operator reconciliation loop.

**Deliverables:**
- MigrationController with reconciliation logic
- Phase state machine (Pending → DualWrite → Replay → Validate → Cutover → Cleanup)
- CRD status updates
- Basic error handling
- Integration tests with mock K8s

**Validation:** Operator can watch CRDs and update status

### Phase 3: Shared Migration Tools Integration (Week 3-4)

**Goal:** Integrate event replay and validation logic.

**Deliverables:**
- `@wallpaperdb/migration-tools` package (from original plan)
- Operator uses migration-tools for event replay
- DeploymentReconciler (manages service deployments)
- NetworkReconciler (manages traffic routing)
- ReplayReconciler (coordinates event replay)
- ValidationReconciler (post-migration checks)

**Validation:** Operator can replay events and validate results

### Phase 4: Rollback & Error Handling (Week 4-5)

**Goal:** Production-grade error handling and rollback.

**Deliverables:**
- RollbackController
- Phase-specific error recovery
- Automatic rollback on validation failure (optional)
- Manual rollback via RollbackRequest CRD
- Comprehensive logging and telemetry

**Validation:** Can rollback migrations successfully

### Phase 5: Gateway Integration (Week 5-6)

**Goal:** Integrate gateway service with operator.

**Deliverables:**
- Gateway dual-write repository support
- Index version configuration
- Health endpoint reports index version
- Example MigrationRequest CRDs for gateway
- K8s deployment manifests for v1 and v2

**Validation:** Can migrate gateway service in K8s cluster

### Phase 6: E2E Testing & Documentation (Week 6-8)

**Goal:** Production readiness and observability.

**Deliverables:**
- End-to-end migration tests (full K8s environment)
- Performance testing with large datasets
- Grafana dashboards for migration monitoring
- Operational runbook
- ADR for operator-based migration system
- Update all service documentation
- CI/CD integration (apply CRDs in deployment pipeline)

**Validation:** Full migration works in staging environment

## Operational Runbook (Operator Pattern)

### Running a Migration

```bash
# 1. Check current gateway version
kubectl get deployment gateway -o jsonpath='{.spec.template.metadata.labels.indexVersion}'

# 2. Review migration request manifest
cat apps/gateway/deploy/migration-v1-to-v2.yaml

# 3. Apply migration request
kubectl apply -f apps/gateway/deploy/migration-v1-to-v2.yaml

# 4. Monitor progress
kubectl get migrationrequest gateway-v1-to-v2 -w

# 5. Watch operator logs
kubectl logs -f deployment/migration-operator -n wallpaperdb

# 6. Check detailed status
kubectl describe migrationrequest gateway-v1-to-v2

# 7. Monitor via Grafana dashboard
# Open: https://grafana.example.com/d/migration-operator
```

### Rollback Procedure

```bash
# Create rollback request
kubectl apply -f apps/gateway/deploy/rollback-to-v1.yaml

# Monitor rollback
kubectl get rollbackrequest gateway-rollback-to-v1 -w

# Check rollback status
kubectl describe rollbackrequest gateway-rollback-to-v1
```

### Troubleshooting

**Migration hangs during replay:**
```bash
# Check migration status
kubectl get migrationrequest gateway-v1-to-v2 -o yaml

# Check operator logs
kubectl logs deployment/migration-operator -n wallpaperdb --tail=100

# Check NATS consumer lag (via NATS monitoring)
kubectl port-forward svc/nats 8222:8222 -n wallpaperdb
curl http://localhost:8222/jsz

# Check target deployment pods
kubectl get pods -l app=gateway,version=v2

# Cancel migration (delete CRD - operator will cleanup)
kubectl delete migrationrequest gateway-v1-to-v2
```

**Validation fails:**
```bash
# Check validation details in migration status
kubectl get migrationrequest gateway-v1-to-v2 -o jsonpath='{.status.validation}'

# Compare document counts via OpenSearch
kubectl port-forward svc/opensearch 9200:9200 -n wallpaperdb
curl "localhost:9200/wallpapers_v1/_count"
curl "localhost:9200/wallpapers_v2/_count"

# Check validation logs
kubectl logs deployment/migration-operator -n wallpaperdb | grep validation

# Manual rollback if needed
kubectl apply -f apps/gateway/deploy/rollback-to-v1.yaml
```

## Future Enhancements

### Media Service Integration

When media service needs migration:

```typescript
// apps/media/src/migration/media-migration-config.ts

import { EventReplayMigrator } from '@wallpaperdb/migration-tools';

export const mediaMigrationConfig: EventReplayMigrationConfig = {
  serviceName: 'media',
  streamName: 'WALLPAPER',
  consumers: [
    {
      eventType: 'wallpaper.uploaded',
      subject: WALLPAPER_UPLOADED_SUBJECT,
      durableName: 'media-migration-wallpaper-uploaded',
      handler: MediaProcessorConsumer,
    }
  ],
  indexConfig: MEDIA_INDEX_CONFIG,
  // ... service-specific config
};

// Instant migration capability via shared package!
```

### Additional Features

- **Blue-Green Deployments:** Support running old and new service versions simultaneously
- **Partial Migrations:** Migrate subset of documents (e.g., by date range)
- **Migration Templates:** Pre-built configs for common migration patterns
- **Metrics Dashboard:** Grafana dashboard for migration monitoring
- **Automated Testing:** CI pipeline that tests migrations on sample data

## Success Criteria

- ✅ Zero service downtime during migrations
- ✅ No data loss (validated via document counts)
- ✅ Rollback capability within 7 days
- ✅ Modular design reusable by other services
- ✅ Comprehensive test coverage (unit + integration)
- ✅ Production-ready CLI tools
- ✅ Complete documentation and runbooks

## Critical Files Summary

**New Shared Package:**
- `packages/migration-tools/src/event-replay/event-replay-migrator.ts` - Main orchestrator
- `packages/migration-tools/src/versioning/alias-manager.ts` - Alias switching
- `packages/migration-tools/src/validation/index-validator.ts` - Validation logic

**Gateway Service:**
- `apps/gateway/src/opensearch/versions.ts` - Version configuration
- `apps/gateway/src/services/migration/dual-write-repository.ts` - Dual-write pattern
- `apps/gateway/src/services/index-manager.service.ts` - Modified for aliases
- `apps/gateway/scripts/migrate-index.ts` - Migration CLI

## Current Workaround (Pre-Production)

Until production environment exists and this system is implemented, the current approach is acceptable:
1. Delete OpenSearch index: `curl -X DELETE "http://localhost:9200/wallpapers"`
2. Restart gateway service (recreates index with new mappings)
3. Re-upload wallpapers (events replay from NATS or manual upload)

This works because:
- No production data to preserve
- NATS events can be replayed if needed
- Fast iteration on schema changes
- No downtime concerns in development

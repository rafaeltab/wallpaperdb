// Re-export framework
export { createTesterBuilder, BaseTesterBuilder } from './framework.js';
export type { AddMethodsType, TesterInstance } from './framework.js';
export type { AsyncReturnTypeof } from './types.js';

// Export convenience helper (Phase 3)
export { createDefaultTesterBuilder } from './createDefaultTesterBuilder.js';

// Export lifecycle builders (Phase 3)
export { SetupTesterBuilder } from './builders/SetupTesterBuilder.js';
export { CleanupTesterBuilder } from './builders/CleanupTesterBuilder.js';
export { DestroyTesterBuilder } from './builders/DestroyTesterBuilder.js';

// Export fixtures builder (Phase 3)
export { FixturesTesterBuilder } from './builders/FixturesTesterBuilder.js';
export type { TestImageOptions } from './builders/FixturesTesterBuilder.js';

// Export infrastructure builders
export { DockerTesterBuilder } from './builders/DockerTesterBuilder.js';
export type { DockerConfig } from './builders/DockerTesterBuilder.js';

export { PostgresTesterBuilder } from './builders/PostgresTesterBuilder.js';
export type { PostgresOptions, PostgresConfig } from './builders/PostgresTesterBuilder.js';

export { MinioTesterBuilder } from './builders/MinioTesterBuilder.js';
export type { MinioOptions, MinioConfig } from './builders/MinioTesterBuilder.js';

export { NatsTesterBuilder } from './builders/NatsTesterBuilder.js';
export type { NatsOptions, NatsConfig } from './builders/NatsTesterBuilder.js';

export { RedisTesterBuilder } from './builders/RedisTesterBuilder.js';
export type { RedisOptions, RedisConfig } from './builders/RedisTesterBuilder.js';

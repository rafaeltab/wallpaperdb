import { CleanupTesterBuilder } from './builders/CleanupTesterBuilder.js';
import { DestroyTesterBuilder } from './builders/DestroyTesterBuilder.js';
import { SetupTesterBuilder } from './builders/SetupTesterBuilder.js';
import { createTesterBuilder } from './framework.js';

/**
 * Create a TesterBuilder with lifecycle builders pre-configured.
 * This is a convenience function that includes SetupTesterBuilder, CleanupTesterBuilder,
 * and DestroyTesterBuilder by default.
 *
 * Use this instead of createTesterBuilder() to avoid manually adding lifecycle builders
 * every time.
 *
 * @returns TesterBuilder with lifecycle builders already included
 *
 * @example
 * ```typescript
 * // Instead of:
 * const TesterClass = createTesterBuilder()
 *   .with(SetupTesterBuilder)
 *   .with(CleanupTesterBuilder)
 *   .with(DestroyTesterBuilder)
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .build();
 *
 * // Use:
 * const TesterClass = createDefaultTesterBuilder()
 *   .with(DockerTesterBuilder)
 *   .with(PostgresTesterBuilder)
 *   .build();
 * ```
 */
export function createDefaultTesterBuilder() {
  return createTesterBuilder()
    .with(SetupTesterBuilder)
    .with(CleanupTesterBuilder)
    .with(DestroyTesterBuilder);
}

import { BaseTesterBuilder, type AddMethodsType } from '../framework.js';

/**
 * CleanupTesterBuilder provides the cleanup lifecycle phase.
 * This builder enables the cleanup() method for removing test data between tests
 * while keeping infrastructure running.
 *
 * Use this in beforeEach/afterEach hooks to reset state without restarting containers.
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(SetupTesterBuilder)
 *   .with(CleanupTesterBuilder)  // Enables cleanup() method
 *   .with(PostgresTesterBuilder)
 *   .build();
 *
 * beforeEach(async () => {
 *   await tester.cleanup();  // Truncate tables, clear buckets, etc.
 * });
 * ```
 */
export class CleanupTesterBuilder extends BaseTesterBuilder<'cleanup', []> {
  name = 'cleanup' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      /** @internal */
      _cleanupHooks: (() => Promise<void>)[] = [];

      /**
       * Register a hook to run during the cleanup phase.
       * Cleanup hooks run in LIFO order (last registered runs first).
       *
       * @param hook - Async function to execute during cleanup
       */
      addCleanupHook(hook: () => Promise<void>) {
        this._cleanupHooks.push(hook);
      }

      /**
       * Execute all registered cleanup hooks in reverse order (LIFO).
       * This removes test data but keeps infrastructure running.
       *
       * Typical cleanup operations:
       * - Truncate database tables
       * - Delete S3 objects
       * - Purge NATS streams
       * - Flush Redis cache
       *
       * @returns The tester instance for chaining
       */
      async cleanup() {
        // Run in reverse order (LIFO) to respect dependencies
        const reversed = [...this._cleanupHooks].reverse();
        for (const hook of reversed) {
          await hook();
        }
        return this;
      }
    };
  }
}

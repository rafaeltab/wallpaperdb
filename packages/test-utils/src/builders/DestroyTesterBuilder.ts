import { BaseTesterBuilder, type AddMethodsType } from '../framework.js';

/**
 * DestroyTesterBuilder provides the destroy lifecycle phase.
 * This builder MUST be included in all test configurations to enable the destroy() method.
 *
 * The destroy phase stops all infrastructure and cleans up resources.
 * Always call this in afterAll() hooks to prevent resource leaks.
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(SetupTesterBuilder)
 *   .with(DestroyTesterBuilder)  // Required for destroy() method
 *   .with(DockerTesterBuilder)
 *   .build();
 *
 * afterAll(async () => {
 *   await tester.destroy();  // Stop containers, close connections
 * });
 * ```
 */
export class DestroyTesterBuilder extends BaseTesterBuilder<'destroy', []> {
  name = 'destroy' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      /** @internal */
      _destroyHooks: (() => Promise<void>)[] = [];

      /**
       * Register a hook to run during the destroy phase.
       * Destroy hooks run in LIFO order (last registered runs first).
       *
       * @param hook - Async function to execute during destroy
       */
      addDestroyHook(hook: () => Promise<void>) {
        this._destroyHooks.push(hook);
      }

      /**
       * Execute all registered destroy hooks in reverse order (LIFO).
       * This ensures dependencies are destroyed after their dependents
       * (e.g., containers stopped before networks removed).
       *
       * Typical destroy operations:
       * - Close database connections
       * - Stop Docker containers
       * - Remove Docker networks
       * - Clean up temporary files
       *
       * @returns The tester instance for chaining
       */
      async destroy() {
        // Run in reverse order (LIFO) to respect dependencies
        // e.g., containers must be stopped before networks are removed
        const reversed = [...this._destroyHooks].reverse();
        for (const hook of reversed) {
          await hook();
        }
        return this;
      }
    };
  }
}

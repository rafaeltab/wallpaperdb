import { BaseTesterBuilder, type AddMethodsType } from '../framework.js';

/**
 * SetupTesterBuilder provides the setup lifecycle phase.
 * This builder MUST be included in all test configurations to enable the setup() method.
 *
 * @example
 * ```typescript
 * const TesterClass = createTesterBuilder()
 *   .with(SetupTesterBuilder)  // Required for setup() method
 *   .with(DockerTesterBuilder)
 *   .build();
 * ```
 */
export class SetupTesterBuilder extends BaseTesterBuilder<'setup', []> {
  name = 'setup' as const;

  addMethods<TBase extends AddMethodsType<[]>>(Base: TBase) {
    return class extends Base {
      /** @internal */
      _setupHooks: (() => Promise<void>)[] = [];

      /**
       * Register a hook to run during the setup phase.
       * Hooks run in the order they are registered.
       *
       * @param hook - Async function to execute during setup
       */
      addSetupHook(hook: () => Promise<void>) {
        this._setupHooks.push(hook);
      }

      /**
       * Execute all registered setup hooks in order.
       * This starts all infrastructure containers and initializes resources.
       *
       * @returns The tester instance for chaining
       */
      async setup() {
        for (const hook of this._setupHooks) {
          await hook();
        }
        return this;
      }
    };
  }
}

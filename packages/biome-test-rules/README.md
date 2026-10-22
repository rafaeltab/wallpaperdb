# Test correctness rules

This workspace supplies the shared test lint configuration and four custom Biome rules. Normal Make/Turbo lint tasks load the [configuration](./test-correctness.json).

## Rule ownership

Biome 2.6.2 owns floating promises (`noFloatingPromises`), focused tests (`noFocusedTests`), skipped tests (`noSkippedTests`), self-comparisons (`noSelfCompare`) and the configured TODO properties (`noJsRestrictedProperties`). The TODO entries restrict `it.todo`, `test.todo`, `describe.todo` and `suite.todo`, with the message from #437. Floating-promise checks apply to TypeScript test sources. Native behavior is used directly; there is no custom Effect checker, Promise API catalog or TypeScript compiler bridge.

The remaining rules translate the implementations enabled in [#437 at 7cfe7fc1](https://github.com/rafaeltab/wallpaperdb/blob/7cfe7fc1ab5450d1e35b01216640527fca2a3995/scripts/eslint.tests.config.mjs):

| Custom rule | Pinned implementation and configuration |
| --- | --- |
| `validExpect` | `@vitest/eslint-plugin` 1.6.27 `valid-expect`, with `maxArgs: 2` and the other upstream defaults. |
| `validExpectInPromise` | The same plugin's `valid-expect-in-promise`, with its default syntax and test-callback handling. |
| `requireAwaitedExpectPoll` | The same plugin's `require-awaited-expect-poll`, covering `poll` and `element`. |
| `noTestRetries` | #437's local `test-policy/no-retries`, following initializer aliases and shared/spread option objects. |

The assertion algorithm sources and parser are retained under [src/ported](./src/ported), adapted to Biome syntax, lexical scopes and diagnostics. [The notices](./UPSTREAM-LICENSE.txt) preserve the upstream MIT licenses. No ESLint runtime or dependency is included. The adapters do not supply arbitrary type, callback-contract or control-flow analysis. The pinned algorithms determine assertion handling, including their stored-assertion restriction and syntactic limitations. Custom rules report diagnostics; upstream text-based automatic fixes are not offered by these Biome adapters.

## Verification and maintenance

The tests exercise the real Biome CLI. [Upstream fixture data](./test/upstream-fixtures.json) records the pinned source URL, original expectations and every excluded case with its line and reason. Exclusions distinguish different rule options, fixture-specific plugin settings and nonliteral fixture construction; they are not blanket claims that the source syntax is unsupported. The fixture runner checks the configured rule behavior; native rules have their own CLI controls. [Integration tests](./test/integration.test.mjs) exercise actual Make/Turbo discovery and cache invalidation.

The unit task writes Istanbul JSON and LCOV reports to `coverage/unit` through c8. Maintained rules live under `src` so the repository CRAP inventory includes both the JavaScript adapters and retained algorithms. Biome executes plugins in its isolated runtime: real CLI diagnostics exercise those rules, but Node V8 coverage does not observe their execution. The report retains unmeasured source files with zero hits; CRAP therefore treats their coverage as unknown/zero rather than claiming the CLI fixtures covered their branches. The integration suite verifies coverage combination, measured JavaScript controls and the unmeasured rule inventory through the actual collector.

Keep the CLI and runtime versions pinned together while JavaScript plugins are in developer preview. When changing a custom rule, compare the pinned implementation and fixtures before changing its semantics. Do not add a framework API or a new test-quality policy to compensate for a native rule's behavior. Rule selection and migration history are tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477).

The shared configuration covers existing ESM/TypeScript test sources, including maintained fixture helpers, while excluding generated output and deliberately invalid CRAP input fixtures. The [root configuration](../../biome.json) keeps the unrelated newly recommended component-hook-factory rule disabled. Workspace integration follows the [coding guidelines](../../CODING_STANDARDS.md); run package tasks through [Make](../../Makefile).

# Test correctness rules

Make/Turbo lint tasks load this shared [test lint configuration](./test-correctness.json) and four custom Biome rules.

## Rule ownership

Biome 2.6.2 owns `noFloatingPromises`, `noFocusedTests`, `noSkippedTests`, `noSelfCompare` and `noJsRestrictedProperties`. The latter restricts `it.todo`, `test.todo`, `describe.todo` and `suite.todo` with #437's message. Floating-promise checks apply to TypeScript test sources. Native behavior applies without a custom Effect checker or TypeScript compiler bridge.

Custom rules translate the implementations enabled in [#437 at 7cfe7fc1](https://github.com/rafaeltab/wallpaperdb/blob/7cfe7fc1ab5450d1e35b01216640527fca2a3995/scripts/eslint.tests.config.mjs):

| Custom rule | Pinned implementation and configuration |
| --- | --- |
| `validExpect` | `@vitest/eslint-plugin` 1.6.27 `valid-expect`, with `maxArgs: 2` and the other upstream defaults. |
| `validExpectInPromise` | The same plugin's `valid-expect-in-promise`, with its default syntax and test-callback handling. |
| `requireAwaitedExpectPoll` | The same plugin's `require-awaited-expect-poll`, covering `poll` and `element`. |
| `noTestRetries` | #437's local `test-policy/no-retries`, following initializer aliases and shared/spread option objects. |

[Ported sources](./src/ported) adapt the pinned algorithms to Biome syntax, lexical scopes and diagnostics. [Notices](./UPSTREAM-LICENSE.txt) preserve the upstream MIT licenses. The adapters retain upstream syntactic limitations and stored-assertion restrictions; they provide diagnostics without automatic fixes or arbitrary type, callback-contract, or control-flow analysis. No ESLint dependency is included.

## Verification and maintenance

Tests exercise the real Biome CLI. [Upstream fixtures](./test/upstream-fixtures.json) record source URLs, expectations and exclusions with line-specific reasons. Exclusions cover differing options, plugin settings and nonliteral fixture construction, not blanket syntax limitations. [Integration tests](./test/integration.test.mjs) verify Make/Turbo discovery, cache invalidation and coverage collection. [Algorithm contracts](./test/algorithm-contracts.test.mjs) execute the adapters and algorithms directly in Node with finite syntax inputs and an unbound-global collaborator; the CLI tests cover native syntax, binding and imports.

The unit task writes Istanbul JSON and LCOV to `coverage/unit` through c8. Node coverage measures only direct execution; it cannot observe plugins in Biome's isolated runtime. Unmeasured paths, including the registration/diagnostic bridge, have zero hits and unknown/zero coverage in CRAP. Maintained adapters and algorithms remain under `src` for the CRAP inventory.

Keep CLI and runtime versions pinned together during JavaScript plugin developer preview. Compare pinned implementations and fixtures before changing custom-rule semantics. Do not add a framework API or test-quality policy to compensate for native-rule behavior. [#477](https://github.com/rafaeltab/wallpaperdb/issues/477) tracks rule selection and migration history.

The configuration covers ESM/TypeScript tests and maintained fixture helpers, excluding generated output and deliberately invalid CRAP fixtures. Run package tasks through [Make](../../Makefile).

# Test correctness rules

This workspace owns WallpaperDB's shared test correctness policy for Biome. It adds checks for mistakes that can make a test pass without verifying its assertion.

## Capabilities

The assertion rules reject incomplete matchers and unhandled Vitest async assertions, including task-local `expect` bindings. A reason as the second argument remains valid when the assertion has a matcher. Retry checks follow Vitest registration aliases and shared options while accepting application retry settings and test data.

The shared policy uses Biome's built-in focus, skip, self-comparison, floating-promise and Playwright checks. Targeted plugins cover known Effect promise APIs, registration aliases, and TODO/skip/focus registration options. Node's `only` option is prohibited as a focus registration option; its runtime effect depends on the runner's only-mode configuration. Normal repository linting applies the policy to test sources, including maintained fixture helpers, and excludes generated output and deliberate CRAP input fixtures.

The regression tests run the actual Biome CLI with the exported configuration. Keep invalid examples in those tests so ordinary repository linting does not discover them as test sources.

The [shared policy](./test-correctness.json) targets ESM and TypeScript tests, matching the inherited test inventory. Adding CommonJS test sources requires extending discovery and binding support together; `.cjs` tests and `require()` test API bindings are outside the current policy.

## Maintenance

The CLI and runtime versions are pinned together because Biome's JavaScript plugin API is a developer preview. Check the [upstream plugin documentation](https://biomejs.dev/linter/plugins/) and run the regression suite when upgrading either dependency.

Biome does not infer every imported generic return type. The plugins use supported bindings and syntax APIs, which do not expose TypeScript type inference. The demonstrated shared-tester promise gap and the migration decision remain tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477).

Async assertion checking follows direct syntax and bindings. It recognizes test registrations and lifecycle hooks, Promise chains and direct aggregates, Vitest polling, and the existing Effect promise constructors. Discarded concise-arrow assertion results passed to `forEach` or a discarded `map` call are rejected. This is a bounded set of known consumers, not inference of callback contracts.

An aggregated `map` call is accepted under the standard `Array.prototype.map` callback-result contract. Receiver types and method implementations are not inferred. A custom same-name method that discards callback promises can pass both #437's baseline and this policy; it is outside the supported consumer contract. This inherited semantic gap remains tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477). Do not add generic collection inference or reject normal imported arrays to approximate receiver-type proof.

Aggregate handling preserves the inherited lint contract: awaiting `Promise.all`, `allSettled`, `race` or `any` consumes their direct input promises. This does not prove that assertion failures reach the test runner. `allSettled` records rejections, and another input can win a race or fulfill `any`. Deliberate outcome inspection remains valid. Rejection handlers are also consumption boundaries without analysis of their bodies. The unresolved failure-propagation check is tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477).

The aggregate recognizer requires the unshadowed global `Promise`. Bound helper results reuse the same immutable-alias and known-consumer checks as direct callbacks; creating an unused bound function does not create an assertion promise. Registration option checks inspect conditional and logical alternatives conservatively, without inferring arbitrary conditions or mutable flow. Flag options respect the last visible write through literal and shared spreads; a later absent property does not clear an earlier flag. Retry overrides remain prohibited regardless of value.

Mutable binding resolution follows one direct assignment in the same statement list, checking its order relative to the read. Conditional, nested and repeated writes remain unresolved. Options checks cannot infer prohibited values through those ambiguous writes; promise checks do not treat an ambiguous read as proof of handling. Keep explicit handling beside the promise creation when this bounded analysis cannot establish the connection.

Finding a matching await or return does not prove that every execution path reaches it. A stored async assertion awaited only inside an `if` can pass this policy. #437's `vitest/valid-expect` rejects that case by rejecting stored async assertions altogether, including valid unconditional later awaits and `finally` handling. This migration deliberately retains bounded binding support and loses that coarse restriction. Cancellation tests in the [gateway](../../apps/gateway/test/unit/runtime.unit.test.ts), [color extractor](../../apps/color-extractor/test/image-cancellation.integration.test.ts) and [browser processing](../../apps/web/test/browser/picture-processing.spec.ts) attach rejection assertions before abort/dispose and await them afterward. The concrete assertion path gap is a migration tradeoff, not inherited parity. The equivalent conditional Effect-promise gap also passes the baseline and is inherited. Both remain tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477), alongside the unresolved generic typed-promise scope decision. No every-path or caller-contract proof is claimed.

An unknown concise-arrow callback argument passed to a custom wrapper is reported even when the wrapper call is awaited: awaiting a wrapper does not prove that it awaits its callback. Ordinary object-property helper arrows retain their normal function return contract. Explicit `await` and block `return` remain local handling boundaries; accepting them does not prove that an arbitrary caller propagates callback completion. Verify that contract in the wrapper. Keep regression controls for supported consumer boundaries when changing the rule; do not expand it into an open-ended library API catalog.

Assertion invocation through `Function.prototype.call` or `apply` is outside the current shape checks. For example, matcherless `expect.call(null, 1)` and `expect.apply(null, [1])` pass both #437's ESLint baseline and this policy. This inherited gap is tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477); the policy does not claim to validate every JavaScript invocation form.

The [root configuration](../../biome.json) leaves the newly recommended component-hook-factory rule disabled to keep unrelated React refactors outside this upgrade.

Use the standard workspace tasks through [Make](../../Makefile). Repository ownership and testing requirements are in the [coding guidelines](../../CODING_STANDARDS.md).

# Test correctness rules

This workspace owns WallpaperDB's shared test correctness policy for Biome. It adds checks for mistakes that can make a test pass without verifying its assertion.

## Capabilities

The assertion rules reject incomplete matchers and unhandled Vitest async assertions, including task-local `expect` bindings. A reason as the second argument remains valid when the assertion has a matcher. Retry checks follow Vitest registration aliases and shared options while accepting application retry settings and test data.

The shared policy uses Biome's built-in focus, skip, self-comparison, floating-promise and Playwright checks. Targeted plugins cover known Effect promise APIs and unfinished registrations. Normal repository linting applies the policy to test sources, including maintained fixture helpers, and excludes generated output and deliberate CRAP input fixtures.

The regression tests run the actual Biome CLI with the exported configuration. Keep invalid examples in those tests so ordinary repository linting does not discover them as test sources.

The [shared policy](./test-correctness.json) targets ESM and TypeScript tests, matching the inherited test inventory. Adding CommonJS test sources requires extending discovery and binding support together; `.cjs` tests and `require()` test API bindings are outside the current policy.

## Maintenance

The CLI and runtime versions are pinned together because Biome's JavaScript plugin API is a developer preview. Check the [upstream plugin documentation](https://biomejs.dev/linter/plugins/) and run the regression suite when upgrading either dependency.

Biome does not infer every imported generic return type. The plugins use supported bindings and syntax APIs, which do not expose TypeScript type inference. The demonstrated shared-tester promise gap and the migration decision remain tracked in [#477](https://github.com/rafaeltab/wallpaperdb/issues/477).

Async assertion checking follows direct syntax and bindings. It recognizes test registrations and lifecycle hooks, Promise chains and direct aggregates, Vitest polling, and the existing Effect promise constructors. Discarded concise-arrow assertion results in `forEach` and `map` are rejected. This is a bounded set of known consumers, not inference of callback contracts.

An unknown concise-arrow callback argument passed to a custom wrapper is reported even when the wrapper call is awaited: awaiting a wrapper does not prove that it awaits its callback. Ordinary object-property helper arrows retain their normal function return contract. Explicit `await` and block `return` remain local handling boundaries; accepting them does not prove that an arbitrary caller propagates callback completion. Verify that contract in the wrapper. Keep regression controls for supported consumer boundaries when changing the rule; do not expand it into an open-ended library API catalog.

The [root configuration](../../biome.json) leaves the newly recommended component-hook-factory rule disabled to keep unrelated React refactors outside this upgrade.

Use the standard workspace tasks through [Make](../../Makefile). Repository ownership and testing requirements are in the [coding guidelines](../../CODING_STANDARDS.md).

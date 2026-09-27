# Vendored CRAP analyzer

This directory contains the source modules used by WallpaperDB's shared CRAP tooling from [`@barney-media/crap-typescript-core` 0.5.2](https://github.com/fabian-barney/crap-typescript/tree/57694795d6cb66fc0a3986646e236606d999d9f7/packages/core).

- Upstream repository: <https://github.com/fabian-barney/crap-typescript>
- Upstream revision: `57694795d6cb66fc0a3986646e236606d999d9f7`, tag `v0.5.2`.
- License: [Apache-2.0](LICENSE), retained verbatim. That revision contains no NOTICE file.
- Original paths: `packages/core/src/` and `packages/core/test/`. Filenames and source layout are preserved for comparison with upstream.

WallpaperDB maintains this copy as the private `@wallpaperdb/crap-typescript-core` workspace so callback discovery and coverage attribution can mature in repository use before an upstream contribution. The shared command remains [scripts/crap.mts](../../scripts/crap.mts). Upstream CLI orchestration and report renderers are omitted because WallpaperDB owns those policies already. The local `src/index.ts` exposes the consumed subset through the package export. `test/coverage.test.ts` omits upstream command-runner tests for the omitted runner.

[Issue #239](https://github.com/rafaeltab/wallpaperdb/issues/239) tracks evaluation and a possible contribution after sustained repository use.

Local changes include callback discovery and display names, full source ranges for function identity, source-body coverage ownership, conservative handling of incomplete legacy V8 reports, synthetic function-entry branch filtering, and retention of function counters. The new regressions live beside the imported tests. [Live provider tests](../../scripts/crap.test.ts) exercise the repository's installed Vitest versions and Effect generator behavior. Repository-specific orchestration and coverage policy stay outside the vendored modules.

Keep imports and unrelated upstream code stable when making changes. Modified upstream files carry a notice referring to this document. The package's [Biome configuration](biome.json) deliberately limits linting and formatting to workspace JSON files and the Vitest configuration. Imported source and test formatting remains unchanged to keep comparisons with upstream focused on behavioral changes.

Run package tests and coverage through `make test-unit PACKAGE=crap-typescript-core` and type checking through `make check-types PACKAGE=crap-typescript-core`. These use the standard Turbo tasks and run in workspace CI. Type checking includes tests; the package's [Turbo configuration](turbo.json) includes them in its cache inputs. Root `make test-crap` runs the live provider tests separately. Command definitions remain in the [root Makefile](../../Makefile).

Compare changes against the pinned revision before preparing an upstream contribution, retaining the license and any future upstream notices when refreshing this copy.

# Vendored CRAP analyzer

This package vendors source modules from [`@barney-media/crap-typescript-core` 0.5.2](https://github.com/fabian-barney/crap-typescript/tree/57694795d6cb66fc0a3986646e236606d999d9f7/packages/core).

- Upstream repository: <https://github.com/fabian-barney/crap-typescript>
- Upstream revision: `57694795d6cb66fc0a3986646e236606d999d9f7`, tag `v0.5.2`.
- License: [Apache-2.0](LICENSE), retained verbatim. That revision contains no NOTICE file.
- Original paths: `packages/core/src/` and `packages/core/test/`. Filenames and source layout are preserved for comparison with upstream.

WallpaperDB maintains the private `@wallpaperdb/crap-typescript-core` workspace to exercise callback discovery and coverage attribution fixes before a possible upstream contribution, tracked in [#239](https://github.com/rafaeltab/wallpaperdb/issues/239). [scripts/crap.mts](../../scripts/crap.mts) owns repository orchestration and coverage policy. Upstream CLI orchestration, report renderers, and their command-runner tests are omitted. [src/index.ts](src/index.ts) exports the consumed subset.

Local changes cover JavaScript source selection and parsing, callback discovery and names, function identity ranges, source-body coverage ownership, conservative handling of incomplete legacy V8 reports, synthetic function-entry branch filtering, and retention of function counters. Regressions sit beside imported tests. Root [provider integration tests](../../test/integration/crap-provider.test.ts) exercise installed Vitest 3 and gateway Vitest 5, Effect generators, and legacy coverage compatibility.

Keep imports and unrelated upstream code stable. Modified upstream files carry a notice referring here. The [Biome configuration](biome.json) limits linting and formatting to workspace JSON and Vitest configuration so imported source/test formatting stays comparable.

Run `make test-unit PACKAGE=crap-typescript-core` and `make check-types PACKAGE=crap-typescript-core`. Root provider checks use `make test-integration PACKAGE=root` and `make check-types PACKAGE=root`. Type checking includes tests; [Turbo cache inputs](turbo.json) include them. These checks run in workspace CI.

Compare against the pinned revision before an upstream contribution. Retain the license and any future upstream notices when refreshing this copy.

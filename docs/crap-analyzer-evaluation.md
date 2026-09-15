# CRAP analyzer evaluation

Research snapshot: 2026-09-03.

## Decision

Adopt `@barney-media/crap-typescript-core` at an exact version behind a small
WallpaperDB-owned wrapper. Do not use its Vitest adapter while WallpaperDB is
on Vitest 3.

No mature off-the-shelf JavaScript or TypeScript CRAP tool satisfies the
settled requirements. `crap-score` is the oldest and has the largest recent
npm download count, but it uses statement coverage only, discovers functions
from the coverage report rather than the maintained source tree, has no
threshold gate, and has no terminal inventory. The newer alternatives add
useful capabilities, but none except `crap-typescript` implements coverage as
`min(function statement coverage, function branch coverage)`.

The wrapper should own orchestration and policy while the dependency owns
parsing, complexity, coverage attribution, and the CRAP formula:

- `make crap` runs unit and integration coverage through Turborepo, preserving
  valid Turbo cache hits, combines the fresh results, then lists all in-scope
  functions by descending CRAP score. High scores do not fail this command.
- `make check-crap CRAP_THRESHOLD=<n>` runs the same pipeline, prints only
  failures, and exits nonzero when a score exceeds the explicit threshold.
  Functions with missing coverage are scored as 0% covered.
- Source selection includes maintained application/package code and reusable
  test infrastructure, but excludes `apps/docs`, tests, fixtures, generated
  code, declarations, and build/coverage output.
- CI does not invoke the check yet. Later it can run the same Make target after
  a threshold is selected and all existing violations are fixed.

Pinning and characterization tests are important because the recommended
package is still pre-1.0 and its built-in behavior deliberately skips
unmeasured functions in threshold decisions. WallpaperDB's wrapper must treat
that explicit `N/A` state as 0% coverage and calculate the corresponding CRAP
score.

## Requirement fit

| Candidate | Existing Vitest/Turbo coverage | `min(statement, branch)` | Full descending inventory | Separate gate | Unmeasured functions | Scope controls | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@barney-media/crap-typescript` / core | Reads Istanbul `coverage-final.json`; workspace lookup and Vitest-shaped reports have golden fixtures. Its Vitest adapter peers on Vitest 4, so use core after Turbo. | **Yes.** It keeps statement and branch attribution separately and selects the lower applicable value. | Yes; measured scores descend and `N/A` follows deterministically. | Core exposes metrics and formatting, so a wrapper can provide report-only and threshold modes. | Explicit `N/A` with a reason, but the built-in threshold marks it skipped; wrapper must reinterpret it as 0% coverage. | Built-in test/spec/declaration exclusions plus configurable generated/path filters. | **Adopt exact-pinned core with a thin wrapper.** |
| `crap-score` (`ahilke/js-crap-score`) | Reads one Istanbul JSON object; Vitest is not documented or fixture-tested, though its JSON schema may be compatible. | No; statement counters only. | HTML is sorted, but CLI primarily writes HTML/JSON and exposes no all-functions terminal table. | No threshold gate or failure exit contract. | Source absent from Istanbul cannot be discovered; a coverage function that cannot be matched to ESLint is logged and skipped. | Scope is whatever the coverage producer includes. | Older, but requires a substantial policy and reporting layer and still gives the wrong coverage basis. Reject. |
| `crap4ts` (`breezy-bays-labs`) stable 1.x | Reads existing Istanbul or V8 JSON and was developed/tested with Vitest 3. | No; configuration chooses either line or branch coverage. It cannot take their minimum in one analysis. | Yes, with selectable sorting and a table. | Yes. | Stable v1 pessimistically scores unmatched functions as 0% while retaining mismatch diagnostics, matching the selected missing-coverage policy. | Include/exclude globs can express the required scope. | Capable but already in maintenance mode while v2 is rebuilt on Rust; wrong coverage definition. Reject. |
| `poly-crap` | Runner-independent; reads and merges repeated LCOV/Cobertura/JaCoCo/Go reports, so it composes well after Turbo. | No; JavaScript/TypeScript coverage is executable-line coverage. | Yes with `--min 0`; default order is CRAP descending. | Yes via `--fail-above`. | Its pessimistic missing-coverage policy matches the selected 0% treatment. | `.gitignore`, default test/generated exclusions, explicit exclude/allow controls. | Operationally attractive and polyglot, but weeks old and incompatible with the selected coverage definition. Reject for now. |
| `@danibram/crap4ts` | Best monorepo convenience: workspace discovery and a `merge-coverage` command for per-package Istanbul JSON. Runner-independent despite tests using Vitest 2. | No; explicitly statement coverage within a function's line range. | Yes. | Yes. | Preserves a `coverageMissing` flag and supports the selected pessimistic 0% policy. | Include/ignore/allow globs and function/file comments. | Closest orchestration alternative, but young and the wrong coverage basis. Reconsider only if merge ergonomics outweigh the agreed metric. |
| Custom implementation from TypeScript/ESLint and Istanbul building blocks | Full control. | Yes. | Yes. | Yes. | Yes. | Yes. | Unnecessary ownership of parser edge cases, nested-function boundaries, source/coverage path matching, and report semantics. Reject unless characterization tests expose a blocking defect upstream. |

Evidence for the table:

- `crap-typescript` documents its formula, coverage pipeline, source
  exclusions, formats, exit codes, and Vitest/Jest adapters in its
  [README at the evaluated commit](https://github.com/fabian-barney/crap-typescript/blob/646c41e9ed94e222729aae3727771610d97f50fe/README.md).
  Its [compatibility matrix](https://github.com/fabian-barney/crap-typescript/blob/646c41e9ed94e222729aae3727771610d97f50fe/docs/compatibility-matrix.md)
  is fixture-backed and covers workspaces, TSX, nested functions, path
  ambiguity, methods, accessors, decorators, and several attribution edge
  cases. The [report implementation](https://github.com/fabian-barney/crap-typescript/blob/646c41e9ed94e222729aae3727771610d97f50fe/packages/core/src/report.ts)
  sorts numeric scores descending, puts `null` afterward, and treats a null
  score as `skipped`, which is why the wrapper must replace null coverage with
  the selected 0%-coverage score. The [Vitest adapter manifest](https://github.com/fabian-barney/crap-typescript/blob/646c41e9ed94e222729aae3727771610d97f50fe/packages/vitest/package.json)
  declares `vitest: ^4.0.0`; the [core manifest](https://github.com/fabian-barney/crap-typescript/blob/646c41e9ed94e222729aae3727771610d97f50fe/packages/core/package.json)
  has no Vitest dependency.
- `crap-score`'s [coverage implementation](https://github.com/ahilke/js-crap-score/blob/5094d0b4c4e4b3bd9221838a8ceeeca167a82500/src/crap/function-coverage.ts)
  counts statements inside Istanbul `fnMap` locations, while its
  [report service](https://github.com/ahilke/js-crap-score/blob/5094d0b4c4e4b3bd9221838a8ceeeca167a82500/src/crap/crap-report.service.ts)
  iterates files and functions present in coverage and skips coverage-to-ESLint
  mismatches. Its [README](https://github.com/ahilke/js-crap-score/blob/5094d0b4c4e4b3bd9221838a8ceeeca167a82500/README.md)
  documents Jest reporter, CLI, and API usage but no threshold/gate interface.
- Stable `crap4ts` documents the selectable `line | branch` metric, reports,
  gate, and 0%-coverage treatment in its
  [README](https://github.com/breezy-bays-labs/crap4ts/blob/6d71f9cabd490838c935146d2334f869931d079e/README.md).
  The same README declares v1 maintenance mode and says v2 is being rebuilt as
  a Rust-backed adapter. Its [changelog](https://github.com/breezy-bays-labs/crap4ts/blob/6d71f9cabd490838c935146d2334f869931d079e/CHANGELOG.md)
  records that v1.0 made unmatched functions pessimistic rather than silently
  excluding them; its [package manifest](https://github.com/breezy-bays-labs/crap4ts/blob/6d71f9cabd490838c935146d2334f869931d079e/package.json)
  pins its own test development to Vitest 3.
- `poly-crap` documents its runner-independent inputs, multi-report merge,
  line/statement bases, sorting, missing-coverage policies, scope controls, and
  gate in its [README](https://github.com/drew-simmons/poly-crap/blob/cf511fab894e1c2fac4f2662ffa2d9b1df74cd16/README.md).
- `@danibram/crap4ts` documents Turbo/pnpm workspace fixtures, JSON coverage
  merging, descending reports, missing policy, and its statement-only
  limitation in its [README](https://github.com/danibram/crap4ts/blob/41e37bb986370e88861f42ce1a7eff6ecb5826d8/README.md).

## Maturity evidence

Maturity is not the same as package version. The following is a point-in-time
comparison of the official Git histories and registries. Commit and contributor
counts were calculated from complete clones at the linked commit using
`git rev-list --count HEAD` and `git shortlog -sne HEAD`. Download counts are
directional adoption indicators, not proof of distinct production users.

| Candidate | Public history at snapshot | Repository activity at evaluated commit | Registry/release signal | Adoption signal |
| --- | --- | --- | --- | --- |
| `crap-score` | Since 2023-03; five npm versions. | 198 commits, 3 contributors. The April 2026 release only reworked the README, dropped Node 16, and removed source maps; the preceding feature release was May 2023. | npm 1.2.1. | 9,027 npm downloads in 2026-07-31..08-29; 16 GitHub stars. |
| `@barney-media/crap-typescript` | Since 2026-04; ten npm versions. | 358 commits, 4 contributors through 2026-08-29; active fixture and cross-platform CI development, but still version 0.5.1. | npm 0.5.1, Apache-2.0, Node >=22.13. | 6,194 core-package downloads and 4,820 CLI-package downloads in 2026-07-31..08-29; 16 GitHub stars. |
| `crap4ts` (`breezy-bays-labs`) | Since 2026-03; stable 1.0.1 plus five 2.0 release candidates on npm. | v1 branch: 28 commits, 1 contributor; all stable releases landed 2026-03-22..23 and v1 entered maintenance mode by May. | npm `latest` is 1.0.1; `rc` is 2.0.0-rc.5; GPL-3.0-or-later. | 2,481 npm downloads in 2026-07-31..08-29; 1 GitHub star. |
| `@danibram/crap4ts` | Since 2026-05; six npm versions. | 34 commits, 2 contributors; repository activity spans 2026-05-26..28 at the evaluated commit. | npm 0.6.0. | 3,561 npm downloads in 2026-07-31..08-29; 0 GitHub stars. |
| `poly-crap` | Since 2026-08-13; seven crates.io versions by the snapshot. | 38 commits, 3 contributors through 2026-09-03; rapid releases but only three weeks of history. | crates.io 0.8.0; prebuilt GitHub releases for Linux/macOS. | 111 total crates.io downloads; 0 GitHub stars. |

Primary metadata sources:

- Official npm registry metadata and download API for
  [`@barney-media/crap-typescript`](https://registry.npmjs.org/@barney-media/crap-typescript)
  ([period downloads](https://api.npmjs.org/downloads/point/2026-07-31:2026-08-29/%40barney-media%2Fcrap-typescript)),
  [`@barney-media/crap-typescript-core`](https://registry.npmjs.org/@barney-media/crap-typescript-core)
  ([period downloads](https://api.npmjs.org/downloads/point/2026-07-31:2026-08-29/%40barney-media%2Fcrap-typescript-core)),
  [`crap-score`](https://registry.npmjs.org/crap-score)
  ([period downloads](https://api.npmjs.org/downloads/point/2026-07-31:2026-08-29/crap-score)),
  [`crap4ts`](https://registry.npmjs.org/crap4ts)
  ([period downloads](https://api.npmjs.org/downloads/point/2026-07-31:2026-08-29/crap4ts)), and
  [`@danibram/crap4ts`](https://registry.npmjs.org/@danibram/crap4ts)
  ([period downloads](https://api.npmjs.org/downloads/point/2026-07-31:2026-08-29/%40danibram%2Fcrap4ts)).
- Official GitHub repository metadata for
  [`crap-typescript`](https://api.github.com/repos/fabian-barney/crap-typescript),
  [`js-crap-score`](https://api.github.com/repos/ahilke/js-crap-score),
  [`crap4ts`](https://api.github.com/repos/breezy-bays-labs/crap4ts),
  [`@danibram/crap4ts`](https://api.github.com/repos/danibram/crap4ts), and
  [`poly-crap`](https://api.github.com/repos/drew-simmons/poly-crap).
- Official crates.io metadata for
  [`poly-crap`](https://crates.io/api/v1/crates/poly-crap).
- Release histories in the evaluated
  [`crap-typescript` changelog](https://github.com/fabian-barney/crap-typescript/blob/646c41e9ed94e222729aae3727771610d97f50fe/CHANGELOG.md),
  [`crap-score` changelog](https://github.com/ahilke/js-crap-score/blob/5094d0b4c4e4b3bd9221838a8ceeeca167a82500/CHANGELOG.md),
  [`crap4ts` changelog](https://github.com/breezy-bays-labs/crap4ts/blob/6d71f9cabd490838c935146d2334f869931d079e/CHANGELOG.md),
  and [`poly-crap` changelog](https://github.com/drew-simmons/poly-crap/blob/cf511fab894e1c2fac4f2662ffa2d9b1df74cd16/CHANGELOG.md).

## Why not choose the oldest option?

`crap-score` has the strongest age signal and the largest recent npm download
count, so it is the honest answer to “is there a more mature alternative?” It
is not a stronger choice for WallpaperDB. Its central data model starts with
Istanbul's reported functions and computes statement coverage for them. That
prevents a source-based inventory of maintained functions, ignores branch
coverage, and leaves both the local terminal report and future gate to custom
code. Choosing it would preserve only the formula while replacing most of the
behavior that matters here.

`crap4ts`, `poly-crap`, and `@danibram/crap4ts` have more convenient built-in
CLI features in particular areas, but they are no more mature than the
recommended package and each uses a different coverage definition. A bespoke
analyzer built from mature TypeScript/ESLint and Istanbul components would give
complete control, but function discovery and source-to-coverage attribution
are the difficult parts of this problem. The fixture matrix in
`crap-typescript` is more valuable than avoiding a thin policy wrapper.

## Adoption conditions

Before relying on the scores:

1. Pin `@barney-media/crap-typescript-core` exactly; do not use a range.
2. Keep coverage generation in Turborepo. The analyzer must consume outputs
   from the latest Turbo invocation, including valid restored cache outputs,
   rather than decide whether an existing report is fresh.
3. Ensure unit and integration tasks cannot overwrite one another's coverage;
   combine their Istanbul counters before analysis.
4. Characterize the wrapper with representative `.ts` and `.tsx` functions,
   nested functions, branchless functions, branch coverage below statement
   coverage, absent files, ambiguous paths, and generated/test exclusions.
5. Make `make crap` non-gating even though the core library computes threshold
   status. Make `make check-crap` require `CRAP_THRESHOLD` explicitly. In both
   modes, reinterpret unknown coverage as 0% and calculate CRAP from the
   function's measured cyclomatic complexity.
6. Re-evaluate the pin when WallpaperDB adopts Vitest 4. The adapter may then
   be technically compatible, but Turbo should remain the coverage executor so
   local and eventual CI behavior stay identical and cache-aware.

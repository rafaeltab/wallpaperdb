# Compiled V8 coverage

This opt-in path uses the repository's pinned toolchain and V8 provider. Run
`make install` for normal repository setup and `make toolchain` to verify it.
Docker must be available for configured integration suites. No files under
`/tmp/wallpaperdb-742` are required.

From the repository root:

```sh
# Fresh configured unit/integration tests, canonical reports and aggregate.
make coverage-compiled PACKAGE=user
# Multiple workspaces, or omit selectors for all configured producers.
make coverage-compiled PACKAGES=user,asset
# The existing strict CRAP workflow, including fresh coverage production.
make crap COVERAGE_MODE=compiled PACKAGE=asset
# Rebuild the aggregate from this generation after checking report/source hashes.
COVERAGE_MODE=compiled make run PACKAGE=root SCRIPT=coverage:merge ARGS=--local
make coverage-summary
```

[Makefile](../../Makefile) and [delivery.mjs](delivery.mjs) own these commands.
The producer builds dependencies through existing tasks, regenerates a private
converter copy from the pinned installed package with an exact content check,
and compiles a separate mirror with embedded original source maps. It never
patches the dependency store. Qualification-only sources/tests are not injected
into this mirror or the normal coverage denominator.

[repo-inventory.mjs](repo-inventory.mjs) discovers the actual script invocations
and chooses an explicit execution strategy. Suitable Node tiers use native
compiled execution and descendant collection; browser/DOM and reset-dependent
tiers retain Vite. Test selectors, projects, mocks, lifecycle and assertions are
preserved. Host coverage does not imply manually launched browser code was
collected. E2E, workspaces without unit/integration coverage producers, and
mutation collection are outside this command's scope. Their original routes
remain available; this is not a replacement for `make ci` or mutation testing.

Each generation has a unique `.coverage-experiment/production/attempt-*`
directory containing invocation provenance, tests, raw coverage and audit
records. Only after every selected test, inventory check, strict validation and
renderer succeeds are reports copied to the workspace's configured tier output
directories. `coverage/` contains merged JSON, LCOV, HTML and summary from the
same counters, plus `compiled-manifest.json` naming the exact selected scope.
Merge rejects failed/incomplete generations and changed report/source hashes.
Source identities are captured from the bytes compiled into the mirror; edits
during execution fail publication rather than certifying a newer source version.
Failed production removes selected canonical tier outputs and aggregate report
artifacts while preserving the live CRAP caller's `.crap-lock`;
there is no previous-success fallback. Do not rebuild the mirror during a run.

[report-audit.mjs](report-audit.mjs) permits at most two observed finite negative
implicit-false arms, at the recorded Factory joins/planner decisions. Publication
keeps their original branch maps and denominator. With the pinned original source
hash and exact statement spans, a following statement count greater than the
true-arm entry count supports **1, estimated-covered**. The true-arm count must
also agree with its body statement. Planner additionally requires agreement
between the following statement and a separate final-return measurement. The
published 1 is a boolean coverage indicator, never the difference as an exact
visit count. These estimates are supported by bounded controls, not guaranteed
V8 count bounds.

Missing, ambiguous or contradictory evidence falls back to **0, conservatively
uncovered**. Changed source identity also falls back to 0 until requalified.
Raw counts, observed source hash, supporting counts, difference, corroboration,
classification and fallback reason are retained in per-tier `coverage-audit.json`
and the generation manifest. CLI diagnostics and summary distinguish estimated
positives from uncovered fallbacks. Measured positive/zero counts are unchanged.
Any other negative, duplicate site, excess anomaly, invalid statement/function
count, or nonfinite/nonnumeric count fails production. The strict CRAP validator
is unchanged. Source moves or additional anomalies require investigation; this
policy never guesses at unrelated sites. Statement/function counts are untouched.

The reporting boundary can be checked independently:

```sh
make run PACKAGE=root SCRIPT=experiment:coverage:report-audit
make run PACKAGE=root SCRIPT=experiment:coverage:publication
make run PACKAGE=root SCRIPT=experiment:coverage:publication-cleanup
make run PACKAGE=root SCRIPT=experiment:coverage:source-identity
```

Known V8 continuation/generator limitations and forced-termination collection
limits remain. Passing test execution and valid report structure do not establish
perfect source coverage. Existing semantic converter controls remain separate
from publication's explicitly audited conservative handling.

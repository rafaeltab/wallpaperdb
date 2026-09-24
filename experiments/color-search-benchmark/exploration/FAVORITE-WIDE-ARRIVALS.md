# Wide utility-bank arrival workload

The optional `--workload wide` mode in `favorite-optimization-arrival.mjs` exercises changing colors and proportions across the full stored favorite utility bank. This is a cache-stress experiment, not a measured distribution of user searches.

## Requests

- 8,184 deterministic shuffled queries, from `favorite-wide-workload.mjs`.
- 6,138 coverage queries: 256 original anchor colors plus 23 named features, each at vibe and 0–100% proportions in 5% steps.
- 2,046 additional two/five-target combinations (25% of requests), mixing vibe, partial palettes and closed palettes.
- Each 0% coverage query adds a dummy 100% red target because the query interpreter requires a positive requested total. These 279 pairs add to the separately counted combination share.
- Named-family overrides merge over candidate parameters everywhere: preflight, execution, stored identity and field checks. Quality influence and cutoff weighting stay at the candidate's selected preset.

The complete workload compiles to all 6,138 utility keys for one preset. A shorter run has **not** necessarily queried all those keys.

## Protocol

Primary approval still requires the existing four fixed query bodies and their unchanged builder/executor source graphs. The wide generator is captured in the new arrival source snapshot; it does not change historical primary bindings.

All potential workload queries compile before load. The runner validates the full-schema metadata, required encoding, each merged query preset and every scoring field against the index mapping. These checks and coverage accounting are outside request timing. Actual requests still include their own compilation in measured latency.

Wide warmup selects 64 evenly spaced ordinals, including the first and last shuffled query. `warmupPlan` records the exact ordinals. Every selected warmup runs even if earlier ones fail, and all errors remain in raw evidence. Any failed or one-second warmup prevents rate escalation for that candidate.

Each candidate starts timed requests at offset 0. Offsets advance across rate stages, including rejected scheduled requests; warmups do not advance timed offsets. Every trial records `queryId`, `queryOrdinal`, absolute `queryOffset` and merged `parameters`.

Defaults remain `varied`, rates 8/32/64/128 requests per second, and 30 seconds per rate. Fixed and varied modes retain their existing query lists and warm every query.

`--duration-seconds` accepts integer values from 1 to 600. For example, one 16-request/second stage lasting 600 seconds schedules 9,600 requests, enough to traverse all 8,184 shuffled queries. Successful field coverage must still be verified; rejected or failed requests do not establish full coverage. Every profile and the independent auditor use the recorded duration for request counts and scheduling windows.

The three registered doc-value fetch variants validate their exact parent encoding. The sorted variant still requires numeric points; all three require a keyword `id` field with doc values. Unknown method suffixes are rejected.

The exact `favorite-utility-maxima-bounded` method also inherits the numeric schema. It requires its named builder/executor, float points and keyword ID doc values. Its bound definition is captured in preflight evidence, and the independent auditor verifies the binding and successful warmup PIT stages. This does not relax primary C1 approval or source binding.

## Interpreting evidence

Per-rate `coverage`, `cumulativeTimedCoverage`, final `candidateCoverage` and separate `warmupCoverage` distinguish:

- **Scheduled:** includes requests rejected by the client concurrency limit.
- **Dispatched:** excludes client rejections but includes failures that may precede a service request.
- **Successful:** only complete returned rankings; this is the conservative evidence for fields actually requested successfully.

Each records distinct query IDs, exact compiled utility keys, key fraction and target-count/mode frequencies. `fullUtilityBankCovered` becomes true only when the observed keys cover the declared full bank. Unsupported native representations report unavailable utility-key coverage rather than claiming equivalent indexed fields.

The latency percentiles describe the actual mixed workload, including five-color requests when present. They do not establish a latency guarantee for each individual query shape.

## Offline validation

`make color-favorite-optimization-arrival-test`: 18 tests pass. Checks cover full 8,184-query compilation and 6,138-key equality, merged controls through execution and identity, 64 warmup selections, retention of first/middle/last warmup errors, advancing offsets, rejection/error coverage, per-query presets, encoding mismatches, full-schema requirements, fetch/maxima parent validation and duration bounds. `make color-favorite-optimization-arrival-audit-test`: 11 tests pass, including independent configured-duration accounting and maxima binding. No service queries or load benchmarks were run while adding this mode.

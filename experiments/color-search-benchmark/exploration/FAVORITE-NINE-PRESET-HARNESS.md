# Nine-preset benchmark preparation

Prepared September 23, 2026. **No nine-preset million-record index or load run
was started by this work.** The full build is blocked by available disk space;
the user has declined additional disk. Existing results remain unchanged.

## Supported comparison

The existing closed-loop benchmark accepts separate candidates for each preset.
Use the original numeric docvalue method and ordinary pooled bound method:

- `favorite-utility-numeric-docvalues`
- `favorite-utility-bounded-pooled-delete`

For matched favorite-only versus nine-preset storage, keep query controls, shapes,
metadata filters and load rates identical. Use unchanged `fixed`, `varied` or
`wide` arrival workloads on each index. Run global top-20 parity before timed
loads; this harness does not supply a new parity result.

The arrival runner additionally accepts `presets-fixed`, `presets-varied` and
`presets-wide`. These execute each base query with all nine combinations of
quality influence `0, 0.5, 1` and cutoff weighting `0, 1, 3`. Base query order and
query shapes stay identical. Presets interleave within each base query.

The mixed workload must use a full index containing all nine presets. It first
requires four successful C1 closed-loop profiles and warmups for **every preset**
on the same index, method, builder and executor. Thus the primary benchmark needs
18 candidate entries for two methods; the mixed arrival config needs only two
entries, using their favorite preset. Each sibling's exact fixed query bodies
and recursive source graph are bound to the primary evidence.

## Coverage and timing

| Workload | Distinct requests | Explicit warmups |
| --- | ---: | ---: |
| presets-fixed | 36 | 36 |
| presets-varied | 675 | 675 |
| presets-wide | 73,656 | 576 |

Mixed wide covers 55,242 utilities in a complete cycle: 6,138 per preset. It warms
64 evenly spaced base queries at every preset. A 64/s run needs at least 1,151
seconds for a complete cycle; 1,200 seconds is supported. Only `presets-wide`
permits durations up to 1,800 seconds; other workload limits remain 600 seconds.
A 16/s run remains partial at that maximum duration. Actual successful coverage,
not the intended cycle length, establishes which fields were exercised.

Per-preset evidence includes scheduled, dispatched, returned and under-one-second
request counts, the union of errors and requests at/above one second, and actual
returned query/utility coverage. A slow but complete response can demonstrate
field coverage while still failing the latency requirement. Client rejections
and errors never establish successful coverage. Warmup failures remain failures.

Mixed-preset traffic is a different field-access workload from favorite-only
traffic; do not attribute every latency difference to index size alone. Query
plans are compiled before load and held in memory by the existing runner. The
large mixed-wide plan's driver memory cost has not been measured.

## Checks

All focused checks passed through Make:

```sh
make color-favorite-preset-workload-test
make color-favorite-optimization-arrival-test
make color-favorite-optimization-arrival-audit-test
```

Seven new workload tests, 21 existing arrival tests, and 15 audit tests passed.
The audit independently checks preset order, primary approvals and per-preset
counts without importing the generator/scorer. These are offline correctness
checks, not performance or million-record capacity evidence.

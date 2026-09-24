# Pooled snapshot cleanup variants

The first full-million capacity screen failed during connection churn. A separate
instrumented run reproduced 46 query failures in 28,269 queries and 28,227 new
HTTP connections. Its first failure was a reset while deleting a point-in-time
snapshot. Replacing only cleanup transport completed 52,001 queries without a
query error or request at/above one second, with 32 new connections. Both runs
returned the same fixed-query IDs and scores.

These are transport diagnostics on the same complete index, not a replacement
capacity campaign. The failed original screen and its errors remain evidence.
The diagnostic runner and both saved runs are preserved. See
[diagnostic scope and commands](FAVORITE-TRANSPORT-DIAGNOSTIC.md).

## Separate methods

| Method ID | Parent objective |
| --- | --- |
| `favorite-utility-bounded-pooled-delete` | Original globally bounded numeric utilities |
| `favorite-utility-maxima-bounded-pooled-delete` | Global bounds plus necessary ranges from maxima |

Both wrappers call their original parent executor. Query construction, seed
selection, bounds, filters, numerical scores, PIT lifetime and deadline handling
stay in the preserved parent modules. Only `DELETE _search/point_in_time` uses a
native HTTP keep-alive agent. Its JSON body and response validation are unchanged.
There are no retries. The existing duplicate-target arithmetic defect remains;
the separate multiplicity prototype is not silently included.

## Pool lifetime and injection

`createFavoritePooledDeleteTransport()` returns `request`, `snapshot`, `close`
and `definition`. Keep that instance across queries. Creating or destroying an
agent for each query would defeat connection reuse.

Default variant executors share a pool per service origin. Drain complete query
execution before calling `closeFavoritePooledTransports()`. A factory's `close()`
rejects new requests, waits for its already-started DELETE operations, and destroys
its agent. It does not know about parent queries that have not reached cleanup yet.

A fidelity recorder must wrap the factory's actual `request`. Successful native
DELETE responses include a transport witness with one attempted request and the
socket reuse flag. Each variant checks that witness and records per-query cleanup
counts. Injecting the original raw API would fail this check instead of silently
validating the wrong transport.

## Validation gate

Local protocol tests cover shared-socket reuse, unchanged body/method/path,
non-cleanup delegation, HTTP and body errors, premature response closure, abort
deadlines, shutdown draining, parent PIT rotation and rejection of a bypassed
transport. No test retries a failed request.

The new service fidelity runner reuses the existing 626-execution suite per
method/index: nine presets, complete 545-image rankings, limits 20/3/1, metadata
eligibility, exclusions, empty results, zero-score ties and duplicate anchors.
By default it checks both new methods on the full real index and the existing
three-primary projected index: **2,504 executions**. Every candidate is compared
with the unchanged numeric service reference. Captured traces must preserve all
shards, global filters, scoring clauses, PIT rotation/cleanup and the native
transport witness. Before/after index generations and source hashes must agree.

The three primaries remain on one physical node. These checks establish neither
multi-node resilience nor capacity. Human-feedback and a fresh four-method
full-million capacity campaign are separate gates; the existing index is reused.

```sh
make color-favorite-pooled-test
make color-favorite-pooled-fidelity-test
make color-favorite-pooled-adapter-test
COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216 make color-favorite-pooled-fidelity COLOR_FAVORITE_ARGS='--directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/pooled-fidelity-v1 --three-shards true'
```

The example fidelity directory is a single immutable run; choose a fresh name
when reproducing it. Root coordinates live work serially. The saved-file preflight
confirmed that all 189 utilities needed by the suite exist in the retained
three-primary index. Service outcomes must come from its completed artifacts.

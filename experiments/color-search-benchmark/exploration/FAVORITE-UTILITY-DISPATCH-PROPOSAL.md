# Proposal: dispatch favorite utility queries by their resolved terms

This is a proposed execution policy, not an implemented dispatcher or a production
recommendation. The preserved favorite and existing methods remain unchanged.
The full-million capacity campaign must finish before selecting the combination
executor.

## Resolve first, then choose an executor

Use the existing query interpreter and preset resolver to obtain the exact
utility field for every requested target. A complete field key includes the
color anchor or named family, requested amount or vibe mode, and quality/cutoff
preset. Equality of visible hex colors or anchor bins alone is insufficient.

For example, 20% red and 40% red use different utilities. Two 20%-red requests
resolving to the same field are duplicates. This proposal does not add those
percentages or reinterpret them as a request for 40% red.

Apply these branches in order:

| Condition | Proposed executor | Reason |
| --- | --- | --- |
| Any repeated complete utility key | `favorite-utility-numeric-multiplicity` | Preserve each target’s weight with one clause per field. Never pass its changed weights into the existing uniform-weight bound. |
| Exactly one requested term, with no duplicates | `favorite-utility-sorted-docvalues` | Direct global sort on that utility; deterministic ID tie order, lean ID fetch. |
| Two or more distinct complete utility keys | Numeric, original bounds, or seed-maxima bounds, selected after full-million tests | These preserve the same distinct-term objective; their work and round-trip costs differ by query and load. |

The duplicate branch takes priority even when grouping leaves one distinct key.
A future single-field shortcut could safely sort that grouped objective, but
that combined dispatch path has not been independently exercised. Keeping the
already-verified corrected scalar executor avoids accidentally invoking the old
duplicate behavior.

Required mapping guards remain explicit: supported favorite presets, complete
utility coverage, keyword ID doc values, and numeric points for sorting or bound
range queries. Unsupported controls remain unsupported; do not silently alter a
user’s query to fit the optimization.

## Distinct combinations: decision still pending

The numeric query is the simple exact reference. The bounded variants use
OpenSearch seed queries to derive provably necessary ranges, then execute the
original complete scorer globally. They do not retrieve a fixed subset and rank
it inside the application.

Current evidence does not establish one combination winner:

- On the narrow million-record projection, the original bound improved the
  tested two- and five-target cases over numeric scoring.
- On the full 100,000-record index, the bound improved the tested two-target
  case but was slower than numeric for five targets.
- The seed-maxima refinement has correctness/selectivity evidence, but its
  full-million performance is not measured yet.

Choose a branch only after comparing the methods on the **same full-million
index**, favorite preset, limit, filters and environment. Keep query shapes and
metadata selectivity separate. Require zero errors and zero requests at or above
1,000 ms, including warmups, at the intended concurrency and scheduled arrival
rates. A successful-request p95 below a second cannot excuse failures.

Changing-color workloads must exercise and report the actual utility-field
coverage. Fixed-query warm caches do not establish full-bank performance. Do not
derive a two-versus-five-target cutoff or a production throughput promise from
the projection/pilot alone. If no candidate passes a load, reduce the claimed
capacity; choosing the least slow failure does not make it viable.

## Duplicate correction evidence

The independent file-only audit is recorded at:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/multiplicity-independent-audit-v1.json`

It reconstructed the arithmetic from saved native doc values and checked saved
OpenSearch scores and global order, without importing the prototype scorer:

- 162 duplicate-suite executions: **135 actual weight corrections** and
  **27 unchanged same-anchor/different-amount controls**, across nine presets
  and limits 1, 20 and 1000; 30,564 returned scores compared.
- 144 separate ordinary-query comparisons across all 545 corpus entries:
  78,480 scores and full order unchanged from the parent.
- 36 single-target-equivalent or unchanged-control comparisons and three
  explicit eligibility/exclusion checks.
- Maximum difference from the ideal unrounded repeated-term mean:
  `7.947285973752827e-8`; exact float32 grouped scores matched the service.
- Both feedback candidates completed 32 cases, skipped the same six, and had
  zero errors. All 234 assessed preference-pair outcomes remained unchanged.

The 545-entry correctness corpus contains 523 real images and 22 synthetic
fixtures. Existing human feedback contains **no duplicate-target cases**. It
shows absence of an ordinary-query regression, not human endorsement of the
corrected duplicate semantics. This arithmetic correction intentionally differs
from the preserved favorite’s defective duplicate score; describe it separately
from execution optimizations that preserve scores.

## Consistency requirements

Every branch must retain identical metadata filters, eligible/excluded IDs,
limit, deterministic ID ties, timeout/abort handling and score interpretation.
Multistage bounds retain their point-in-time snapshot. Dispatch depends only on
the compiled query and validated index capability, never on sampled wallpaper
hits. Pagination and additional query modes require their own verified contract
before extending this proposal.

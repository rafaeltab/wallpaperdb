# Typed Painless optimization for joint color proportions

This prototype replaces only the Painless source used by the existing membership-atom scorer. It uses the same index, numeric data, query parameters, hard region definitions, error formula, float32 score, filters, and result ordering. The original `MULTI_SCRIPT` remains available for comparison.

## Implementation

`global-multi-fast-source.mjs` exports the pure `FAST_MULTI_SCRIPT` constant. It has no imports and can be used without a circular dependency. `global-multi-fast.mjs` re-exports the source, supplies `withFastMultiScript(body)`, and runs the actual OpenSearch correctness probe. The helper replaces only a script whose source matches the original general scorer; specialized one/two-family query bodies pass through unchanged.

The optimized source:

- Reads `cells`, requested mass, mode, bound, and the parameter lists into typed local variables once per document.
- Reads the selected family bits into five primitive integer variables. Unused bits are zero, so the same source supports one through five families without generating a source per query.
- Caches the packed atom doc-value wrapper and its size once per document.
- Forms each atom's local membership mask with five fixed bit tests instead of an inner loop with repeated dynamic parameter access.
- Computes the subset sums with typed loops over only the receiving half of each block. It removes the original per-mask branch while visiting the same additions in the same order.
- Reads each demand through a typed `List` and retains the original division, error, bound tolerance, and score arithmetic.

The sum transform is equivalent because an original receiving mask at bit `b` has `mask & b != 0`; within each block of length `2b`, these are exactly its final `b` masks, in ascending order. For those masks, `mask ^ b` equals `mask - b`. No summation is reordered. Counts are still decoded from the existing packed long values.

An independent read-only audit confirmed this equivalence for validated one-through-five-family inputs. All histogram sums remain exact integers in doubles because the document's total count is below `2^32`.

## Correctness evidence

Run `make color-global-multi-fast-probe` against the dedicated local OpenSearch 2.11 instance. The probe is read-only and uses `color-global-multi-real-v1`.

**60 native comparisons passed.** Each compares the full eligible ordering and float32 scores from the original source, optimized source, and JavaScript reference over all 100 real wallpapers. Cases cover:

- The six existing benchmark queries, including overlapping dark/blue/navy and five equal rainbow proportions.
- Partial requests with three, four, and five families, plus five zero-percent requests.
- Exact target and minimum modes.
- Unbounded searches and error bounds of 0.25 and 0.8.

The general scorer is forced even for one/two-family probes, checking the unused-bit paths. The report records both source SHA256 hashes and the indexed dataset fingerprint in [global-multi-fast-probe.json](global-multi-fast-probe.json). A failed, timed-out, or partial search fails the probe instead of counting as a successful comparison.

## Performance interpretation

The shared scale harness measured the same existing one-million-document index after earlier experiments had warmed the node and compiled scripts. These are synthetic mixtures of 120 descriptors, not one million independent wallpapers. The optimization introduces no new mapping, document features, or storage requirement.

The optimized run passed **51 correctness comparisons with zero failures**, including agreement with the original extended-timeout full-index score/ID oracles. Repeated full-index scoring of three/five-family queries fell from approximately **20 seconds** with the original source to median **199.7–260.7 ms** with the typed source. The typed measurements have 15 repetitions per query; the slow original full-index runs are correctness oracles, not an equally sized repeated timing sample.

For the repeated overlapping dark40/blue30/navy30 query, adaptive search's median fell from **367.5 ms to 9.8 ms**. At four concurrent requests, its p95 fell from **1,400.7 ms to 59.9 ms** over the recorded repeated-query passes. Query parameters, index and correctness objective stayed fixed; the passes were sequential experiments on a warmed node, not a randomized production trial. Raw results and source fingerprints: [global-multi-fast-evaluation.json](global-multi-fast-evaluation.json).

The later [changing-query workload](GLOBAL-VARIED.md) found substantially different latency distributions, including cases where adaptive search loses to direct scoring after a selective metadata filter. The repeated-query results establish an execution-overhead improvement, not a general end-user latency guarantee.

This changes execution overhead, not the prototype's scope: at most five frozen color families, hard membership and joint area allocation. It does not add dynamic user-defined region boundaries or a preference for colors nearer the center of a region.

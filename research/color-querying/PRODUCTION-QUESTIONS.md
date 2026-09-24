# Questions for production implementation

The [three-option direction](README.md) is accepted. These questions identify
work needed to implement it faithfully and validate deployment; they do not
reopen the completed method-selection discussion. No production work is
implemented by these documents.

## Behavior to preserve

- Use the 256-bin shade-aware, strict-hue measurements and all five cutoff layers.
  Preserve the selected metric, anchor bank, sampling, and score parameters as
  versioned definitions; changes require comparison with the frozen favorite.
- Offer the three linked quality preferences, with linear influence 0.5 and
  cutoff weighting 1 as the default. Do not replace linear 0.5 with smooth-power
  0.5: they have different effects, with no single exact equivalent exponent.
- Keep whole-image target percentages in 10% steps. A partial request retains
  its unspecified remainder; it is not normalized into a closed palette.
- Apply semantic/metadata eligibility in OpenSearch before global ranking.
  Preserve score/tie ordering and stable pagination. Do not introduce a capped
  application-side rerank as an optimization.
- Keep unsupported query behavior explicit. A target-percentage query does not
  implicitly become an accent, palette-purity, or relative-highlight query.

## Correctness decisions before implementation is finalized

**Repeated or overlapping targets.** The selected prototype inherits a numeric
query issue where identical resolved utility clauses can lose their intended
multiplicity. Decide how repeated targets and two precise colors resolving to
the same bin should behave, then validate the implementation against that
explicit objective. The separate
[multiplicity refinement](../../experiments/color-search-benchmark/exploration/FAVORITE-OPTIMIZATION-RESULTS.md)
has arithmetic/service evidence; existing human judgments contain no such
cases. Accepting the architecture is not accepting a known weighting bug as a
product rule.

**Composition semantics.** Independent overlapping coverages can double-count
the same pixels across requested colors. They do not prove that requested areas
occupy distinct regions or that a full palette excludes other colors. Preserve
the user's closed-versus-partial composition examples in the evaluation set.
Any purity or joint-assignment addition changes the objective and needs its own
accuracy and performance comparison.

**Precision and names.** Hex colors currently select their nearest stored anchor;
they are not arbitrary exact-color predicates. Confirm acceptable precision
and explain named grayscale/near-neutral/dark behavior consistently in the UI.
Abstract named features have no layered cutoff weighting, so linked control
positions need not change all named-query rankings.

**Numerical contract.** Establish float precision, aggregation order, duplicate
handling, tie-break ID, and pagination behavior. Test full rankings and small
score gaps against an exhaustive OpenSearch reference. Do not use human-pair
agreement alone to establish retrieval correctness.

## Ingestion, schema, and migration

The existing architecture has a color extractor, NATS events, a gateway, and
OpenSearch. Specify ownership of image sampling, measured descriptors, and
precomputed scores before designing their production contracts. The research
does not select an event schema or decide whether final utilities are computed
in the extractor or during projection into the search index.

Version the metric, anchor bank, cutoff definitions, named features, linked
presets, utility schema, and descriptor provenance together. Plan idempotent
event handling, backfill/reindex behavior, partial-document exclusion, and a
complete-index readiness check. Preserve a reference dataset so that schema
migrations can check behavior before switching queries.

Decide where to retain measurements for future reindexing and debugging. The
optimized experiment disabled OpenSearch stored source and fetched IDs through
doc values; that is evidence about query/storage choices, not a complete
durability or recovery strategy. Review mapping-field limits and per-field
overhead for the 10,044-utility representation. Estimate event and indexing
payload sizes from the chosen format rather than the image storage budget.

## Capacity validation still required

Measure the **complete three-preset, 10%-step bank at one million records**.
Report fully populated field counts and document counts, settled primary bytes,
replica cost, merge/build headroom, and the resource configuration. Do not
substitute the old 70-field projection or one-preset benchmark.

Compare identical favorite queries with queries that rotate all three settings,
using broad and selective metadata filters, single and multiple colors, and
all supported profile keys. Include scheduled arrivals, bursts, cold/unseen
queries, index updates, and the intended shard/replica topology. Count errors,
timeouts, and every request at or above one second as failures; report those
alongside latency percentiles.

Measure gateway end-to-end latency and service CPU/memory as well as OpenSearch
CPU, heap, page-cache/data reads, and storage. Earlier bounds reduced some work
but could increase I/O and latency. No application-level setting that always
keeps the favorite's physical index pages resident has been established by this
research; test locality under actual memory pressure.

Keep ordinary numeric scoring as the reference execution. Compare bounded
execution or a workload-aware dispatcher only with global score/order parity,
consistent pagination, cancellation, total request deadlines, and cleanup costs.
The prototype results do not select one executor for all query shapes.

## Relevance and future media

Add fresh wallpapers and independent reviewers, retain uncertain judgments,
and separate tuning cases from held-out groups. Evaluate high-ranking unjudged
results, precise neighboring shades, dark saturated colors, tinted neutrals,
duplicate targets, and closed/partial palettes. Do not tune only to the highest
score on the current single-reviewer dataset.

Video and live wallpaper support still needs a definition of temporal sampling
and aggregation: what colors should represent a changing scene? The current
research measured still images. Additional image versions do not establish a
video descriptor, nor does larger media storage make index throughput or memory
constraints disappear.

The retained [feedback loop](../../experiments/color-search-benchmark/evaluation/loop/README.md),
[favorite snapshot](../../experiments/color-search-benchmark/exploration/FAVORITE-SNAPSHOT.md),
and [measurement record](EVIDENCE.md) provide the reference for this later work.

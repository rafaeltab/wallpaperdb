# Production color-search decisions and validation

The maintainer confirmed these integration decisions on September 30, 2026,
following the [September 24 selection](README.md).
[ADR 0006](../../adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md#production-integration-decisions)
records the rationale. Priorities are correct values and rankings, performance,
then responsibility split.

Implementation is tracked by [#266](https://github.com/rafaeltab/wallpaperdb/issues/266)
and its approved sub-issues: [extraction](https://github.com/rafaeltab/wallpaperdb/issues/305),
[utility indexing](https://github.com/rafaeltab/wallpaperdb/issues/306),
[the full query contract and ranking](https://github.com/rafaeltab/wallpaperdb/issues/307),
and [the existing picker integration](https://github.com/rafaeltab/wallpaperdb/issues/308).
The approved breakdown replaces the parent's earlier backfill requirement.

## Behavior and numerical reference

Preserve the [selected method](METHOD.md): sampling, 256 overlapping anchors,
shade-aware strict-hue matching, five cutoffs, named features, three linked
settings, the linear curve, and default influence 0.5 with weighting 1. Keep vibe
queries, whole-image proportions in 10% steps, unspecified remainders, and equal
target contributions. Overlapping coverage does not guarantee disjoint regions,
palette purity, or accent/relative-highlight objectives. Abstract named features
measure distribution strength rather than literal pixel area.

Use native numeric OpenSearch execution with the selected float32 values and
aggregation order. Filter eligibility before global ranking, retain eligible
zero-score records, and sort by descending score with ascending wallpaper-ID
ties. Capped application reranking, direct single-target sorting, global bounds,
and other experimental executors are outside this implementation.

The complete bank has 10,044 scores: 256 anchors and 23 named targets, each with
one vibe and eleven proportion profiles at three settings. Preserve indexed
float fields and doc values, source exclusion for utilities, and ID doc values.

The frozen query can lose multiplicity when Lucene collapses identical clauses.
Apply the researched [multiplicity correction](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-MULTIPLICITY.md):
group identical complete utility keys and weight by multiplicity divided by the
original target count. Different percentages remain separate. Validate corrected
duplicates separately from the historical snapshot.

Compare image measurements, complete utilities, and full ordered IDs/scores
against the retained float32 reference. Cover near ties, duplicates, neutral/named
targets, partial compositions, eligibility, zero scores, and unchanged-index
pagination. Bitwise parity with every historical operation grouping is not
required. Preference agreement alone does not establish retrieval correctness;
retain the uncertainty recorded in [EVIDENCE.md](EVIDENCE.md).

## Query contract and verification

The [GraphQL schema](../../../apps/gateway/src/graphql/schema.ts) exposes the
contract; [Catalogue admission](../../../apps/gateway/src/capabilities/catalogue/colors.ts)
owns defaults, one-to-ten target bounds, and resolution. GraphQL translates
protocol values without repeating those decisions. [METHOD.md](METHOD.md#3-score-the-requested-intent)
details target admission and overrides. Mixed modes use their own complete keys
and contribute equally to the original target count.

The [native query adapter](../../../apps/gateway/src/adapters/opensearch/query.ts)
applies multiplicity and pre-ranking metadata, contributor, and readiness filters.
It retrieves IDs from doc values and metadata from source, reporting unavailability
for timeouts, failed shards, or malformed results. Reversible score/ID cursors
cover unchanged-index pages without a new snapshot model. GraphQL, Catalogue,
and real OpenSearch contracts check these boundaries; one composition test follows
an actual-image fact through utility indexing to the API.

## Measurements, utilities, and retained facts

Color Extractor owns sampling and versioned measurements; Gateway owns Catalogue
utilities and query interpretation. Retained coverage, conditional quality, and
named properties permit utility recalculation without decoding originals when
the descriptor definition is unchanged.

The [measurement contract](../../../packages/events/src/schemas/color-measurements.ts)
and [published fact](../../../packages/events/src/schemas/wallpaper-colors-extracted.ts)
freeze descriptor geometry, provenance, and structural validation. Retained NATS
history keeps the measurements after consumer acknowledgement; Gateway rejects
incompatible definitions before projection. Consumers remain replay-safe, and
incomplete banks cannot participate in color ranking. The broader retention and
privacy review remains in [#162](https://github.com/rafaeltab/wallpaperdb/issues/162).
The source-event budget is 64 KiB including headers, enforced by the
[Gateway message-budget adapter](../../../apps/gateway/src/adapters/events/message-budget.ts).

Gateway computes the complete bank with the selected encoder's float32 casts and
calculation order. The [retained utility fixtures](../../../apps/gateway/test/fixtures/prototype/utilities.json)
contain every value produced by the frozen linked-three encoder, independently
of production code. The [mapping](../../../apps/gateway/src/adapters/opensearch/mappings.ts)
keeps Catalogue metadata, measurements, and provenance in the wallpaper document
while excluding utilities from stored source. Utilities are numeric float fields
with indexing and doc values; wallpaper IDs also have doc values. A complete
compatible bank and readiness marker become visible in one document replacement.
A bank arriving before upload remains hidden until the wallpaper is published.

Source exclusion makes ordinary source-based metadata updates unsafe because
reconstructing the document would discard utilities. The
[projection adapter](../../../apps/gateway/src/adapters/opensearch/index.ts)
therefore replaces the complete document using sequence-number and primary-term
compare-and-set. Every accepted wallpaper metadata change recomputes utilities
from retained measurements. Definite conflicts trigger a bounded reread; unknown
write outcomes rely on ordinary replay and stable occurrence identity. Contributor
Profile snapshots keep their separate document and version contract. No
transaction spans a wallpaper, Profile document, and broker acknowledgement.

Writes are bounded by serialized bytes. This consumer writes one complete
wallpaper at a time and checks its acknowledgement; it does not batch partial
banks or add operator replay/rebuild tooling. Future bulk delivery must retain
byte-bounded batches, complete item acknowledgements, and restricted retries for
definite HTTP 429 admission rejection. Experimental shard, replica, and refresh
settings are not deployment requirements.

## Fresh installation and picker scope

The maintainer will recreate infrastructure/storage and upload images again.
Replace the old API, histogram extraction, and index directly. No production
installation or external client needs old inputs, histogram data, parallel indexes,
staged cutover, backfill, or migration/rebuild tooling. Event durability and
replay-safe consumers remain required.

Build the full query contract with every supported setting and mode, then connect
the current single-color picker to default-quality vibe queries. The advanced
picker remains [#36](https://github.com/rafaeltab/wallpaperdb/issues/36).

## Deployment evidence deferred to the persistent environment

The complete bank's million-record storage and mixed-query capacity remain
unmeasured; earlier single-preset and partial-projection results do not establish
them. A million-record campaign, predicted request rate, or Railway availability
is not a completion gate. [#240](https://github.com/rafaeltab/wallpaperdb/issues/240)
owns deployment evidence, with limits and load selected for an actual environment.

Useful evidence includes complete field/document counts, primary and replica
storage, build/merge headroom, hardware and shard topology, end-to-end latency,
errors/timeouts, CPU/memory, and recovery behavior. Mixed settings, broad and
selective filters, multi-target queries, cold/unseen queries, arrivals, bursts,
and updates exercise different costs. These remain evaluation considerations,
not newly imposed acceptance criteria for #266. The earlier one-second research
failure threshold is historical evidence, not an agreed production service target.

Any later executor optimization needs full score/order parity with the numeric
reference, existing pagination behavior, and bounded request/cancellation
lifetimes. This implementation does not select a workload dispatcher or assume
that favorite-preset index pages remain resident under memory pressure.

## Future relevance and media work

Later relevance evaluation can use fresh wallpapers, independent reviewers,
held-out groups, and uncertain judgments. It is not a prerequisite for implementing
the accepted scoring choice.

Video and live wallpapers need their own temporal sampling and aggregation
definition. The selected measurements describe still images; additional stored
image versions do not establish a video descriptor.

The retained
[feedback loop](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/evaluation/loop/README.md),
[favorite snapshot](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-SNAPSHOT.md),
and [measurement record](EVIDENCE.md) preserve the historical reference without
claiming that the new application path or deployment capacity has been validated.

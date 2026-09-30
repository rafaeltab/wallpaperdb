# Production color-search decisions and validation

The [three-option direction](README.md) was accepted on September 24, 2026.
The maintainer confirmed the integration decisions below on September 30, 2026;
[ADR 0006](../../adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md#production-integration-decisions)
records their rationale. The selected prototype already provides the desired
behavior. Correct final values and rankings come first, then performance, then
responsibility split. These documents do not implement the replacement.

Implementation is tracked by [#266](https://github.com/rafaeltab/wallpaperdb/issues/266)
and its approved sub-issues: [extraction](https://github.com/rafaeltab/wallpaperdb/issues/305),
[utility indexing](https://github.com/rafaeltab/wallpaperdb/issues/306),
[the full query contract and ranking](https://github.com/rafaeltab/wallpaperdb/issues/307),
and [the existing picker integration](https://github.com/rafaeltab/wallpaperdb/issues/308).
The approved breakdown replaces the parent's earlier backfill requirement.

## Behavior and numerical reference

- Preserve the selected prototype's 256 overlapping anchors, shade-aware
  strict-hue measurements, all five cutoff layers, named features, sampling,
  and score parameters. Image sampling includes orientation, sRGB conversion,
  a 128-by-128 fill sample, and alpha compositing onto black. The old histogram's
  transparency treatment is not the new descriptor's definition.
- Preserve all three linked quality settings, the linear quality curve, and
  default influence 0.5 with cutoff weighting 1. Independent sliders or a
  different quality curve would change the accepted behavior.
- Keep vibe queries and whole-image target percentages in 10% steps. Partial
  requests retain their unspecified remainder. Unsupported intermediate
  percentages are rejected rather than normalized or rounded.
- Preserve independent overlapping coverages and equal target contributions.
  A request totaling 100% does not guarantee disjoint regions or palette purity.
  No new purity, accent, or relative-highlight objective is part of this work.
- Resolve hex colors to the nearest stored anchor. Preserve named features'
  separate definitions; abstract distribution features do not become literal
  pixel-area measurements. Named features have no layered cutoff weighting.
- Use the selected native numeric OpenSearch executor, float32 utility values,
  and aggregation order as the reference. Apply metadata eligibility before
  global ranking and retain eligible zero-score records. Sort by descending
  relevance and ascending wallpaper ID for ties, preserving existing pagination.
  Capped application reranking, direct single-target sorting, global bounds,
  and other experimental executors are outside this implementation.

The selected utility bank contains 10,044 scores per wallpaper: 256 anchors and
23 named targets, with one vibe and eleven proportion profiles for each of
three quality settings. Preserve numeric float fields and doc values, the
source-disabled utility representation, and ID retrieval through doc values.
Integrating Catalogue metadata and result retrieval must respect that layout.
See [METHOD.md](METHOD.md) for the precise formula and stored-value definitions.

The frozen linked query can lose multiplicity when Lucene collapses identical
utility clauses. Apply the researched
[multiplicity correction](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-MULTIPLICITY.md):
group identical complete utility keys and apply multiplicity divided by the
original target count. This preserves the intended mean without combining
different percentages or redefining composition semantics. The historical
snapshot retains its defect; validate corrected duplicate cases separately.

Correctness checks compare image measurements, complete utility values, and
full ordered IDs and scores against the retained reference. Cover small score
gaps, duplicate resolved keys, neutral/named targets, partial compositions,
eligibility, zero-score records, and multiple pages of an unchanged index.
The numerical baseline is the selected float32 OpenSearch path, not bitwise
parity with every grouping of the original formula. Human preference agreement
alone does not establish retrieval correctness; preserve the uncertainty and
scope recorded in [EVIDENCE.md](EVIDENCE.md).

## Measurements, utilities, and retained facts

Color Extractor owns image measurements; Gateway owns the Catalogue projection
and query interpretation. Measurements describe coverage and conditional quality
at each anchor/cutoff, plus named visual properties. Utilities are derived fit
scores for a target, mode, proportion, and quality preference. Retaining
measurements permits utility calculation without decoding originals again when
the descriptor definition is unchanged.

Retain versioned extraction facts through NATS under the existing retention
decision. Begin with the extractor publishing measurements and Gateway deriving
utilities; the computation split may change if correctness or performance
warrants it within the repository's context boundaries. A new Postgres store is
not required. The broader retention/privacy review remains in
[#162](https://github.com/rafaeltab/wallpaperdb/issues/162).

Record descriptor provenance and version the metric, anchor bank, cutoffs,
named features, presets, and utility schema so incompatible data cannot be mixed.
Consumers must remain replay-safe, and incomplete banks cannot participate in
color ranking. These are ordinary delivery and projection guarantees; they do
not require an operator replay or index-rebuild command in this feature.

The source-event budget is 64 KiB including headers, enforced by the
[Gateway message-budget adapter](../../../apps/gateway/src/adapters/events/message-budget.ts).
Measure the chosen serialized contract rather than assuming that a numeric
value count predicts event size. An encoding must fit that budget; if a durable
logical reference is used, its measurement bytes must remain available for the
event replay lifetime. Contract details and complete-bank eligibility are owned
by the extraction and indexing issues linked above.

## Fresh installation and picker scope

The maintainer will recreate infrastructure and storage and upload images again.
Replace the old color API, histogram extraction, and color index directly. There
is no existing production installation or external client requiring preservation
of old inputs, historical histogram data, parallel indexes, staged cutover,
backfill, or migration/rebuild tooling. This exception does not remove ordinary
event durability or replay-safe consumer requirements.

Build the full replacement color query contract in one step, including every
supported quality setting and query mode. Then connect the current single-color
picker using a default-quality vibe query. No new picker is included;
[#36](https://github.com/rafaeltab/wallpaperdb/issues/36) owns the advanced picker.

## Deployment evidence deferred to the persistent environment

The complete three-setting bank's million-record storage and concurrent mixed
query capacity remain unmeasured. Earlier single-preset or partial-projection
results do not establish those limits. A mandatory million-record campaign,
predicted requests-per-second target, or Railway availability is not a completion
gate for this feature. Deployment evidence belongs to the persistent environment
work in [#240](https://github.com/rafaeltab/wallpaperdb/issues/240), with resource
limits and load chosen when there is an actual environment to evaluate.

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

Fresh wallpapers, independent reviewers, held-out groups, and uncertain judgments
can support later relevance evaluation. They do not reopen the accepted scoring
choice or make another relevance interview a prerequisite for implementation.

Video and live wallpapers need their own temporal sampling and aggregation
definition. The selected measurements describe still images; additional stored
image versions do not establish a video descriptor.

The retained
[feedback loop](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/evaluation/loop/README.md),
[favorite snapshot](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-SNAPSHOT.md),
and [measurement record](EVIDENCE.md) preserve the historical reference without
claiming that the new application path or deployment capacity has been validated.

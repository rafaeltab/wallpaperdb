# Global color composition search in OpenSearch

**Historical experiment findings, not an approved design.** The user has returned the work to joint exploration of goals and options before choosing further experiments. See [COLOR-QUERY-GOALS.md](COLOR-QUERY-GOALS.md) for the current discussion and scope.

## Recommendation

The strongest direction is **original-pixel measurements, an indexed catalogue of color regions, and globally exact scoring inside OpenSearch**. Use indexed pruning for broad searches and direct scoring for small eligible populations. It supports one to five requested proportions, including overlapping regions, without fetching a capped candidate list and sorting it in the service.

Try it at **http://zerotwo:8221/global.html**. Compare **Original-pixel joint composition** and **Adaptive original-pixel composition**: they implement the same ranking and should return the same order. The earlier methods remain available for comparison. [UI instructions](GLOBAL-UI.md) describe setup and controls.

This is a promising production direction, not a finished production feature. The fast prototype uses **18 predefined, experimental regions** and hard membership. Arbitrary per-query RGB/HSV/HSL/OKLab ranges and the earlier center-to-edge quality preference are separate capabilities; they are not silently approximated by this fast scorer.

The priority order is accuracy, speed, flexibility, service resources, OpenSearch resources, then storage. The experiments establish accurate measurement and globally correct retrieval for the declared model. **Human relevance and consistently fast complex searches remain unproven.**

## Which options survived testing?

| Approach | What we learned | Decision |
| --- | --- | --- |
| Cosine versus L2 | Changing vector distance does not express partial amounts or exclusive portions | Keep as historical comparators |
| Numeric coverage with native scoring | Simple and fast, but independent coverages can count the same area more than once | Useful baseline; different semantics |
| Inverted percentage tokens | Query expansion outweighed competitive-score skipping in these tests | Do not prefer over numeric scoring |
| Arbitrary palette-range scripts | Global OpenSearch ordering is possible, but compact palettes lose narrow regions and broad scans cost more | Flexible reference, not the leading production candidate |
| Original-pixel membership plus numeric bounds | Preserves overlapping portions; pruning can remove most scoring while retaining global winners | Leading candidate, with strategy chosen by selectivity |

The full [option comparison](GLOBAL-OPTIONS.md) also covers nested cells, multiresolution representations, ANN and custom plugins. Those alternatives are researched options, not completed scale prototypes.

## What the experiments established

1. **Changing cosine to L2 does not solve composition semantics.** The earlier [initial findings](FINDINGS.md) cover that comparison. Partial proportions and overlapping ranges need an objective that describes image area explicitly.
2. **Measure original pixels without thumbnail interpolation.** Approximately 65k jittered original-pixel samples averaged 0.024 percentage points of coverage difference from a 262k-sample reference, with a maximum 0.302 pp across 100 wallpapers × 18 regions. Resizing to 256px averaged 0.701 pp and reached 35.799 pp in one region/image. Exact counts on four diagnostic images confirmed material differences. This establishes fidelity to source-pixel area, not universal human color perception; spatial averaging at display size can itself affect appearance. [Sampling evidence](GLOBAL-SAMPLING.md)
3. **A small perceptual palette can lose a valid narrow region entirely.** Wallpaper 088 has 39.6301% grayscale area by exact source-pixel counting under the declared 2% saturation rule. Its 32-color palette reported 0%; original-pixel sampling reported 39.6701%.
4. **Precompute region overlap during extraction.** A membership histogram records how much area belongs to each combination of regions. On the 100 real wallpapers it needed 5–109 entries, median 47. This preserves the declared hard-membership information without clustering colors into 32 centroids. [Representation and formula](GLOBAL-MULTI.md)
5. **Use indexed numeric bounds to avoid unnecessary scoring.** An adaptive search starts with a small total-error limit, searches every potentially competitive document, and widens when necessary. Every accepted page is globally complete for the indexed model and score ordering.
6. **Script implementation had a large OpenSearch cost.** The first generic Painless loop took about 20s to scan 1M documents. Caching typed values and removing repeated dynamic lookups reduced it to roughly 0.20–0.26s with identical scores. Indexed pruning reduced repeated benchmark queries further, but changing queries exposed higher latency. [Script comparison](GLOBAL-MULTI-FAST.md)

## Ranking and global completeness

For each selected set of regions S, let:

- `demand(S)` be the sum of requested proportions in S;
- `coverage(S)` be the image area in the union of those regions;
- `P` be the total requested proportion.

The exact-area error is:

```text
missing = max over selected subsets S of max(0, demand(S) - coverage(S))
excess  = max(0, coverage(all selected regions) - P)
error   = missing + excess
score   = float32(1 - error)
```

Results sort by this score descending, then stable ID ascending. “Globally exact” means exact for that implemented score/ID order. Tiny error differences can round to the same score; the ID then decides their order. The probes include an adversarial example that verifies these ties across adaptive bounds and pagination.

For “40% green,” this reduces to `abs(actual_green - 0.40)`: 80% green ranks below 40%. For five 20% requests, one 20% patch that belongs to all five regions cannot satisfy the whole request; the error is 80%. Pixels can be allocated to one requested portion at a time.

One/two-region requests use a small closed form. Three to five regions require at most 31 subset constraints, evaluated from the membership histogram. The independent flow comparison and actual OpenSearch probes verify this formulation.

To return 20 results, the adaptive query begins at 1 pp allowed error. Numeric singleton/pair-union filters discard documents that provably cannot score within that error. The script checks the complete objective, including larger overlaps. If there are fewer than 20 certified results, the error limit widens. A point-in-time snapshot (PIT) keeps the collection stable; `search_after`, a stable ID tie-break and float32-aware boundary handling preserve pagination. The bound can eventually widen to the entire eligible population. [Bound proof and pagination details](GLOBAL-BOUNDED.md)

## Performance evidence

The experiments used real OpenSearch 2.11, three shards, one local node, four CPUs, 2 GiB heap and a 4 GiB container limit. Quality examples use 100 actual wallpapers plus 20 analytic fixtures. The 1M load documents are deterministic mixtures of those descriptors, **not 1M independently sourced wallpapers**.

Repeated queries made adaptive search look particularly fast: medians around 3–15ms and observed p95s around 7–77ms with four requests in flight. **Changing-query results were substantially slower.** The later workload changed regions, amounts and metadata partitions across 60 queries:

| Eligible population / query | Direct median | Adaptive median |
| --- | ---: | ---: |
| 1M documents, three regions | 218.1ms | 63.4ms |
| 1M documents, five regions | 303.4ms | 203.4ms |
| 10k documents, three regions | 12.0ms | 164.1ms |
| 10k documents, five regions | 7.6ms | 163.6ms |

Every ordered top-20 ID and float32 score matched: **60/60 sequential comparisons and 60/60 concurrent results**. Across the mixed workload, adaptive latency was 63.8ms median / 301.9ms p95 sequentially, and 68.3ms / 386.0ms with four in flight. Broad five-region queries reached 487.9ms in the concurrent pass. Each subgroup has only 7–8 queries, so these are observations rather than stable tail estimates. The node was already used, methods could warm each other's fields, and concurrency repeated the sequential queries. This is not a cold-cache test. [Changing-query evidence](GLOBAL-VARIED.md)

This rules out always using adaptive widening. Small eligible populations favor direct scoring inside OpenSearch; broad searches often benefit from indexed bounds. Exact query-by-query values, failures and sample counts are in [measured evidence](GLOBAL-MEASUREMENTS.md).

### The planner follow-up

The final prototype counts metadata matches on the same PIT, stopping once it cannot prove the population is at most 10,000. An exact count at or below 10,000 selects direct scoring; larger populations use adaptive bounds. The cutoff is experimental, chosen from the observed workload. There is no service reranking.

Retesting the same, now-warmed 60-query set passed all 60 sequential comparisons, 120 concurrent result checks and 15 edge/pagination checks. Including counting and PIT overhead, narrow three/five-region medians improved from 47.0/100.1ms to 10.5/9.3ms. The planner's mixed workload measured **9.3ms median / 58.4ms p95 sequentially**, and **16.1ms / 135.4ms with four in flight**.

These are warmed follow-up observations, not unseen-query guarantees. The concurrent planner pass ran second and could benefit from cache warming. Broad searches execute the same adaptive algorithm in both methods, so their timing differences cannot be attributed to the planner. An unseen workload and additional selectivities are needed to calibrate the cutoff. [Planner implementation and evidence](GLOBAL-PLANNER.md)

The longer resource checks ran four requests concurrently for at least 8s per case. Cached CPU counters were allowed to refresh before and after each block. They show substantially lower OpenSearch CPU per query for adaptive pruning than full scans on the repeated examples. These measure the prototype coordinator and search engine; they exclude image extraction, production gateway work and remote-user network latency.

## Accuracy and flexibility limits

- **The region catalogue is not perceptually calibrated.** The experimental red region accepts some pink/brown colors. Perfect ranking under that definition does not prove that users like the results. Canonical color chips and blinded wallpaper judgments should tune the bank before shipping.
- **The real corpus is small.** Some red/green and red/dark compositions have no close example. The search still returns the closest available wallpapers; an unattractive result is not necessarily a retrieval omission.
- **Hard membership is implemented.** The requested 100%-at-center/50%-at-edge preference is not included in the fast multi-region representation. Membership alone discards within-region distance; accurate graded allocation needs a richer descriptor and its own global-scoring verification.
- **Free-form ranges remain a tradeoff.** The dynamic OpenSearch range prototype accepts arbitrary geometric ranges but uses a 32-color palette, loses some narrow-region area, and scans matching documents. It was slower at 100k. The fast route exchanges that flexibility for precomputed measurements; new presets require extraction/backfill. The user has not accepted a fixed catalogue as a permanent product constraint.
- **No spatial-layout constraint is modeled.** The percentages concern image area, not where each color appears. Overlapping regions can allocate different parts of an otherwise uniform accepted color to different requested portions.

## One million versus one hundred million

One million parent documents were indexed and queried. The final membership representation occupies about 9 GiB for that synthetic index after background merges, including `_source` and all 171 scalar bound fields. That is roughly 9.3 KiB per document in this experiment. Storage savings are a secondary concern here; query accuracy, latency and CPU drove the choice. Pair fields grow quadratically with the number of regions, so a much larger catalogue needs separate ingestion, mapping and query-cost measurements.

The architecture is compatible with distributed OpenSearch: indexed filters, doc values, a cached Painless script, shard-level collection and global score merging. It returns only the requested page to the service. No custom OpenSearch plugin is required.

**100M performance is not demonstrated.** Bound selectivity depends on real color distributions, requested proportions and metadata filters. Loose bounds can approach a full scan. Production validation needs an independently diverse corpus, varied/cold queries, representative concurrency, replicas/shard placement, and an agreed latency target. Simply multiplying the 1M timings would be misleading.

The prototype's 15s OpenSearch timeout applies to each search, and adaptive widening can issue several searches. Its HTTP client allows up to 180s per call. Production integration needs an overall request deadline and cancellation policy; the current timeout is not a user-facing latency guarantee.

## Integration direction

1. In the color extractor, sample original pixels and emit a versioned region-bank/membership descriptor. Keep sample count, alpha semantics and extraction version explicit.
2. Extend the NATS event contract and gateway projection with the complete descriptor and bound fields from the same extraction. Missing measurements must not masquerade as 0% coverage.
3. Backfill a new OpenSearch index, then switch its alias when descriptor coverage and verification are complete. Changing region definitions changes the representation version.
4. Add a query planner in the gateway that selects direct scoring or adaptive indexed bounds according to eligible population, using the small closed-form scorer for one/two regions and the generic scorer for three to five. Preserve PIT-based cursors. All final ordering remains in OpenSearch.
5. Tune the family definitions and evaluate graded preferences before presenting the prototype's exact-area ranking as finished perceptual matching.

## Artifacts and scope

- [Options considered](GLOBAL-OPTIONS.md): native numeric scoring, inverted percentage tokens, certified bounds, dynamic ranges, ANN and richer-index alternatives.
- [Measurements](GLOBAL-MEASUREMENTS.md): original and optimized timing/resource tables, storage, quantization and palette errors.
- [Query planner](GLOBAL-PLANNER.md): same-snapshot strategy selection, global-order checks and measured request overhead.
- [Work log](GLOBAL-WORKLOG.md): durable checkpoints, decisions and unfinished questions.
- `global-*-probe.json`: formula, native ordering, filter, pagination, tie and snapshot evidence.

Changes are isolated under `experiments/color-search-benchmark/` and Makefile targets. These are scratch indexes and throwaway prototypes, ready for inspection rather than a production migration.

# Cutoff profiles: projected-field scale experiment

The mixed workload passed for hard, feather and core/halo, but dedicated concurrent five-color queries exposed additional failures. **No production winner is established.** Consensus failed even serially; two of the six non-consensus burst variants stayed below one second at C16 in this short run. Every result below concerns a reduced field projection.

## Scope

This experiment measures native OpenSearch query work on 100,000 and one million synthetic descriptor mixtures. **It indexes only the fields used by the workload: 180 numeric fields, versus 30,720 color fields in the full 1,024-bucket representation.** It does not measure full-index storage, indexing cost, memory consumption, cache pressure, or production capacity.

All bucket variants query the same projected index, `color-exploration-cutoff-projection-scale-v1`. Differences reflect selected anchors and query structure; they are not comparisons of four fully populated physical indexes.

## Campaign

The coordinated campaign started on 2026-09-21 after real-corpus feedback, integration testing and browser QA finished. It uses the isolated OpenSearch node at port 19217. The real-corpus node at 19216 and visual services remain available. There is no overlapping benchmark campaign.

Artifact directory:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/cutoff-scale/2026-09-21T19-18-49.670Z/`

The mixed campaign completed at 19:25:52 UTC. Its `scale.json`, `requests.jsonl`, `resources.jsonl`, source snapshots and external checkpoint retain every request and failure. The separate dedicated five-color burst ran from 19:26:26 to 19:29:18 UTC, after the mixed campaign and a 1.2-second local test run. Its artifact directory is `heavy-2026-09-21T19-26-26.601Z/` beneath the main directory.

Both campaigns are complete. The scale node was stopped through `make color-exploration-scale-stop`; its stopped state was verified at 19:30:24 UTC. The one-million-document index remains on disk. The real-corpus node returned green health, and ports 8225, 8226 and 8227 returned HTTP 200 after shutdown. No benchmark or agent work for these campaigns remains active.

OpenSearch 2.11.0 runs with a 4 GiB Java heap in a container with an eight-CPU quota and 12 GiB memory limit. The JVM reports 32 visible/allocated processors; that does not remove the container's eight-CPU quota. Container limits are recorded in `container-limits.json`. The driver uses Node v22.22.3.

## Mixed-workload results

There were **4,272 timed requests and 768 warmups**, across 178 executed concurrency profiles. Nineteen distinct requests failed the strict criterion: five timed errors, ten timed responses at or above one second, one warmup error and five slow warmups; these categories overlap for two timed requests. All failures occurred at one million documents and were unfiltered five-color consensus queries.

- **100,000 documents:** all 96 profiles passed.
- **One million documents:** all 72 hard/feather/core-halo profiles passed this mixed workload.
- **Consensus:** all eight million-document variants failed at some tested load. Seven failed serially; the 1,024-bucket, 0%-cutoff variant passed C1/C4 and failed C16. Fourteen higher-concurrency profiles were skipped after earlier failures.

The workload is two-thirds selective-filter queries and includes only two timed unfiltered five-color requests per concurrency profile. A pass therefore does not establish capacity for simultaneous expensive queries; the separate burst below addresses that gap.

### One-million-document mixed workload, 50% cutoff

All latency columns are milliseconds. p95 uses successful timed responses; maximum includes errors. A dash means higher concurrency was skipped after serial failure. Pass/fail also includes warmups.

| Profile | Buckets | C1 p95 | C4 p95 | C16 p95 | Maximum timed | Strict result |
|---|---:|---:|---:|---:|---:|---|
| Hard | 16 | 321.22 | 333.11 | 340.39 | 343.35 | Pass |
| Hard | 64 | 319.50 | 321.56 | 333.34 | 336.18 | Pass |
| Hard | 256 | 316.46 | 313.32 | 322.56 | 334.27 | Pass |
| Hard | 1,024 | 313.37 | 323.07 | 317.62 | 329.18 | Pass |
| Feather | 16 | 313.42 | 320.17 | 327.03 | 341.53 | Pass |
| Feather | 64 | 312.18 | 315.85 | 328.01 | 329.07 | Pass |
| Feather | 256 | 307.67 | 312.01 | 311.10 | 336.84 | Pass |
| Feather | 1,024 | 305.93 | 309.82 | 326.32 | 333.02 | Pass |
| Core/halo | 16 | 317.78 | 321.25 | 323.24 | 330.65 | Pass |
| Core/halo | 64 | 313.83 | 312.31 | 331.31 | 332.37 | Pass |
| Core/halo | 256 | 310.81 | 311.35 | 334.29 | 334.97 | Pass |
| Core/halo | 1,024 | 315.85 | 312.70 | 340.13 | 351.74 | Pass |
| Consensus | 16 | 1,006.93 | — | — | 1,018.49 | Fail at C1 |
| Consensus | 64 | 984.69 | — | — | 1,018.17 | Fail at C1 |
| Consensus | 256 | 999.98 | — | — | 1,020.80 | Fail at C1 |
| Consensus | 1,024 | 987.73 | — | — | 1,030.11 | Fail at C1 |

### Projected-index observations

The first 100,000 documents indexed and refreshed in 14.71 seconds; the next 900,000 took 134.12 seconds. At the million-document stage, the driver waited 55.17 seconds for active merges to settle. Pre-query projected-index storage was 4,175,171,316 bytes across 23 segments, versus 321,878,054 bytes across two segments at 100,000 documents. **These are measurements of the 180-field projection, not forecasts for the full schema.**

After both campaigns, the index contained exactly 1,000,000 documents, zero deleted documents and zero active merges; storage was 4,175,170,742 bytes across 24 segments. The final state is recorded in `final-index-stats.json`.

## Dedicated unfiltered five-color burst

This follow-up removes the selective queries that diluted the mixed workload. It uses the same existing projection index and unchanged native query builder, with only the unfiltered five-color 20%-each query. The four profiles use 256 and 1,024 buckets, a 50% cutoff, one serial warmup per variant, and **32 requests per C1/C4/C16 block**. There were 640 timed requests and eight warmups across 20 executed blocks; four consensus C4/C16 blocks were skipped after serial failure.

All six non-consensus variants passed C1 and C4. At C16, four failed and two passed this short block. Both consensus variants failed C1. The 648 total requests contain **81 distinct strict failures**: 59 timed errors, 56 timed responses at or above one second, one warmup error and one slow warmup. Error and slow-response counts overlap and must not be added.

| Profile | Buckets | Highest tested load | p95 ms | Maximum ms | Timed errors / 32 | Timed ≥1s / 32 | Strict result at that load |
|---|---:|---:|---:|---:|---:|---:|---|
| Hard | 256 | C16 | 1,070.62 | 1,138.17 | 4 | 9 | Fail |
| Hard | 1,024 | C16 | 1,058.07 | 1,129.40 | 1 | 9 | Fail |
| Feather | 256 | C16 | 854.31 | 869.66 | 0 | 0 | Pass |
| Feather | 1,024 | C16 | 964.31 | 1,006.28 | 1 | 1 | Fail |
| Core/halo | 256 | C16 | 906.30 | 1,016.71 | 1 | 1 | Fail |
| Core/halo | 1,024 | C16 | 903.54 | 939.83 | 0 | 0 | Pass |
| Consensus | 256 | C1 | 1,024.23 | 1,025.36 | 20 | 18 | Fail |
| Consensus | 1,024 | C1 | — | 1,015.04 | 32 | 18 | Fail |

The last row has no successful responses, so its p95 is undefined. All p95 values use successful responses only; maximum includes failures. The 256-bucket consensus warmup also exceeded one second; the 1,024-bucket consensus warmup timed out.

Passing feather-256 and core/halo-1,024 blocks leave limited margin and do not establish a stable ordering between these variants. There are only 32 repeated requests per block, one query composition and a projected schema. The important finding is that a filtered mixed workload can hide heavy-query failures; it is not evidence to choose one bank or kernel for production.

### Receipts and checks

Both raw `requests.jsonl` files retain every timed request and warmup, including timeouts and slow successful responses. Independent aggregation reproduces the profile counters and strict results; request/profile counts agree. Each directory includes `raw-accounting-audit.json`: all 178 mixed profiles and 20 heavy profiles match their raw rows, with no mismatches. Source snapshots preserve the main driver and dependencies, and the follow-up saves its own immutable source alongside the linked main snapshots. No scoring, extraction or main-campaign source changed during either run.

The artifact root also contains `color-cutoff-scale-campaign.log`, `color-cutoff-heavy-campaign.log`, `color-cutoff-scale-dry-run.json`, `color-cutoff-scale-green.log`, `color-cutoff-heavy-tests.log`, `container-limits.json`, `final-index-stats.json`, `scale-stop.log` and `stopped-container-state.json`. The between-campaign offline suite passed 28 tests with three service checks skipped; the subsequent full integration run passed **31 tests with zero skips**.

## Workload and failure criterion

- Four profiles: hard cutoff, linear feather, full core with soft halo, and consensus across cutoffs.
- Four banks: 16, 64, 256 and 1,024 unchanged anchors.
- Two cutoff settings: 50% as the primary comparison, and 0% as broader support stress. Consensus also reads the next two stricter cutoff levels.
- Twelve queries per variant: one picked-color vibe, one-color 40% proportions, two-color 50%/50%, and five-color 20% each, with each query unfiltered, restricted to a 10% partition, and restricted to a synthetic 1% tag.
- Serial warmup of all twelve queries; two timed repetitions at concurrency 1, 4 and 16. Each concurrency profile has 24 requests; this is a short diagnostic run.
- Compilation through decoded service response is timed. A request error, partial response or latency **at or above one second** fails the tested profile. Warmup failures also fail it.
- Native query timeout: 950 ms. Client timeout: 1,500 ms. The driver drains outstanding requests and checks the search queue before proceeding. Higher concurrency for a variant is skipped after a failure, and that omission remains explicit.

OpenSearch executes filtering and global ranking. The client records results and checks expected hit counts without reranking wallpapers.

## Data and provenance

All 545 source assets are represented: 523 real wallpapers, including the original collection and all archive wallpapers, plus 22 controlled fixtures. The scale data are deterministic mixtures of measured descriptors, **not one million independent photographs or additional accuracy judgments**.

Source preparation reads each hashed cutoff descriptor individually, reproduces its complete indexed document, verifies hard-50% parity with the original overlap measurements and reproduces the all-values verification receipt. Only then does it retain the queried fields. The source values hash is `1f171f40fbfadeebc7d3b887298ff1321ab5981db4eba3d8e11e7632aa23eecf`.

For both physical and effective coverage, the existing mixture generator combines area and quality mass separately:

```text
area = w × areaA + (1 − w) × areaB
qualityMass = w × areaA × qualityA + (1 − w) × areaB × qualityB
quality = qualityMass / area
```

Coverage is rounded to basis points and quality to float32. Quality is zeroed when rounded synthetic coverage is zero. The projection includes paired quality fields for every physical coverage field needed by diagnostics, as well as the fields queried for scoring. Independent regions are never normalized into an exclusive palette. Synthetic tags and partitions model selectivity without fabricating subjects.

Source hashes, query workload, selected field names, mapping, seed, complete source receipt and projected descriptor hash bind the scale index identity. Resume checks reject changed identities, unexpected mappings and inconsistent document counts. A deterministic partial bulk can be replayed within the last recorded batch; unrelated indexes are never replaced.

## Reproduction

```sh
# Source verification and payload estimate only; no service requests.
make color-cutoff-scale COLOR_CUTOFF_ARGS='--dry-run'

# Coordinate a quiet benchmark window before starting the isolated node.
make color-exploration-scale-up
make color-cutoff-scale
make color-cutoff-heavy
make color-exploration-scale-stop
```

The dry-run verified all sources in approximately 7.6 seconds. Its first 100 generated projection documents averaged 5,874.89 serialized JSON bytes. This is a transport estimate, not index storage. The default driver uses `--counts 100000,1000000 --concurrency 1,4,16 --repeats 2`; other supported controls include `--bucket-counts`, `--profiles`, `--cutoffs`, `--resume`, `--directory`, `--batch-size` and `--rerun`. The heavy helper requires the main campaign's completed one-million-document artifact, verifies its source and index identity, and never adds or modifies index documents.

## Interpretation limits

The limited anchor workload and repeated source structure can produce favorable cache/compression behavior. The projected schema omits most fields that a production index would retain. Successful brief closed-loop requests do not establish sustained arrival-rate capacity, constant query time, or 100-million-wallpaper behavior. Whole-node CPU includes background work, and one-second memory polling may miss peaks.

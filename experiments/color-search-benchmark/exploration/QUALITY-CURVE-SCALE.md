# Linear versus power quality: retained-index performance comparison

**Both curves passed every tested C1/C4 block on the retained one-million-document projection.** Power was slower: five-color C1 medians were approximately 407–417 ms versus 275–282 ms for linear. The maximum timed request was 445.63 ms. This short projected-index experiment does not establish full-schema or C16 capacity.

## Status

The coordinated live campaign ran on 2026-09-21 from 20:04:25 to 20:05:49 UTC after feedback and UI checks finished. All **32 profiles passed**, with **512 timed requests, 16 warmups, zero errors and zero requests at or above one second**. No blocks were skipped or rerun. The maximum warmup was 428.41 ms.

Artifact directory:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/quality-curve-scale/2026-09-21T20-04-25.158Z/`

The scale node recovered to green before the run. Its retained index passed the one-million-document count, mapping and source-identity checks. Scoring and extraction sources stayed frozen during measurement. The helper and four focused tests passed before the run.

The isolated node was stopped through Make after completion, with `Running=false` confirmed at 20:06:40 UTC. The real-corpus node at 19216 remained green, and the comparison/inspector services at 8225, 8226 and 8227 returned HTTP 200. No benchmark work remains pending.

## Measured latency

All values are milliseconds. C1 columns show medians; C4 columns show p95. With only 16 timed samples in a block, the nearest-rank p95 equals that block's maximum, so it should not be read as a stable population percentile.

| Query | Membership | Buckets | Linear C1 median | Power C1 median | Linear C4 p95 | Power C4 p95 |
|---|---|---:|---:|---:|---:|---:|
| One red vibe | Hard | 256 | 39.16 | 59.11 | 48.20 | 68.79 |
| One red vibe | Hard | 1,024 | 34.99 | 61.14 | 41.25 | 77.45 |
| One red vibe | Feather | 256 | 34.43 | 61.10 | 42.70 | 72.34 |
| One red vibe | Feather | 1,024 | 33.12 | 60.67 | 39.47 | 75.46 |
| Five proportions | Hard | 256 | 279.28 | 416.94 | 291.31 | 422.59 |
| Five proportions | Hard | 1,024 | 275.29 | 411.02 | 291.27 | 445.63 |
| Five proportions | Feather | 256 | 281.92 | 411.21 | 290.13 | 422.13 |
| Five proportions | Feather | 1,024 | 280.43 | 406.94 | 287.48 | 433.06 |

The observed five-color median increase is approximately 45–49%. The one-color median increase is approximately 20–28 ms. These compare two different ranking curves within the same run; they do not isolate script overhead from changes in score distribution and search behavior.

Both curves remained below the required one-second ceiling at the tested C1/C4 loads. No C16 test was part of this campaign. [The earlier dedicated five-color campaign](CUTOFF-SCALE.md) exposed C16 failures for several linear variants; this follow-up does not supersede those failures or prove that power can handle the same higher concurrency.

## Scope and protocol

The comparison reuses the existing one-million-document index `color-exploration-cutoff-projection-scale-v1`; it does not reindex or alter earlier campaigns. That index stores 180 numeric fields selected for a fixed workload. This measures query execution on a reduced projection, **not full-schema capacity or one million independently photographed wallpapers**. [Original scale experiment](CUTOFF-SCALE.md)

- Hard and feathered pixel membership, with 256 and 1,024 buckets.
- Pixel cutoff 0%, quality influence 3×, minimum wallpaper quality 0%.
- Linear and power quality curves: eight variants total.
- One picked-red vibe query and one unfiltered five-color proportion query, each measured in a separate block.
- Sixteen timed requests per block at C1 and C4, plus one serial warmup for each query/variant pair.
- A maximum of 32 concurrency profiles and 512 timed requests. Higher concurrency is skipped only when that specific query/curve case fails.
- Server timeout 950 ms, client timeout 1,500 ms. Errors, partial responses and latencies at or above one second—including warmups—fail strict viability.

Filtering and ranking remain global inside OpenSearch. At influence 3, linear uses native quality functions and power uses a parameterized Painless quality function. The dry-run generated eight query cases of each form. This comparison deliberately changes the ranking curve; accuracy is evaluated separately in the feedback loop.

Queries are grouped by method, bucket count and query type, with linear followed by power. Results must remain separate by query so inexpensive single-color requests cannot hide slower five-color requests. The short, fixed-order blocks are diagnostic evidence, not stable production capacity estimates.

The environment is OpenSearch 2.11.0, a 4 GiB Java heap, an eight-CPU container quota and a 12 GiB container memory limit, on the same shared host as the earlier experiment. The JVM sees 32 processors; the container quota is the effective CPU limit.

## Provenance

The retained index identity is `e81ce8afae89e85c9016c9190f10f8a5d084c30bc6cfa7e8c94594cd484ece18`. The helper verifies the completed original artifact and checkpoint, then checks the live document count, mapping and stored source identity immediately before measurement.

Region geometry, extraction and synthetic descriptor generator hashes must still match the original campaign. Query source hashes are intentionally allowed to differ: the new run snapshots `quality-curve.mjs`, the changed query builders and all benchmark/query dependencies separately. Earlier source snapshots and request records are retained unchanged. Every compiled query and its required fields are saved with the new run.

The final index still has exactly 1,000,000 documents and zero deleted documents. Observed storage was 1,579,624,711 bytes across 14 segments, with zero active merges. This physical layout differs from the earlier campaign's final storage/segment observation; the helper performs no indexing or force-merge operation. Every recorded settling observation reported zero active merges. Use the paired comparisons in this run rather than attributing absolute latency changes between campaigns solely to the new curve.

## Raw evidence and audit

The external artifact contains `scale.json`, all 528 raw rows in `requests.jsonl`, compiled query plans, frozen source snapshots, the campaign log, offline test/dry-run receipts, container limits and verified stopped state. `audit-raw.jq` reproduces the accounting from the raw file; `raw-accounting-audit.json` confirms all 32 profile counts, error/slow counts, medians, p95 values, maxima, request ordinals and strict pass flags. There are no mismatches or incorrect slow-response flags.

A separate read-only agent audit independently confirmed the complete accounting. The raw artifact inherits a generic limitations sentence mentioning C1/C4/C16 from the earlier driver; its configuration and actual profiles test **only C1/C4**. That historical text is preserved without rewriting frozen results. Some short native-query blocks have zero cached whole-node CPU deltas, so these observations do not support comparative CPU ratios.

## Reproduction

```sh
# Filesystem verification and compilation only; no service requests.
make color-quality-curve-test
make color-quality-curve-scale COLOR_CUTOFF_ARGS='--dry-run'

# Run only during a coordinated quiet performance window.
make color-exploration-scale-up
make color-quality-curve-scale
make color-exploration-scale-stop
```

The external run directory contains `quality-curve-scale-tests.log`, `quality-curve-scale-dry-run.json`, `quality-curve-scale-campaign.log`, `container-limits.json`, `scale-stop.log` and `stopped-container-state.json`. New runs write separate directories beneath the reusable `color-evaluation/exploration/quality-curve-scale/` store; earlier artifacts are never overwritten.

# Rank-feature scale results

Both indexed utility methods passed the recorded one-million-document workload, including six sustained 60-second profiles: **89,213 requests, no errors, and no latency at or above one second**. All recorded warmups passed too (maximum 58.14 ms).

This establishes performance for this synthetic corpus, workload and node. It does not establish 100-million-document behavior, population relevance, or production arrival-rate capacity.

## Environment and workload

- OpenSearch 2.11.0, one node and one shard, no replicas, eight allocated CPUs, 4 GiB heap, 12 GiB container limit.
- Index: `color-exploration-rank-feature-scale-v1`, `_source` disabled.
- One million deterministic descriptor mixtures from all 545 source assets; these are not one million independent wallpapers.
- Original sixteen-query performance workload: thirteen supported named-color/proportion/vibe cases and three explicitly unsupported picked-color/range cases. It includes 10% and 1% metadata-selectivity cases.
- Twenty results per query. All filtering and ranking occur in OpenSearch. The rank-feature objective is globally evaluated; there is no application-side candidate ranking.

## Staged measurements

Each row used 52 timed requests. These short profiles establish initial behavior; the sustained profiles below provide more evidence.

| Documents | Method | C1 p95 | C4 p95 | C16 p95 | Strict result |
| ---: | --- | ---: | ---: | ---: | --- |
| 1,000 | Area | 2.71 ms | 6.21 ms | 15.39 ms | Pass |
| 1,000 | Vibe | 3.37 ms | 4.43 ms | 12.12 ms | Pass |
| 10,000 | Area | 3.76 ms | 6.26 ms | 12.77 ms | Pass |
| 10,000 | Vibe | 3.87 ms | 3.69 ms | 10.39 ms | Pass |
| 100,000 | Area | 6.98 ms | 7.71 ms | 12.73 ms | Pass |
| 100,000 | Vibe | 8.33 ms | 7.56 ms | 13.44 ms | Pass |
| 1,000,000 | Area | 44.82 ms | 46.20 ms | 92.59 ms | Pass |
| 1,000,000 | Vibe | 45.98 ms | 45.76 ms | 61.27 ms | Pass |

C1/C4/C16 mean actual concurrent clients. The original thirteen supported queries repeat four times, so every profile has enough work to exercise sixteen clients.

## Sustained million-document measurements

| Method | Clients | Duration | Requests | p95 | Maximum | Requests/sec |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Area | 1 | 60.01 s | 4,115 | 42.10 ms | 48.97 ms | 68.57 |
| Area | 4 | 60.02 s | 15,644 | 45.60 ms | 67.79 ms | 260.64 |
| Area | 16 | 60.06 s | 23,164 | 157.22 ms | 267.86 ms | 385.66 |
| Vibe | 1 | 60.02 s | 4,465 | 42.15 ms | 52.14 ms | 74.39 |
| Vibe | 4 | 60.04 s | 16,899 | 45.67 ms | 84.17 ms | 281.47 |
| Vibe | 16 | 60.11 s | 24,926 | 158.49 ms | 259.53 ms | 414.68 |

At sixteen clients, the node consumed approximately eight CPU cores on average. Sustained p95 was substantially higher than the short initial C16 profiles, while every observed request remained below one second. This is closed-loop load: clients wait for their prior request before sending another. The separate arrival-load protocol measures scheduled traffic and queue delay.

## Indexing, storage and resources

Indexing all stages took **1,079.98 seconds (18.0 minutes)** in total. Individual additions took 1.26 s for the first 1k, 10.00 s for the next 9k, 92.19 s for the next 90k, and 976.53 s for the final 900k. Timing includes descriptor generation, JSON serialization, checkpoint writes, service indexing, refresh and count checks.

The post-test storage snapshot reports **12,433,295,009 bytes (12.43 GB decimal)**, forty-three segments and one active merge. This is provisional while merging continues. The immediate 1k store counter was stale and must not be used for extrapolation. The 100k snapshot was approximately 2.22 GB; merging changes the size materially.

The later **idle** snapshot after the arrival campaign reports **13,105,519,265 bytes (13.11 GB decimal)**, forty-five segments and **zero active merges**, with the exact one-million-document count reconfirmed. Use this later size for the settled index. Both observations are retained: `final-storage.json` contains the earlier provisional measurement and `idle-storage.json` contains the later idle measurement.

A background merge remained active during sustained measurements. It still had approximately 2.10 GB of input with an automatic throttle of 8.24 MB/s when the benchmark window was released. Node CPU and latency therefore include this interference. No indexing client or other benchmark client ran concurrently during the profiles.

Sampled OpenSearch heap peaks stayed below 2.94 GB decimal. The benchmark client used at most approximately 0.25 CPU core on average per sustained profile and reached 311,357,440 bytes of observed RSS (297 MiB). Client measurements include source descriptors, response handling and retained benchmark evidence; they are not direct measurements of a production gateway. One-second resource sampling does not capture every instantaneous peak.

## Artifacts and reproduction

All artifacts are outside the repository under:

```text
~/.local/share/wallpaperdb/color-evaluation/exploration/
  rank-feature-scale/2026-09-20T01-58-20.990Z/
    scale.json
    final-storage.json
    idle-storage.json
    requests.jsonl
    resources.jsonl
    sources/<source-hash>/
```

The saved source directories preserve the exact driver/query/generator sources for each invocation. The later completion-marker fix does not retroactively change those archived sources or the running experiment. Future reruns clear the overall completion marker before work and retain each previous invocation's completion.

After obtaining an exclusive port-19217 benchmark window:

```sh
make color-exploration-rank-scale
make color-exploration-rank-scale COLOR_EXP_ARGS='--counts 1000000 --rerun --duration-seconds 60'
```

The existing index is resumable and is never silently replaced. Replaying smaller stages requires a new isolated index name via `--index`; an existing million-document index cannot be labeled as a smaller corpus. `--dry-run --samples 100` only measures local descriptor generation/serialization and makes no service requests.

Accuracy, unsupported cases and the utility definitions are documented separately in [RANK-FEATURE-NOTES.md](RANK-FEATURE-NOTES.md) and the consolidated findings. These scale results do not eliminate the named-profile method's missing arbitrary-color controls or missing joint palette-purity objective.

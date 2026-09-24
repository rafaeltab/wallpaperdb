# Color-query exploration

This is an isolated prototype and evaluation workspace. Wallpaper filtering and final ranking run in real OpenSearch, with one focused ClickHouse comparison for precise picked colors. JavaScript compiles queries, extracts offline descriptors, and records service results. No trained model or image embedding is used.

## Try it

**User's strong favorite:** [Strict hue snapshot 001](FAVORITE-SNAPSHOT.md) — shade-aware + strict hue, cutoff weighting 1, original linear quality influence 0.5, with 256 and 1,024 bins as joint favorites. Exact settings and frozen source references are preserved for future comparisons.

**Favorite performance:** [Scale measurements and limitations](FAVORITE-PERFORMANCE.md) — one million synthetic descriptor records in real OpenSearch, concurrent and scheduled query loads, and full-schema indexing/storage pilots. The favorite's scoring and visual prototype remain unchanged.

- **[Visual comparison browser](http://zerotwo:8225/)** — choose multiple implementations and compare their wallpaper results.
- **[Combined quality slider](http://zerotwo:8228/strictness.html)** — tabs for the original independent controls and three/five linked quality choices, keeping the saved favorite in the middle. Uses separate compact indexes and 10% proportion steps. [Prototype record](LINKED-STRICTNESS-PROTOTYPE.md).
- **[Histogram inspector](http://zerotwo:8226/)** — click a wallpaper to inspect all 4,096 bins, query weights, score terms and bin-removal effects for the refined histogram method. [Inspector notes](HISTOGRAM-INSPECTOR.md).
- **[Overlapping-region inspector](http://zerotwo:8227/)** — switch between 16, 64, 256 and 1,024 overlapping coverage/quality pairs. Compare hard, feathered, core/halo and multiple-cutoff profiles. **All cutoffs** uses all five levels with adjustable equal-to-exponential score weights. Compare smooth power versus original linear quality influence. Open each bin's colors in the hue/lightness or hue/saturation modal, inspect score terms, adjust quality controls, and enable live queries. [Original representation](OVERLAPPING-REGIONS.md) · [Cutoff experiments](CUTOFF-PROTOTYPES.md) · [Quality curves](QUALITY-CURVES.md) · [All-cutoff weights](ALL-CUTOFFS.md).
- **[Consolidated findings](http://zerotwo:8225/findings)** — saved accuracy, coverage, scale failures and measurement limits.
- **[Feedback-loop reports](http://zerotwo:8224/)** — immutable individual runs.
- [Visual walkthrough](browser-WALKTHROUGH.md) — proportions, precise swatches, ranges, fixtures and unsupported controls.

The browser includes **523 real wallpapers**: all 105 prior sources and all 418 images in the supplied archive. An optional switch includes 22 controlled fixtures, for **545 indexed assets** in total. The archive, originals, thumbnails, extracted descriptors and generated scale documents live outside the repository at:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`

No original or downloaded wallpaper is committed. The original human responses remain unchanged.

## What is being compared

The registry contains **54 implementations: 53 using OpenSearch and one using ClickHouse**, plus separately reported parameter-sweep configurations. These include several refinements within each family. A typed implementation that preserves the same score is an execution experiment, not a new perceptual theory.

| Family | Question it tests | Main limitation |
|---|---|---|
| HSV cosine, raw/unit L2, Hellinger | Can changing vector distance improve the existing histogram approach? | Approximate retrieval can miss global best results; proportions are represented indirectly. |
| RGB vectors and perceptual kernels | Does finer color information improve perceived similarity? | Representation and query construction still influence the meaning of distance. |
| Area histograms and palettes | Does separating matching area from matching quality reflect the requested colors better? | Exhaustive scoring can be expensive; quantization and palette compression lose information. |
| Native named-area decay | Can indexed scalar features give fast target-percentage ranking? | Named vocabulary; a simple additive area objective misses some composition preferences. |
| Native utility postings | Can precomputed target-fit and vividness utilities use native indexed ranking? | More index storage, quantized utilities, and limited custom-color support. |
| Composition objectives | Can area error, color quality, excess and unwanted colors express closed and partial palettes? | Hand-authored preferences; interactions require careful evaluation. |
| Palette transport | Does assigning color mass to requested portions improve combinations? | More expensive service-side optimization and compressed source palettes. |
| Relative highlights | Does scene-relative contrast recognize dark wallpapers with small bright accents? | Additional descriptors; current preference evidence is narrow. |
| Exact indexed bounds | Can native indexes discard provably noncompetitive documents before exact scoring? | Weak bounds can still leave a large scan; multiple searches need a stable index view. |
| Hybrids | Can query-specific methods combine useful capabilities? | Every branch needs its own support, accuracy and performance evidence. |
| Native picked-color grid | Can interpolation between precomputed precise-color utilities extend fast indexed ranking to hex colors? | Approximation of the objective, a fixed radius/edge profile, and no proportions. |
| Overlapping coverage/quality regions | Can many independent pixel neighborhoods add precise colors and proportions to native scalar ranking? | Fixed radius, nearest-anchor approximation, and no recovery of union area from overlapping marginals. |
| Columnar palette scoring | Can ClickHouse execute the same exact picked-color palette objective more efficiently? | A second search service; currently only a single picked-color query is supported. |

Unsupported controls are reported explicitly. A method does not silently substitute a different query meaning. Tags and other eligibility constraints are service filters; this prototype does not introduce a semantic classifier.

## Evaluation contract

All implementations use the existing [feedback loop](../evaluation/loop/README.md). There are **37 logical judgment records**, including **35 image-based cases** and two conceptual examples without image rankings. The judgments come from one observer, reuse some images and include a quickly completed batch with explicitly uncertain comparisons. They are development evidence, not a held-out or population-wide accuracy estimate.

The main accuracy number is the average, across supported queries, of agreement with strict human preference pairs. Ties and uncertain-pair sensitivity remain visible in the saved reports. Unsupported or unjudged cases are not counted as wrong. Methods with different coverage cannot be compared by their headline percentage alone; the findings page also compares the same 20 HSV-supported cases when a method supports all of them.

Accuracy diagnosis uses a large result window so judged images can be compared inside the expanded corpus. Timed interactive requests ask for 20 results. Newly imported wallpapers remain unjudged. Separately measured ANN recall compares native retrieval with an exact OpenSearch reference for the same scoring objective; this measures retrieval loss, not human relevance.

Every new method and refinement must complete the feedback loop. Parameter sweeps remain separate from default configurations. Frozen run artifacts record configuration, corpus and dataset fingerprints, service version and source evidence. Later runs archive full source snapshots; the initial scale run lacks a startup source snapshot, which is disclosed rather than reconstructed as certainty.

## Scale and load

The interactive corpus runs on OpenSearch 2.11.0 at port 19216. A separate node at port 19217 has an eight-CPU quota, 12 GiB container limit and 4 GiB Java heap. Indexes have one primary shard and no replicas. ClickHouse runs separately at port 19218 with the same eight-CPU quota and 12 GiB container limit. Historical indexes and the application stack are preserved.

Scale tests use deterministic mixtures of the 545 source descriptors at 1,000, 10,000, 100,000 and 1,000,000 documents. These are **not one million independent photographs**. Repeated source structure and quantized values may make graph and postings performance optimistic. Synthetic relative-lightness values are interpolated performance inputs, not measurements of newly rendered images.

Two load measurements are kept separate:

1. **Concurrent clients:** a fixed number of clients sends another request after the previous one finishes. Increasing-duration runs test sustained throughput.
2. **Scheduled arrivals:** queries arrive at a configured rate regardless of earlier request completion. Latency includes dispatch delay; excess client work is rejected and counted as failure.

A request at or above one second fails the user's viability requirement. Service timeouts, HTTP failures, partial search responses, client rejections and warmup failures remain visible. Successful-request percentiles never excuse failed requests. Measurements apply only to the recorded query workload, filters, load and hardware; they do not establish 100-million-document or production capacity.

The scale node is shared by sequential campaigns. **Do not run indexing, recall diagnostics and performance workloads concurrently on it.** CPU counters may be cached; a zero delta over a short block does not imply zero CPU usage. Reported memory samples are observations, not guaranteed instantaneous peaks.

## Reproduce

Run commands from the repository root using Make. All generated artifacts stay in the external shared store.

```sh
make color-exploration-scale-up
make color-exploration-corpus
make color-exploration-index
make color-exploration-rank-index
make color-exploration-refinement-features
make color-exploration-refinement-index
make color-exploration-palette-bounds
make color-exploration-palette-cell-index
make color-exploration-precision-precomputed-index
make color-exploration-clickhouse-up
make color-exploration-clickhouse-index
make color-exploration-clickhouse-test
make color-exploration-precision-grid-index
make color-exploration-test
make color-exploration-test-integration
make color-exploration-evaluate COLOR_EXP_ARGS='--methods hsv-cosine-ann,native-area-linear,hybrid-indexed-typed --label comparison'
make color-exploration-summary
```

Index creation intentionally fails if that index already exists; reuse a validated index rather than overwriting an earlier experiment. Existing scale indexes cannot be relabeled as smaller corpora. Use their current count or new index names. Example measurements, to run **sequentially**:

```sh
make color-exploration-scale COLOR_EXP_ARGS='--counts 1000000 --methods native-area-linear --concurrency 1,4,16 --repeats 3'
make color-exploration-scale COLOR_EXP_ARGS='--counts 1000000 --methods native-area-linear --concurrency 8,32 --duration-ms 15000'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods native-area-linear --index color-exploration-scale-features-v1 --rates 50,200 --seconds 15'
```

The utility-postings index has a separate resumable campaign: `make color-exploration-rank-scale`. ClickHouse uses `make color-exploration-clickhouse-scale`; the picked-color grid uses `make color-exploration-precision-grid-scale`. Run heavy campaigns sequentially even across engines because they share the host. After benchmarking, `make color-exploration-scale-stop` frees the scale node’s memory while retaining its indexes; `scale-up` starts it again. The visual browser uses the separate real-corpus services. See [utility notes](RANK-FEATURE-NOTES.md), [sustained results](RANK-FEATURE-SCALE.md), [accuracy comparisons](ACCURACY-FINDINGS.md), [performance findings](PERFORMANCE-FINDINGS.md) and [recall diagnostics](RECALL.md) for method-specific evidence.

The browser runs under the user systemd manager as `wallpaperdb-color-exploration.service`, listening on `0.0.0.0:8225`. Restart it after registry changes. Its transient unit survives a chat session but must be recreated after reboot. `make color-exploration-browser` also starts it directly when the port is free.

## Continue the work

[PLAN.md](PLAN.md) is the durable checkpoint, including active jobs and remaining validation. [SOURCES.md](SOURCES.md) records execution references. Method-specific notes document formulas, representation loss, parity checks and refinement decisions. The external findings artifacts retain failed and superseded attempts; no production search choice has been made.

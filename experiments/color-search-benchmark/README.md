# Color search benchmark — experimental

**Current status: establish the evaluation feedback loop before narrowing methods.** Start with the [loop documentation](evaluation/loop/README.md), [submitted batch and caveats](evaluation/batch-001-results.md), and [color-query goals](COLOR-QUERY-GOALS.md). Use `make color-eval-run` to evaluate candidate configurations and `make color-eval-serve` to view saved runs on port 8224. The user corrected the premature shortlist: methods, combinations and parameter changes should be compared through the same loop. The [method discussion](METHOD-CHOICE-DISCUSSION.md) remains research input, and older experiments below remain historical evidence rather than an accepted architecture.

Question: **Does switching the current cosine comparison to L2 improve searches for wallpapers containing a substantial area of a selected color? If not, what does?**

This directory contains reproducible experiments, not a production feature. [FINDINGS.md](FINDINGS.md) records the initial cosine/L2 comparison; [GLOBAL-FINDINGS.md](GLOBAL-FINDINGS.md) contains the latest conclusions for exact proportions and global OpenSearch ordering. [HISTORY.md](HISTORY.md) identifies the previous discussion in issue #8; [RESEARCH.md](RESEARCH.md) records supported OpenSearch 2.11 comparisons and equations.

**Follow-up: exact color proportions.** For queries such as 40% green with the remainder unspecified, or 50% green / 50% red, see the [interactive proportion prototype](PROPORTIONS-README.md) and its [separate findings](PROPORTIONS-FINDINGS.md). Run `make color-proportions-serve` and open http://localhost:8220/proportions.html.

**Follow-up: color ranges and center preference.** Define separate RGB/HSV/HSL limits or an OKLab radius for each portion, with 100% center preference and 50% at the edge. See the [range prototype](RANGES-README.md), [findings](RANGES-FINDINGS.md), and [1M/100M scaling analysis](RANGES-SCALING.md). Run `make color-ranges-serve` and open http://localhost:8220/ranges.html.

**Historical follow-up: globally ranked OpenSearch prototypes.** Compare native coverage, indexed bounds, and original-pixel joint matching for up to five colors at **http://zerotwo:8221/global.html**. Start with [GLOBAL-FINDINGS.md](GLOBAL-FINDINGS.md), [options considered](GLOBAL-OPTIONS.md), and [actual million-document measurements](GLOBAL-MEASUREMENTS.md). This follow-up investigates globally complete results, source-pixel accuracy, query cost, and pagination instead of a capped service rerank. See [GLOBAL-UI.md](GLOBAL-UI.md) for startup commands and current limits.

## Run

From the repository root, with the normal workspace dependencies installed:

```sh
make color-benchmark
make color-benchmark-serve
```

Open **http://localhost:8220/report.html**. The first command downloads/verifies the pinned corpus, starts dedicated OpenSearch 2.11 and NATS containers, runs the production extraction/event projection code, evaluates all candidates, and builds the report. Originals and thumbnails stay in the ignored `corpus/` directory. Their URLs and SHA256 hashes are retained in `corpus-manifest.json`.

```sh
make color-benchmark-down       # stop only experiment containers
make color-benchmark-diagnose   # fast synthetic color/area checks
make color-benchmark-rank       # rerun evaluation on already projected data
make color-benchmark-report     # rebuild HTML from saved numeric results
```

`REQUIRE_SELF_MATCH=1 make color-benchmark-diagnose` intentionally fails against the unchanged production query to demonstrate the yellow→white mismatch.

The scratch services bind loopback ports **19215** (OpenSearch) and **14223** (NATS). Indexes are `color-benchmark-cosine`, `color-benchmark-l2`, and `color-benchmark-prototypes`. Containers belong to the current worktree's Compose project with a `-color-benchmark` suffix. Their data is disposable. Ordinary application services are not needed. The report server uses loopback port 8220.

## What runs through production code

`pipeline.ts` imports the actual upload publisher, color-extractor upload consumer, extraction processor, Sharp histogram provider, HSV strategy, color event publisher, gateway color consumer, and gateway repository. It publishes 100 upload events and checks 100 color events, acknowledgments, source hashes, and all projected histograms. It runs native gateway repository searches and checks scores and pagination.

The image reader reads local files instead of S3. Base wallpaper documents are seeded through the repository. Upload HTTP/auth/validation, the gateway HTTP/GraphQL layer, Redis, and the browser product UI are outside this experiment. This is a real NATS/OpenSearch pipeline with production color logic, not a complete deployment E2E test.

## Comparisons

- **Current behavior:** exact production query builder and 64-bin HSV extraction, Lucene HNSW cosine.
- **Previously suggested alternative:** Lucene HNSW L2 with unchanged query, then separately with a query normalized to sum to one.
- **Additional comparisons:** L1/intersection, L-infinity, Hellinger, narrower tolerance, and inner product on the existing descriptor.
- **New descriptor prototypes:** 512-bin RGB histogram with OKLab Gaussian query weights and native Faiss inner product; 32-color weighted OKLab palettes with application coverage ranking.

Every OpenSearch exact score is checked against the mathematical formula. Native cosine/L2 scores are checked separately because their score translations differ. Faiss candidate recall is measured against exact inner-product rankings. Scores from different methods are not directly comparable.

## Evaluation

The 100 actual wallpapers are separate from the synthetic diagnostic cases. There are 24 single-color queries and four two-color queries. Half the query names were assigned to a development split and half to a holdout split before results were evaluated.

Candidate extraction uses approximately 10,000 pixels, as production does. An independent relevance module examines a separate sample up to 256×256 pixels:

- **CIELAB coverage:** alpha-weighted pixel fraction within Euclidean ΔE76 distance 20, 30, or 40 of the selected color.
- **HSV coverage:** hue within 25 degrees, saturation within .3, and value within .3; neutral queries require low saturation and a value difference within .2.
- **Multiple colors:** weighted geometric mean of the per-color fractions; missing a requested color gives zero hard coverage. This evaluates containing every color, not exact palette proportions.

These are **automated proxies**, not human relevance labels. CIELAB and HSV evaluate candidates independently from their OKLab scoring, but no single formula fully captures visual judgment. Inspect the report's actual images and the recorded visual review. The holdout separates query colors, not images: both splits search the same 100 wallpapers, and holdout queries happen to have more available matches. It does not measure generalization to an unseen collection.

**nDCG@10** measures the ordering of the first ten results relative to an ideal ranking under the selected proxy (1 is ideal; linear coverage gain). **Precision@10** counts results with at least 10% proxy coverage of **each** requested color. The report also shows how many such matches exist, since some queried shades have few real matches. Queries with no positive relevance are excluded only from mean nDCG, while every query contributes to precision and coverage averages. `answerableNdcg10` restricts ranking evaluation further to queries having at least one substantial match. Raw scores are not percentages of matching area unless their formula explicitly has that meaning.

`results.json` retains complete rankings, per-wallpaper relevance, query vectors, configuration, native checks, and timing observations. `summary.json` is the compact aggregate. `output/` contains regenerable extraction evidence, descriptors, and diagnostics. This 100-image experiment does not establish production-scale search latency, memory use, or a user-approved strict filter threshold.

## Files and ownership

All prototype implementation lives here; production code is unchanged. The only root change adds Make commands. The corpus collection does not supply a blanket redistribution license; record and inspect sources locally rather than committing the downloaded artwork. Once a production design is selected, carry over its measured behavior and regression cases, then archive or remove this experimental runner.

# Color querying: accepted production direction

On **2026-09-24**, the user accepted the **three-option combined quality slider**
as the direction for a production implementation. The chosen approach retains
the shade-aware, strict-hue matching behavior they preferred, while moving score
calculation into indexing so OpenSearch can rank wallpapers efficiently.

This directory consolidates what the research established, what changed along
the way, and what still needs validation. It accompanies
[ADR 0004](../../docs/adr/0004-use-precomputed-color-utilities-with-three-quality-levels.md).
No production implementation, migration, or rollout is part of this change.

## Read this research

| Document | Purpose |
| --- | --- |
| [Research path](RESEARCH-PATH.md) | Why a vector-distance experiment became a study of perceived color, proportions, and global ranking. |
| [Selected method](METHOD.md) | The representation, matching behavior, three settings, score calculation, and indexed fields. |
| [Evidence and limits](EVIDENCE.md) | Accuracy, ranking fidelity, performance, storage, and the exact scope of each result. |
| [Production questions](PRODUCTION-QUESTIONS.md) | Decisions and validation required when production work begins. |

## The direction in brief

Each wallpaper is measured against **256 overlapping color neighborhoods**. A
pixel may contribute to several neighborhoods. The matching function gives dark
shades of a color more credit than the earlier distance metric did, while
requiring sufficiently similar hue. Five nested quality cutoffs retain both
matching area and average match quality. Named features support requests such
as dark or grayscale alongside picked colors.

Instead of calculating all of those score terms for every matching wallpaper
at search time, precompute the resulting scores for three quality preferences
and the supported requested amounts. A query selects the relevant scores;
**OpenSearch applies eligibility filters and produces the global ranking**.
The gateway must not retrieve a limited candidate set and then rerank it as
though that were the whole search result.

| Preference | Quality influence | Cutoff weighting |
| --- | ---: | ---: |
| Relaxed | 0 | 0 |
| Favorite / default | 0.5 | 1 |
| Strictest | 1 | 3 |

The original linear quality curve is retained. The middle position is the
saved favorite, not a replacement based on the highest aggregate evaluation
score. The combined control offers selected pairs of two different mechanisms;
the mechanisms are not mathematically interchangeable, and slider steps are not
equally spaced perceptual distances.

The starting representation has **10,044 numeric scores per wallpaper**:
256 color bins plus 23 named targets, each with an overall-vibe score and
0–100% target scores in 10% steps, for each of the three preferences. The field
count is exact. Million-record storage and concurrency for this particular bank
have **not** been measured.

## Product priorities and behavior

The user's priorities, in order, are perceived accuracy, responsive searches,
query flexibility, service CPU/memory, OpenSearch CPU/memory, then index storage.
Accuracy and speed are crucial. A query taking one second or longer fails the
research viability requirement; production validation must include load and
end-to-end behavior, not only successful OpenSearch response percentiles.

Users may ask for a general color impression, a named appearance, or multiple
whole-image target amounts. “40% green, rest unspecified” aims near 40%; an 80%
green image does not automatically improve that match. A partial request is not
renormalized to 100%. Color relevance works with separate tag/description
eligibility, rather than attempting to recognize every semantic concept through
colors alone.

The selected method remains an approximation of those wants. Its overlapping
marginal measurements do not allocate disjoint image regions, enforce palette
purity, or implement an accent/relative-highlight objective. Precise hex queries
also use the nearest indexed anchor. See the limitations in [METHOD.md](METHOD.md)
before treating a score as a literal pixel percentage or a complete composition
model.

## Preserved prototypes and evidence

The complete prototype archive was committed and pushed first as
[`30edcb2`](https://github.com/rafaeltab/wallpaperdb/commit/30edcb2a61e6c4cc915a61807210a3ab5e924d96)
on `t3code/improve-color-filtering`. This documentation branch builds on that
snapshot. Runnable sources, evaluation cases, submitted judgments, diagrams,
configuration, and historical findings live in
[`experiments/color-search-benchmark`](../../experiments/color-search-benchmark/README.md).

The [research evidence archive](../../experiments/color-search-benchmark/research-archive/README.md)
also preserves external research notes, audit scripts, frozen source bundles,
generated reports, and the exact favorite source tarball. Large reports use
lossless gzip compression; the inventory records original hashes and duplicate
locations. It includes failed and superseded runs. Downloaded wallpapers, the
supplied ZIP, screenshots, runtime indexes, and large raw measurement streams
remain external and are inventoried rather than included as image/data bytes.

The original September 21 favorite remains a historical reference for both
256 and 1,024 bins. Its statement that no production choice had yet been made
describes that date. This September 24 decision selects the later 256-bin,
three-option direction without rewriting that snapshot.

For local visual review, the [combined-slider prototype](http://zerotwo:8228/strictness.html)
compares original and linked controls over all **523 real wallpapers**; the
[original inspector](http://zerotwo:8227/) and
[optimization lab](http://zerotwo:8228/) remain separate tools. These are local
research services, not deployed product features.

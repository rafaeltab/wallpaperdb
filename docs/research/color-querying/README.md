# Color querying: accepted production direction

On 2026-09-24, the user accepted three linked quality preferences with 256
overlapping anchors, shade-aware strict-hue matching, five cutoff layers, and
precomputed numeric scores ranked globally by OpenSearch. Requested proportions
use 10% steps. [ADR 0006](../../adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md)
records the decision.

## Read this research

| Document | Purpose |
| --- | --- |
| [Research path](RESEARCH-PATH.md) | Experiments and feedback that led to the selection. |
| [Selected method](METHOD.md) | Measurements, query semantics, settings, formulas, and limitations. |
| [Evidence and limits](EVIDENCE.md) | Preference agreement, ranking fidelity, performance, storage, and measurement scope. |
| [Production decisions and validation](PRODUCTION-QUESTIONS.md) | Integration decisions, correctness checks, and deferred deployment evidence. |

## Product priorities and behavior

The research prioritized perceived accuracy, responsiveness, query flexibility,
service CPU/memory, OpenSearch CPU/memory, then storage. Queries taking one
second or longer failed the research viability requirement. The September 30
integration decision prioritizes correct values and rankings, then performance,
then responsibility split. It permits a fresh installation without migration or
backfill. Deployment capacity belongs to [#240](https://github.com/rafaeltab/wallpaperdb/issues/240),
not a million-record benchmark gate for [#266](https://github.com/rafaeltab/wallpaperdb/issues/266).

## The direction in brief

The selected bank has 10,044 utilities per wallpaper. Its million-record storage
and concurrent-query capacity remain unmeasured. Overlapping measurements do not
allocate exclusive regions, enforce palette purity, or implement accent and
relative-highlight objectives. Hex queries use the nearest stored anchor; see
[METHOD.md](METHOD.md) before interpreting scores as literal image percentages.

## Preserved prototypes and evidence

The prototype archive is preserved at
[`30edcb2`](https://github.com/rafaeltab/wallpaperdb/commit/30edcb2a61e6c4cc915a61807210a3ab5e924d96)
on `t3code/improve-color-filtering`. Pinned runnable sources, evaluations,
judgments, diagrams, configuration, and findings live in
[`experiments/color-search-benchmark`](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/README.md).

The [research evidence archive](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/README.md)
preserves external research notes, audit scripts, frozen sources, reports, and
the exact favorite source tarball, including failed and superseded runs. Large
reports use lossless gzip; the inventory records hashes and duplicate locations.
Wallpapers, the supplied ZIP, screenshots, runtime indexes, and large raw
measurement streams are inventoried externally; their bytes are not included.

The September 21 favorite preserves the 256- and 1,024-bin experiments before
the September 24 selection. Its statement that no method was selected is historical.

For local visual review, the [combined-slider prototype](http://zerotwo:8228/strictness.html)
compares original and linked controls over all 523 real wallpapers; the
[original inspector](http://zerotwo:8227/) and
[optimization lab](http://zerotwo:8228/) remain separate tools. These are local
research services, not deployed product features.

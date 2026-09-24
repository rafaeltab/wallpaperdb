# Round 1 — broad comparison

Run: `2026-09-20T00-50-38.374Z-32d2dbb7`, saved in the shared `color-evaluation/runs/` store. All16methods use real OpenSearch2.11 and the same545assets. Three timed top20 requests per supported case, plus a separate large-window diagnostic. No errors. Two conceptual cases have no image inputs and remain unsupported. Subject-case eligibility follows the supplied case condition; no semantic classifier is claimed.

Agreement below is **query-macro pairwise agreement on supported development cases**, not population accuracy. Different support counts are not directly comparable. The37logicalcases contain related images, one observer's preferences and a quick-pass caveat. Three precision cases and several vibe cases sharply distinguish support.

| Method | Supported /37 | Agreement | Small-corpus p95 ms |
|---|---:|---:|---:|
| HSV cosine ANN |20|.540|3.2|
| HSV raw L2 ANN |20|.540|3.0|
| HSV unit-sum L2 ANN |20|.515|3.8|
| HSV Hellinger ANN |20|.465|3.3|
| RGB512 Hellinger ANN |20|.487|4.0|
| RGB512 cosine ANN |20|.560|3.3|
| HSV cosine exhaustive reference |20|.540|3.1|
| Fine histogram weighted color mass |33|.654|471.3|
| Palette32 target area |33|.713|9.8|
| Fine histogram target area |33|.720|465.3|
| Fine histogram composition |33|.671|457.8|
| Indexed family area linear |32|.706|2.3|
| Indexed family area Gaussian |32|.706|2.7|
| Indexed area bucket postings |32|.704|2.8|
| Indexed feature composition |32|.679|2.3|
| RGB marginal Wasserstein |33|.493|11.4|

## Refinement directions supported by this run

- Preserve area-target objectives. On the same33supportedcases, plain histogram area has higher aggregate agreement than the initial composition objective. Large unwanted-color/quality penalties introduce regressions, especially with unspecified remainder. Investigate the tradeoff; do not discard the user's explicit closed-palette preference.
- Preserve quality-aware vibe/precision options. Weighted histogram mass has .789 perceived-color and .800 precision agreement, versus area-only .761 and .656. An intent-dependent combination is worth evaluating.
- Named indexed features are fast in the small corpus and cover vibe concepts; they lack precise picked-color/range support. Global hue-diversity features are distribution strengths, not literal pixel areas.
- Initial fine histogram scripts are already costly at545docs and fail the one-second threshold on many1000docscalequeries. Typed script optimization and indexed necessary bounds should be measured as separate implementations.
- L2 alone did not materially improve this development set. Hellinger and RGB marginal distributions also do not establish a general replacement. Retain them in the browser and scale comparison as actual alternatives.

## Next experiments

1. Exactly equivalent typed Painless histogram/palette queries, checked against all545scores.
2. Exact global feature scoring with safe indexed area bounds, verified against exhaustive scoring; no fixed candidate cap.
3. Palette optimal transport for exclusive portion allocation, with excess requested color charged in the remainder.
4. Sweep and combine amount/quality/purity objectives while preserving explicit intent diagnostics and category regressions. Add no fabricated labels to the new ZIP images.
5. Finish1000/10000/100000/1000000scaleprofiles, concurrentqueries and nativeANN recall references. Small-corpus speed is not million-document evidence.

## Known first-round limitations

Explicit custom range controls on vector candidates were found to be ignored by the initial compiler. They are being changed to explicitly unsupported; none of the37feedbackcases carries that explicit control, so recorded case behavior is unchanged. Broad grayscale and strict grayscale detail currently share the same provisional region unless the user explicitly selects `strict_grayscale`. Record this semantic distinction when refining it. The first run stores source hashes; subsequent runs additionally archive full prototype source text for replay.

# Typed direct-palette precision

`palette-precision-typed` implements the same objective as `palette-direct-precision` for one picked color in vibe mode with one OKLab radius. It keeps original RGB24 centroids, the same RGB-to-OKLab arithmetic, the same range boundary, conditional quality, and matching-area support threshold.

The implementation loads typed scalar parameters once per document. Its centroid loop contains the necessary RGB conversion, OKLab distance, and area/quality accumulation. It removes unused named-color, HSV, and HSL branches and repeated map/list reads from that loop.

`palette-precision-bounded-typed` uses this scorer for both the seed scoring and final global query of the existing palette-cell planner. The generic planner and reference remain available unchanged. Its new optional scorer callback defaults to the original direct-palette builder. See [PALETTE-BOUNDS.md](PALETTE-BOUNDS.md) for the necessary-bound proof and index consistency assumptions.

## Verification

`COLOR_EXPLORATION_PRECISION_TYPED_TEST=1 make color-exploration-test` passed 45 tests with 10 unrelated integration skips. The new integration check compared every score and ordered ID across all 545 assets, for six queries:

- Warm red, muted green, gray, and near black.
- Zero perceptual radius.
- An edge weight of 1, where all colors inside the range have equal quality.

All 3270 document scores and complete orders matched the generic service reference exactly. The bounded typed method also matched each reference's top 20. This establishes a behavior-preserving implementation refinement; its performance improvement and scaling must be measured separately.

## Feedback loop, round 8

Frozen run: `2026-09-20T01-39-31.955Z-22f2b24e`, over all 545 assets.

| Candidate | Supported image cases | Query-macro pairwise agreement | Timed requests | p95 latency |
|---|---:|---:|---:|---:|
| `palette-precision-typed` | 3 | 0.7944 | 15 | 7.11 ms |
| `palette-precision-bounded-typed` | 3 | 0.7944 | 15 | 18.87 ms |
| `hybrid-indexed-typed` | 35 | 0.7548 | 175 | 14.11 ms |

All requests succeeded. The two precision methods retain the generic precision agreement. The new hybrid routes supported picked-color queries to bounded typed precision and every other request to `hybrid-relative-accents`; the existing hybrid remains available. Its agreement matches the previous indexed hybrid. Coverage differs substantially between the precision-only methods and the hybrid, so their aggregate agreement values are not a direct contest.

These are real-corpus, single-client timings. The extra seed/bound requests cost more than a simple exhaustive scan on 545 documents; the scale benchmark must determine whether pruning pays off on a larger index. New ZIP images remain unjudged, and the human preferences remain single-observer development evidence.

The browser service was restarted after registration. Its metadata lists all three new methods among 38 available prototypes and retains 523 real wallpapers plus 22 optional fixtures.

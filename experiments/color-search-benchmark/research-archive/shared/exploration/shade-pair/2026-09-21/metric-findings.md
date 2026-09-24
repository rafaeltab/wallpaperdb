# Pagoda versus orange sky: hue diagnostic

2026-09-21. Read-only diagnosis and pixel counterfactuals. Existing indexes and gallery ranking remain unchanged. Source code: `shade-pair-probe.mjs`; machine-readable observations: `pixel-variants.json`; command: `make color-shade-pair-probe COLOR_SHADE_ARGS='--variants'`.

## Reproduced failure before experimenting

Identified originals are `madness-wallhaven-ogg7ql` (red pagodas) and `wallpaper-031` (orange/yellow sky). The independent replay agent reproduced the undesired ordering in 20 of 24 real OpenSearch settings (four banks, influence 1/3, cutoff blend 0/3/6). At influence 1 and blend 3, pagodas rank 101 with score .021471864; sky ranks 61 with .033415463. The user's exact 93/61 setting was not recovered; the meaningful ordering failure was.

The pixel probe used the retained originals and the same 128×128, sRGB, alpha-to-black preprocessing as indexing. Every hard-layer coverage and float32 conditional quality exactly matched the actual shade-aware index for both images and the two previous red-portrait controls. The diagnostic baseline scores agree with live scores up to service score rounding.

The user's clarified request is **stricter hue similarity**, not reducing hue's penalty. The tested alternatives follow that clarification.

## What causes the ordering

The current squared shade distance can be decomposed exactly into lightness, chroma magnitude, and hue angle. The polar identity is `||ab-atbt||² = (C-Ct)² + 2*C*Ct*(1-cos(h-ht))`, applied separately to the raw and normalized chroma terms. Algebraic closure against the frozen metric was checked for every sampled pixel.

For pixels admitted by the current broadest layer:

| | Pagodas | Orange sky |
| --- | ---: | ---: |
| Admitted physical area | 44.93% | 39.23% |
| Conditional quality | 20.45% | 30.25% |
| Mean OKLab hue gap | 10.86° | 32.58° |
| Lightness share of squared distance | 14.64% | 2.89% |
| Chroma-magnitude share | 82.51% | 60.60% |
| Hue-angle share | 2.86% | 36.50% |

The pagodas already have more broadly admitted area. Their subdued reds lose most of their quality through chroma-magnitude mismatch. The orange sky has a larger hue mismatch but still gets higher aggregate quality and more area above stricter cutoffs: 23.35% versus 13.84% above quality 25%, and 5.68% versus .99% above quality 50%. Thus raw amount alone does not explain this pair; the current balance between chroma magnitude and hue is central. These pixel groups and areas are diagnostic measurements, not human segmentation labels.

## Controlled interventions

All probes preserve the current shade metric's lightness, chroma-magnitude and near-black behavior. They keep influence and blend settings fixed within each comparison.

1. Multiply the angular distance by 1.5, 2 or 3 (squared angular term multiplied by the square of that factor).
2. Apply an explicit smooth hue gate to baseline pixel quality. A 15° full-quality core fading to zero at 45° was compared with a 10° core fading to zero at 30°. Angles are circular OKLab hue angles, not HSV degrees. `gate = smoothstep((edge - gap)/(edge - core))`; midpoint quality is halved. Finite support also requires a positive gate.

| Candidate | Pagoda wins / six settings | Pagoda score, influence 1/blend 3 | Sky score, same setting |
| --- | ---: | ---: | ---: |
| Current shade metric | 1/6 | .021472 | .033415 |
| Angular ×1.5 | 3/6 | .020108 | .020531 |
| Angular ×2 | 6/6 | .019662 | .007301 |
| Angular ×3 | 6/6 | .018759 | .000685 |
| Hue gate 15°–45° | 1/6 | .021402 | .027934 |
| Hue gate 10°–30° | 6/6 | .021107 | .013553 |

The six settings are influence 1/3 × blend 0/3/6. These are offline objective values for this pair, **not global-rank predictions**. None was used to serve or reorder gallery results.

## Preserve earlier preferences

At influence 1/blend 3, the 10°–30° gate keeps the dark-red portrait's score .144401→.144404 and the softer-red portrait .089130→.089052. The 2× angular candidate lowers the softer portrait to .082977, about 6.9% below its prior score. A conditional mean can increase slightly after low-quality pixels leave its support, even though no pixel gained quality; the unchanged ranking formula allows that behavior.

Controlled pixel qualities against #FF0000:

| Pixel | Current | Angular ×2 | Hue gate 10°–30° |
| --- | ---: | ---: | ---: |
| #FF2200 | .9468 | .9260 | .9468 |
| #A00000 | .7051 | .7051 | .7051 |
| #800000 | .5990 | .5990 | .5990 |
| #B53738 soft red | .6384 | .6147 | .6384 |
| #642B2A subdued red | .3206 | .3076 | .3206 |
| #FF6600 warm orange | .6394 | .4609 | .5649 |
| #FF8000 orange | .4792 | .1854 | .1111 |
| #FFA500 yellow-orange | .2467 | 0 | 0 |
| #FF8080 pale pink | .4923 | .4591 | .4923 |
| #FF0080 magenta-red | .5033 | .0074 | .0353 |
| #805030 brown | .2406 | .1099 | .0497 |
| #808080, #202020, black | 0 | 0 | 0 |

The user's earlier broad preference for orange over pink requires care. The 2× angular candidate almost erases the advantage of warm #FF6600 over #FF8080; 3× reverses it. The 10°–30° gate retains a clearer margin for that warm orange, while intentionally demoting yellower oranges. This is not a claim that every orange must outrank every pink.

## Recommended next prototype

The **10° full-core / 30° outer-edge hue gate** is the most promising next controlled candidate from these probes. It directly expresses stricter hue admission, preserves near-red precision and both earlier portraits, and corrects this pair without increasing quality influence. Keep the existing shade-aware method available for comparison. Preserve neutral anchor behavior by blending gate strength with the existing target chromatic-strength transition; don't apply hue gating to pure grayscale targets.

This is a provisional parameter choice based on one new pair and limited controls. It needs fresh offline measurements in a separate versioned index, real OpenSearch execution, the full feedback loop, and checks across other target hues, muted colors, proportions, and near-neutral anchors. The existing five-layer query structure can remain the same; this probe establishes no new latency or production-scale claim. More elaborate saturation/lightness tuning is not justified by this pair alone.

## Subsequently authorized implementation

The root agent authorized this additional prototype after reviewing the reproduced failure and counterfactual evidence. `hue-definition.mjs` reuses the frozen shade metric and multiplies its quality by `(1-s)+s*gate`, where s is the unchanged anchor chromatic strength and `gate=smoothstep((30-hueGapDegrees)/20)`. Neutral anchors bypass hue computation entirely. The metric is `shade-hue-aware`; existing shade-aware and original indexes remain intact.

`hue-index.mjs` measures five hard cutoffs in fresh `color-exploration-shade-hue-{16,64,256,1024}-real-v1` indexes, using the same provenance, create-only resume, single-document bulk, and flush-every-25 safeguards as the earlier shade build. Metric source identity is frozen at `334de5f444ac67fb606b`; artifact root is `exploration/hues/334de5f444ac67fb606b`. Hue coordinates cache chroma once per input color; this changes no formula. The source list includes the unchanged shade-definition dependency.

Before indexing, `make color-hue-test` passed 13 tests with one real-index integration skip. Tests cover every exact anchor, neutral parity, circular hue wrap, gate core/midpoint/edge, finite support, controlled probe predictions, direct pixel/descriptor parity at every anchor/layer, projections, and malformed inputs. Parent agents own subsequent service integration, feedback and browser validation.

### Completed new-index build and preservation audit

`make color-hue-prepare` completed with all 545 corpus IDs and every indexed value verified in all four banks. Extraction took 253.497 seconds. Initial index receipts:

| Bank | Index + verification | Stored bytes at receipt |
| --- | ---: | ---: |
| 16 | 1.837 s | 1,743,562 |
| 64 | 2.794 s | 8,249,866 |
| 256 | 6.558 s | 31,272,146 |
| 1024 | 27.447 s | 179,416,487 |

Stored bytes are immediate segment-state observations, without a force merge; background merging can change them. These timings describe preparation, not search latency.

`make color-hue-audit` independently compared hashed checkpoints: **2,790,400 hard-layer coverage values** were all less than or equal to the prior shade-aware measurements, as required by narrower admission. **87,200 neutral-anchor coverage and quality values** were exactly unchanged, with zero differences. Source snapshots, corpus image identities, checkpoint manifests, and every descriptor hash were checked. Audit receipt: `exploration/hues/334de5f444ac67fb606b/hue-subset-audit.json`. Existing indexes and frozen source files remain unchanged. All preparation jobs are complete; parent agents continue real-query integration, feedback evaluation and browser verification.

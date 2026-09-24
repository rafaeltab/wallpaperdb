# Strong favorite: strict hue snapshot 001

Recorded 2026-09-21. **User-endorsed reference version to preserve during future experiments.** This records a subjective favorite, not a production choice or a claim of universal accuracy.

Snapshot ID: `strict-hue-favorite-001`.

## Settings the user liked

| Control | Recorded preference |
|---|---|
| Method | **All cutoffs: shade-aware + strict hue** (`cutoff-shade-hue-all-levels`) |
| Cutoff weighting | Keep adjustable; favorite **1** |
| Quality influence | Keep adjustable; current optimum **0.5 using Original linear penalty** |
| Quality versus coverage | Aim for a result where both feel similarly important; this is a perceptual goal, not a mathematical equal-weight claim |
| Curve experience | Likes using **Smooth power**, but its 0.5 setting does not reproduce the preferred linear result |
| Bin counts | **256 and 1,024 are joint favorites**; user does not notice a large difference between them |

Do not silently substitute power 0.5 for linear 0.5. Do not promote one favored bank over the other based on this feedback. Keep the endorsed version accessible when creating further variants; a new curve should have a separate identity until evaluated.

The user did not specify a query, target proportions, minimum quality, named-color mode, or the advanced area/quality/excess penalties in this message. The reproducible configurations explicitly pin existing defaults for those controls: minimum quality 0, concrete named swatches, area power 0.5, proportion quality penalty 0.35, excess penalty 1.5. These are **inherited defaults, not additional user preferences**. The all-cutoff implementation normalizes pixel cutoff to 0 while retaining all five measured layers.

## Restore and reproduce

Open http://zerotwo:8227/ and select:

1. **256** or **1,024** color buckets.
2. **All cutoffs: shade-aware + strict hue**.
3. Cutoff weighting **1**.
4. Quality curve **Original linear penalty**.
5. Quality influence **0.5**.

Keep other controls at the explicitly pinned defaults above to reproduce the saved configurations. Choose the colors or proportions independently; this snapshot describes the method and its preferred tuning, not one fixed query.

- [Machine-readable snapshot](snapshots/strict-hue-favorite-001.json): user preferences, inherited defaults, frozen source archive and measurement fingerprints.
- [Feedback configuration](configs/strict-hue-favorite-001.json): exact settings for both favored banks.
- [Underlying method and previous evidence](HUE-TOLERANCE.md).

```sh
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/strict-hue-favorite-001.json'
```

The frozen archive is stored outside the worktree and contains prototype source and UI files, not wallpapers. The snapshot manifest pins its checksum and the existing extracted measurements so later source changes do not erase what this version meant. Existing benchmark runs and their limitations remain valid historical evidence; they are not relabeled as measurements of this new preferred tuning.

## Snapshot verification

The external archive contains **635 text/source files** (6,026,994 bytes), with SHA-256 `25cb051d58244b05c923adf2d52fccc470cc5600af2f0b6913c7a1dfb18a6ddd`. It preserves source/UI files, dependency manifests and lockfile, configuration and documentation at capture time. Final evaluation notes and the manifest are recorded separately after that capture. Eight referenced artifact checksums were independently verified, along with safe relative archive paths and exclusion of image/archive/environment files.

The exact two-setting [feedback run](http://zerotwo:8224/2026-09-21T23-49-12.493Z-97753239/report.html) completed successfully: **32 supported and six unsupported cases per bank, zero errors, 192 timed requests total**. Candidate p95 was **6.17 ms for 256** and **6.23 ms for 1,024**, with maximum **38.51 ms** on the 545-asset corpus at concurrency 1. These timings do not establish production scale. The manifest records the dataset/run fingerprints and detailed results. Joint-favorite status comes from the user's experience, not a selection made by the benchmark.

No runtime scoring, index measurements or live UI controls changed while saving this snapshot.

The later [performance campaign](FAVORITE-PERFORMANCE.md) tests these exact settings at larger sizes and concurrent loads. Its findings are separate from this preserved preference and do not change the snapshot.

## Why smooth power has no exact equivalent

For an overall-vibe component, let `q` be its conditional mean color quality in the range 0–1. Linear influence 0.5 gives the quality multiplier:

```text
0.5 + 0.5 × q
```

Smooth power gives `q^p`. The exponent that matches the linear multiplier at a particular `q` is:

```text
p(q) = log((1 + q) / 2) / log(q)
```

| Bin quality | Linear 0.5 multiplier | Power 0.5 multiplier | Power exponent matching this one quality |
|---:|---:|---:|---:|
| 10% | 0.550 | 0.316 | 0.260 |
| 25% | 0.625 | 0.500 | 0.339 |
| 50% | 0.750 | 0.707 | 0.415 |
| 75% | 0.875 | 0.866 | 0.464 |
| 90% | 0.950 | 0.949 | 0.487 |

These are component multipliers, not whole-wallpaper score equivalences. At zero quality, linear 0.5 retains a multiplier of 0.5, while every positive power exponent gives zero. No single exponent can match the entire curve. Around medium quality, approximately 0.4 is a local approximation, not a replacement for the saved setting.

Positive proportion targets use the base `b = 1 − 0.35 × (1 − q)` instead of `q`; the corresponding local exponents differ. A requested 0% bypasses the quality factor. For an individual vibe component, power 0.5 gives `sqrt(coverage × quality)`, which has equal proportional sensitivity to its two inputs. That mathematical symmetry does not establish the user's preferred perceptual balance, particularly when separately scored cutoff layers are combined.

## Proposed follow-up: linear below 1, power above 1

Status: **design proposal only; not implemented in this snapshot.** Preserve the current linear and power options when trying it.

Let `i` be the influence slider and `b` the existing quality base (`q` for vibe, the adjusted base for positive proportions):

```text
quality factor = 1 − i × (1 − b)    when 0 ≤ i ≤ 1
                 b^i               when i > 1
```

This exactly preserves the favored linear 0.5 behavior and uses the existing smooth-power behavior above 1. Both branches meet at `b` when the slider reaches 1, so there is no jump in the score. The slider's rate of change has a kink at that point; the curve is continuous, not generally differentiable there. Above 1, positive quality keeps positive credit instead of being clipped by the original linear penalty.

This requires no new color measurements, fields or indexes. The lower branch can use existing native OpenSearch functions and the upper branch the existing parameterized power script. Any implementation should update query validation, service scoring, diagnostic reconstruction, displayed formulas and saved-query handling together, then check parity with linear at 0/0.5/1 and power above 1. The existing snapshot must remain reproducible. No production latency improvement is inferred from the unchanged query structure.

## Original user feedback

> I want to remember this version as a strong snapshot that I really like.
>
> All cutoffs: shade-aware + strict hue
> Cutoff weighting variable, but my favorite at 1
> Quality influence variable, favorite at a place where quality and coverage matter a similar amount.
> I like the 'Smooth power' option usage wise, but I need to use linear at 0.5 for my optimum feeling result (I want to find the equivalent of 0.5 linear on the smooth power option, maybe setting it to 0-1 should be linear, and 1+ should be the smooth power version?).
>
> I don't notice a big difference between 256 and 1024, and these two options are my favorite.

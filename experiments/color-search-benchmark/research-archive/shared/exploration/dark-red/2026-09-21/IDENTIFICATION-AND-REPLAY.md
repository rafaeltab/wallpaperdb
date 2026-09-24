# Attached red wallpapers: identification and existing OpenSearch ranking

2026-09-21, read-only diagnosis. Both attachments are existing corpus assets. No wallpaper, index, extraction definition, or scoring code was changed.

## Image identification

| Attachment | Matched corpus ID | Original | Attachment | Original-source 64×64 RGB RMSE |
|---|---|---|---|---:|
| Dark red background portrait | `madness-wallhaven-gww23l` | 4096×3122 JPEG | 2048×1561 WebP | 3.015 / 255 |
| Softer red background, seated portrait | `madness-wallhaven-9oov2d` | 3000×4390 JPEG | 274×400 PNG | 1.427 / 255 |

Both were visually confirmed. Every real corpus thumbnail was compared after auto-orientation, sRGB conversion and a 64×64 fill resize. Best/second-best thumbnail RMS errors are 3.63/56.68 for the first and 0.84/58.47 for the second. Source hashes differ from attachment hashes: these are resized/reencoded representations, not byte-identical files. All image bytes remain outside the repository.

## Replay assumptions and scope

Picked `#ff0000`, vibe mode, smooth power quality, minimum average quality 0, existing default area exponent 0.5. All cutoffs at blend exponent 0, 3, 6 and quality influence 1, 3; all four banks. Original fixed-cutoff dense method is included as a reference. Each image has 32 recorded replays: 24 all-cutoff settings plus eight original references.

The user confirmed All cutoffs and reported the first image undercredited at influence 1 across weightings, while influence 3 also undercredits the second image. The recorded grid covers these controls; it does not claim every possible continuous weighting was tested or identify the exact weighting active in the user's browser.

Every query returns all 523 real wallpapers globally ranked by real OpenSearch. The existing provider excludes all controlled fixtures in the service. There is no application reranking. These runs are explanations, not latency benchmarks or new human judgments.

## Ranks among 523 real wallpapers

**Ranks and scores are exactly identical across the 16, 64, 256 and 1024 banks.** All four contain the exact `#ff0000` anchor at index 4, with anchor distance zero. Bucket resolution is not responsible for these picked-red results.

| Method | Influence | Blend | First image rank / score | Second image rank / score |
|---|---:|---:|---:|---:|
| All cutoffs | 1 | 0 | 54 / 0.0660282 | 12 / 0.14665608 |
| All cutoffs | 1 | 3 | 33 / 0.041953273 | 26 / 0.050906833 |
| All cutoffs | 1 | 6 | 24 / 0.034229565 | 40 / 0.015713258 |
| All cutoffs | 3 | 0 | 38 / 0.020479053 | 24 / 0.033609968 |
| All cutoffs | 3 | 3 | 25 / 0.026541874 | 41 / 0.014979573 |
| All cutoffs | 3 | 6 | 19 / 0.02762419 | 47 / 0.0057475218 |
| Original fixed 50% | 1 | — | 73 / 0.055060346 | 11 / 0.19915037 |
| Original fixed 50% | 3 | — | 60 / 0.024547534 | 18 / 0.067393154 |

## Existing measured color admission

Each quality is the stored conditional average among pixels admitted at that cutoff. It is not the cutoff itself, and coverage across these nested layers must not be summed.

| Cutoff | First area | First quality | Second area | Second quality |
|---|---:|---:|---:|---:|
| 0% | 22.19% | 20.506% | 41.04% | 40.162% |
| 25% | 8.08% | 38.641% | 35.68% | 44.119% |
| 50% | 0.68% | 66.770% | 11.72% | 58.172% |
| 75% | 0.19% | 88.624% | 0.03% | 76.852% |
| 90% | 0.10% | 94.920% | 0% | 0% |

Increasing influence to 3 cubes these conditional qualities before multiplying the area factor and component weight. This suppresses the broad moderate-quality red areas of the second image, while the first retains a tiny very-high-quality core. It changes the ranking tradeoff without changing which pixels are admitted or their underlying quality. The table supports investigating the measurement itself; it does not alone establish which replacement distance is perceptually correct.

## Visually reviewed higher-ranked examples

For influence 1, equal weights, the first image ranks 54. `wallpaper-004` ranks 50 (score 0.071170114); its thumbnail shows teal/blue/white abstract swirls with some coral/red ribbons. `wallpaper-031` ranks 30 (0.094925344); its thumbnail shows a strongly orange/yellow sunset under a dark teal sky. These descriptions are agent observations, **not new user preference labels**.

The raw files retain complete ordered IDs and scores for every setting. They allow later pair selection without inventing judgments. No pair was added to the formal feedback loop during this identification task.

## Artifacts and reproduction

- `identification.json`: first attachment hashes, original metadata, all 523 thumbnail distances and original verification.
- `rank-matrix.json`: first image's 32 executed settings, full rankings, selected regions and component score ledgers.
- `matched-wallpaper.jpg`: visual identification reference.
- `identification-sources/`: source snapshots and hashes recorded by the corresponding matrix.
- `second-example/`: same files for the second attachment.

Run from the repository root:

```sh
make color-dark-red-identify
make color-dark-red-identify COLOR_DARK_RED_ARGS='--image /home/rafaeltab/.t3/userdata/attachments/2e3d9373-52f7-4563-8387-0de843690bfe-77086804-ada2-49ae-8fa0-a84ed419b6cb.png --output-directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/dark-red/2026-09-21/second-example'
```

These exact commands completed successfully with 32 replays each, all 523 hits present, matching search/inspection scores and no OpenSearch errors. Choose a different output directory to retain these original receipts when repeating after future code changes.

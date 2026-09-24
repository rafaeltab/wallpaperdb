# Color search benchmark corpus

## Source and purpose

Exactly 100 genuine wallpaper files from [dharmx/walls](https://github.com/dharmx/walls), pinned to commit [`6bf4d733ebf2b484a37c17d742eb47e5139e6a14`](https://github.com/dharmx/walls/tree/6bf4d733ebf2b484a37c17d742eb47e5139e6a14). This collection includes photographs, digital illustrations, paintings, abstract art, and monochrome wallpapers. It was chosen to exercise color filtering on a mix of real wallpaper styles. It is a convenience sample, not a representative sample of WallpaperDB uploads.

The upstream [README and sources](https://github.com/dharmx/walls/blob/6bf4d733ebf2b484a37c17d742eb47e5139e6a14/README.md) describe a collected wallpaper archive with multiple source websites. Individual original artists and image licenses are generally not supplied. Every manifest entry therefore records `license: "unknown"`. These files are cached for local experimentation; repository availability does not establish a redistribution license. The full images and their derived thumbnails are ignored by git.

## Selection

The sampler takes ten images from each of ten upstream categories:

| Category | Count | Intended coverage |
| --- | ---: | --- |
| abstract | 10 | Flat regions, shapes, unusual combinations |
| aerial | 10 | Photographs of seas, cities, and landscapes |
| architecture | 10 | Built environments, surfaces, shadows |
| digital | 10 | Illustrations with saturated and muted palettes |
| flowers | 10 | Red, yellow, pink, purple, green, and white subject matter |
| minimal | 10 | Large uniform areas and sparse accent colors |
| monochrome | 10 | Light, dark, and neutral images |
| mountain | 10 | Blue, gray, white, and earth tones |
| nature | 10 | Vegetation, water, and earth tones |
| painting | 10 | Complex mixed-color artwork |

Within each category, candidates are ordered by the SHA256 of `wallpaperdb-color-benchmark-2026-09-15:<upstream path>`. Up to twelve filenames mentioning red, yellow, purple, pink, orange, green, or colorful are moved to the front of that deterministic order. The first 32 candidates per category (or the whole category if smaller) form a candidate pool. Selection skips files larger than 25 MiB in the source tree, exact SHA256 duplicates, animated images, and images smaller than 1280 × 720. Category order is fixed in `downloader.mjs`.

Each candidate is decoded to sRGB and downsampled to fit within 96 × 96 pixels. Coarse HSV area fractions are measured without invoking any search algorithm under evaluation. Pixels below value 0.15 are black; pixels above value 0.85 and below saturation 0.15 are white; remaining pixels below saturation 0.35 or value 0.2 are muted. Other pixels use hue intervals: red 340–20°, orange 20–45°, yellow 45–75°, green 75–165°, cyan 165–195°, blue 195–255°, purple 255–290°, and pink 290–340°.

The sampler first tries to obtain five wallpapers with at least 10% pixel area in each coarse bucket, prioritizing rare buckets and larger areas while allowing at most ten wallpapers per subject category. It then fills every category to ten using greedy farthest-point selection over the coarse histograms. This encourages color and style variety; coarse labels are for sampling only and must not be treated as human relevance judgments. Exact per-image area fractions are recorded as `selectionCoverage` in the manifest. A candidate audit is written to the ignored `corpus/selection-audit.json`.

Files are never recolored, generated, or substituted with synthetic images. Width and height remain those of the original download.

This process is deterministic against the pinned source tree. The checked-in manifest is the definitive selected dataset; normal reruns fetch and verify precisely that list instead of sampling again. Categories come from upstream and are not manually verified semantic labels.

## Validation and limitations

The initial category-only sample was visually inspected and found to favor dark and muted wallpapers, with few strong red, yellow, and violet examples. It was replaced before any benchmark extraction by the deterministic color-diverse sampler described above. The final corpus is deliberately selected for color variety and is not representative of production traffic.

The final selection contains 100 images from 294 valid candidates, with 100 distinct SHA256 values and exactly 100 original local files. It contains 71 JPEGs, 28 PNGs, and one WebP, totaling 260,405,235 bytes (248.34 MiB). There are 95 landscape and five portrait images. The smallest width is 1366 pixels and the smallest height is 768 pixels. `make color-benchmark-corpus` passed a second SHA256 and dimensions verification after selection. All four final contact sheets were visually inspected.

| Coarse color bucket | Candidates with ≥10% area | Selected images with ≥10% area |
| --- | ---: | ---: |
| red | 32 | 17 |
| orange | 25 | 17 |
| yellow | 5 | 5 |
| green | 11 | 8 |
| cyan | 24 | 17 |
| blue | 66 | 30 |
| purple | 8 | 7 |
| pink | 10 | 6 |
| black | 134 | 42 |
| white | 45 | 17 |
| muted | 257 | 86 |

Images can qualify for several buckets. These broad intervals group earth tones with their corresponding hue and do not guarantee exact matches to fully saturated query colors such as `#FFFF00`. Yellow is the sparsest sampled chromatic bucket. Visual inspection found a few near-duplicate scenes or upstream color variants, notably wallpapers 018/019 (rocks and sea) and 052/058 (boats). Deduplication removes byte-identical files, not these visually related images; correlated examples reduce the effective sample diversity slightly. Any future evaluation should keep near-duplicates in the same train/test group.

## Reproduce and verify

Run from the repository root:

```sh
make color-benchmark-corpus
```

This restores missing originals, checks every image's SHA256 and dimensions, rejects manifests that do not contain exactly 100 distinct SHA256 values, and creates missing JPEG thumbnails with an upper bound of 384 × 216. It also creates four 25-image contact sheets at `corpus/contact-sheet-{1..4}.jpg`. Originals are kept byte-for-byte. If the manifest is absent, the script performs the pinned color-diverse selection. `--select` refuses to overwrite an existing manifest. To explicitly recreate the selection from its candidate pool, use `COLOR_CORPUS_REBALANCE=1 make color-benchmark-corpus`; this replaces the local corpus and manifest.

The source commit and image checksums are pinned; future availability of third-party hosting is not guaranteed.

## Manifest schema

`corpus-manifest.json` is an array of 100 objects. Paths are relative to this benchmark directory.

- `id`: stable identifier, `wallpaper-001` through `wallpaper-100`.
- `filename`: original local image path, such as `corpus/wallpaper-001.jpg`.
- `thumbnail`: JPEG preview path under `corpus/thumbnails/`.
- `sourceUrl`: raw download URL pinned to the source commit.
- `sourcePage`: human-readable GitHub file page pinned to that commit.
- `sourceRepository`, `sourceCommit`, `sourcePath`: provenance.
- `category`: upstream directory used for stratified sampling.
- `title`: descriptive upstream filename with underscores replaced by spaces; not an original artist title.
- `sha256`: SHA256 of the unmodified downloaded bytes.
- `width`, `height`, `bytes`, `format`: decoded image dimensions, file size, and format.
- `license`: `unknown`; no image distribution rights are inferred.
- `selectionCoverage`: coarse HSV sampling fractions, keyed by red, orange, yellow, green, cyan, blue, purple, pink, black, white, and muted. These are not search relevance labels.

# HDR conversion proof results

The HDR milestone remains blocked. Required conversion and display-headroom rendering gates must pass separately from browser HDR presentation, native viewers, and OS wallpaper checks. Automated codec results cannot qualify those physical consumers. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.

Reproduce from the repository root with `make run PACKAGE=media SCRIPT=proof:hdr`. Docker must support linux/amd64. The default command returns exit 2 while required codec cases or physical checks are unqualified. This is an intentional qualification failure, not a passing release gate.

Recorded 3209 conversion attempts over 73 fixture records: 3199 completed native encoding, 10 stopped at a native operation, and 0 lack a confirmed native outcome. Qualification outcomes: 8 incompatible with the requested selectors, 2520 qualified, 681 tested and failed.
The inventory covers 85 HDR-ledger cells and 5 labeled SDR controls. Ledger outcomes: 9 deliberately deferred, 17 incompatible with the requested selectors, 15 qualified, 32 tested and failed, 12 untested.

The original fixed coverage plan contains 320 cases. Unexecuted fixed-plan cases: 0. Unlisted cross-products are untested, even when a neighboring case passes.

## Accepted product coverage

320 of 320 declared fixture/geometry endpoint comparisons have qualified codec evidence under their named source models. 0 have no matching tested tuple.

The accepted contract permits a suitable supported depth when depth is omitted. Required SDR AVIF requests therefore accept exact qualified 8-, 10-, or 12-bit evidence. This does not qualify a failed explicit depth=8 request. WebP retains its eight-bit output constraint. Every other selector, source fixture, geometry, and qualification gate must match. No runtime depth-selection policy is implemented here.

| Required product path | Fixture/geometry requirements | Qualified | Untested |
| --- | ---: | ---: | ---: |
| `gainmap-jpeg:hdr:jpg` | 20 | 20 | 0 |
| `gainmap-jpeg:sdr:jpg` | 40 | 40 | 0 |
| `static-avif:hdr:avif` | 120 | 120 | 0 |
| `static-avif:sdr:avif` | 120 | 120 | 0 |
| `animated-pq:hdr:avif` | 10 | 10 | 0 |
| `animated-pq:sdr:avif` | 5 | 5 | 0 |
| `animated-pq:sdr:webp` | 5 | 5 | 0 |

These counts cover the declared corpus only. Gain-map HDR counts describe the original display boost 16 comparisons; they do not qualify intermediate display headroom. Old Apple endpoint comparisons retain the legacy libavif source model, which fails the documented full-HDR source comparison. Its rendering gate requires the separately named documented reference. A ledger cell can retain failed exact-selector candidates while its endpoint requests have qualified alternatives. Consumer review and a usable SDR wallpaper download remain separate requirements. The original fixed-plan outcomes below remain visible.

1 of 25 additional HDR rendering requirements qualify. An unqualified row blocks faithful-HDR qualification independently of the endpoint counts and pending physical checks.

| Exact rendering requirement | Display boost | Status |
| --- | ---: | --- |
| `gainmap-android-iso:hdr:jpg:upscale:display-boost2` | 2 | tested and failed |
| `gainmap-android-iso:hdr:jpg:upscale:display-boost64` | 64 | qualified |
| `gainmap-android-iso:hdr:jpg:contain:display-boost2` | 2 | tested and failed |
| `gainmap-android-iso:hdr:jpg:contain:display-boost64` | 64 | tested and failed |
| `gainmap-android-iso:hdr:jpg:cover:display-boost2` | 2 | tested and failed |
| `gainmap-android-iso:hdr:jpg:cover:display-boost64` | 64 | tested and failed |
| `gainmap-android-iso:hdr:jpg:fill:display-boost2` | 2 | tested and failed |
| `gainmap-android-iso:hdr:jpg:fill:display-boost64` | 64 | tested and failed |
| `gainmap-android-iso:hdr:jpg:orientation:display-boost2` | 2 | tested and failed |
| `gainmap-android-iso:hdr:jpg:orientation:display-boost64` | 64 | tested and failed |
| `gainmap-android-xmp:hdr:jpg:contain:display-boost2` | 2 | tested and failed |
| `gainmap-android-xmp:hdr:jpg:cover:display-boost2` | 2 | tested and failed |
| `gainmap-android-xmp:hdr:jpg:fill:display-boost2` | 2 | tested and failed |
| `gainmap-android-xmp:hdr:jpg:upscale:display-boost2` | 2 | tested and failed |
| `gainmap-android-xmp:hdr:jpg:orientation:display-boost2` | 2 | tested and failed |
| `gainmap-apple-old:hdr:jpg:contain:display-boost2` | 2 | untested |
| `gainmap-apple-old:hdr:jpg:cover:display-boost2` | 2 | untested |
| `gainmap-apple-old:hdr:jpg:fill:display-boost2` | 2 | untested |
| `gainmap-apple-old:hdr:jpg:upscale:display-boost2` | 2 | untested |
| `gainmap-apple-old:hdr:jpg:orientation:display-boost2` | 2 | untested |
| `gainmap-apple-new:hdr:jpg:contain:display-boost2` | 2 | untested |
| `gainmap-apple-new:hdr:jpg:cover:display-boost2` | 2 | untested |
| `gainmap-apple-new:hdr:jpg:fill:display-boost2` | 2 | untested |
| `gainmap-apple-new:hdr:jpg:upscale:display-boost2` | 2 | untested |
| `gainmap-apple-new:hdr:jpg:orientation:display-boost2` | 2 | untested |

Source and output must use the same display boost and the declared independent reference. A passing endpoint or another headroom value cannot satisfy this gate. No new product selector or runtime generation policy is introduced.

One identical output file at display boosts 2, 16, 64: tested and failed. Different output files cannot jointly satisfy adaptive-HDR qualification; the matrix joins their actual SHA-256 hashes across every rendering point.

0 of 20 required gain-map fixture/geometry tuples pass every declared same-file rendering. Every tuple needs boost 2 and 16; the ISO source also needs boost 64 to reach full source capacity. Untested source models and geometries remain unqualified. Endpoint evidence without an explicit display boost cannot satisfy the same-file join.

## Failure stages

Of 320 original fixed-plan cases, 320 have exact fixture/selector evidence and 156 qualify. This plan chose eight-bit SDR AVIF; that choice is not a product requirement when depth is omitted. Native encoding completed in 320; 0 stopped at a native operation. A native failure can occur while preparing an input fixture, before the final encoder is reached.

Across all recorded cases, 650 have measured check failures and 60 lack required evidence. These counts overlap. A missing ordinary-white patch after cropping or an unavailable independent gamut reference is an evidence gap, not a measured change to those pixels.

False downstream flags on a failed native operation are unevaluated. They do not establish additional appearance, decoder, or metadata privacy failures. Successful encoding also does not establish qualification. The original status enums and required passing criteria remain unchanged.

| Fixed coverage path | Planned | Observed | Native completed | Native failure | Measured failure | Missing evidence | Qualified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gainmap-jpeg:hdr:jpg` | 20 | 20 | 20 | 0 | 20 | 0 | 0 |
| `gainmap-jpeg:sdr:jpg` | 40 | 40 | 40 | 0 | 40 | 0 | 0 |
| `static-avif:hdr:avif` | 120 | 120 | 120 | 0 | 0 | 0 | 120 |
| `static-avif:sdr:avif` | 120 | 120 | 120 | 0 | 96 | 0 | 24 |
| `animated-pq:hdr:avif` | 10 | 10 | 10 | 0 | 0 | 0 | 10 |
| `animated-pq:sdr:avif` | 5 | 5 | 5 | 0 | 4 | 0 | 1 |
| `animated-pq:sdr:webp` | 5 | 5 | 5 | 0 | 4 | 0 | 1 |

Measured failures and evidence gaps count cases once per column, even when several frames fail. Per-check counts and case diagnostics are in [the matrix](conversion-matrix.json); raw measurements and native errors remain in [measurements](measurements.json).

## Scoped eight-bit precision diagnostic

The exhaustive diagnostic evaluates all 16,777,216 full-range sRGB RGB8 triples for each selected reference color. It finds 36 of 349 visible shadow samples that cannot meet the fixed maximum Delta E ITP gate in this representation.

| Reference sRGB code units | Matching shadow pixels | Best RGB8 code | Minimum Delta E ITP |
| --- | ---: | --- | ---: |
| [0.35917961716473906, 0.3591796171647385, 0.35917961716473884] | 18 | [1, 1, 1] | 10.291877 |
| [0.17231441227079494, 0.17231441227079466, 0.1723144122707948] | 18 | [0, 0, 0] | 11.111862 |

The native AOM encode and independent dav1d decode preserve the supplied RGB8 codes exactly: True. The encoder cannot recover precision absent from those codes. The [diagnostic record](precision.json) includes reference, source, metric and threshold hashes, native commands, and six additional YUV encoding trials.

This is a floating-point enumeration for one unchanged grade and one representation. It does not establish that eight-bit AVIF, another declared transfer, every YUV encoding, or another independently justified SDR grade is impossible. The diagnostic cannot qualify any conversion or physical display.

## Fixed ISO gain-map code bound

The [read-only diagnostic](iso-map-code-bound.json) searches every RGB8 gain-map triple for each selected shadow pixel. One triple must serve boosts 2, 16 and 64 with the fixed decoded base and actual gain metadata. Actual emitted-code reconstruction must agree with the independent decoder before enumeration.

| Pixel [x, y] | Enumerated codes | Minimum joint maximum Delta E ITP | Best shared RGB8 code | Codes meeting all three maximum gates |
| --- | ---: | ---: | --- | ---: |
| [236, 822] | 16,777,216 | 109.491281 | [0, 0, 0] | 0 |
| [242, 640] | 16,777,216 | 54.101789 | [35, 32, 0] | 0 |

A minimum above the unchanged maximum of 8 rules out a map-code-only correction for that fixed representation. The float64 search optimistically ignores JPEG neighborhood coupling; it is not a formal interval-arithmetic certificate. Other base pixels, offsets, capacities, metadata, map precision, geometry and representations remain outside this bound. A feasible pixel code would still need actual native encoding and all regional gates. This diagnostic cannot qualify a conversion or physical consumer.

## Fixed-base ISO offset bound

The [shared-offset diagnostic](iso-global-offset-bound.json) keeps the same decoded P3 base and positive ordered display weights. It encloses the unchanged maximum-error balls in conservative RGB intervals. Two pixels constrain the same green-channel offset difference `D = 203 * (base offset - alternate offset)`.

| D upper bound, nits | D lower bound, nits | Contradiction margin, nits | Contradiction |
| ---: | ---: | ---: | --- |
| -2.764145 | -1.468168 | 1.295977 | established |

The unchanged maximum of 8 supplies the error-ball radius. Disjoint offset bounds rule out every shared nonnegative offset pair for this fixed model, including arbitrary map precision and per-pixel gains. The analytic enclosure uses linear support, monotone PQ inversion and signed matrix intervals. Numerical sampling only checks the implementation. Guarded float64 arithmetic is not a formal directed-rounding certificate. Other bases, capacities, reference models, geometry, gain equations and physical consumers remain outside this result. This diagnostic cannot qualify a conversion.

## Environment and reproducibility

The image uses the same Node 22 Alpine/musl deployment shape as Media. This is a proposed native proof pipeline, not the existing Sharp 0.33 production worker. No service dependency was upgraded. HDR geometry uses native FFmpeg/zimg float processing and luminance-coupled HLG transforms. The calibrated SDR candidate uses the native CPU Mobius filter. CPU lavapipe runs the retained libplacebo comparison trials without a host GPU. Network access is disabled during tests.

- Node: `v22.22.3`
- AVIF tools: `Version: 1.4.1 (dav1d [dec]:1.5.3, aom [enc/dec]:v3.14.1)`
- FFmpeg: `ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers`
- ExifTool: `13.55`
- Unchanged threshold file SHA-256: `0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf`

The base image is pinned by digest. Every additional APK is pinned by URL and SHA-256, the full package inventory is checked, npm uses its integrity lock, and native source archives have checked hashes. See [native versions](native-versions.json), [dependency locks](../environment/), [commands](commands.json), [fixture facts and hashes](fixtures.json), and [generator hashes](../fixtures/generated-sha256.json).

## How to read the evidence

A qualified case requires a real encoder, a separate decoder, exact structural checks, fixed appearance thresholds, and metadata privacy. Independent AV1 decoding uses dav1d, while encoding uses AOM. ExifTool independently reads emitted signaling. The locally patched libavif sequence writer retains animated orientation; its patch and binary hashes are recorded. Gain-map JPEG uses pinned experimental libultrahdr PR484 and PR491 patches and a local per-channel XMP parser/writer patch, with dual ISO/Android metadata. These are proof builds, not upstream releases. ISO-only source reconstruction uses a separately validated native-libjpeg/ISO reader for verified sRGB-transfer RGB bases, supported sRGB/P3 ICC matrices and forward ISO metadata. Analytic vectors and independent native libavif/XMP controls test this narrow reader; unknown color facts or metadata layouts are rejected.

All comparisons use display-referred linear light. PQ uses ST 2084 absolute luminance. HLG uses a declared 1000-nit reference display and gamma 1.2 OOTF. Synthetic AVIF/PNG geometry references use independent Pillow floating-point bilinear resampling with premultiplied alpha. Gain-map references use separately declared Lanczos geometry. The comparison includes patch boundaries; interpolation differences are measured rather than hidden by discarding edges. These synthetic charts stress conversion and do not represent every photographic or artistic source.

Authored SDR JPEG candidates additionally use a correctly declared gamma-3.2 ICC transfer with sRGB or P3 primaries. They preserve the independently referenced authored SDR grade and existing acceptance gates while testing the forty required gain-map source/gamut/geometry requests. The native RGB JPEG encoder and independent FFmpeg MJPEG decoder check emitted pixels; the actual ICC matrix and curves determine their color interpretation. Native zimg fractional crop windows retain the filter samples needed at cover boundaries. Standard sRGB-transfer candidates and their failures remain separate. The accepted gamut selectors identify primaries, so a different correctly signaled transfer does not change those selectors. ICC interpretation by physical consumers remains pending.

Authored SDR lossless PNG and WebP candidates pass all four gain-map sources, two requested gamuts and seven geometries using 8-bit samples with independently verified sRGB transfer and sRGB or P3 ICC primaries. Their 112 cases keep the authored SDR grade and unchanged appearance gates; physical consumer interpretation remains pending.

The predeclared [thresholds](../thresholds.json) report BT.2124 Delta E ITP and luminance error separately for shadows, midtones, and highlights. Best-effort SDR additionally requires 203-nit ordinary white near 0.90 sRGB signal, retained shadows/midtones, smooth highlight detail, and an independent chromatic mapping reference. The 1000-nit candidate uses a fixed Mobius knee of 0.6 and exposure 1.1. The 4000-nit sequence uses knee 0.54 and exposure 1.2 across both frames. Both use peak output scale 0.99. Its explicit relative-colorimetric gamut mapping clips out-of-gamut sRGB channels after primary conversion; it does not claim perceptual gamut compression. The independent reference derives the shoulder from boundary conditions and converts through D65 XYZ. Identity controls test tone policy before crop, while every encoded derivative is compared at its actual geometry, grouped by source HDR luminance region. Authored JPEG SDR bases bypass automatic HDR tone mapping. Separate gamma-2.2 candidates preserve the same SDR grade with sRGB primaries and a correctly declared coding transfer. AVIF uses CICP 1/4/0; JPEG/WebP/GIF use an independently parsed ICC matrix/TRC profile. GIF requires explicit binary-alpha coercion when the source has fractional alpha. They are not standard sRGB-transfer files. Every emitted representation needs its own consumer review.

Read [measurements](measurements.json) for each case, including native failures, facts, region statistics, source/output hashes and artifact paths. Full artifacts remain under `../work/` after a run; selected inspected files are committed under [manual](manual/manifest.json). Failed candidates are diagnostic files, not approved fallbacks.

## Required and candidate paths

| Source family | Range | Output | Policy | Exact-case aggregate status | Missing fixed-plan cases |
| --- | --- | --- | --- | --- | ---: |
| gainmap-jpeg | hdr | jpg | required | tested and failed | 0 |
| gainmap-jpeg | hdr | avif | after proof | tested and failed | 0 |
| gainmap-jpeg | hdr | png | after proof | tested and failed | 0 |
| gainmap-jpeg | hdr | webp | after proof | tested and failed | 0 |
| gainmap-jpeg | hdr | gif | reject | incompatible with the requested selectors | 0 |
| gainmap-jpeg | sdr | jpg | required | tested and failed | 0 |
| gainmap-jpeg | sdr | avif | after proof | tested and failed | 0 |
| gainmap-jpeg | sdr | png | after proof | tested and failed | 0 |
| gainmap-jpeg | sdr | webp | after proof | tested and failed | 0 |
| gainmap-jpeg | sdr | gif | after proof | tested and failed | 0 |
| static-avif | hdr | jpg | after proof | tested and failed | 0 |
| static-avif | hdr | avif | required | qualified | 0 |
| static-avif | hdr | png | after proof | qualified | 0 |
| static-avif | hdr | webp | after proof | tested and failed | 0 |
| static-avif | hdr | gif | reject | incompatible with the requested selectors | 0 |
| static-avif | sdr | jpg | after proof | tested and failed | 0 |
| static-avif | sdr | avif | required | tested and failed | 0 |
| static-avif | sdr | png | after proof | qualified | 0 |
| static-avif | sdr | webp | after proof | tested and failed | 0 |
| static-avif | sdr | gif | after proof | tested and failed | 0 |
| animated-pq | hdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-pq | hdr | avif | required | qualified | 0 |
| animated-pq | hdr | png | after proof | qualified | 0 |
| animated-pq | hdr | webp | after proof | tested and failed | 0 |
| animated-pq | hdr | gif | reject | incompatible with the requested selectors | 0 |
| animated-pq | sdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-pq | sdr | avif | required | tested and failed | 0 |
| animated-pq | sdr | png | after proof | qualified | 0 |
| animated-pq | sdr | webp | required | tested and failed | 0 |
| animated-pq | sdr | gif | after proof | tested and failed | 0 |
| animated-hlg | hdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-hlg | hdr | avif | after proof | qualified | 0 |
| animated-hlg | hdr | png | after proof | qualified | 0 |
| animated-hlg | hdr | webp | after proof | tested and failed | 0 |
| animated-hlg | hdr | gif | reject | incompatible with the requested selectors | 0 |
| animated-hlg | sdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-hlg | sdr | avif | after proof | tested and failed | 0 |
| animated-hlg | sdr | png | after proof | qualified | 0 |
| animated-hlg | sdr | webp | after proof | tested and failed | 0 |
| animated-hlg | sdr | gif | after proof | tested and failed | 0 |
| hdr-png | hdr | jpg | after proof | untested | 0 |
| hdr-png | hdr | avif | after proof | tested and failed | 0 |
| hdr-png | hdr | png | after proof | tested and failed | 0 |
| hdr-png | hdr | webp | after proof | untested | 0 |
| hdr-png | hdr | gif | reject | incompatible with the requested selectors | 0 |
| hdr-png | sdr | jpg | after proof | qualified | 0 |
| hdr-png | sdr | avif | after proof | qualified | 0 |
| hdr-png | sdr | png | after proof | tested and failed | 0 |
| hdr-png | sdr | webp | after proof | qualified | 0 |
| hdr-png | sdr | gif | after proof | tested and failed | 0 |
| avif-gainmap | hdr | jpg | after proof | tested and failed | 0 |
| avif-gainmap | hdr | avif | after proof | tested and failed | 0 |
| avif-gainmap | hdr | png | after proof | tested and failed | 0 |
| avif-gainmap | hdr | webp | after proof | untested | 0 |
| avif-gainmap | hdr | gif | reject | incompatible with the requested selectors | 0 |
| avif-gainmap | sdr | jpg | after proof | tested and failed | 0 |
| avif-gainmap | sdr | avif | after proof | qualified | 0 |
| avif-gainmap | sdr | png | after proof | qualified | 0 |
| avif-gainmap | sdr | webp | after proof | qualified | 0 |
| avif-gainmap | sdr | gif | after proof | tested and failed | 0 |
| other-hdr | hdr | jpg | after proof | untested | 0 |
| other-hdr | hdr | avif | after proof | untested | 0 |
| other-hdr | hdr | png | after proof | untested | 0 |
| other-hdr | hdr | webp | after proof | untested | 0 |
| other-hdr | hdr | gif | reject | incompatible with the requested selectors | 0 |
| other-hdr | sdr | jpg | after proof | untested | 0 |
| other-hdr | sdr | avif | after proof | untested | 0 |
| other-hdr | sdr | png | after proof | untested | 0 |
| other-hdr | sdr | webp | after proof | untested | 0 |
| other-hdr | sdr | gif | after proof | untested | 0 |
| deferred-input | hdr | jpg | later | deliberately deferred | 0 |
| deferred-input | hdr | avif | later | deliberately deferred | 0 |
| deferred-input | hdr | png | later | deliberately deferred | 0 |
| deferred-input | hdr | webp | later | deliberately deferred | 0 |
| deferred-input | hdr | gif | reject | incompatible with the requested selectors | 0 |
| deferred-input | sdr | jpg | later | deliberately deferred | 0 |
| deferred-input | sdr | avif | later | deliberately deferred | 0 |
| deferred-input | sdr | png | later | deliberately deferred | 0 |
| deferred-input | sdr | webp | later | deliberately deferred | 0 |
| deferred-input | sdr | gif | later | deliberately deferred | 0 |
| sdr | hdr | jpg | reject | incompatible with the requested selectors | 0 |
| sdr | hdr | avif | reject | incompatible with the requested selectors | 0 |
| sdr | hdr | png | reject | incompatible with the requested selectors | 0 |
| sdr | hdr | webp | reject | incompatible with the requested selectors | 0 |
| sdr | hdr | gif | reject | incompatible with the requested selectors | 0 |

The [machine-readable matrix](conversion-matrix.json) retains exact selectors, qualified cases, alternative static/coercion requests, missing coverage, and blockers. A failed case does not qualify because another request to the same extension passed.

## Measured tone-map controls

| Source | Native algorithm | Ordinary-white SDR signal | Tone policy | Repeat pixels |
| --- | --- | ---: | --- | --- |
| avif-pq-rec2020-10-opaque | bt.2446a | 0.37901 | fail | True |
| avif-pq-rec2020-10-opaque | mobius:tonemapping_param=0.3 | 0.82819 | fail | True |
| avif-pq-rec2020-10-opaque | reinhard:tonemapping_param=0.5 | 0.74213 | fail | True |
| avif-hlg-rec2020-10-opaque | bt.2446a | 0.68324 | fail | True |
| avif-hlg-rec2020-10-opaque | mobius:tonemapping_param=0.3 | 0.85463 | fail | True |
| avif-hlg-rec2020-10-opaque | reinhard:tonemapping_param=0.5 | 0.81196 | fail | True |
| avif-pq-rec2020-10-opaque | CPU Mobius knee 0.6; exposure 1.1; output scale 0.99; declared peak 1000 nits | 0.88563 | pass | True |

## Representative regional measurements

| Exact case | Region | Delta E ITP p95 | Mean absolute luminance error, nits |
| --- | --- | ---: | ---: |
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | shadow | 0.3242 | 0.0053 |
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | midtone | 0.3150 | 0.0943 |
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | highlight | 0.3509 | 1.4039 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | shadow | 0.1269 | 0.0011 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | midtone | 0.0425 | 0.0162 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | highlight | 0.0589 | 0.1856 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | shadow | 0.3206 | 0.0055 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | midtone | 0.3193 | 0.0897 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | highlight | 0.3496 | 1.4009 |
| `gainmap-android-xmp:sdr:jpg:srgb:preserve:contain` | shadow | 11.2978 | 0.3151 |
| `gainmap-android-xmp:sdr:jpg:srgb:preserve:contain` | midtone | 4.9543 | 0.6743 |
| `gainmap-apple-new:sdr:jpg:preserve:preserve:contain` | shadow | 7.1993 | 0.0610 |
| `gainmap-apple-new:sdr:jpg:preserve:preserve:contain` | midtone | 4.8474 | 0.5717 |

The tunable Mobius and Reinhard trials use maintained native functions with fixed parameters. Their failures do not change the white target. Adaptive peak detection is disabled in the candidate conversion path; separate controls record frame-to-frame white shifts and repeat hashes with it enabled and disabled. Persistent temporal-filter history is not qualified by these per-frame trials.

## Native gain-map candidate measurements

Each value is the maximum of the recorded regional statistic across the tested geometries in that row. Means are not pooled across regions or images. Empty regions are excluded; absent measurements remain missing. Qualification still requires every original structural, privacy and appearance check. Exact case IDs, all shadow/midtone/highlight statistics and individual blockers remain in [measurements](measurements.json).

| Fixture | Candidate | Reference revision | Qualified/attempted | SDR Delta E mean | SDR Delta E max | HDR Delta E mean | HDR Delta E max | HDR mean absolute luminance error, nits |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5` | `gainmap-hdr-target-gamut-v1` | 1/1 | 0.8142 | 5.2275 | 1.3503 | 7.3122 | 2.0797 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-render-boost2` | `gainmap-iso-intermediate-boost2-v1` | 0/1 | 0.8142 | 5.2275 | 21.2724 | 104.2137 | 72.2573 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-render-boost64` | `gainmap-iso-full-headroom-boost64-v1` | 0/1 | 0.8142 | 5.2275 | 25.0703 | 129.3897 | 105.0352 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-source-boost64` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 26.6022 | 128.0727 | 130.0010 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-source-boost64` | `gainmap-iso-full-headroom-boost64-v1` | 1/1 | 0.8142 | 5.2275 | 1.3672 | 7.7999 | 2.8201 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-source-boost64` | `gainmap-iso-intermediate-boost2-v1` | 0/1 | 0.8142 | 5.2275 | 20.4759 | 116.9443 | 69.1910 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-source-boost64-source-capacity` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 1.2286 | 101.1661 | 1.7580 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-source-boost64-source-capacity` | `gainmap-iso-full-headroom-boost64-v1` | 1/1 | 0.8142 | 5.2275 | 1.3672 | 7.7999 | 2.8201 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma1.5-source-boost64-source-capacity` | `gainmap-iso-intermediate-boost2-v1` | 0/1 | 0.8142 | 5.2275 | 2.1980 | 127.1464 | 0.8549 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-float32-map-gamma2` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 1.2949 | 11.4405 | 2.0262 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-midpointoffset-dct-islow-map-source-float32-map-gamma2` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 1.3623 | 11.4405 | 2.1182 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-moderateoffset-dct-float-map-source-float32` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 1.1848 | 7.8515 | 2.0078 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-smalloffset-dct-float-map-source-float32` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 1.8879 | 9.2815 | 3.1136 |
| `gainmap-android-iso` | `native-combine-icc-gamma32-smalloffset-dct-float-map-source-float32-map-gamma2` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8142 | 5.2275 | 1.6603 | 8.4811 | 2.4658 |
| `gainmap-android-iso` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.0004 | 5.0994 | 1.7891 | 5.2962 | 2.5180 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 3/6 | 0.3705 | 28.6637 | 1.1815 | 7.5796 | 1.9210 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-float-rgb-same-file-headroom` | `gainmap-hdr-target-gamut-v1` | 2/2 | 0.3705 | 5.9781 | 1.0369 | 6.6790 | 1.9210 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-float-rgb-same-file-headroom` | `gainmap-iso-full-headroom-boost64-v1` | 0/2 | 0.3705 | 5.9781 | 25.1302 | 141.3131 | 104.8666 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-float-rgb-same-file-headroom` | `gainmap-iso-intermediate-boost2-v1` | 0/2 | 0.3705 | 5.9781 | 24.4959 | 106.7726 | 85.2391 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 2/6 | 0.3957 | 26.8878 | 1.2715 | 7.7325 | 1.8473 |
| `gainmap-android-iso` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 4/6 | 0.4356 | 28.6637 | 1.1834 | 7.5227 | 1.9313 |
| `gainmap-android-iso` | `native-combine-moderateoffset-jpegli-base-dct-float-map-same-file-headroom` | `gainmap-hdr-target-gamut-v1` | 1/1 | 0.3956 | 5.6370 | 1.0479 | 6.9778 | 1.6461 |
| `gainmap-android-iso` | `native-combine-moderateoffset-jpegli-base-dct-float-map-same-file-headroom` | `gainmap-iso-full-headroom-boost64-v1` | 0/1 | 0.3956 | 5.6370 | 25.1017 | 111.9170 | 104.7114 |
| `gainmap-android-iso` | `native-combine-moderateoffset-jpegli-base-dct-float-map-same-file-headroom` | `gainmap-iso-intermediate-boost2-v1` | 0/1 | 0.3956 | 5.6370 | 22.5398 | 71.5773 | 77.4588 |
| `gainmap-android-iso` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 5.0994 | 1.0444 | 4.6038 | 1.6505 |
| `gainmap-android-iso` | `native-combine-moderateoffset-lossless-rgb-source-float32` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 5.0994 | 1.0460 | 4.2965 | 1.6285 |
| `gainmap-android-iso` | `native-combine-moderateoffset-mozjpeg-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 1/1 | 0.4120 | 7.1832 | 1.0693 | 6.4514 | 1.6724 |
| `gainmap-android-iso` | `native-combine-moderateoffset-mozjpeg-base-dct-float-map-same-file-headroom` | `gainmap-hdr-target-gamut-v1` | 1/1 | 0.4120 | 7.1832 | 1.0693 | 6.4514 | 1.6724 |
| `gainmap-android-iso` | `native-combine-moderateoffset-mozjpeg-base-dct-float-map-same-file-headroom` | `gainmap-iso-full-headroom-boost64-v1` | 0/1 | 0.4120 | 7.1832 | 25.1032 | 120.0772 | 104.9228 |
| `gainmap-android-iso` | `native-combine-moderateoffset-mozjpeg-base-dct-float-map-same-file-headroom` | `gainmap-iso-intermediate-boost2-v1` | 0/1 | 0.4120 | 7.1832 | 22.6427 | 71.9363 | 77.9394 |
| `gainmap-android-xmp` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-pq16-map-gamma1.5` | `gainmap-hdr-target-gamut-v1` | 1/1 | 0.7870 | 3.8356 | 0.9059 | 6.9264 | 2.0220 |
| `gainmap-android-xmp` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-pq16-map-gamma1.5-independent-xmp-headroom` | `gainmap-xmp-independent-boost16-v1` | 1/1 | 0.7870 | 3.8356 | 0.9094 | 6.9264 | 2.0268 |
| `gainmap-android-xmp` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-pq16-map-gamma1.5-independent-xmp-headroom` | `gainmap-xmp-intermediate-boost2-v1` | 0/1 | 0.7870 | 3.8356 | 9.4959 | 93.5670 | 30.0381 |
| `gainmap-android-xmp` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 2.0849 | 1.2553 | 3.0473 | 3.1721 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.3243 | 27.7158 | 0.8948 | 6.4785 | 2.3871 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-dct-float-rgb-independent-xmp-headroom` | `gainmap-xmp-independent-boost16-v1` | 4/4 | 0.3243 | 7.8722 | 0.8958 | 6.0992 | 2.3874 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-dct-float-rgb-independent-xmp-headroom` | `gainmap-xmp-intermediate-boost2-v1` | 0/4 | 0.3243 | 7.8722 | 9.9635 | 90.2211 | 31.5860 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.3479 | 25.4949 | 0.9491 | 6.1151 | 2.5249 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.3577 | 25.4949 | 0.8988 | 6.5961 | 2.3915 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 2.0849 | 0.7819 | 3.7019 | 1.9795 |
| `gainmap-apple-new` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-pq16-map-gamma1.5` | `gainmap-hdr-target-gamut-v1` | 1/2 | 0.9220 | 5.0109 | 1.3749 | 7.1706 | 2.1707 |
| `gainmap-apple-new` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-pq16-map-gamma1.5-base-dct-float` | `gainmap-hdr-target-gamut-v1` | 1/1 | 0.7956 | 4.7982 | 1.3575 | 6.7789 | 2.1593 |
| `gainmap-apple-new` | `native-combine-icc-gamma32-midpointoffset-dct-islow-map-source-pq16-map-gamma1.5` | `gainmap-hdr-target-gamut-v1` | 0/1 | 0.8082 | 5.0109 | 1.4363 | 7.5280 | 2.2540 |
| `gainmap-apple-new` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.0003 | 3.3440 | 1.8773 | 4.0623 | 2.4850 |
| `gainmap-apple-new` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 4/6 | 0.3626 | 28.6637 | 1.2462 | 7.7442 | 1.9281 |
| `gainmap-apple-new` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 3/6 | 0.3906 | 28.6637 | 1.3123 | 7.8035 | 1.8902 |
| `gainmap-apple-new` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 2/6 | 0.4328 | 35.2023 | 1.2259 | 7.7970 | 1.8154 |
| `gainmap-apple-new` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0003 | 3.3440 | 1.1281 | 4.2359 | 1.5549 |
| `gainmap-apple-old` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-apple-documented-full` | `apple-old-documented-full-rec709-linear-bilinear8-v1` | 1/1 | 0.9220 | 4.6409 | 0.9797 | 4.2249 | 1.6308 |
| `gainmap-apple-old` | `native-combine-icc-gamma32-midpointoffset-dct-float-map-source-pq16-map-gamma1.5` | `gainmap-hdr-target-gamut-v1` | 2/2 | 0.9220 | 5.0109 | 1.3606 | 7.0629 | 2.5011 |
| `gainmap-apple-old` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.0003 | 3.3440 | 1.7808 | 4.0685 | 3.0539 |
| `gainmap-apple-old` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 4/6 | 0.3626 | 28.6637 | 1.2516 | 8.2264 | 2.2192 |
| `gainmap-apple-old` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 3/6 | 0.3906 | 28.6637 | 1.3224 | 8.1888 | 2.2909 |
| `gainmap-apple-old` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 2/6 | 0.4328 | 35.2023 | 1.2674 | 8.4480 | 2.2087 |
| `gainmap-apple-old` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0003 | 3.3440 | 1.1055 | 4.6705 | 2.0067 |

The following separate decoder diagnostics do not alter the file qualification above. The original reader results remain recorded. A successful readback still leaves every physical consumer pending manual review.

| Independent reader diagnostic | Attempted | Appearance passed | Failed or unqualified |
| --- | ---: | ---: | ---: |
| `baseline_libavif` | 93 | 21 | 72 |
| `rgb_libavif` | 93 | 90 | 3 |
| `stock_native_srgb` | 22 | 0 | 22 |

The SOF0 union below counts each exact observed request once across native alternatives with independently inspected SOF0 base and map layers. Fixture and source hash, normalized selectors, geometry, crop and source-orientation facts, and reference revision must match. A request qualifies only when an exact alternative passes all original checks without blockers or rejected measurements. The per-candidate failures above remain unchanged.

| Reference revision | Qualified/observed exact SOF0 requests | Qualified/observed required requests |
| --- | ---: | ---: |
| `apple-old-documented-full-rec709-linear-bilinear8-v1` | 1/1 | 1/1 |
| `gainmap-hdr-target-gamut-v1` | 24/24 | 20/20 |
| `gainmap-iso-full-headroom-boost64-v1` | 1/5 | 1/5 |
| `gainmap-iso-intermediate-boost2-v1` | 0/5 | 0/5 |
| `gainmap-xmp-independent-boost16-v1` | 5/5 | 5/5 |
| `gainmap-xmp-intermediate-boost2-v1` | 0/5 | 0/5 |

These denominators cover the observed corpus only; the required column matches the fixed plan within that corpus. Unobserved requests remain untested. This summary selects no runtime encoder and changes no matrix status. Physical browser and OS wallpaper qualification remains pending manual review.

The separate [JPEGli base experiment](jpegli-base-experiment.json) records 64 native SOF0 RGB8 trials, of which 4 pass the unchanged authored-SDR base checks. Each failed trial retains its regional measurements.

The bounded [JPEGli quality experiment](jpegli-quality-experiment.json) records 84 native trials, with 0 passing and 84 failed or unqualified. It retains every declared quality/table/adaptive option for the remaining source/geometry corpus under the same authored-SDR reference and thresholds.

Both base experiments do not qualify an HDR derivative and are excluded from the conversion-attempt counts above. A JPEGli HDR candidate must independently regenerate and validate its gain map and reconstructed HDR output. Physical consumer review remains pending.

## Native MozJPEG base experiments

These separate authored-SDR base experiments are excluded from the conversion-attempt counts. A passing base still needs a regenerated gain map and complete independent HDR qualification. Every physical consumer remains pending manual review.

| Native setup | Trials | Qualified SDR bases | Measured appearance failures | Decoder errors |
| --- | ---: | ---: | ---: | ---: |
| Optimized Huffman | 56 | 4 | 52 | 0 |
| Retained standard Huffman | 56 | 0 | 30 | 26 |
| Bounded trellis precision | 36 | 0 | 36 | 0 |

The [optimized-Huffman trials](mozjpeg-base-experiment.json) retain every declared DCT/trellis/deringing option. The [initial standard-Huffman setup](mozjpeg-standard-huffman-experiment.json) remains reproducible, including malformed streams that FFmpeg conceals despite exiting zero. Both native command runners now reject error-level decoder diagnostics; concealed rasters cannot supply appearance evidence.

The [bounded trellis-precision follow-up](mozjpeg-lambda-experiment.json) increases the native coefficient-distortion penalty for the remaining six source/geometry cases. It retains default controls, unchanged quality-100 quantizers, authored samples and appearance gates. Failure of these declared options does not prove every baseline JPEG encoder impossible.

## Remaining baseline JPEG precision evidence

This read-only [native coefficient diagnostic](mozjpeg-coefficient-diagnosis.json) cannot qualify a converter or physical consumer. It retains the failed input statuses and checks output, reference and native-input hashes before reading actual JPEG coefficients.

| Source | Geometry | Profiles | Native geometry passes | Smallest full-image maximum Delta E | Minimum failing shadow pixels in unchanged-DC blocks |
| --- | --- | ---: | --- | ---: | ---: |
| `gainmap-android-iso` | upscale | 8 | True | 26.8878 | 140 |
| `gainmap-android-xmp` | upscale | 8 | True | 25.4949 | 19 |
| `gainmap-apple-old` | contain | 8 | True | 9.9823 | 1 |
| `gainmap-apple-old` | upscale | 8 | True | 26.8878 | 177 |
| `gainmap-apple-new` | contain | 8 | True | 9.9823 | 1 |
| `gainmap-apple-new` | upscale | 8 | True | 26.8878 | 177 |

Failures persist in blocks whose DC coefficients match the no-trellis control. The higher-lambda trials change real output bytes and AC coefficients. Quantized AC/IDCT error is an inference from those coefficients and decoded samples; these observations do not prove every possible baseline JPEG encoder incapable of meeting the fixed gates.

## Blockers and scope limits

- The [ISO intermediate-headroom proof](iso-intermediate-boost2.json) fails at display boost 2 against an independently reconstructed source at that same boost. Both actual output readers agree within the existing limits, but reconstructed appearance does not. The source capacity is about 49.26 times SDR white; the regenerated file is about 4.47. Read-only pre-JPEG-map and ideal-gain diagnostics retain large errors. A normalized-weight diagnostic reduces broad bias but still fails; normalizing capacity to the boost-16 reference endpoint is insufficient in that diagnostic. Other capacity choices remain untested. The separate display-boost-16 endpoint remains measured; the boost-2 rendering requirement blocks faithful-HDR qualification independently of endpoint counts and physical review.
- The [ISO full-source-headroom proof](iso-full-headroom-boost64.json) also fails. At display boost 64 both source and output gain weights equal one, but the output remains identical to its boost-16 rendering while the source becomes brighter. Its shadow maximum is 129.3897 Delta E ITP and highlight mean is 25.0703. The matrix requires one identical output file to pass boosts 2, 16 and 64; different files cannot jointly qualify adaptation.
- A separate [native full-source candidate](iso-full-source-candidate.json) reconstructs the ISO source at boost 64 before geometry and gain-map regeneration. That full-source rendering passes, with independent shadow maximum 7.79985 under the unchanged limit of 8. The exact same output fails boosts 2 and 16, so it does not clear the joint adaptation requirement. Its regenerated capacity is 3.089498 log2 versus the source 5.622376. The original output and all earlier failures remain separate evidence.
- The [source-capacity candidate](iso-source-capacity.json) copies only the original capacity fields through the pinned native packer. Compressed base/map coding, actual ICC bytes and every other ISO field remain exact; ISO/XMP/native metadata agree. Source and output weights match at all three boosts. Highlight mean error improves from 20.4759 to 0.62918 at boost 2 and from 26.6022 to 1.02007 at boost 16, but shadow and midtone maxima still fail. Boost-64 pixels and measurements remain exactly equal to the qualified full-source control. This corrects the capacity mismatch without qualifying adaptation.
- The [ISO geometry rendering proof](iso-geometry-headroom.json) reruns the existing qualified containment, crop, stretch and EXIF6 orientation recipes. It preserves their exact files and every original endpoint measurement. Each passes display boost 16 and fails appearance at 2 and 64; all other gates pass. The twelve rendering records retain their separate references and manual-file labels. These measurements cover all five required ISO geometries together with the upscale proofs. Other source dialects require their own measurements.
- The [independent XMP source proof](xmp-source-reference.json) reads original JPEG samples and XML gain parameters independently of native gain application. It declares the pinned point-bilinear sampling convention and separate boost-2/16 reference revisions. Every original/imported base and map code and per-channel gain field must agree; source and reference-relation appearance use unchanged regional gates. Native nonlinear-gamma, unequal-offset, per-channel and zero-weight controls exercise the equations. The original has explicit EXIF sRGB but lacks the ICC required by the Android container specification, so its legacy source scope does not establish container conformance. The different UltraHDR source renderer remains a failed diagnostic. A source-reader result cannot qualify a resized output or physical consumer.
- The [XMP geometry rendering proof](xmp-containment-headroom.json) retains the five exact earlier native HDR JPEGs and compares them with independent same-boost source references after geometry. Every boost-16 rendering passes; every boost-2 rendering fails appearance. Containment shadow maximum is 88.53405 against the unchanged limit of 8; other boost-2 maxima range from 81.43344 to 93.56704. Both output readers agree and all nonappearance gates pass. Real EXIF6 facts and original coded samples are bound before one independent reference rotation. Upscale retains the experimental ICC-aware reader scope. All five same-file requirements remain failed; ten rendering scopes and references enter the manual bundle. Apple intermediate adaptation remains untested.
- The [fractional map-gamma-1.5 candidate](icc-gainmap-midpointoffset-gamma1.5.json) passes the unchanged SDR, native HDR, independent HDR and cross-reader gates for ISO JPEG upscale. It retains the gamma-3.2 compressed base, eight-bit SOF0 layers and midpoint offsets. Qualification requires the experimental ICC-aware readers at display boost 16; the stock sRGB-assuming reader still fails and physical consumers remain pending. All five preceding failed representations remain separate.
- The [Android XMP fractional-gamma upscale](icc-gainmap-xmp-midpointoffset-gamma1.5.json) passes the same file gates using the existing PQ16 source bridge with requested native depth 12. Its source reference shares libavif gain application; source transport agreement is not a claim of a second source-renderer implementation. Independent final HDR readers still qualify the output. The ISO-only float32 guard, stock-reader failure and pending physical status are unchanged.
- New Apple containment passes the same ICC-aware JPEG recipe, while the original upscale remains failed at independent HDR shadow maximum 8.08225 against the unchanged limit 8. Native source/geometry/intent, SDR appearance and cross-reader agreement pass. A separate integer-DCT map keeps that shadow failure and adds highlight p95 failures in both HDR readers, with identical base and pre-JPEG map samples. A separately named FLOAT-base/FLOAT-map upscale preserves native gamma3.2 input and P3 ICC bytes, regenerates the map against its actual compressed base, and passes all gates at maximum HDR error 6.77896. The observed SOF0 union now covers 24/24 tuples, including 20/20 required, within the declared reader scope. Exact auxiliary XMP model/version/headroom facts govern this source; removing its non-authoritative MakerNotes leaves native reconstruction byte-identical, while unknown required XMP facts reject transformation.
- Old Apple containment and upscale also pass the exact midpoint-offset fractional-gamma recipe through the experimental ICC-aware readers. Native source reconstruction requires the original Apple headroom MakerNotes, with a real stripped-source rejection control. Final native and independent HDR gates remain separate from the shared-libavif source reference. Stock-reader failures and physical review stay pending.
- The [old Apple source-model diagnostic](apple-source-model.json) independently applies Apple's documented full effect: inverse Rec.709 map transfer, followed by linear gain multiplication using actual MakerNote headroom 8. Native import preserves every original base/map sample and applies the retained exponential coded-map convention. That convention passes its own control but fails six unchanged regional gates against the documented model: midtone mean/p95 Delta E 2.45608/6.41030 and highlight mean/p95 4.34848/6.23720, plus both relative-luminance p95 gates. These legacy endpoint measurements remain recorded with their model limitation. The documented full reference has a distinct revision; intermediate Apple adaptation and applicability to the transplanted newer XMP fixture remain unqualified.
- The gain-map AVIF authored SDR GIF containment remains failed despite valid native encoding, actual sRGB ICC, opaque one-frame structure and independent decoding. Palette-only and full-reference errors both exceed the fixed photographic gates. The read-only exact-palette lower bound identifies 900 pixels for which changing dithering cannot meet the existing maximum; it makes no claim about other palettes or encoders. A separate native libimagequant candidate also fails, with 951 pixels outside the fixed maximum for its exact palette. Its native package version and differing library API report are recorded separately. The separate gamma3.2 ICC/libimagequant palette improves shadow maximum to 46.78 and its bound to 794 pixels, but still fails the fixed shadow and midtone gates. All three photographic palettes remain unqualified.
- The [integer-DCT map alternative](icc-gainmap-midpointoffset-gamma2-islow.json) retains the exact midpoint gamma-2 compressed base and native pre-JPEG map. It changes only native map JPEG coding. Both HDR readers still fail shadow maxima and their agreement worsens; its original floating-DCT counterpart remains separate.
- The [corrected native old Apple source](apple-native-source.json) applies the documented full model with native JPEG samples, bilinear8 map expansion and FFmpeg float32 arithmetic. It passes the independent photographic gates with maximum Delta E ITP 0.000027853. Analytic controls cover all 65,536 base/map code pairs at full-effect headrooms 1 and 8; maximum numeric error is 0.000466684 nits. Unknown source facts reject preparation. This qualifies encoder input only; derivatives, intermediate adaptation and the newer Apple model require separate evidence. The legacy source-model failures remain recorded.
- The [corrected old Apple containment](apple-hdr-jpeg-contain.json) uses the independently established documented full source, native P3 float geometry and checked PQ16 intent. Its actual RGB8 SOF0 layers and authored SDR grade pass all declared file gates at boost 16. Independent HDR maximum is 4.52892; native maximum is 4.22494; authored SDR maximum remains exactly 4.64090 from the retained control. The source headroom is 8 and both full gain weights equal one. The inspected manual bundle contains its own JPEG, SDR reference and native HDR intent. ICC-aware interpretation remains required; stock-reader limitations, intermediate Apple adaptation and physical consumers remain unqualified.
- Separately regenerated gain-map AVIF containment, crop, stretch and upscale check actual base, map and alternate precision against the source. Each native moderate-offset depth-8 candidate passes authored SDR and both HDR readers at log2 display headroom 4. The four stock depth-8 results fail; all eight automatic-depth variants declare alternate depth 12 and remain incompatible with the requested preservation selectors. Regenerated headroom and offsets differ from the source, so intermediate display adaptation remains untested. This is a declared endpoint proof, with physical consumers pending.
- The [logarithmic midpoint-offset candidate](icc-gainmap-midpointoffset-gamma2.json) fixes the gamma-2 trial at ISO offsets 1/16384. Both HDR readers pass the existing midtone/highlight gates but fail their shadow maxima; their cross-comparison also fails in shadows. This separate result narrows the precision tradeoff without qualifying the JPEG or changing the original gates.
- The [separate map-gamma-2 experiment](icc-gainmap-smalloffset-gamma2.json) retains the small ISO offset and both eight-bit JPEG layers. AVIF/ISO/XMP/native gamma values and zero/fractional/full-headroom controls must agree. Highlight error improves, but shadow error and regional means remain failed under the same gates. Earlier gamma-1 bytes and failed cases stay separate.
- Separate ICC-aware HDR JPEG experiments use the actual gamma-3.2 base profile, native LittleCMS float32 linearization and native gain computation. Both the [moderate-offset](icc-gainmap-moderateoffset.json) and [small-offset](icc-gainmap-smalloffset.json) cases remain in the matrix. The former fails independent shadow reconstruction and decoder agreement; the latter improves agreement but fails midtone/highlight appearance. The fixed references, RGB8 layer depths and appearance gates are unchanged. Stock readers that assume sRGB or reject ICC remain separately recorded limitations. Their inspected files are diagnostic, with physical consumers pending.
- Single-layer HDR PNG16 from the verified gain-map AVIF renderer retains a distinct original aspect failure: pHYs 0:1 does not establish the requested square pixels. A separate native setsar=1 rewrite must preserve every decoded RGB16 and alpha sample while establishing 1:1. Independent chunk parsing, ExifTool, libpng and FFmpeg check color, depth, geometry, privacy and storage; unchanged source, geometry and HDR appearance gates still apply. Neither representation certifies physical HDR presentation.
- The locked gain-map AVIF source has separately qualified standard-sRGB RGB8 JPEG containment, crop and stretch. Its standard-sRGB upscale remains failed at shadow maximum 25.49485 in both native-input and full-reference comparisons. A separate gamma-3.2 ICC upscale passes the same gates with shadow maximum 3.83562. Exhaustive native transfer checks preserve the authored SDR reference and primaries; regional mean errors increase but stay within their unchanged limits. Actual ICC semantics, RGB components and Adobe transform establish color; raw decoder defaults remain diagnostics. Native JPEG coding error and full authored-reference error must both pass unchanged photographic gates. No separate JPEG aspect declaration is invented, and physical compatibility remains pending.
- The gain-map AVIF source has separately qualified HDR JPEG containment, crop, stretch and upscale through ICC-aware readers at display boost 16. Native authored SDR and corrected PQ16 HDR preparations supply encoder pixels; direct dav1d source samples and parsed tmap metadata supply the independent reference. Actual RGB8 SOF0 layers, ISO/XMP/native agreement, privacy and both endpoint appearances pass unchanged gates. Independent HDR maximum across these geometries is 6.10543; original containment bytes and measurements remain exact. These endpoint measurements retain stock-reader limitations; separate intermediate rendering and physical consumer checks remain necessary.
- A separate gain-map AVIF-to-HDR-JPEG containment proof renders that exact file at display boost 2. Both readers agree but fail the unchanged appearance gates, with independent shadow maximum 75.26896. Capacity-normalized and uncompressed-map diagnostics retain shadow errors. The original authored SDR geometry remains fixed; replacing it with linear-light geometry would fail its existing reference. This measured adaptation failure does not create an additional required product path or change the passing boost-16 endpoint.
- An optional unresized gain-map AVIF-to-HDR-JPEG conversion retains the original raster and checked source gain metadata. One actual RGB8 file passes authored SDR and both HDR readers at boosts 2, source-full and 16. Independent HDR maximum is 4.666031 across those renderings; SDR maximum is 3.962015. Actual ICC interpretation remains necessary. Candidate/reference pairs are prepared for physical review. This identity result does not qualify resizing, crop, orientation or unmeasured headrooms; the failed resized candidates remain unchanged.
- A separate native AVIF-to-HDR-JPEG trial retains original source gain metadata while resizing its map and authored base separately. It restores matching source/output weights and preserves the SDR measurement exactly, but fails HDR appearance at boost 2, source-full headroom and boost 16. Independent shadow maxima are 146.7847 at boost 2 and 171.395 at full headroom. Read-only reference diagnostics identify exact nonmonotonic channel samples that an equal-offset gain curve cannot reproduce exactly; they do not prove that every approximate encoding must fail the regional limits.
- Authored SDR WebP containment, crop, stretch and upscale from the locked gain-map AVIF uses the same verified native source/geometry preparation. Actual lossless RGB8 WebP and native sRGB ICC semantics are independently inspected. FFmpeg and libwebp must recover every native input sample exactly; the independent authored SDR reference and unchanged photographic limits still determine appearance qualification. HDR and physical consumer interpretation are separate.
- Original Sharp, retained-map and native-regeneration candidates keep their measured failures. Resampling a base and logarithmic map separately does not commute with resizing reconstructed HDR in linear light. The native combined candidate instead resizes the authored SDR and reconstructed HDR intents separately, computes a new map, and retains both compressed RGB8 JPEG layers exactly. Independent FFmpeg SDR decoding, native libultrahdr HDR reconstruction and a separately validated ISO reader check the emitted file.
- The separately versioned gainmap-hdr-target-gamut-v1 reference filters and clips negative Lanczos excursions in the requested output primaries. Clipping in the earlier Rec.2020 decoder coordinates could create negative components in the requested P3 or sRGB gamut. Analytic commutation, out-of-gamut and identity controls verify this correction. Old references and failed case IDs remain visible; new cases record the reference revision and diagnostic differences. Appearance thresholds are unchanged.
- Combined gain-map candidates use JPEG SOF3 predictive RGB8 coding and proof-local native patches. The pinned libavif JPEG reader rejects SOF3, while the separately tested native JPEG/ISO and patched libultrahdr readers decode it. File qualification does not establish browser or wallpaper compatibility. Every exact representation still requires the listed physical consumer checks.
- Separate SOF0 RGB8 DCT candidates compute a gain map against their actual compressed SDR base. SOF0 layer coding alone does not establish ICC-aware gain-map reconstruction; DCT shadow errors still disqualify other cases. The baseline libavif JPEG-to-AVIF-to-PQ decoder route adds eight-bit YCbCr map rounding. A separate native RGB reader preserves map samples without that conversion. Both reader results retain their own measurements and failures without changing any conversion gate. Neither decoder result qualifies a physical browser or wallpaper setter.
- A separate moderate-offset native gain-map candidate uses offsets of 1/4096 to reduce the eight-bit map interval while retaining near-black accuracy. Analytic dark controls and unchanged regional appearance gates check the tradeoff. All ISO, ExifTool XMP and native probe channel extrema, gamma, offsets and headroom must agree within documented serialization precision. The prior identity-policy upscale failures stay visible.
- Separate ISO float32 source candidates reuse the native codec transfer/gain functions before half-float storage and retain native float geometry. They must pass independent source, geometry, PQ intent and emitted-JPEG measurements. Floating-DCT alternatives use the native JDCT_FLOAT encoder while retaining the existing sRGB base transfer. Earlier source-precision and integer-DCT failures remain recorded.
- Single-layer PQ PNG16 and AVIF12 candidates independently decode the executed native HDR intent against the gain-map source reference. They explicitly request output depth and preserve source primaries. The native PNG inspection file is also included as a manual comparison; its presence alone never qualifies a separate conversion. Explicit SDR requests continue to select the authored base.
- The retained native JPEG writer emits independently parsed ISO plus per-channel Android metadata. Android element-style XMP now encodes and independently reconstructs. The validated ISO source reader removes a source-evidence gap within its declared scope. The separate native libavif regeneration route still rejects ISO-only input. Fractional map-coordinate crops in the retained-map route remain explicit failures.
- Same-transfer AVIF geometry operates in display-linear light with explicit alpha handling. Cover resizing filters before cropping. A separate native coverage resample normalizes image-edge weights to the unchanged independent reference. The declared required static and animated HDR AVIF requests have qualified file evidence; this does not extend to untested photographs or consumers.
- Calibrated static and sequence-wide SDR tone/gamut controls pass. Eight-bit sRGB-transfer failures remain visible. Higher-depth and correctly declared gamma-2.2 candidates retain the same predeclared sdr-8 appearance ceiling and distinct case IDs. Qualified alternatives can satisfy matching product selectors; they never change a failed representation into a passing one. The gamma transfer must be interpreted correctly by each consumer.
- Animated outputs retain separate checks for fully composed frames, unequal durations, repetition count and fractional alpha. Only the matching qualified representation can fulfill the requested animation and transparency selectors.
- Every two-frame AVIF and APNG output also checks exact encoded-white stability where the independent references prove an unchanged source neighborhood. A one-code signal shift fails that control. Full-frame regional appearance and tone checks still apply.
- Additional gamma-3.2 GIF candidates use native nearest rounding and retain the same SDR reference and fixed thresholds. Static AVIF/APNG cases have separate IDs from gamma-2.2 failures. Optional animated APNG-to-GIF cases preserve 300/700 ms timing and three total plays, encoded as two GIF repeats. Explicit binary coercion compares exact threshold decisions. Quantized half-alpha mismatches remain failed and record the reference, encoder-input and decoded values.
- A further animated GIF candidate resamples alpha separately with native zimg and rounds to sixteen bits after each axis. Independent checks require identical RGB16 samples, intermediate alpha error within the existing PNG16 ceiling and exact final binary decisions. These candidates preserve the original SDR grade and keep the earlier half-alpha failures visible.
- Static 16-bit HDR PNG sources have separate PQ/HLG, P3/Rec.2020 and alpha evidence for identity, contain, cover, fill, upscale and independently checked EXIF-8 orientation. Their source and HDR conversions use the unchanged stricter avif-12 appearance gates. Matching same-format identity requests are byte-exact controls. Six conflicting/unknown PNG signaling controls retain exact originals and withhold transforms.
- Separate eight-bit PQ/HLG PNG sources use their own reviewed source hash lock. Their containment cases cover HDR PNG8/AVIF8 and explicit SDR PNG16/AVIF8. The direct-input failures remain recorded. A separate native zimg storage expansion must preserve every independently decoded RGBA sample exactly before conversion; it changes neither the reference intent nor the fixed output gates. The normalized candidate also covers crop, fill, upscale and real EXIF-8 orientation under the same gates. Eight separately hashed orientation sources require unchanged coded samples and an exact independent rotation check before resampling. Matching requests retain exact originals, and unknown CICP facts withhold transformations. Unlisted PNG8 geometries and formats remain untested.
- Four animated RGBA16 APNG sources cover PQ/HLG and P3/Rec.2020 with full-canvas SOURCE frames, no disposal, 300/700 ms timing and three plays. An independent chunk reader verifies animation/color metadata and passes unchanged compressed frame data to native libpng. Contain, cover, fill, upscale and independently checked EXIF-8 orientation derivatives cover HDR APNG/AVIF and explicit SDR APNG/AVIF/WebP under unchanged gates. Four orientation sources have distinct hashes and every native rotation matches the independently decoded frames exactly. PQ uses one 4000-nit sequence peak; HLG uses its 1000-nit reference display. HDR APNG has CICP, SDR APNG has standard sRGB signaling, and SDR AVIF/WebP have gamma-2.2 CICP/ICC. Native SOURCE rectangles are independently reconstructed by exact RGBA replacement; out-of-bounds rectangles, partial default images, OVER blending and disposal remain rejected. Static extraction checks the first fully composed frame for HDR PNG/AVIF and SDR PNG/AVIF/WebP/JPEG/GIF at each tested geometry. JPEG opacity and GIF binary alpha require explicit coercion; preserve-alpha requests are rejected. The two original gamma-2.2 PQ static GIF orientation cases exceed the fixed shadow color-error ceiling and remain unqualified. The newer gamma-3.2 cases retain separate measurements and qualification. Unlisted APNG geometries remain untested.
- Additional PNG8-to-HDR PNG16 and AVIF12 cases use the stricter existing avif-12 output gates across contain, cover, fill, upscale and real EXIF-8 orientation. Source quantization is measured separately. Native rotation must match the independently decoded original samples before geometry changes; alpha must remain within two codes at the actual output depth.
- Separate PNG8-to-SDR WebP candidates cover containment, crop, stretch, upscale and real EXIF-8 orientation with both original and nearest-code quantization. They use the unchanged tone/gamut grade and gamma-2.2 ICC coding. The static VP8L reader checks dimensions, alpha signaling, metadata and chunk structure. Independent native FFmpeg decoding must match Pillow/libwebp and the actual encoder-input codes exactly. Nearest-code candidates must also match independently rounded input samples within half a code. Those exact storage checks do not replace appearance, tone or alpha thresholds.
- One separately locked gain-map AVIF source has authored-SDR AVIF containment, crop, stretch and upscale candidates. Independent BMFF/tmap parsing, actual AV1 packet depth/signaling, dav1d samples and AOM candidate decoding establish the source base. Native metadata text repeats channel-zero gain values; the independently parsed per-channel fractions remain authoritative. Unknown color, depth, orientation or metadata withholds transformation and preserves exact originals. Nonidentity orientation remains original-only. The SDR result does not establish HDR qualification.
- Additional authored-SDR PNG8 containment, crop, stretch and upscale candidates use the same gain-map AVIF base and unchanged photographic SDR reference. Their native sRGB/cHRM/gAMA signaling and square-pixel pHYs are independently parsed and cross-checked with ExifTool. Native libpng must recover every actual encoder-input RGB8 sample exactly. Appearance and privacy remain separate gates; source import error receives no additional allowance.
- Gain-map AVIF HDR containment, crop, stretch and upscale each have two distinct native candidates against the same predeclared bilinear-map renderer convention. Original libavif source, linear-geometry and emitted-output failures remain recorded. The separate native antialiased-map and float32 gain candidate must pass all three unchanged appearance gates and independent single-layer PQ AVIF12 signaling, depth, opacity, square-pixel and privacy checks. Each input normalization is retained during PQ encoding. Its renderer convention is not claimed as a uniquely mandated ISO filter or as physical interoperability. Named source-reconstruction profiles are bound to the canonical fixture hash without changing the original SDR inspection facts.
- Unlisted PNG/APNG cross-products, HDR WebP and other unexecuted accepted-source requests remain untested. Other gain-map AVIF selector and adaptation combinations remain unqualified. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.
- These are proof-side selector and byte-delivery controls. Production endpoint integration, byte-free metadata persistence and generation-owned facts still need implementation tests; this suite does not claim those endpoints exist.
- The fixtures include synthetic charts and the documented upstream gain-map corpus. Additional independent real-device photographs, gain-map depth/layout variants and wider motion/composition corpora remain coverage gaps.
- Safari on the named Mac and iPad, Chrome on Windows/Galaxy, Firefox SDR fallbacks, downloaded files, native viewers and built-in wallpaper setters all remain pending user review. An OS that flattens HDR does not remove the HDR download; a usable SDR download still must qualify.

Prepared 1130 inspected source/candidate files with hashes. Follow [the physical-device checklist](../MANUAL.md). No UI, migration, generation policy, caching, source-admission or production delivery behavior changed.

## Suite integrity

Proof-side controls: 144. Unit tests run before native conversions. Evidence validation errors: 0.

Policy authority: [HDR resolution](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153), [complete ledger](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681), [proof ticket](https://github.com/rafaeltab/wallpaperdb/issues/284), [delivery contract](https://github.com/rafaeltab/wallpaperdb/issues/250). Native algorithm references: [FFmpeg libplacebo filter](https://ffmpeg.org/ffmpeg-filters.html#libplacebo), [libplacebo options](https://libplacebo.org/options/), [libavif tools](https://github.com/AOMediaCodec/libavif/tree/v1.4.1/apps), [Sharp gain-map API](https://sharp.pixelplumbing.com/api-output/#keepgainmap).

# HDR conversion proof results

The HDR milestone remains blocked. Automated codec results do not qualify browser HDR presentation, native viewers, or OS wallpaper setters. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.

Reproduce from the repository root with `make run PACKAGE=media SCRIPT=proof:hdr`. Docker must support linux/amd64. The default command returns exit 2 while required codec cases or physical checks are unqualified. This is an intentional qualification failure, not a passing release gate.

Recorded 2813 conversion attempts over 64 fixture records: 2803 completed native encoding, 10 stopped at a native operation, and 0 lack a confirmed native outcome. Qualification outcomes: 2178 qualified, 635 tested and failed.
The inventory covers 85 HDR-ledger cells and 5 labeled SDR controls. Ledger outcomes: 9 deliberately deferred, 17 incompatible with the requested selectors, 12 qualified, 28 tested and failed, 19 untested.

The original fixed coverage plan contains 320 cases. Unexecuted fixed-plan cases: 0. Unlisted cross-products are untested, even when a neighboring case passes.

## Accepted product coverage

320 of 320 declared product fixture/geometry requirements have qualified codec evidence. 0 have no matching tested tuple.

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

These counts cover the declared corpus only. A ledger cell can retain failed exact-selector candidates while its required product requests have qualified alternatives. Consumer review and a usable SDR wallpaper download remain separate requirements. The original fixed-plan outcomes below remain visible.

## Failure stages

Of 320 original fixed-plan cases, 320 have exact fixture/selector evidence and 156 qualify. This plan chose eight-bit SDR AVIF; that choice is not a product requirement when depth is omitted. Native encoding completed in 320; 0 stopped at a native operation. A native failure can occur while preparing an input fixture, before the final encoder is reached.

Across all recorded cases, 600 have measured check failures and 57 lack required evidence. These counts overlap. A missing ordinary-white patch after cropping or an unavailable independent gamut reference is an evidence gap, not a measured change to those pixels.

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
| avif-gainmap | hdr | jpg | after proof | untested | 0 |
| avif-gainmap | hdr | avif | after proof | tested and failed | 0 |
| avif-gainmap | hdr | png | after proof | untested | 0 |
| avif-gainmap | hdr | webp | after proof | untested | 0 |
| avif-gainmap | hdr | gif | reject | incompatible with the requested selectors | 0 |
| avif-gainmap | sdr | jpg | after proof | untested | 0 |
| avif-gainmap | sdr | avif | after proof | untested | 0 |
| avif-gainmap | sdr | png | after proof | untested | 0 |
| avif-gainmap | sdr | webp | after proof | untested | 0 |
| avif-gainmap | sdr | gif | after proof | untested | 0 |
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
| `gainmap-android-iso` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.0004 | 5.0994 | 1.7891 | 5.2962 | 2.5180 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 3/6 | 0.3705 | 28.6637 | 1.1815 | 7.5796 | 1.9210 |
| `gainmap-android-iso` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 2/6 | 0.3957 | 26.8878 | 1.2715 | 7.7325 | 1.8473 |
| `gainmap-android-iso` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 4/6 | 0.4356 | 28.6637 | 1.1834 | 7.5227 | 1.9313 |
| `gainmap-android-iso` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 5.0994 | 1.0444 | 4.6038 | 1.6505 |
| `gainmap-android-iso` | `native-combine-moderateoffset-lossless-rgb-source-float32` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 5.0994 | 1.0460 | 4.2965 | 1.6285 |
| `gainmap-android-xmp` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 2.0849 | 1.2553 | 3.0473 | 3.1721 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.3243 | 27.7158 | 0.8948 | 6.4785 | 2.3871 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.3479 | 25.4949 | 0.9491 | 6.1151 | 2.5249 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.3577 | 25.4949 | 0.8988 | 6.5961 | 2.3915 |
| `gainmap-android-xmp` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0004 | 2.0849 | 0.7819 | 3.7019 | 1.9795 |
| `gainmap-apple-new` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.0003 | 3.3440 | 1.8773 | 4.0623 | 2.4850 |
| `gainmap-apple-new` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 4/6 | 0.3626 | 28.6637 | 1.2462 | 7.7442 | 1.9281 |
| `gainmap-apple-new` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 3/6 | 0.3906 | 28.6637 | 1.3123 | 7.8035 | 1.8902 |
| `gainmap-apple-new` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 2/6 | 0.4328 | 35.2023 | 1.2259 | 7.7970 | 1.8154 |
| `gainmap-apple-new` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0003 | 3.3440 | 1.1281 | 4.2359 | 1.5549 |
| `gainmap-apple-old` | `native-combine-identity-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 5/6 | 0.0003 | 3.3440 | 1.7808 | 4.0685 | 3.0539 |
| `gainmap-apple-old` | `native-combine-moderateoffset-dct-float-rgb` | `gainmap-hdr-target-gamut-v1` | 4/6 | 0.3626 | 28.6637 | 1.2516 | 8.2264 | 2.2192 |
| `gainmap-apple-old` | `native-combine-moderateoffset-dct-rgb` | `gainmap-hdr-target-gamut-v1` | 3/6 | 0.3906 | 28.6637 | 1.3224 | 8.1888 | 2.2909 |
| `gainmap-apple-old` | `native-combine-moderateoffset-jpegli-base-dct-float-map` | `gainmap-hdr-target-gamut-v1` | 2/6 | 0.4328 | 35.2023 | 1.2674 | 8.4480 | 2.2087 |
| `gainmap-apple-old` | `native-combine-moderateoffset-lossless-rgb` | `gainmap-hdr-target-gamut-v1` | 6/6 | 0.0003 | 3.3440 | 1.1055 | 4.6705 | 2.0067 |

The following separate decoder diagnostics do not alter the file qualification above. The original reader results remain recorded. A successful readback still leaves every physical consumer pending manual review.

| Independent reader diagnostic | Attempted | Appearance passed | Failed or unqualified |
| --- | ---: | ---: | ---: |
| `baseline_libavif` | 72 | 16 | 56 |
| `rgb_libavif` | 72 | 69 | 3 |

The separate [JPEGli base experiment](jpegli-base-experiment.json) records 64 native SOF0 RGB8 trials, of which 4 pass the unchanged authored-SDR base checks. Each failed trial retains its regional measurements. These base experiments do not qualify an HDR derivative and are excluded from the conversion-attempt counts above. A JPEGli HDR candidate must independently regenerate and validate its gain map and reconstructed HDR output.

## Blockers and scope limits

- Original Sharp, retained-map and native-regeneration candidates keep their measured failures. Resampling a base and logarithmic map separately does not commute with resizing reconstructed HDR in linear light. The native combined candidate instead resizes the authored SDR and reconstructed HDR intents separately, computes a new map, and retains both compressed RGB8 JPEG layers exactly. Independent FFmpeg SDR decoding, native libultrahdr HDR reconstruction and a separately validated ISO reader check the emitted file.
- The separately versioned gainmap-hdr-target-gamut-v1 reference filters and clips negative Lanczos excursions in the requested output primaries. Clipping in the earlier Rec.2020 decoder coordinates could create negative components in the requested P3 or sRGB gamut. Analytic commutation, out-of-gamut and identity controls verify this correction. Old references and failed case IDs remain visible; new cases record the reference revision and diagnostic differences. Appearance thresholds are unchanged.
- Combined gain-map candidates use JPEG SOF3 predictive RGB8 coding and proof-local native patches. The pinned libavif JPEG reader rejects SOF3, while the separately tested native JPEG/ISO and patched libultrahdr readers decode it. File qualification does not establish browser or wallpaper compatibility. Every exact representation still requires the listed physical consumer checks.
- Separate SOF0 RGB8 DCT candidates compute a gain map against their actual compressed SDR base. Passing cases have a coding form that the pinned libavif reader can decode; DCT shadow errors still disqualify other cases. The baseline libavif JPEG-to-AVIF-to-PQ decoder route adds eight-bit YCbCr map rounding. A separate native RGB reader preserves map samples without that conversion. Both reader results retain their own measurements and failures without changing any conversion gate. Neither decoder result qualifies a physical browser or wallpaper setter.
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
- Separate eight-bit PQ/HLG PNG sources use their own reviewed source hash lock. Their containment cases cover HDR PNG8/AVIF8 and explicit SDR PNG16/AVIF8. The direct-input failures remain recorded. A separate native zimg storage expansion must preserve every independently decoded RGBA sample exactly before conversion; it changes neither the reference intent nor the fixed output gates. Matching requests retain exact originals, and unknown CICP facts withhold transformations. Unlisted PNG8 geometries and formats remain untested.
- Four animated RGBA16 APNG sources cover PQ/HLG and P3/Rec.2020 with full-canvas SOURCE frames, no disposal, 300/700 ms timing and three plays. An independent chunk reader verifies animation/color metadata and passes unchanged compressed frame data to native libpng. Contain, cover, fill, upscale and independently checked EXIF-8 orientation derivatives cover HDR APNG/AVIF and explicit SDR APNG/AVIF/WebP under unchanged gates. Four orientation sources have distinct hashes and every native rotation matches the independently decoded frames exactly. PQ uses one 4000-nit sequence peak; HLG uses its 1000-nit reference display. HDR APNG has CICP, SDR APNG has standard sRGB signaling, and SDR AVIF/WebP have gamma-2.2 CICP/ICC. Native SOURCE rectangles are independently reconstructed by exact RGBA replacement; out-of-bounds rectangles, partial default images, OVER blending and disposal remain rejected. Static extraction checks the first fully composed frame for HDR PNG/AVIF and SDR PNG/AVIF/WebP/JPEG/GIF at each tested geometry. JPEG opacity and GIF binary alpha require explicit coercion; preserve-alpha requests are rejected. The two PQ static GIF orientation cases exceed the fixed shadow color-error ceiling and remain unqualified. Unlisted APNG geometries remain untested.
- Unlisted PNG/APNG cross-products, HDR WebP, gain-map AVIF and other unexecuted accepted-source requests remain untested. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.
- These are proof-side selector and byte-delivery controls. Production endpoint integration, byte-free metadata persistence and generation-owned facts still need implementation tests; this suite does not claim those endpoints exist.
- The fixtures include synthetic charts and the documented upstream gain-map corpus. Additional independent real-device photographs, gain-map depth/layout variants and wider motion/composition corpora remain coverage gaps.
- Safari on the named Mac and iPad, Chrome on Windows/Galaxy, Firefox SDR fallbacks, downloaded files, native viewers and built-in wallpaper setters all remain pending user review. An OS that flattens HDR does not remove the HDR download; a usable SDR download still must qualify.

Prepared 808 inspected source/candidate files with hashes. Follow [the physical-device checklist](../MANUAL.md). No UI, migration, generation policy, caching, source-admission or production delivery behavior changed.

## Suite integrity

Proof-side controls: 56. Unit tests run before native conversions. Evidence validation errors: 0.

Policy authority: [HDR resolution](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153), [complete ledger](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681), [proof ticket](https://github.com/rafaeltab/wallpaperdb/issues/284), [delivery contract](https://github.com/rafaeltab/wallpaperdb/issues/250). Native algorithm references: [FFmpeg libplacebo filter](https://ffmpeg.org/ffmpeg-filters.html#libplacebo), [libplacebo options](https://libplacebo.org/options/), [libavif tools](https://github.com/AOMediaCodec/libavif/tree/v1.4.1/apps), [Sharp gain-map API](https://sharp.pixelplumbing.com/api-output/#keepgainmap).

# HDR conversion proof results

The HDR milestone remains blocked. Automated codec results do not qualify browser HDR presentation, native viewers, or OS wallpaper setters. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.

Reproduce from the repository root with `make run PACKAGE=media SCRIPT=proof:hdr`. Docker must support linux/amd64. The default command returns exit 2 while required codec cases or physical checks are unqualified. This is an intentional qualification failure, not a passing release gate.

Recorded 845 conversion attempts over 32 fixture records: 829 completed native encoding, 16 stopped at a native operation, and 0 lack a confirmed native outcome. Qualification outcomes: 290 qualified, 555 tested and failed.
The inventory covers 85 HDR-ledger cells and 5 labeled SDR controls. Ledger outcomes: 9 deliberately deferred, 17 incompatible with the requested selectors, 5 qualified, 28 tested and failed, 26 untested.

The finite required plan contains 320 cases. Unexecuted required cases: 0. Unlisted cross-products are untested, even when a neighboring case passes.

## Failure stages

Of 320 planned required cases, 320 have exact fixture/selector evidence and 132 qualify. Native encoding completed in 315; 5 stopped at a native operation. A native failure can occur while preparing an input fixture, before the final encoder is reached.

Across all recorded cases, 489 have measured check failures and 108 lack required evidence. These counts overlap. A missing ordinary-white patch after cropping or an unavailable independent gamut reference is an evidence gap, not a measured change to those pixels.

False downstream flags on a failed native operation are unevaluated. They do not establish additional appearance, decoder, or metadata privacy failures. Successful encoding also does not establish qualification. The original status enums and required passing criteria remain unchanged.

| Required path | Planned | Observed | Native completed | Native failure | Measured failure | Missing evidence | Qualified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gainmap-jpeg:hdr:jpg` | 20 | 20 | 15 | 5 | 15 | 5 | 0 |
| `gainmap-jpeg:sdr:jpg` | 40 | 40 | 40 | 0 | 35 | 5 | 0 |
| `static-avif:hdr:avif` | 120 | 120 | 120 | 0 | 18 | 0 | 102 |
| `static-avif:sdr:avif` | 120 | 120 | 120 | 0 | 96 | 0 | 24 |
| `animated-pq:hdr:avif` | 10 | 10 | 10 | 0 | 4 | 0 | 6 |
| `animated-pq:sdr:avif` | 5 | 5 | 5 | 0 | 5 | 0 | 0 |
| `animated-pq:sdr:webp` | 5 | 5 | 5 | 0 | 5 | 0 | 0 |

Measured failures and evidence gaps count cases once per column, even when several frames fail. Per-check counts and case diagnostics are in [the matrix](conversion-matrix.json); raw measurements and native errors remain in [measurements](measurements.json).

## Environment and reproducibility

The image uses the same Node 22 Alpine/musl deployment shape as Media. This is a proposed native proof pipeline, not the existing Sharp 0.33 production worker. No service dependency was upgraded. HDR geometry uses native FFmpeg/zimg float processing and luminance-coupled HLG transforms. The calibrated SDR candidate uses the native CPU Mobius filter. CPU lavapipe runs the retained libplacebo comparison trials without a host GPU. Network access is disabled during tests.

- Node: `v22.22.3`
- AVIF tools: `Version: 1.4.1 (dav1d [dec]:1.5.3, aom [enc/dec]:v3.14.1)`
- FFmpeg: `ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers`
- ExifTool: `13.55`
- Unchanged threshold file SHA-256: `0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf`

The base image is pinned by digest. Every additional APK is pinned by URL and SHA-256, the full package inventory is checked, npm uses its integrity lock, and native source archives have checked hashes. See [native versions](native-versions.json), [dependency locks](../environment/), [commands](commands.json), [fixture facts and hashes](fixtures.json), and [generator hashes](../fixtures/generated-sha256.json).

## How to read the evidence

A qualified case requires a real encoder, a separate decoder, exact structural checks, fixed appearance thresholds, and metadata privacy. Independent AV1 decoding uses dav1d, while encoding uses AOM. ExifTool independently reads emitted signaling. The locally patched libavif sequence writer retains animated orientation; its patch and binary hashes are recorded. Gain-map JPEG uses pinned experimental libultrahdr PR484 and PR491 patches in a separate native adapter, with dual ISO/Android metadata. These are proof builds, not upstream releases. ISO-only source calculations still cannot replace an unavailable maintained independent source decoder.

All comparisons use display-referred linear light. PQ uses ST 2084 absolute luminance. HLG uses a declared 1000-nit reference display and gamma 1.2 OOTF. Geometry references use independent Pillow floating-point bilinear resampling with premultiplied alpha. The comparison includes patch boundaries; interpolation differences are measured rather than hidden by discarding edges. These synthetic charts stress conversion and do not represent every photographic or artistic source.

The predeclared [thresholds](../thresholds.json) report BT.2124 Delta E ITP and luminance error separately for shadows, midtones, and highlights. Best-effort SDR additionally requires 203-nit ordinary white near 0.90 sRGB signal, retained shadows/midtones, smooth highlight detail, and an independent chromatic mapping reference. The calibrated candidate uses a fixed Mobius knee of 0.6, a 1.1 exposure factor and 0.99 peak output scale. Its explicit relative-colorimetric gamut mapping clips out-of-gamut sRGB channels after primary conversion; it does not claim perceptual gamut compression. The independent reference derives the shoulder from boundary conditions and converts through D65 XYZ. Identity controls test tone policy before crop, while every encoded derivative is compared at its actual geometry, grouped by source HDR luminance region. Authored JPEG SDR bases bypass automatic HDR tone mapping.

Read [measurements](measurements.json) for each case, including native failures, facts, region statistics, source/output hashes and artifact paths. Full artifacts remain under `../work/` after a run; selected inspected files are committed under [manual](manual/manifest.json). Failed candidates are diagnostic files, not approved fallbacks.

## Required and candidate paths

| Source family | Range | Output | Policy | Automated status | Missing required cases |
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
| static-avif | hdr | avif | required | tested and failed | 0 |
| static-avif | hdr | png | after proof | qualified | 0 |
| static-avif | hdr | webp | after proof | tested and failed | 0 |
| static-avif | hdr | gif | reject | incompatible with the requested selectors | 0 |
| static-avif | sdr | jpg | after proof | tested and failed | 0 |
| static-avif | sdr | avif | required | tested and failed | 0 |
| static-avif | sdr | png | after proof | qualified | 0 |
| static-avif | sdr | webp | after proof | tested and failed | 0 |
| static-avif | sdr | gif | after proof | tested and failed | 0 |
| animated-pq | hdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-pq | hdr | avif | required | tested and failed | 0 |
| animated-pq | hdr | png | after proof | qualified | 0 |
| animated-pq | hdr | webp | after proof | tested and failed | 0 |
| animated-pq | hdr | gif | reject | incompatible with the requested selectors | 0 |
| animated-pq | sdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-pq | sdr | avif | required | tested and failed | 0 |
| animated-pq | sdr | png | after proof | tested and failed | 0 |
| animated-pq | sdr | webp | required | tested and failed | 0 |
| animated-pq | sdr | gif | after proof | tested and failed | 0 |
| animated-hlg | hdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-hlg | hdr | avif | after proof | tested and failed | 0 |
| animated-hlg | hdr | png | after proof | qualified | 0 |
| animated-hlg | hdr | webp | after proof | tested and failed | 0 |
| animated-hlg | hdr | gif | reject | incompatible with the requested selectors | 0 |
| animated-hlg | sdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-hlg | sdr | avif | after proof | tested and failed | 0 |
| animated-hlg | sdr | png | after proof | qualified | 0 |
| animated-hlg | sdr | webp | after proof | tested and failed | 0 |
| animated-hlg | sdr | gif | after proof | tested and failed | 0 |
| hdr-png | hdr | jpg | after proof | untested | 0 |
| hdr-png | hdr | avif | after proof | untested | 0 |
| hdr-png | hdr | png | after proof | untested | 0 |
| hdr-png | hdr | webp | after proof | untested | 0 |
| hdr-png | hdr | gif | reject | incompatible with the requested selectors | 0 |
| hdr-png | sdr | jpg | after proof | untested | 0 |
| hdr-png | sdr | avif | after proof | untested | 0 |
| hdr-png | sdr | png | after proof | untested | 0 |
| hdr-png | sdr | webp | after proof | untested | 0 |
| hdr-png | sdr | gif | after proof | untested | 0 |
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
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | highlight | 0.3524 | 1.4030 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | shadow | 0.2169 | 0.0011 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | midtone | 0.0425 | 0.0163 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | highlight | 0.0651 | 0.2203 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | shadow | 0.3242 | 0.0079 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | midtone | 0.3193 | 0.0897 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | highlight | 0.3496 | 1.4000 |
| `gainmap-android-xmp:sdr:jpg:srgb:preserve:contain` | shadow | 11.2978 | 0.3151 |
| `gainmap-android-xmp:sdr:jpg:srgb:preserve:contain` | midtone | 4.9543 | 0.6743 |
| `gainmap-apple-new:sdr:jpg:preserve:preserve:contain` | shadow | 7.1993 | 0.0610 |
| `gainmap-apple-new:sdr:jpg:preserve:preserve:contain` | midtone | 4.8474 | 0.5717 |

The tunable Mobius and Reinhard trials use maintained native functions with fixed parameters. Their failures do not change the white target. Adaptive peak detection is disabled in the candidate conversion path; separate controls record frame-to-frame white shifts and repeat hashes with it enabled and disabled. Persistent temporal-filter history is not qualified by these per-frame trials.

## Blockers and scope limits

- The pinned Apple fixes remove the retained-layer encoding error and correct new-Apple headroom. Required Apple geometries now encode and independently decode, but regional SDR-base and HDR reconstruction errors still exceed the fixed limits. Resampling the base and logarithmic map separately does not commute with resizing reconstructed HDR in linear light. Recomputing a map against the retained authored base remains an untested candidate.
- The retained native JPEG writer now emits independently parsed ISO plus Android metadata. ISO-only source JPEG still lacks a maintained independent reconstruction reader in this environment. The Android element-style XMP fixture is rejected by the native reader; fractional map-coordinate crops also remain rejected. These failures are explicit.
- Same-transfer AVIF geometry now operates in display-linear light with explicit alpha handling. Cover resizing filters the full image before cropping, preserving samples across the crop boundary. Remaining image-edge downscale differences and output quantization still fail some regional appearance/alpha gates. Native zimg clamps the filter at image boundaries; the independent Pillow reference truncates and normalizes there. The animated orientation serialization regression passes.
- Calibrated static SDR tone/gamut controls pass, and exact SDR PNG cases qualify. Some eight-bit SDR outputs still fail the unchanged near-black Delta E gates: rounding a small positive signal to black can exceed the maximum even when the tone policy passes. Optional 12-bit SDR AVIF tuples retain the same predeclared sdr-8 appearance ceiling and separate case IDs; they cannot replace failed required eight-bit requests. The animated PQ sequence also retains a highlight-gradation blocker.
- Animated outputs need exact fully composed frames, unequal durations, repetition count and fractional alpha. Failed animation or alpha cases remain required blockers.
- Unexecuted optional HDR PNG/APNG, HDR WebP, gain-map AVIF and other accepted-source rows remain untested. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.
- These are proof-side selector and byte-delivery controls. Production endpoint integration, byte-free metadata persistence and generation-owned facts still need implementation tests; this suite does not claim those endpoints exist.
- The fixtures include synthetic charts and the documented upstream gain-map corpus. Additional independent real-device photographs, gain-map depth/layout variants and wider motion/composition corpora remain coverage gaps.
- Safari on the named Mac and iPad, Chrome on Windows/Galaxy, Firefox SDR fallbacks, downloaded files, native viewers and built-in wallpaper setters all remain pending user review. An OS that flattens HDR does not remove the HDR download; a usable SDR download still must qualify.

Prepared 110 inspected source/candidate files with hashes. Follow [the physical-device checklist](../MANUAL.md). No UI, migration, generation policy, caching, source-admission or production delivery behavior changed.

## Suite integrity

Proof-side controls: 23. Unit tests run before native conversions. Evidence validation errors: 0.

Policy authority: [HDR resolution](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153), [complete ledger](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681), [proof ticket](https://github.com/rafaeltab/wallpaperdb/issues/284), [delivery contract](https://github.com/rafaeltab/wallpaperdb/issues/250). Native algorithm references: [FFmpeg libplacebo filter](https://ffmpeg.org/ffmpeg-filters.html#libplacebo), [libplacebo options](https://libplacebo.org/options/), [libavif tools](https://github.com/AOMediaCodec/libavif/tree/v1.4.1/apps), [Sharp gain-map API](https://sharp.pixelplumbing.com/api-output/#keepgainmap).

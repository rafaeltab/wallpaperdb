# HDR conversion proof results

The HDR milestone remains blocked. Automated codec results do not qualify browser HDR presentation, native viewers, or OS wallpaper setters. Issue #284 remains open. Valid original requests retain exact bytes; unqualified transforms remain unsupported, and unknown required source facts remain original-only.

Reproduce from the repository root with `make run PACKAGE=media SCRIPT=proof:hdr`. Docker must support linux/amd64. The default command returns exit 2 while required codec cases or physical checks are unqualified. This is an intentional qualification failure, not a passing release gate.

Executed 715 native conversion cases over 32 fixture records. Case outcomes: 12 qualified, 703 tested and failed.
The inventory covers 85 HDR-ledger cells and 5 labeled SDR controls. Ledger outcomes: 9 deliberately deferred, 17 incompatible with the requested selectors, 33 tested and failed, 26 untested.

The finite required plan contains 320 cases. Unexecuted required cases: 0. Unlisted cross-products are untested, even when a neighboring case passes.

## Environment and reproducibility

The image uses the same Node 22 Alpine/musl deployment shape as Media. This is a proposed native proof pipeline, not the existing Sharp 0.33 production worker. No service dependency was upgraded. CPU lavapipe runs libplacebo without a host GPU. Network access is disabled during tests.

- Node: `v22.22.3`
- AVIF tools: `Version: 1.4.1 (dav1d [dec]:1.5.3, aom [enc/dec]:v3.14.1)`
- FFmpeg: `ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers`
- ExifTool: `13.55`
- Fixed threshold file SHA-256: `0863bf98e1cecc6761edbdc6f6f8e70c22a5345cfa9f9d183fc5d100be88fccf`

The base image is pinned by digest. Every additional APK is pinned by URL and SHA-256, the full package inventory is checked, npm uses its integrity lock, and native source archives have checked hashes. See [native versions](native-versions.json), [dependency locks](../environment/), [commands](commands.json), [fixture facts and hashes](fixtures.json), and [generator hashes](../fixtures/generated-sha256.json).

## How to read the evidence

A qualified case requires a real encoder, a separate decoder, exact structural checks, fixed appearance thresholds, and metadata privacy. Independent AV1 decoding uses dav1d, while encoding uses AOM. ExifTool independently reads emitted signaling. Other decoder limitations remain explicit blockers. ISO gain-map calculations supplement the measurements but do not replace an unavailable maintained independent ISO reader.

All comparisons use display-referred linear light. PQ uses ST 2084 absolute luminance. HLG uses a declared 1000-nit reference display and gamma 1.2 OOTF. Geometry references use independent Pillow floating-point bilinear resampling with premultiplied alpha. The comparison includes patch boundaries; interpolation differences are measured rather than hidden by discarding edges. These synthetic charts stress conversion and do not represent every photographic or artistic source.

The predeclared [thresholds](../thresholds.json) report BT.2124 Delta E ITP and luminance error separately for shadows, midtones, and highlights. Best-effort SDR additionally requires 203-nit ordinary white near 0.90 sRGB signal, retained shadows/midtones, smooth highlight detail, and an independent chromatic mapping reference. Merely selecting libplacebo perceptual gamut mapping does not satisfy that last gate. Authored JPEG SDR bases bypass automatic HDR tone mapping.

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
| static-avif | hdr | png | after proof | tested and failed | 0 |
| static-avif | hdr | webp | after proof | tested and failed | 0 |
| static-avif | hdr | gif | reject | incompatible with the requested selectors | 0 |
| static-avif | sdr | jpg | after proof | tested and failed | 0 |
| static-avif | sdr | avif | required | tested and failed | 0 |
| static-avif | sdr | png | after proof | tested and failed | 0 |
| static-avif | sdr | webp | after proof | tested and failed | 0 |
| static-avif | sdr | gif | after proof | tested and failed | 0 |
| animated-pq | hdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-pq | hdr | avif | required | tested and failed | 0 |
| animated-pq | hdr | png | after proof | tested and failed | 0 |
| animated-pq | hdr | webp | after proof | tested and failed | 0 |
| animated-pq | hdr | gif | reject | incompatible with the requested selectors | 0 |
| animated-pq | sdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-pq | sdr | avif | required | tested and failed | 0 |
| animated-pq | sdr | png | after proof | tested and failed | 0 |
| animated-pq | sdr | webp | required | tested and failed | 0 |
| animated-pq | sdr | gif | after proof | tested and failed | 0 |
| animated-hlg | hdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-hlg | hdr | avif | after proof | tested and failed | 0 |
| animated-hlg | hdr | png | after proof | tested and failed | 0 |
| animated-hlg | hdr | webp | after proof | tested and failed | 0 |
| animated-hlg | hdr | gif | reject | incompatible with the requested selectors | 0 |
| animated-hlg | sdr | jpg | conditional reject | incompatible with the requested selectors | 0 |
| animated-hlg | sdr | avif | after proof | tested and failed | 0 |
| animated-hlg | sdr | png | after proof | tested and failed | 0 |
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

## Representative regional measurements

| Exact case | Region | Delta E ITP p95 | Mean absolute luminance error, nits |
| --- | --- | ---: | ---: |
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | shadow | 89.9584 | 0.2447 |
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | midtone | 114.9414 | 7.5150 |
| `avif-pq-rec2020-10-opaque:hdr:avif:preserve:preserve:contain` | highlight | 78.0665 | 16.6096 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | shadow | 63.0483 | 0.2102 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | midtone | 91.7682 | 7.4234 |
| `avif-hlg-p3-12-opaque:hdr:avif:preserve:preserve:contain` | highlight | 0.6889 | 12.1331 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | shadow | 125.5601 | 0.2415 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | midtone | 378.6606 | 55.5702 |
| `animated-pq-alpha:hdr:avif:preserve:preserve:contain` | highlight | 79.1067 | 20.5690 |
| `gainmap-android-xmp:sdr:jpg:srgb:preserve:contain` | shadow | 11.2978 | 0.3151 |
| `gainmap-android-xmp:sdr:jpg:srgb:preserve:contain` | midtone | 4.9543 | 0.6743 |
| `gainmap-apple-new:sdr:jpg:preserve:preserve:contain` | shadow | 7.1993 | 0.0610 |
| `gainmap-apple-new:sdr:jpg:preserve:preserve:contain` | midtone | 4.8474 | 0.5717 |

The tunable Mobius and Reinhard trials use maintained native functions with fixed parameters. Their failures do not change the white target. Adaptive peak detection is disabled in the candidate conversion path; separate controls record frame-to-frame white shifts and repeat hashes with it enabled and disabled. Persistent temporal-filter history is not qualified by these per-frame trials.

## Blockers and scope limits

- Apple gain-map retention on musl must preserve the authored base and reconstructed HDR together. Native failure or measured regeneration drift remains a blocker.
- ISO-only output needs a maintained independent reconstruction path and validated ISO plus Android metadata. A test-only reconstruction equation cannot certify interoperability.
- Same-transfer AVIF geometry must meet the fixed regional appearance and alpha gates for every required depth/gamut/transfer combination. Native interpolation differences, orientation failures and any source-validation failures stay visible in the case results.
- HDR-only SDR outputs need a controlled native tone-map configuration meeting the ordinary-white, shadow, highlight and gamut-reference checks. The tested BT.2446A and tunable trials are not accepted automatically.
- Animated outputs need exact fully composed frames, unequal durations, repetition count and fractional alpha. Failed animation or alpha cases remain required blockers.
- Unexecuted optional HDR PNG/APNG, HDR WebP, gain-map AVIF and other accepted-source rows remain untested. Container capability has not been reclassified as impossibility. HEIC/HEIF and JPEG XL inputs retain their deliberate deferrals.
- These are proof-side selector and byte-delivery controls. Production endpoint integration, byte-free metadata persistence and generation-owned facts still need implementation tests; this suite does not claim those endpoints exist.
- The fixtures include synthetic charts and the documented upstream gain-map corpus. Additional independent real-device photographs, gain-map depth/layout variants and wider motion/composition corpora remain coverage gaps.
- Safari on the named Mac and iPad, Chrome on Windows/Galaxy, Firefox SDR fallbacks, downloaded files, native viewers and built-in wallpaper setters all remain pending user review. An OS that flattens HDR does not remove the HDR download; a usable SDR download still must qualify.

Prepared 107 inspected source/candidate files with hashes. Follow [the physical-device checklist](../MANUAL.md). No UI, migration, generation policy, caching, source-admission or production delivery behavior changed.

## Suite integrity

Proof-side controls: 23. Unit tests run before native conversions. Evidence validation errors: 0.

Policy authority: [HDR resolution](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153), [complete ledger](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681), [proof ticket](https://github.com/rafaeltab/wallpaperdb/issues/284), [delivery contract](https://github.com/rafaeltab/wallpaperdb/issues/250). Native algorithm references: [FFmpeg libplacebo filter](https://ffmpeg.org/ffmpeg-filters.html#libplacebo), [libplacebo options](https://libplacebo.org/options/), [libavif tools](https://github.com/AOMediaCodec/libavif/tree/v1.4.1/apps), [Sharp gain-map API](https://sharp.pixelplumbing.com/api-output/#keepgainmap).

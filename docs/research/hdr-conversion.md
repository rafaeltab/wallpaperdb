# HDR conversion research for implementation

Research snapshot, 2026-09-29. Native conversion experiments establish useful
paths for HDR AVIF, explicit SDR delivery and several gain-map JPEG operations.
The strongest starting point is a pipeline that identifies the source's actual
color model, processes geometry at adequate precision, and chooses a separately
verified output representation. A filename or an encoder's format support list
does not establish that pipeline's accuracy.

The experiments remain on `t3code/hdr-conversion-proof-suite`, preserved at
[`fd1c43e7`][archive]. This document extracts implementation guidance without
merging that suite. It changes no production dependency, API, generation policy,
migration or editor behavior.

## Product policy and research coverage

The [accepted delivery contract][contract] and [HDR resolution][resolution]
remain the product authorities. They establish explicit conversion selectors,
preserved originals, conservative capabilities, source-sensitive HDR handling,
authored SDR preference, and useful explicit SDR delivery. The [conversion
ledger][ledger] inventories candidate paths; it does not make every possible
cross-format conversion a release requirement.

The user clarified on 2026-09-29 that not passing every case subsequently called
"required" by the suite should not hold up planning. The suite's 320 initial
fixture/geometry cases, 25 additional display-headroom comparisons and 20
same-file combinations are engineering coverage choices. Its [thresholds][thresholds]
explicitly describe themselves as "provisional engineering gates for this
fixture corpus." Specific fixtures, geometry dimensions, headroom samples and
numeric tolerances are not independent product decisions.

Those checks still reveal real limitations. A failed file must retain its
measured failure; an untested case must remain unqualified. Planning should
select the capabilities worth shipping and the evidence they need, rather than
use the suite's entire accumulated experiment inventory as an automatic release
gate. This document does not silently revise the accepted product policy.

## Best available conversion paths

"Pass" below means the tested files meet their declared structural and
appearance checks. It does not mean general source coverage or consumer support.
The [committed report][report] includes retained failed candidates beside passing
alternatives, so an aggregate cell marked failed can contain a useful recipe.

| Source and requested result | Best demonstrated approach | Capability and limit |
| --- | --- | --- |
| Static PQ or HLG AVIF to HDR AVIF | Native FFmpeg/zimg processing, explicit transfer and primaries, AOM encoding, dav1d readback | Tested P3/Rec.2020 and 8/10/12-bit sources pass preservation and geometry checks, including fractional alpha. This covers the declared synthetic corpus. [Recipe][avif] |
| Animated HDR AVIF to HDR AVIF | Process every frame with one color interpretation and preserve sequence metadata | PQ and additional HLG examples pass timing, loop, orientation and alpha checks. The proof uses a patched sequence writer. Arbitrary animations remain outside this corpus. [Recipe][avif] |
| HDR AVIF to explicit SDR | Calibrated native Mobius tone mapping, explicit gamut mapping, then choose adequate output precision | Passing static and animated AVIF/WebP alternatives exist. PNG16 retains precision; JPEG needs static opaque output. Some eight-bit cases need a different correctly signaled transfer. [Tone recipe][tone], [encoding alternatives][gamma] |
| Gain-map JPEG to authored SDR | Decode the authored base, apply requested geometry and color management, then encode | JPG, AVIF, PNG and WebP have passing examples across all four JPEG fixtures. Lossless PNG/WebP and AVIF avoid additional JPEG damage. Difficult JPEG cases use gamma-3.2 ICC coding. [Base processing][authored], [lossless outputs][lossless] |
| Verified old Apple JPEG to a single-layer HDR image | Reconstruct the documented full effect, then encode PQ AVIF or PNG | Tested P3 AVIF8/10/12, Rec.2020 AVIF8/10/12 and P3 PNG16 pass five geometries. These files have no embedded authored SDR base or adaptive gain map. [Source preparation][apple-source], [AVIF][apple-avif], [PNG][apple-png] |
| Gain-map JPEG to regenerated HDR JPEG | Resize authored SDR and reconstructed HDR separately, then recompute the map against the actual compressed base | Passing fixed-headroom alternatives exist, including corrected old Apple derivatives. Accuracy depends on the source model, base transfer, map coding and reader. General adaptive preservation remains unresolved. [Combined recipe][combine], [ICC-aware recipe][icc], [corrected Apple][apple-jpeg] |
| HDR PNG/APNG conversions | Explicitly inspect CICP and sample depth, normalize native transport, then reuse color and geometry processing | Several HDR/SDR, animation and alpha paths pass. PNG8 needed separate precision fixes; a PNG16 result does not qualify PNG8. [PNG/APNG][png], [PNG8 normalization][png8] |
| GIF or HDR WebP | Keep these optional and request-specific | Synthetic SDR GIF examples pass with palette/transfer choices and explicit binary-alpha conversion. Photographic gain-map examples fail. HDR WebP has no qualified path; HDR GIF selectors are incompatible. [GIF evidence][gif], [matrix][matrix] |

The tested geometry modes include proportional containment, center crop,
stretch, upscaling and orientation. Their exact coverage is recipe-specific.
Capabilities must preserve that specificity: a passing eight-bit WebP does not
satisfy `depth=preserve` for a ten-bit source, and binary GIF transparency does
not preserve fractional alpha. Static extraction selects the first fully
composed frame. Gain-map JPEG reports the base and map coded depths separately.
[Selector contract][contract], [exact combinations][matrix].

Two newer focused results are useful but narrow. Original-size XMP JPEG to
gain-map AVIF preserves base/map samples and gain metadata, passing at display
boosts 2, approximately 11.314 and 16. It does not establish resizing. A separate
opaque PQ8/P3 AVIF to HDR JPEG passes at boost 16 with ordered dithering; its
undithered control fails highlight detail. These results cover only their named
fixtures and rendering points. They do not establish resized conversions,
additional source depths, arbitrary display headrooms or consumer compatibility.
[XMP conversion][xmp-identity], [PQ8 conversion][pq8-jpeg].

## Techniques worth carrying into implementation

Inspect source facts before choosing a decoder. Transfer, primaries, sample
depth, alpha, motion, orientation and gain-map model all matter. ISO binary gain
metadata, Android/Adobe XMP and the two Apple representations need distinct
admission rules. The proof retains unknown required facts as original-only.
Native decoding must preserve the declared source model before output encoding
can be evaluated. [Source inspection][source-inspection], [selector controls][selectors].

The old Apple fixture exposed an actual model error. Its retained libavif
interpretation applied exponential gain to stored map values and failed six
regional comparisons against the documented full effect. The corrected path
linearizes the map with inverse Rec.709 and applies `baseLinear * (1 + 7 * mapLinear)`
for this fixture's headroom of 8. Native source reconstruction then reached a
maximum Delta E ITP of 0.000027853. This equation is fixture-specific; intermediate
adaptation and newer Apple semantics are not established by it.
[Source comparison][apple-model], [native implementation][apple-source].

Process HDR geometry in linear light with enough intermediate precision. Apply
orientation once, filter premultiplied color when alpha is present, then restore
the output's required alpha convention. Explicit pixel formats matter: implicit
FFmpeg conversions introduced measurable rounding and association errors.
PQ uses absolute luminance; the tested HLG interpretation uses a 1000-nit
reference display with a luminance-coupled system gamma of 1.2. Its explicit
native transform avoids treating that display response as independent channel
curves. Preserve frame timing and loop metadata separately from raster
processing. [Native geometry][avif], [HLG transfer][transfer].

For gain-map SDR delivery, preserve the authored base instead of automatically
tone mapping the HDR reconstruction. For single-layer HDR without an authored
SDR image, the best tested fallback uses FFmpeg's CPU Mobius operator. The
1000-nit recipe uses knee 0.6 and exposure 1.1; the 4000-nit sequence uses knee
0.54 and exposure 1.2. Both reserve rounding headroom with output scale 0.99.
These are calibrated fixture recipes, not an automatic policy for arbitrary
content peaks. A sequence uses one grade, avoiding per-frame exposure changes.
[Tone mapping][tone], [independent reference][sdr-reference].

The tone checks place 203-nit ordinary white near 0.90 SDR signal, within 0.025,
and separately test shadows, midtones and a smooth highlight shoulder. The
tested gamut mapping converts primaries and clips out-of-gamut sRGB channels
relative-colorimetrically. It is deliberate and independently checked, but does
not establish a perceptual gamut-compression algorithm. [Checks and rationale][thresholds].

Choose precision and transfer together. Omitted depth allows a supported depth;
it does not require eight-bit output. The proof found near-black samples that
no full-range sRGB RGB8 triple could represent within its fixed gate. AOM encoded
the supplied codes exactly, so changing encoder quality could not restore the
missing precision. Higher-depth SDR AVIF or PNG16 solved relevant cases.
Gamma-2.2 coding helped eight-bit AVIF/JPEG/WebP, while gamma-3.2 helped some
authored JPEG and GIF cases. These files require their actual CICP or ICC
interpretation; they cannot be relabeled as standard sRGB-transfer files.
[Precision diagnostic][precision], [gamma coding][gamma].

Recent precision work also shows why output depth remains consequential:

| Corrected old Apple containment | Maximum HDR Delta E ITP | Interpretation |
| --- | ---: | --- |
| Original PQ16 PNG path | 0.258409 | Passing baseline. |
| Explicit opaque planar16 PNG path | 0.010890 | More accurate native packing under unchanged gates. |
| PQ12 AVIF from the improved intent | 0.174863 | Previous same-depth path measured 0.350934. |
| Explicit PQ8 PNG | 2.686236 | Passes the photographic gate, but all 27 regional error statistics increase versus precise PNG16. |

These are focused results recorded in the [latest proof documentation][proof-readme]
and reproducible through [PNG precision][png-precision], [AVIF precision][avif-precision]
and [PNG8][apple-png8] tests. They do not establish universal visual invisibility.
More accurate input also worsened some eight-bit/ten-bit AVIF statistics after
quantization; the archive retains those tradeoffs.

## Limits that affect implementation choices

Regenerated gain-map JPEG is the least settled path. Its most successful
experimental recipe includes a gamma-3.2 RGB8 base, a recomputed RGB8 map,
midpoint offsets of 1/16384 and map gamma 1.5. Several files pass at boost 16
with experimental ICC-aware readers. Stock readers that assume sRGB or reject
the ICC interpretation still fail. Predictive-lossless SOF3 JPEG variants have
an additional interoperability problem: the pinned libavif reader rejects them.
Baseline SOF0 variants avoid that particular rejection but do not fix every
color or adaptation issue. [Recipe and reader limits][icc], [coding variants][combine].

An output that matches at one display headroom can diverge at another. The
committed report records zero of its 20 gain-map source/geometry combinations
passing every same-file headroom comparison. ISO and XMP examples have measured
adaptation failures; Apple intermediate models are unproven. For example, the
ISO source reaches approximately 49.26 times SDR white. A regenerated map with
a lower capacity can match one endpoint and then stop brightening too early.
Copying source capacity improves some highlights but leaves shadow/midtone
failures. [Headroom evidence][headroom], [capacity experiment][capacity].

This is a limitation of the tested recipes and source interpretations, not a
proof that HDR JPEG conversion is universally impossible or a standalone reason
to block every HDR feature. Bounded diagnostics eliminate several fixes for a
specific ISO upscale model; they do not eliminate other color models,
representations or product scopes. Preserve source-dependent capability
decisions and measure any replacement recipe against its declared intent.
[Diagnostic scope][bounds].

The fixture corpus is small. Static AVIF charts deliberately stress transfer,
gamut, depth and fractional alpha; short animation sequences do not represent
arbitrary content. The old Apple fixture is a resized iPhone photo. The newer
Apple fixture reuses those pixels with transplanted metadata. The XMP fixture
was edited and gain-map-authored, and lacks the ICC required by the Android
container specification. The ISO fixture is deterministically regenerated from
the Apple example, not an untouched Android capture. All photographic base/map
parts are eight-bit. Untouched Android handset captures with dual ISO/XMP
metadata, independent newer Apple scenes and creator-authored SDR/HDR pairs
remain important coverage gaps.
[Provenance and hashes][provenance], [generated fixture locks][fixture-lock].

Browser presentation, native viewing and OS wallpaper behavior remain pending
on the agreed MacBook Pro, iPad Pro, Windows HDR PC and Galaxy. Automated files
cannot establish visible HDR luminance, profile handling or wallpaper behavior.
Use the [inspected file manifest][manual-files] and [device checklist][manual].
Their failed diagnostic files retain failed labels. The research also supplies
no production throughput, memory, file-size target or concurrency qualification,
and no proof of faithful browser-side Profile picture cropping or encoding.

## Deployment and evidence boundaries

The native environment resembles Media's deployment shape but uses different
dependencies: linux/amd64 Alpine 3.24.1, Node 22.22.3, Sharp 0.35.5/libvips 8.18.7,
libultrahdr 2.0.2, libavif 1.4.1 with AOM 3.14.1 and dav1d 1.5.3, FFmpeg 8.1.2,
and zimg 3.0.6. The image, packages and native sources are hash-pinned; test
execution has no network access. Some paths depend on local patches, including
AVIF animated orientation, libultrahdr Apple/XMP handling and ICC-aware gain-map
readers. Their deployment and maintenance are implementation work, not ordinary
version upgrades. [Docker build][docker], [recorded versions and patch hashes][versions].

The proof checks emitted signaling, depths, metadata, geometry, timing, loops,
alpha and privacy with readers separate from encoding. It compares appearance
by shadow, midtone and highlight using Delta E ITP and luminance errors. These
are scoped engineering tests, not perceptual guarantees. Exact-byte no-ops,
original-only admission and invalid-selector rejection are proof-side controls;
production Media still needs those behaviors implemented. [Appearance checks][appearance],
[contract controls][selectors].

The committed full report at [`41c22b5b`][report-commit] contains 3,229 attempts:
2,540 qualified, 681 tested and failed, and eight incompatible. Its execution
source was [`c484862b`][execution]. The 320 endpoint comparisons have passing
alternatives under named source models, including the superseded old Apple
convention. They are not 320 production-ready capabilities. Later source
corrections and focused increments are committed through `fd1c43e7`, but a full
replay of that latest revision was not completed before work stopped. The older
aggregate report must not be presented as a complete validation of the latest
source. Raw results from external or interrupted runs are not this document's
committed evidence.

To rerun the latest archived suite from a separate checkout, use Docker with
linux/amd64 support and the repository's normal package tooling:

```sh
git fetch origin t3code/hdr-conversion-proof-suite
git worktree add --detach ../wallpaperdb-hdr-proof-replay fd1c43e78134a5ecc0cd353a3ce099e02ed19392
cd ../wallpaperdb-hdr-proof-replay
make run PACKAGE=media SCRIPT=proof:hdr
```

This regenerates evidence in the archive checkout. The documentation branch
does not contain the suite. The full command intentionally returns 2 while its
engineering qualification gates or physical checks remain unresolved; exit 1
means suite integrity or helper-test failure. Consult the [archive instructions][proof-readme]
before interpreting the result.

## Using this evidence in the wayfinder map

Use these findings to choose practical implementation scope in the
[Media rendition map][map]. [HDR Profile picture source and editing policy][profile-hdr]
can now compare concrete server-native candidates, but still needs decisions
about cropping, preview, accepted uploads and source retention. The separate
[SDR editor specification][profile-sdr] already chooses a 512-by-512 sRGB SDR
WebP upload; this research does not change that contract or prove its browser
implementation.

[Final specification planning][specs] should select the supported combinations,
consumer targets, deployment dependencies and representative acceptance tests.
Generation policy, companion lifecycle and migration remain with their existing
map investigations. The [conversion proof ticket][proof-ticket] remains open;
this document neither closes it nor requires every optional experiment to pass
before those planning discussions proceed.

[archive]: https://github.com/rafaeltab/wallpaperdb/commit/fd1c43e78134a5ecc0cd353a3ce099e02ed19392
[map]: https://github.com/rafaeltab/wallpaperdb/issues/253
[profile-hdr]: https://github.com/rafaeltab/wallpaperdb/issues/270
[profile-sdr]: https://github.com/rafaeltab/wallpaperdb/issues/243
[specs]: https://github.com/rafaeltab/wallpaperdb/issues/259
[proof-ticket]: https://github.com/rafaeltab/wallpaperdb/issues/284
[contract]: https://github.com/rafaeltab/wallpaperdb/issues/250
[resolution]: https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153
[ledger]: https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681
[report-commit]: https://github.com/rafaeltab/wallpaperdb/commit/41c22b5bb02461bb47b5f14bc9366b4ca1c6c335
[execution]: https://github.com/rafaeltab/wallpaperdb/commit/c484862b1d76559e43c5e7d30724e3608c21914b
[report]: https://github.com/rafaeltab/wallpaperdb/blob/41c22b5bb02461bb47b5f14bc9366b4ca1c6c335/apps/media/hdr-proof/results/report.md
[matrix]: https://github.com/rafaeltab/wallpaperdb/blob/41c22b5bb02461bb47b5f14bc9366b4ca1c6c335/apps/media/hdr-proof/results/conversion-matrix.json
[versions]: https://github.com/rafaeltab/wallpaperdb/blob/41c22b5bb02461bb47b5f14bc9366b4ca1c6c335/apps/media/hdr-proof/results/native-versions.json
[manual-files]: https://github.com/rafaeltab/wallpaperdb/blob/41c22b5bb02461bb47b5f14bc9366b4ca1c6c335/apps/media/hdr-proof/results/manual/manifest.json
[proof-readme]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/README.md
[thresholds]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/thresholds.json
[avif]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/avif.py
[tone]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/sdr_candidate.py
[gamma]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/gamma_sdr.py
[authored]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/gainmap_sdr.py
[lossless]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/authored_lossless.py
[apple-source]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/apple_native_source.py
[apple-avif]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/apple_hdr_avif.py
[apple-png]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/apple_hdr_png.py
[combine]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/combined_gainmap_proof.py
[icc]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/icc_gainmap.py
[apple-jpeg]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/apple_hdr_jpeg.py
[png]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/apng.py
[png8]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/hdr_png8_precision.py
[gif]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/gainmap_avif_gif.py
[xmp-identity]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/xmp_identity_avif.py
[pq8-jpeg]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/static_avif_hdr_jpeg.py
[source-inspection]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/gainmap_iso.py
[selectors]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/selector_probes.py
[apple-model]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/apple_source_model.py
[transfer]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/native_transfer.py
[sdr-reference]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/sdr_reference.py
[precision]: https://github.com/rafaeltab/wallpaperdb/blob/41c22b5bb02461bb47b5f14bc9366b4ca1c6c335/apps/media/hdr-proof/results/precision.json
[png-precision]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/test_apple_hdr_png_precision.py
[avif-precision]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/test_apple_hdr_avif_precision.py
[apple-png8]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/test_apple_hdr_png8.py
[headroom]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/iso_intermediate_headroom.py
[capacity]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/iso_source_capacity.py
[bounds]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/iso_capacity_bound.py
[provenance]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/fixtures/gainmap/manifest.json
[fixture-lock]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/fixtures/generated-sha256.json
[manual]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/MANUAL.md
[docker]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/Dockerfile
[appearance]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/appearance.py

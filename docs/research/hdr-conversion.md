# HDR conversion research for implementation

Research completed, 2026-10-11. The October 4 native replay and representative
physical reviews establish useful paths for HDR AVIF, explicit SDR delivery
and several gain-map JPEG operations, alongside measured failures and untested
consumer paths. This completes the empirical investigation in [#284][proof-ticket];
it does not qualify every HDR capability or originally named device.
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
The [final replay evidence][native-results] retains failed candidates beside
passing alternatives, so an aggregate cell marked failed can contain a useful
recipe. The [compact matrix][matrix] summarizes all classified cells; the full
archive contains exact selectors and per-case measurements.

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
[Selector contract][contract], [exact combinations in the native archive][native-results].

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
[completed replay][replay-audit] records only one of 25 additional headroom
comparisons passing, and zero of 20 gain-map source/geometry combinations
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

Consumer results below narrow several of these paths further. Browser success
does not establish native-viewer or wallpaper compatibility. The research also
supplies no production throughput, memory, file-size target or concurrency
qualification, and no proof of faithful browser-side Profile picture cropping
or encoding.

## Physical review findings

The October 8 to 11 reviews cover representative exact files, not every native
case. The [consumer observations][consumer-observations], [result rows][consumer-results]
and [asset hashes][consumer-assets] retain each result's scope. These are user
observations under recorded settings, without measured display luminance.
The photographic SDR PNG is an independently prepared authored-base reference;
its natural appearance does not prove HDR-to-SDR conversion quality.

| Device and recorded environment | Browser findings | Native viewing and wallpaper findings |
| --- | --- | --- |
| iPad Pro 12.9-inch, sixth generation; iPadOS 27.0.1; Safari build unrecorded; brightness about halfway, True Tone on | Controlled PQ HDR brightness passed; HLG appearance was positive without a separate above-page-white confirmation. The photograph looked natural with brighter HDR highlights. HDR AVIF animation showed no image, including direct-file viewing. SDR WebP replay and apparent transparency worked. The derived gain-map JPEG had severe green/pink colors; its original control looked natural. | Preview displayed the static photograph naturally with brighter HDR highlights. The tested native flow could not open the HDR animation. SDR JPEG wallpaper looked natural and correctly oriented, with visible blur. The installed neutral HDR diagnostic was much dimmer than Preview and failed perceived HDR-brightness retention. |
| Galaxy S26 Ultra; Android 16 / One UI 8.5; Chrome 154.0.8037.126; Samsung Gallery 15.8.00.81; halfway brightness, Adaptive brightness and Power saving off | Controlled PQ and separate HLG above-page-white brightness checks passed. The photograph looked natural; animation and apparent translucency worked. The derived gain-map JPEG looked natural with visible HDR. | Gallery rendered the tested HDR AVIF files green/pink. Gain-map JPEGs looked natural; the derived JPEG visibly brightened in Gallery. HDR AVIF animations were reported still; SDR WebP animated. SDR JPEG wallpapers looked natural and correctly oriented on both screens. Tested HDR AVIF Home Screen wallpapers had green/pink colors, and the derived JPEG lost visible HDR on both Home and Lock Screens. |
| Windows 11, 10.0.26220 Build 26220; Dell AW2725DF, HDR Peak 1000; Chrome 155.0.8059.40, 64-bit; Windows HDR and Auto HDR on; SDR content brightness halfway; user had not run Display Calibration | PQ and HLG chart highlights exceeded page white. Both photographic files looked natural; the SDR base looked brighter overall and HDR outdoor buildings brighter. Both animations played with translucency and a brighter HDR white corner. Original JPEG clouds looked brighter; converted JPEG bright HDR highlights were confirmed, without a separate natural-color judgment. | ImageGlass 8.8.4.4 made the HDR photograph desaturated and not convincingly HDR. Microsoft Photos 2025.11100.9001.0 and Explorer thumbnails rendered tested HDR AVIFs red. Desktop SDR JPEG was natural and correctly oriented; HDR AVIF was red and derived JPEG appeared SDR-like. The Lock Screen picker rejected the tested AVIF; both JPEGs were accepted and looked normal, without visible HDR. |

The supplemental 768-by-512 PQ/HLG charts expose an SDR limitation beyond the
original small fixture corpus. On the updated iPad, both SDR candidates showed
bright-red intensity collapse and strongly compressed neutral highlights.
Native inspection confirmed that the two brightest saturated first-column red
tiles become identical sRGB red after gamut clipping. The neutral highlight
ramps still contain distinct codes, so perceived flatness is not evidence of
complete white clipping. The reported red-orange appearance has no isolated
cause. These new charts have structural and reproducibility checks, but no
complete appearance qualification; their SDR fidelity remains unqualified.

Several narrower limits matter when interpreting the table:

- Earlier iPadOS 17.5.1 Safari observations are historical and do not qualify
  HDR still-image presentation. The positive iPad observations followed the OS
  update; a precise Safari build was not supplied.
- The Galaxy's user-reported Developer options > Show HDR/SDR ratio rose from
  1.00 to 4.99 as the same derived JPEG brightened in Gallery, but was 1.00 as
  wallpaper on both screens. This supports the observed presentation loss;
  it is not a luminance measurement or proof that Android rewrote the image.
- The Windows neutral Allow-HDR high patches were not explicitly compared
  against the white divider. The separate PQ/HLG above-white chart results are
  positive. SDR red/green animation regions appeared more translucent than HDR;
  quantitative alpha fidelity and the cause remain unresolved.
- ImageGlass and Photos showed natural JPEG colors but uncertain HDR. ImageGlass
  HDR AVIF animations and Photos HDR AVIF/SDR WebP animations were reported still.
  Initial playback was not confirmed for these finite three-cycle files, so
  still-only observations do not establish a complete animation diagnosis.
- The Mac is unavailable. Mac browser, viewer and wallpaper paths,
  and Firefox SDR presentation, remain untested. Usable SDR wallpaper on every
  originally named device is therefore unestablished.

Most of the 1,288 native manual assets remain physically unreviewed. The
observations do not fix gain-map adaptation failures or qualify other encodings,
software versions or consumer paths. Missing visible HDR also does not establish
how an operating system stores an imported wallpaper. Private screenshots
support the recorded color-corruption observations and are excluded from the
published evidence.

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

The final replay of `fd1c43e7` completed on 2026-10-04. Its
[audit][replay-audit] records 690 helper tests with zero failures or errors, and
3,266 native attempts: 2,576 qualified, 682 tested and failed, and eight
incompatible with the requested selectors. All 85 ledger cells and five
additional generic SDR control cells have classifications. All 217 recorded
proof-source hashes, 146 selector controls and 1,288 manual-file hashes verified;
suite integrity and evidence validation reported no errors. Existing case
artifact hashes reproduced unchanged. The replay adds 37 cases to the prior
aggregate, with 36 qualified and one failed.

The 320 selected endpoint requests have passing alternatives under their named
source models, including the retained superseded old Apple convention. They are
not 320 production-ready capabilities. The separate 1/25 headroom and 0/20
same-file results leave `milestone_qualified=false`. The native replay's historical
physical-review pending entries remain intact; the smaller consumer record
above supplements them without retroactively qualifying the whole matrix.

The [raw native results archive][native-results] preserves the final report,
full matrix, measurements, commands, fixture facts and native versions. The
[compact matrix][matrix] links its full source hash, and the [replay audit][replay-audit]
records the hashes of the principal result files. The [publication manifest][publication]
hashes both archives and the compact evidence files. The [research prerelease][evidence-release]
is an evidence archive, not a production release. The large proof branch remains
separate from this documentation change.

For reproduction, use the [archived suite instructions][proof-readme] in a separate checkout at the pinned proof commit. Exit 2 records unresolved qualification gates or physical checks; exit 1 records suite integrity or helper-test failure.

## Using this evidence in the wayfinder map

Use these findings to choose practical implementation scope in the
[Media rendition map][map]. The accepted [HDR Profile picture resolution][profile-hdr]
places native processing in Media and stores the processed image as User's
immutable Asset. Its source admission, crop, preview and retention decisions
remain in force; this research supplies evidence for their implementation. The separate
[SDR editor specification][profile-sdr] already chooses a 512-by-512 sRGB SDR
WebP upload; this research does not change that contract or prove its browser
implementation.

[Final specification planning][specs] should select the supported combinations,
consumer targets, deployment dependencies and representative acceptance tests.
Generation policy and companion lifecycle remain with their existing map
investigations. The accepted [clean-rebuild decision][clean-rebuild] requires no
historical migration or backfill. The [conversion proof ticket][proof-ticket] concludes as
completed empirical research with demonstrated, failed and explicitly untested
outcomes. Remaining fidelity and consumer qualifications belong in the selected
implementation scope and its acceptance tests. Closing the research does not
change accepted product policy, authorize silent SDR or gamut reduction, or
require every optional experiment to pass before planning proceeds.

[archive]: https://github.com/rafaeltab/wallpaperdb/commit/fd1c43e78134a5ecc0cd353a3ce099e02ed19392
[publication]: hdr-conversion-evidence/publication.json
[map]: https://github.com/rafaeltab/wallpaperdb/issues/253
[profile-hdr]: https://github.com/rafaeltab/wallpaperdb/issues/270#issuecomment-5902621514
[profile-sdr]: https://github.com/rafaeltab/wallpaperdb/issues/243
[specs]: https://github.com/rafaeltab/wallpaperdb/issues/259
[clean-rebuild]: https://github.com/rafaeltab/wallpaperdb/issues/257#issuecomment-5940357833
[proof-ticket]: https://github.com/rafaeltab/wallpaperdb/issues/284
[contract]: https://github.com/rafaeltab/wallpaperdb/issues/250
[resolution]: https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153
[ledger]: https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681
[matrix]: hdr-conversion-evidence/conversion-matrix.json
[replay-audit]: hdr-conversion-evidence/replay-audit.json
[versions]: hdr-conversion-evidence/native-versions.json
[consumer-observations]: hdr-conversion-evidence/consumer-observations.json
[consumer-results]: hdr-conversion-evidence/consumer-results.csv
[consumer-assets]: hdr-conversion-evidence/assets.json
[evidence-release]: https://github.com/rafaeltab/wallpaperdb/releases/tag/hdr-proof-2026-10-11
[native-results]: https://github.com/rafaeltab/wallpaperdb/releases/download/hdr-proof-2026-10-11/final-replay-results.tar.gz
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
[docker]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/Dockerfile
[appearance]: https://github.com/rafaeltab/wallpaperdb/blob/fd1c43e78134a5ecc0cd353a3ce099e02ed19392/apps/media/hdr-proof/appearance.py

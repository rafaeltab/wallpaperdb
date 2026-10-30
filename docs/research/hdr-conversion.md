# HDR conversion research for implementation

Research completed on 2026-10-11 for [#284][proof-ticket]. The October 4 native
replay and physical reviews demonstrate HDR AVIF, explicit SDR delivery, and
several gain-map JPEG paths, with failures and untested consumers retained below.
Conversion must identify the actual source color model, preserve geometry at
adequate precision, and verify the output representation.

The suite remains on `t3code/hdr-conversion-proof-suite` at [`fd1c43e7`][archive].
These findings do not change production dependencies, APIs, generation policy,
migration, or editor behavior.

## Product policy and research coverage

The [delivery contract][contract] and [HDR resolution][resolution] govern explicit
selectors, preserved originals, conservative source-sensitive capabilities,
authored SDR preference, and explicit SDR delivery. The [conversion ledger][ledger]
is a candidate inventory, not a requirement to ship every conversion.

On 2026-09-29 the user clarified that suite cases subsequently called "required"
should not block planning. Its 320 initial fixture/geometry cases, 25 additional
headroom comparisons, and 20 same-file combinations are engineering coverage
choices. The [thresholds][thresholds] call themselves "provisional engineering
gates for this fixture corpus." Fixtures, dimensions, headrooms, and tolerances
are not independent product decisions. Keep failures and untested cases explicit;
select release capabilities and their evidence without adopting the whole suite
as a release gate.

## Best available conversion paths

"Pass" means the tested files meet their structural and appearance checks,
not general source or consumer support. The [replay evidence][native-results]
retains failures beside passing alternatives, so a failed aggregate cell may
still contain a useful recipe. The [compact matrix][matrix] summarizes cells;
the full archive retains exact selectors and measurements.

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

Geometry coverage is recipe-specific: proportional containment, center crop,
stretch, upscaling, and orientation. Eight-bit WebP cannot satisfy `depth=preserve`
for a ten-bit source; binary GIF alpha cannot preserve fractional alpha. Static
extraction selects the first fully composed frame. Gain-map JPEG reports base
and map depths separately. [Selector contract][contract], [exact combinations][native-results].

Original-size XMP JPEG to gain-map AVIF preserves base/map samples and metadata,
passing at display boosts 2, approximately 11.314, and 16. Opaque PQ8/P3 AVIF to
HDR JPEG passes at boost 16 with ordered dithering; its undithered control fails
highlight detail. Neither establishes resizing, other depths/headrooms, or
consumer compatibility. [XMP conversion][xmp-identity], [PQ8 conversion][pq8-jpeg].

## Techniques worth carrying into implementation

Inspect transfer, primaries, depth, alpha, motion, orientation, and gain-map
model before selecting a decoder. ISO binary metadata, Android/Adobe XMP, and
the two Apple representations need distinct admission rules. The proof keeps
sources with unknown required facts original-only and checks native decoding
against the declared model. [Source inspection][source-inspection], [selector controls][selectors].

The old Apple fixture exposed an actual model error. Its retained libavif
interpretation applied exponential gain to stored map values and failed six
regional comparisons against the documented full effect. The corrected path
linearizes the map with inverse Rec.709 and applies `baseLinear * (1 + 7 * mapLinear)`
for this fixture's headroom of 8. Native source reconstruction then reached a
maximum Delta E ITP of 0.000027853. This equation is fixture-specific; intermediate
adaptation and newer Apple semantics are not established by it.
[Source comparison][apple-model], [native implementation][apple-source].

Process geometry in linear light at adequate precision. Apply orientation once,
filter premultiplied color, then restore the required alpha convention. Implicit
FFmpeg pixel-format conversions caused rounding and association errors. PQ uses
absolute luminance; tested HLG uses a 1000-nit reference display and luminance-coupled
system gamma 1.2, not independent channel curves. Preserve timing and loops
separately. [Native geometry][avif], [HLG transfer][transfer].

For gain-map SDR, preserve the authored base. Single-layer HDR's best tested
fallback is FFmpeg CPU Mobius: knee 0.6 / exposure 1.1 for 1000 nits, and
knee 0.54 / exposure 1.2 for the 4000-nit sequence, both with output scale 0.99
for rounding headroom. These are fixture calibrations, not arbitrary-peak
policy. Use one grade per sequence. [Tone mapping][tone], [independent reference][sdr-reference].

The tone checks place 203-nit ordinary white near 0.90 SDR signal, within 0.025,
and separately test shadows, midtones and a smooth highlight shoulder. The
tested gamut mapping converts primaries and clips out-of-gamut sRGB channels
relative-colorimetrically. It is deliberate and independently checked, but does
not establish a perceptual gamut-compression algorithm. [Checks and rationale][thresholds].

Choose precision and transfer together. Omitted depth permits supported depths;
it does not require eight bits. Some near-black samples could not meet the gate
with any full-range sRGB RGB8 triple. AOM reproduced supplied codes exactly,
so encoder quality could not fix this. Higher-depth SDR AVIF or PNG16 solved
relevant cases. Gamma-2.2 helped eight-bit AVIF/JPEG/WebP; gamma-3.2 helped some
authored JPEG/GIF cases. Preserve their actual CICP/ICC interpretation rather
than relabeling them sRGB. [Precision diagnostic][precision], [gamma coding][gamma].

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

These failures concern tested recipes and source interpretations. Bounded
diagnostics eliminate several fixes for one ISO upscale model, not HDR JPEG
conversion generally. Keep source-dependent capabilities and test replacement
recipes against their declared intent. [Diagnostic scope][bounds].

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

Browser results do not establish native-viewer or wallpaper compatibility.
Production throughput, memory, file-size targets, concurrency, and browser-side
Profile picture cropping/encoding remain unqualified.

## Physical review findings

The October 8 to 11 reviews cover exact files, not every native case. The
[observations][consumer-observations], [results][consumer-results], and
[hashes][consumer-assets] record scope and settings, without luminance measurements.
The photographic SDR PNG is an independent authored-base reference; its natural
appearance does not qualify HDR-to-SDR conversion.

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

Most of the 1,288 manual assets remain physically unreviewed. These observations
do not qualify other encodings, versions, or consumers, resolve gain-map adaptation,
or reveal how operating systems store wallpapers. Private screenshots support
the color-corruption observations but remain outside published evidence.

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

The [native archive][native-results] retains the report, full matrix,
measurements, commands, fixture facts, and versions. The [compact matrix][matrix]
links its source hash; the [audit][replay-audit] hashes principal results; the
[publication manifest][publication] hashes both archives and compact evidence.
The [prerelease][evidence-release] publishes evidence, not production software.

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

Use the [Media rendition map][map] and [final specification planning][specs] to
select combinations, consumers, deployment dependencies, and acceptance tests.
Generation policy and companion lifecycle remain with the map investigations.
The [HDR Profile picture resolution][profile-hdr] places native processing in
Media and stores the result as User's immutable Asset, retaining its admission,
crop, preview, and retention decisions. The [SDR editor specification][profile-sdr]
requires a 512-by-512 sRGB SDR WebP upload; this research does not qualify its
browser implementation. The [clean-rebuild decision][clean-rebuild] requires
no historical migration or backfill.

[#284][proof-ticket] completes empirical research with passing, failed, and
untested outcomes. Remaining fidelity and consumer qualification belong to the
selected implementation's acceptance tests. Completion neither authorizes silent
SDR/gamut reduction nor requires every optional experiment to pass before planning.

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

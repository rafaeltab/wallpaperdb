# HDR conversion proof

This isolated native suite implements the empirical work in [#284](https://github.com/rafaeltab/wallpaperdb/issues/284). It does not implement Media delivery or change the accepted HDR policy. Its failed and untested paths remain unqualified.

Run from the repository root with Docker and the repository's normal package tooling installed:

```sh
make run PACKAGE=media SCRIPT=proof:hdr
```

The first build downloads checksum-locked packages and native source archives. Tests then run without network access in a linux/amd64 Node 22 Alpine container. The image uses software Vulkan, so it needs no host GPU. Allow approximately 1 GB for the image and additional space for generated evidence. An ARM host needs Docker's amd64 emulation.

Exit 0 is available only for passing helper tests through `make run PACKAGE=media SCRIPT=proof:unit`. The complete qualification command returns 2 while a required codec case or physical-display check remains unqualified. Exit 1 identifies broken suite integrity, dependency/hash drift, or failing helper tests. A failed conversion is a recorded result, not a reason to lower its thresholds or skip the rest of the matrix.

Read the generated [report](results/report.md), [conversion matrix](results/conversion-matrix.json), [measurements](results/measurements.json), [commands](results/commands.json), and [native versions](results/native-versions.json). [Fixture facts](results/fixtures.json) and [gain-map provenance](fixtures/gainmap/manifest.json) identify exact inputs. [Thresholds](thresholds.json) explain the gates fixed before measurements. Native selector controls have a separate [threshold profile](selector-thresholds.json).

The complete run replaces the generated report and measurement files under `results/`; it leaves complete intermediates and native diagnostics in ignored `work/`. Selected inspected files and their hashes are committed under [results/manual](results/manual/manifest.json). Follow [MANUAL.md](MANUAL.md) on the agreed Mac, iPad, Windows PC, and Galaxy. Browser and OS qualification stays pending until those devices have been checked by the user. A diagnostic file marked failed is not an approved SDR fallback.

Keep the checkout and generated intermediates on disk. A full replay can retain
several gigabytes under `work/`; running several copies in a RAM-backed `/tmp`
can exhaust host memory and cause native-operation timeouts. Such timeouts stay
failed in the recorded run. A later successful replay supplies separate evidence.

Changes to fixtures require intentional review of their committed source hashes. `--update-fixture-lock` updates the original generated corpus; the separately declared PNG8 corpus retains its own lock. Dependency changes require new lock files and native qualification. The suite never downloads a floating fixture or silently refreshes an expected hash during normal execution. `fixtures/generated-sha256.json` covers generated AVIF, sixteen-bit HDR PNG/APNG and selector inputs; the committed JPEG fixture manifest and fixture tests cover the camera corpus and regenerated ISO representation.

The Python color equations and request oracle exist only in this proof. FFmpeg/libplacebo, Sharp/libvips/libultrahdr, and libavif/AOM perform the native candidate conversions. dav1d, ExifTool, Pillow/libjpeg, a small reader linked to libpng, and the independent gain-map reader check the bytes. Their precise limitations are recorded in every affected case. Unit tests of the proof-side request oracle do not claim production endpoint behavior. Media's existing dependency versions, source admission, UI, migrations, generation policy and caching are unchanged.

The proof image includes explicitly pinned experimental native patches. Apple
retained-map experiments isolate libultrahdr PR484 and PR491 separately and
together; the final candidate uses both plus a local per-channel XMP patch.
A local libavif sequence-writing patch
fixes animated orientation serialization. These patches do not upgrade Media's
production dependencies. Their source, patch, recipe and binary hashes are
recorded by the build and [native version evidence](results/native-versions.json).

The [combined gain-map proof](combined_gainmap_proof.py) separately resizes the
authored SDR base and reconstructed HDR intent, computes a new native gain map,
and retains RGB8 base/map samples with native predictive lossless JPEG coding.
Isolated libavif variants measure rare-gain retention, smaller offsets and identity
matrix coding. Separate libultrahdr variants test RGB JPEG decoding and its
existing exact transfer/gain formulas. The pinned libavif reader rejects these
SOF3 JPEG files; file accuracy and physical consumer compatibility remain separate.

Separate SOF0 RGB8 DCT candidates recompute the gain map against their actual
compressed SDR base. The pinned libavif reader can decode that coding form,
but some files still exceed the fixed authored-SDR shadow limits. Its extra
JPEG-to-AVIF-to-PQ reconstruction also introduces eight-bit YCbCr map rounding;
those appearance failures remain visible as a separate decoder diagnostic.
Another pinned native libavif reader preserves the decoded RGB gain samples
with identity matrix coding. Its independent dav1d/PQ readback has separate
appearance measurements; it never replaces the original reader's failures or
changes the conversion gates.
Both independent JPEG/ISO and native libultrahdr reconstruction must pass the
unchanged file gates. Every physical consumer remains pending.

The separate [JPEGli experiment](jpegli_proof.py) tests another pinned native
encoder against the same authored SDR bases. It records all combinations of
uint8/float32 input transport, standard/JPEGli quantization tables and adaptive
quantization, with unchanged RGB8 output depth and sRGB transfer. The complete
suite regenerates [all trial measurements](results/jpegli-base-experiment.json),
including failures, native commands and build/source hashes. A passing SDR base
alone does not qualify a gain-map JPEG or establish physical compatibility.
The separate `jpegli-base-dct-float-map` HDR candidate recomputes the gain map
against the actual JPEGli-compressed base and encodes the map with the existing
native floating-DCT helper. Both layers remain SOF0 RGB8. Its emitted JPEG must
pass the complete independent SDR, HDR, metadata and privacy checks.

The separate [MozJPEG experiment](mozjpeg_proof.py) fixes quality 100 and RGB8
coding while varying native integer/floating DCT, trellis and deringing. Its
static encoder is built from a checksum-pinned source archive. Optimized Huffman
coding is required for the tested trellis setup. The original standard-table
failures remain a separate replay, including malformed files that FFmpeg
conceals while returning exit zero. Both proof command runners reject FFmpeg
error diagnostics before any such raster can qualify.
The `mozjpeg-base-dct-float-map` ISO crop candidate independently checks a complete
HDR JPEG using the compressed native base, a regenerated floating-DCT gain map
and the unchanged SDR/HDR gates. Native file success leaves consumer review pending.
The complete replay also retains a bounded native trellis-precision experiment
on the six remaining source/geometry cases. It raises the coefficient-distortion
penalty under fixed quality-100 quantizers and unchanged source samples. Its
default controls must reproduce their earlier JPEG bytes exactly; all failures
remain in [their own measurements](results/mozjpeg-lambda-experiment.json).
The [coefficient diagnostic](mozjpeg_diagnostics.py) reads actual compressed
coefficients with pinned native libjpeg and checks the reference, native-input
and output hashes. It distinguishes geometry error from coding error and counts
failed shadow pixels in blocks with unchanged DC coefficients. This diagnostic
does not qualify a conversion or prove every baseline JPEG encoder impossible.

The separate [ICC-aware experiment](icc_gainmap.py) tests a gamma-3.2 RGB8 base
with a regenerated RGB8 gain map. Native LittleCMS reads the actual compressed
base's ICC profile before libavif computes gains; the independent reader uses
FFmpeg JPEG samples and separate ICC/ISO equations. Two predeclared offset
policies retain distinct failures: 1/4096 amplifies small JPEG decoder differences
in shadows, while 1/65536 exceeds the fixed midtone and highlight limits. Both
remain unqualified. Stock readers that assume sRGB transfer or reject ICC also
remain separate limitations; this experiment does not establish interoperability.
The complete command reproduces both experiments and includes their failed
cases in the matrix, with separate measurements and inspected diagnostic files.
A further native map-gamma-2 representation retains the small offset and uses
matching AVIF, ISO, XMP and native metadata. Analytic zero, fractional and full
headroom controls verify the reciprocal decoding exponent. This allocates more
of the existing eight-bit map precision to the measured gain range; it changes
neither image grade nor reference. Highlight error improves, but regional means
and shadow error still fail. The earlier gamma-1 bytes remain pinned.
A separate gamma-2 candidate uses the logarithmic midpoint offset, 1/16384.
It passes midtone and highlight limits but fails both readers' shadow maxima
and their cross-comparison. Exact emitted offsets, metadata agreement and
headroom controls remain mandatory; this failure does not qualify the path.
An integer-DCT map alternative keeps that exact compressed base and pre-JPEG
gain map. Shadow failures persist, and cross-decoder agreement worsens. Both
native map encodings remain separate failed evidence.
A separate midpoint-offset map uses encoding gamma 1.5. This increases code
precision near zero gain and passes every unchanged appearance gate for the ISO
JPEG upscale. Native and independent HDR maximum error is 7.31 deltaE ITP;
cross-reader maximum error is 5.53. The compressed gamma-3.2 base remains exact,
and both actual JPEG layers remain eight-bit SOF0. This qualifies the experimental
ICC-aware file path at display boost 16. The stock reader
that assumes sRGB still fails, so consumer compatibility remains pending.
The five preceding failures stay visible and retain their exact output hashes.
The same recipe also passes the Android XMP upscale. This source uses the
existing native libavif PQ16 bridge with requested depth 12; its source
reference shares libavif gain application. The source comparison verifies that
transport, while separate final HDR readers establish output accuracy.
The ISO-only float32 source decoder remains narrowly scoped. Stock-reader
failure and pending consumer review also apply to this XMP output.
Old Apple containment and upscale also pass the exact same map recipe.
Its native source path requires the original headroom MakerNotes, and a real
source stripped of those facts remains original-only. These two cases retain
their PQ source precision evidence and separate final HDR-reader measurements.
New Apple containment also passes, while the original upscale remains failed at an
independent HDR shadow maximum of 8.08225 against the unchanged limit of 8.
This source requires its auxiliary XMP model, version and headroom. Native
reconstruction remains byte-identical after removing unused MakerNotes;
unknown required XMP facts reject transformation.
A separate integer-DCT map retains the same new Apple upscale base, HDR intent
and pre-JPEG gain samples. The shadow maximum stays at 8.08225, and both HDR
readers also exceed the highlight p95 limit of 3. Both map encodings remain
failed evidence under unchanged thresholds.
A separate FLOAT-DCT base uses the identical native gamma-3.2 input and P3 ICC
profile, then regenerates the original floating-DCT map against that compressed
base. This new Apple upscale passes, with maximum HDR error 6.77896 and
cross-reader error 5.73114. Together, the observed SOF0 alternatives cover all
24 tested source/geometry tuples, including all 20 required tuples. This is
file qualification within the declared decoder scope; stock-reader limitations
and pending physical review remain unchanged.
These gain-map endpoint measurements use display boost 16. They do not prove
faithful adaptation at other display headroom values. The matrix separately
requires ISO upscale at boost 2, using the same source/output display boost
and an independently reconstructed, matched-geometry source reference. It also
requires boost 64, which fully applies this source's gain map. One identical
output file must pass boosts 2, 16 and 64; different files at different headroom
values cannot satisfy the joint requirement. Display headroom is not a product
selector. An unqualified rendering blocks faithful-HDR qualification even when all
320 original fixture/geometry requests have passing endpoint alternatives.
The adaptation inventory covers all 20 required gain-map fixture/geometry
tuples. Each needs the same file at boosts 2 and 16; all five ISO geometries also
need boost 64. This makes 25 additional rendering points and 20 same-file joins.
Untested XMP and Apple source models remain unqualified. Their existing boost-16
successes cannot fill a missing intermediate reference. A rendering point also
requires explicit independent-source-decoder evidence, and endpoint records
without an explicit boost cannot enter the same-file join.
The [boost-2 proof](iso_intermediate_headroom.py) reruns the exact native
converter and records a large appearance failure while both output readers
agree. Its source capacity is about 49.26 times SDR white, compared with 4.47
for the regenerated output. Read-only uncompressed-map and ideal-gain
diagnostics retain the mismatch. Normalizing the interpolation weight removes
much of the broad exposure bias but still fails the shadow and midtone maxima.
Normalizing capacity to the boost-16 reference endpoint is insufficient in
this diagnostic. Other capacity choices remain untested. These diagnostic
pixels never enter the encoder or qualify a file.
The original output also fails the separate boost-64 full-source comparison.
Both output readers agree, and its decoded pixels are exactly equal to those
at boost 16, while the independently reconstructed source becomes brighter.
The earlier endpoint success therefore proves neither intermediate adaptation
nor this source's fully applied HDR appearance.
A separate [full-source candidate](iso_full_headroom_candidate.py) renders the
native float32 source at boost 64 before geometry and map regeneration. Its
boost-64 file rendering passes both HDR readers, with independent shadow maximum
7.79985 against the unchanged limit of 8. The same output fails boosts 2 and 16.
Its native regenerated capacity is 3.089498 log2, while the source is 5.622376.
This improves the full-source endpoint but leaves the joint same-file adaptation
requirement failed. It retains the exact compressed SDR base and every earlier
candidate's evidence.
The [source-capacity candidate](iso_source_capacity.py) changes only the two
capacity fields using the pinned native compressed-image API. Exact compressed
coding, ICC bytes and all other ISO metadata remain unchanged. Source/output
weights now agree at all three boosts. Highlight mean error improves from
20.4759 to 0.62918 at boost 2 and from 26.6022 to 1.02007 at boost 16. Shadow and
midtone maxima still fail, so the same-file adaptation requirement remains
failed. Full-source pixels and measurements stay exactly equal to the passing
boost-64 control. The native packer header, library, source and binary are
checksum-recorded; existing codec binaries remain unchanged.
The [fixed-map diagnostic](iso_map_code_bound.py) then enumerates every RGB8
map triple at the two worst shadow pixels across boosts 2 and 16. The same
triple must meet the unchanged maximum gate at 2, 16 and 64. Minimum joint
maximum errors are 109.491281 and 54.101789 against the limit of 8, after
verifying the emitted-code model against actual independent decoding. This
rules out map-code changes alone for this fixed base and metadata. The search
optimistically ignores JPEG neighborhood coupling and does not bound other
bases, offsets, capacities, metadata or representations. It records no
conversion qualification. The default replay validates the native capacity
report before reuse and writes its own hashed diagnostic record.
The [four other ISO geometries](iso_geometry_headroom.py) rerun their exact
qualified recipes and preserve every original endpoint measurement. Each
containment, crop, stretch and EXIF6 orientation file passes at boost 16 and
fails appearance at 2 and 64. The independent reference reconstructs the
canonical source at the requested boost before geometry, with one rotation
for the orientation case. The extracted source map is hash-bound before and
after decoding. All five required ISO geometries now have measured adaptation
failures; XMP and Apple intermediate rendering remains untested.

A separate moderate-offset candidate uses native ISO offsets of 1/4096 in place
of 1/65536. This narrows the encoded gain interval for 8-bit maps while retaining
the same HDR intent and fixed appearance limits. Analytic near-black controls
check the offset tradeoff; the earlier identity-map candidates and their upscale
failures remain visible. Native ISO-only source reconstruction checks the ICC,
base/map samples and metadata before applying gain. Its map expansion is limited
to independently verified identity or two-times axes. Missing or conflicting
color signaling, unknown ICC facts, nonidentity map orientation and unproved map
ratios reject transformation.

The ISO source also has a separate float32 reconstruction candidate. It calls
the native codec's existing transfer and gain functions before half-float
storage, then resamples in native float precision. Analytic channel/headroom
controls and the unchanged independent source reference verify it. Its emitted
JPEG cases retain the earlier PQ16 path and thresholds. A separate floating-DCT
JPEG encoder tests the native library's `JDCT_FLOAT` method without changing
the base transfer or gain-map interpretation.

The [gain-map cross-format proof](gainmap_crossformat.py) separately evaluates
single-layer PQ PNG16 and AVIF12 outputs from the native HDR intent. Independent
libpng or dav1d decoding compares each emitted file with the reconstructed
source at matched geometry. The requests explicitly select output depth and
preserve primaries. Original base/map depths remain recorded as source facts;
explicit SDR conversions continue to use the authored base. These additional
HDR candidates do not establish browser or wallpaper compatibility.

Its [versioned geometry reference](gainmap_reference.py) filters and clips in the
requested gamut before conversion to metric coordinates. Clipping Lanczos
excursions in Rec.2020 can create colors outside the requested P3 or sRGB gamut.
Analytic tests prove this distinction and preserve identity colors. Original
references, failing candidates and thresholds remain unchanged; new case IDs
record `gainmap-hdr-target-gamut-v1` and retain diagnostic reference differences.

The SDR candidate's [independent reference](sdr_reference.py) declares its tone
curve and relative-colorimetric gamut clipping. Out-of-gamut saturation detail
can be lost; this is a deliberate mapping choice to evaluate during physical
review. The [native candidate](sdr_candidate.py) implements the conversion using
FFmpeg, separately from that reference. Identity tone controls must pass, and
every encoded derivative must also pass full appearance, signaling and privacy
checks. Eight-bit output failures remain recorded even when a higher-precision
PNG passes. No existing acceptance thresholds were relaxed.

Additional SDR AVIF `depth=12` cases have distinct selector tuples and case IDs.
They retain the predeclared `sdr-8` color and luminance limits as a minimum
fidelity requirement; higher coded precision does not relax appearance or tone
thresholds. Every explicit `depth=8` case remains in the original fixed coverage
plan, including its failures. That plan's eight-bit SDR AVIF choice was a proof
choice, not a product requirement. The accepted contract permits a suitable
supported depth when depth is omitted.

The matrix separately records `product_coverage`, matching product requests to
qualified exact fixture/geometry/selector evidence. An omitted-depth SDR AVIF
request can use a qualified 12-bit candidate; a failed explicit eight-bit request
stays failed. WebP retains its eight-bit constraint. Schema version 2 preserves
the legacy `required_case_count` and `diagnostic_summary.required_cases` fields
as the original fixed 320-case coverage plan for comparison. Product milestones
use `product_coverage`; physical browser, viewer and wallpaper checks remain
pending. This is proof accounting, not a runtime depth-selection policy.

The complete command also reproduces a [precision diagnostic](precision.py).
It enumerates every full-range sRGB RGB8 triple for selected shadow references,
then encodes and independently decodes an exact-code counterexample. Its bounds
apply only to that transfer, matrix, grade and per-pixel metric. They do not
declare a format impossible or qualify a conversion. Additional native YUV
trials and all reference hashes remain in the generated `results/precision.json`.

Separate gamma-2.2 candidates encode the same SDR grade with sRGB primaries.
AVIF declares CICP `1/4/0`. JPEG and WebP embed a deterministic native LittleCMS
profile whose actual curves, colorants and adaptation are independently checked.
These are gamma-2.2 SDR files, not standard sRGB-transfer files. The accepted
contract defines `gamut=srgb` as primaries, so these candidates retain the same
selectors while recording different representation IDs. Profile-aware physical
review remains mandatory; existing failed sRGB-transfer files stay failed.

Separate GIF candidates use a gamma-3.2 ICC profile and native nearest rounding
to eight bits. They retain the same SDR reference, selectors and appearance
limits. Their case IDs identify the representation; earlier gamma-2.2 failures
remain visible. This includes the two PQ APNG static orientation cases, which
pass with the new representation. GIF still requires explicit coercion of
fractional alpha to binary transparency.
Optional animated APNG-to-GIF candidates also verify both fully composed frames,
300/700 ms timing and three total plays. GIF encodes that as two repeats after
the initial play. An exact binary-alpha mismatch is a failure, even when it
comes from one half-opacity sample rounded across the cutoff by an intermediate.
Another native candidate resamples alpha separately and rounds to sixteen bits
after each axis. It must preserve every RGB16 code, keep intermediate alpha
within the existing PNG16 precision ceiling and match every final binary decision.
The original quantized failures remain separate cases.

The [authored SDR JPEG proof](authored_sdr_proof.py) also evaluates gamma-3.2
ICC encodings against the same independently decoded authored SDR base. These
are real RGB JPEG8 files with independently checked sRGB or P3 primaries and
actual profile curves. The coding transfer changes; the reference grade and
appearance gates do not. These candidates cover the forty required gain-map
source, gamut and geometry requests while standard sRGB-transfer failures stay
visible. Native zimg applies fractional crop windows with normalized filter
boundaries for cover geometry. Cropping to integer bounds before resampling
would discard samples used by the independent reference. As with gamma-2.2,
the accepted gamut selectors identify primaries. Every ICC representation
still needs separate browser, viewer and wallpaper review.

The [HDR PNG generator](hdr_png.py) creates eight deterministic static charts
covering PQ/HLG, P3/Rec.2020 and opaque/fractional alpha at 16 bits. Native PNG
encoding writes CICP; ExifTool checks signaling and the separate libpng reader
decodes samples. Source and HDR derivative appearance use the existing stricter
`avif-12` ceiling because their 16-bit precision exceeds the 12-bit fixture
precision. SDR derivatives keep the existing `sdr-8` gates and independent tone
reference. The scope covers identity, contain, cover, fill, upscale and a real
EXIF-8 orientation variant. The eight orientation sources have separate hashes;
native rotation is checked against an independent exact pixel rotation. Matching
HDR PNG identity requests are exact-byte controls, including original metadata,
and do not count as encoder evidence. Converted files must remove the source's
numeric GPS, camera model, serial, EXIF and XMP data. Six metadata-only negative
controls cover unknown transfer, conflicting or duplicate CICP, invalid CRC,
and conflicting ICC/sRGB signaling. They retain exact originals and withhold
transformation. Unlisted cross-products remain untested; this proof does not
change source admission.

The separate [eight-bit PNG source proof](hdr_png8.py) generates the same eight
PQ/HLG, P3/Rec.2020 and alpha combinations at eight coded bits. Its source
quantization uses the existing `avif-8` ceiling, declared before measurement,
plus exact native libpng code recovery and a half-code quantization bound.
[Source hashes](fixtures/png8-source-sha256.json) are locked separately.
These source checks do not qualify derivatives or change the sixteen-bit
fixtures, their hashes or their stricter appearance gates.
The [PNG8 containment proof](hdr_png8_proof.py) separately evaluates HDR
PNG8/AVIF8 and explicit SDR PNG16/AVIF8 outputs. A direct native input expansion
changes normalized samples and leaves measured failures. A separate native
zimg expansion preserves every RGB and alpha sample exactly before conversion.
Its candidates use distinct IDs and the same references and output gates;
the original bytes, measurements and failures remain unchanged. The complete
suite includes both candidates, exact-byte no-ops and unknown-CICP controls.
The [additional geometry proof](hdr_png8_geometry.py) extends the normalized
candidate to cover, fill, upscale and real EXIF-8 orientation. Its eight
orientation sources have a [separate reviewed hash lock](fixtures/png8-orientation-sha256.json).
It checks unchanged coded samples after resetting orientation metadata, exact
native precision expansion, and one native rotation against independent decoded
pixels before resizing. These cases retain the containment appearance and alpha
limits. No existing source hashes or failed containment results change.
The [higher-depth candidates](hdr_png8_precision.py) separately test explicit
HDR PNG16 and AVIF12 requests from these eight-bit sources. Both outputs use the
existing, stricter `avif-12` appearance ceiling against decoded-source geometry.
Source quantization remains separate. Alpha error must stay within two codes
at the actual output depth. The complete suite includes these measurements and
their inspected containment files for pending physical review.
The same higher-depth cases also cover crop, fill, upscale and real EXIF-8
orientation, with exact native rotation checked before resampling.
The [SDR WebP cases](hdr_png8_webp.py) preserve the independently referenced SDR
grade with gamma-2.2 ICC coding and fractional alpha. A restricted static VP8L
reader checks container structure before native decoding. FFmpeg's native WebP
decoder must match both Pillow/libwebp and the coded encoder input exactly;
regional appearance, tone/gamut policy and privacy still have separate gates.
A separate nearest-code quantizer must match independently rounded sixteen-bit
RGB and alpha samples exactly, within half an output code. Both quantization
candidates retain separate measurements and the same final appearance and alpha
limits. The earlier JPEG and static/animated WebP defaults retain pinned bytes.
Both candidates cover containment, crop, stretch, upscale and real EXIF-8
orientation. Each rotated source has its own locked hash, and native rotation
must exactly match the independently rotated source samples before resizing.

The [gain-map AVIF source proof](gainmap_avif.py) regenerates one separately
[hash-locked source](fixtures/gainmap-avif-source-sha256.json) from the Android
XMP JPEG. Independent BMFF parsing reads base/map associations and per-channel
gain fractions; direct AV1 packet decoding checks actual native depth and color
signaling before any eight-bit conversion. The pinned libavif metadata printer
repeats channel zero, so its text remains diagnostic evidence. The
[authored-SDR derivative](gainmap_avif_proof.py) uses AOM source decoding and
encoding, independent dav1d samples and unchanged photographic appearance gates.
Containment, crop, stretch and upscale retain separate measurements. Cover uses
the native fractional-window filter and an independently cropped SDR reference.
Unknown required facts preserve exact originals and withhold transformation.
Nonidentity orientation and untested selector tuples remain unqualified.
The separate [SDR PNG8 candidates](gainmap_avif_png.py) retain the same authored
base and photographic limits for containment, crop, stretch and upscale.
Their actual native PNGs use standard sRGB/cHRM/gAMA signaling and explicitly square pixels. Independent
libpng decoding must preserve the native encoder-input samples exactly;
ExifTool and a strict chunk reader verify color, depth, geometry and privacy.
Exact storage does not replace its regional appearance checks.
The separate [SDR WebP proof](gainmap_avif_webp.py) covers containment, crop,
stretch and upscale using that verified native preparation and an actual native sRGB ICC profile. Native libwebp and
FFmpeg must agree on every stored RGB8 sample, with strict container, profile
and privacy checks. Its authored SDR appearance gates remain unchanged; HDR
rendering and physical consumer interpretation are separate.
The separate [HDR AVIF12 proof](gainmap_avif_hdr.py) retains the original native
sampling failures and tests native antialiased map resampling with float32 gain
application. Both candidates use the same independently reconstructed source
and unchanged photographic HDR gates. Source reconstruction, linear geometry
and the emitted single-layer PQ12 AVIF must pass separately. PQ encoding honors
each native input's actual luminance normalization. The map-sampling convention
is fixed for this proof; it is not claimed as ISO's uniquely mandated filter.
Containment, crop, stretch and upscale keep separate candidate results; the
original source-sampling failures remain visible at every geometry.
Named reconstruction profiles remain bound to the source hash. Physical consumer
interoperability remains unqualified.
The separate [HDR PNG16 proof](gainmap_avif_hdr_png.py) checks the same native
source reconstruction and unchanged HDR reference. Its original PNG does not
establish requested square pixels: pHYs reports 0:1. A native rewrite declares
1:1 while preserving every decoded RGB16 and alpha sample. Independent libpng,
FFmpeg and ExifTool verify storage, PQ signaling, dimensions and privacy;
source, geometry and final appearance must still pass. The original aspect
failure stays visible beside the corrected candidate.
The separate [regenerated gain-map AVIF proof](gainmap_avif_preserve.py) preserves
actual base, map and alternate depth at eight bits for containment, crop, stretch
and upscale. Independent BMFF/tmap and
AV1 packet inspection precede authored SDR, independent HDR and native HDR
appearance checks. Stock depth-8 failures and automatic-depth-12 incompatibility
remain visible. Qualification covers the declared full-headroom endpoints only:
regenerated offsets and headroom differ from the source, so intermediate display
adaptation remains untested. Physical consumers remain pending.
The separate [authored SDR JPEG proof](gainmap_avif_jpeg.py) checks containment,
crop, stretch and upscale from the same gain-map AVIF source. Standard sRGB
RGB8 quality-100 JPEG passes
the first three geometries. Upscale fails the unchanged shadow maximum at
25.49485 in both native-input and full-reference comparisons. A separate
gamma-3.2 ICC upscale passes the same gates, with shadow maximum 3.83562.
Native conversion changes the coding transfer of the existing SDR samples;
the authored reference and sRGB primaries remain unchanged. Regional mean
errors increase but remain within the fixed limits. Exhaustive sample checks
verify the native coding transfer, and the standard-sRGB failure stays visible.
Independent inspection establishes color from actual ICC, RGB components and
Adobe transform fields; decoder-guessed
color defaults remain diagnostics. Actual dimensions are checked without
inventing an absent JPEG aspect declaration. Physical interpretation remains
pending independently from the lossless PNG, WebP and AVIF versions.
The separate [HDR JPEG proof](gainmap_avif_hdr_jpeg.py) combines the
verified native SDR and HDR preparations from this source. Its gamma-3.2 ICC
base and regenerated midpoint-offset gamma-1.5 map pass the unchanged SDR,
native HDR, independent HDR and cross-reader gates at display boost 16 for
containment, crop, stretch and upscale. The original containment remains exact.
Independent HDR maximum error is 6.10543 across these cases; both actual JPEG layers are RGB8
SOF0. The source reference uses independent dav1d samples and parsed tmap
metadata. A separate [boost-2 rendering proof](gainmap_avif_hdr_jpeg_headroom.py)
retains the exact containment file but fails against the source reconstructed
at that same boost. Both readers agree; independent shadow maximum is 75.26896.
Capacity-normalized and uncompressed-map diagnostics still fail. Changing the
authored SDR geometry to a linear-light reference would itself fail the existing
SDR gate, so that reference remains unchanged. These are optional conversion
measurements, not an additional required product path. Stock-reader failure and
measured adaptation failure remain explicit; browser and wallpaper results are
pending.
The [separate-map experiment](gainmap_avif_separate_map.py) uses native map
sampling and geometry with the original gain metadata. Its checked metadata
carrier supplies no image pixels. Source and output weights match, and the
actual-ICC authored SDR measurement stays exact, but all three renderings fail.
Shadow maxima reach 146.7847 at boost 2 and 171.395 at source-full headroom.
Uncompressed-map diagnostics retain those errors. The fixed references contain
809 pixels with an exact channel-order violation for an equal-offset monotonic
gain curve. This identifies a representation constraint, not proof that no
approximate file can meet the regional limits.
The [unresized format conversion](gainmap_avif_identity_jpeg.py) retains the
original base raster, native sampled map and checked source gain metadata.
One actual RGB8 HDR JPEG passes authored SDR and both HDR readers at boosts 2,
source-full and 16. The independent HDR maximum across those renderings is
4.666031, and the SDR maximum is 3.962015, under the unchanged regional gates.
Actual ICC interpretation remains necessary. This optional identity conversion
does not qualify resize, crop, orientation or other display headrooms. Its
candidate and matched SDR reference are included for pending physical review;
all failed resized experiments remain separate.
The [authored SDR GIF containment](gainmap_avif_gif.py) remains failed. Its real
256-color native palette passes structure, ICC, opacity and independent decoding
but exceeds the unchanged shadow and midtone appearance gates. A read-only
comparison finds 900 reference pixels with no color in this exact palette
within the maximum error of 8. Changing dithering alone cannot fix those pixels;
this does not prove other palettes or GIF encoders impossible.
A separate native libimagequant palette also fails. It improves regional means
but raises the shadow maximum to 62.97; 951 pixels cannot meet the maximum gate
with that exact palette. Both native outputs remain failed, with distinct
case IDs and unchanged references. The native package version, library hash
and its different version-API report are recorded separately.
A third candidate applies the existing native gamma-3.2 coding transfer before
the same libimagequant adapter, with an actual matching ICC profile. It reduces
the shadow maximum to 46.78 and the exact-palette bound to 794 pixels, but still
fails shadow and midtone gates. The optimizer's fixed gamma convention is
recorded separately from the actual output color interpretation. All three
photographic GIF candidates remain unqualified.

The separate [APNG proof](apng.py) adds four animated RGBA16 fixtures covering
PQ/HLG and P3/Rec.2020. Their two full-canvas frames use SOURCE blending, no
disposal, 300/700 ms timing and three plays. Native FFmpeg encodes the animation;
an independent chunk reader checks timing, loops and signaling, then gives
untouched compressed frame data to the native libpng decoder. Exact source
sample comparisons include fractional alpha. Contain, cover, fill, upscale and
orientation derivatives cover HDR APNG and AVIF, plus explicit SDR APNG,
gamma-2.2 AVIF and gamma-2.2 ICC WebP. Four separately hashed EXIF-8 sources
exercise real nonidentity orientation; every native frame rotation is checked
against an independent exact pixel rotation before geometry conversion.
HDR APNG signals CICP; native SDR APNG uses the standard sRGB chunk. The unchanged
SDR reference uses one declared sequence peak, 4000 nits for PQ or 1000 nits for
the HLG reference display. Original-byte and unsupported-composition controls
remain separate from codec qualification. Two native partial-rectangle fixtures
verify exact SOURCE replacement, including fractional alpha and stored RGB under
zero alpha. The independent reader checks rectangle bounds and requires the
first default-image frame to fill the canvas. Explicit static extraction checks
the first fully composed frame for HDR PNG/AVIF and SDR PNG/AVIF/WebP/JPEG/GIF
at each tested geometry. JPEG opacity and GIF binary alpha require explicit
coercion; preserve-alpha requests are rejected. The two original gamma-2.2 PQ
static GIF orientation cases exceed the fixed shadow color-error ceiling and remain
unqualified; their separately measured gamma-3.2 alternatives retain the same gates.
OVER blending, disposal and unlisted geometries remain unqualified in this APNG subset.
Browser, viewer and wallpaper interpretation remains pending manual review for
every emitted representation.

Authored SDR lossless PNG and WebP candidates pass all four gain-map sources,
two requested gamuts and seven geometries using 8-bit samples with independently
verified sRGB transfer and sRGB or P3 ICC primaries. Their 112 cases keep the authored SDR grade and
unchanged appearance gates; physical consumer interpretation remains pending.

The [authored SDR AVIF candidate](authored_avif.py) uses native AOM RGB8 encoding
and independent dav1d decoding. It preserves the base's eight-bit depth with
explicit sRGB-transfer CICP and either sRGB or P3 primaries. It rejects auxiliary
gain maps, conflicting ICC profiles, motion, alpha and disagreeing color facts.
The same authored-base geometry and regional appearance limits still apply.

The appearance metric keeps signed color coordinates when a valid color lies
outside an intermediate RGB gamut. P3 red, for example, has a negative blue
coordinate in Rec.2020. It checks finite values, nonnegative luminance and the
BT.2124 LMS domain without clipping those coordinates. Tests require identical
measurements for the same color expressed in either gamut. Color-error and
luminance-error thresholds remain unchanged.

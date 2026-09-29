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

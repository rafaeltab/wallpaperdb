# Physical display and wallpaper review

Every browser, native viewer and wallpaper result below is **pending manual review**. Automated decoding, CICP/ICC inspection, sample depth, screenshots and `dynamic-range: high` cannot certify visible HDR luminance. Do not close [the proof ticket](https://github.com/rafaeltab/wallpaperdb/issues/284) when native codec tests pass.

Use the emitted files referenced by [the conversion report](results/report.md), retaining their SHA-256 hashes from [the inspected manual-file manifest](results/manual/manifest.json). The selected files are in [results/manual/](results/manual/). Their original files also remain pending physical review; a source file is not automatically a display reference that has passed.

Keep each source original, transformed HDR candidate, matched-geometry authored/reference SDR file and explicit sRGB SDR candidate together. Consult [the conversion matrix](results/conversion-matrix.json), [appearance measurements](results/measurements.json), [fixture provenance and hashes](results/fixtures.json), and [native versions](results/native-versions.json) before recording a result. A failed candidate is useful for diagnosis but must retain its failed label throughout this review. Physical approval cannot override a failed structural, privacy or appearance check.

## Review environment

Record date, reviewer, OS build, browser version, monitor/display identity, display profile, HDR mode, brightness, automatic brightness/True Tone/Night Shift settings, battery/power mode and ambient light. On Windows, record HDR and SDR content brightness settings and monitor preset. On mobile devices, record power-saving and enhanced brightness settings. Keep these settings stable within each comparison and repeat any questionable result in the expected daily-use configuration.

| Device and required browser | Still gain-map JPEG | Still PQ AVIF | Still HLG AVIF | Animated PQ AVIF with alpha |
| --- | --- | --- | --- | --- |
| Safari, 16-inch 2023 M2 Max MacBook Pro | Pending | Pending | Pending | Pending; test explicit SDR WebP fallback if needed |
| Safari, 12.9-inch 6th-generation iPad Pro | Pending | Pending | Pending | Pending; test explicit SDR WebP fallback if needed |
| Chrome, Windows HDR PC with QD-OLED DisplayHDR True Black 400 | Pending | Pending | Pending | Pending |
| Chrome, Galaxy S26 Ultra | Pending | Pending | Pending | Pending |

Test Android/ISO, Android XMP, old Apple and new Apple JPEG separately. Test every emitted PQ/HLG P3/Rec.2020 and 8/10/12-bit variant represented in the report. Do not infer one flavor's result from another flavor or assume wide gamut means HDR presentation. Animated HLG plus alpha and extra HDR PNG/APNG/WebP conversions remain optional candidates with separate records.
The inspected bundle includes all 24 static AVIF source combinations and their
contain derivatives, including opaque and fractional-alpha variants. Use each
file's manifest status; the bundle also retains failed candidates for diagnosis.
The optional PNG8 bundle covers all eight PQ/HLG, P3/Rec.2020 and alpha sources,
their separately hashed EXIF-8 variants, and inspected containment/orientation
outputs. Test HDR PNG8 and AVIF8 separately from explicit SDR PNG16 and AVIF8.
The higher-depth HDR PNG16 and AVIF12 candidates are separate files. Compare
their gradients and fractional alpha against the same eight-bit source intent;
increased output precision cannot recover detail absent from that source.
Separate PNG8-to-SDR WebP candidates use gamma-2.2 ICC coding and fractional
alpha. Confirm that each consumer interprets the embedded profile and preserves
the transparent edges against the same SDR reference.
Nearest-code WebP candidates have distinct `nearest8` names. Compare their
transparent edges and shadow/midtone gradients with the earlier candidates;
each representation retains its own file qualification and pending consumer result.
The separately named MozJPEG ISO crop uses baseline RGB8 JPEG coding for both
the SDR base and gain map. Check its SDR appearance and HDR reconstruction in
each consumer independently of the predictive-lossless JPEG candidates.
The direct-input failures remain diagnostic files; use the manifest to select
the separately qualified native-normalization candidates for consumer review.

Combined HDR JPEG candidates use SOF3 predictive RGB8 base and gain-map coding.
The pinned libavif reader rejects this coding; the suite's validated native
JPEG/ISO and patched libultrahdr decoders check its file accuracy. Record each
browser, viewer and wallpaper setter's ability to decode these exact files
before assessing visible HDR. A different JPEG candidate's result does not
establish SOF3 compatibility. Keep every consumer result pending until tested.
The bundle also includes inspected 16-bit PQ PNG files showing the native
encoder's matched-geometry HDR intent. Use these to compare another HDR container
when a consumer rejects the JPEG. They are native comparison files, not
independent source references or additional qualified conversions.
Separate SOF0 DCT JPEG candidates have their own manifest entries. Some retain
measured shadow failures and are only diagnostic files. Test a qualified SOF0
file separately from the SOF3 file; neither result establishes the other's
decoder, gain-map interpretation or HDR presentation behavior.
Gamma-3.2 ICC-aware HDR JPEG experiments have separate SDR-base and HDR
measurements. The midpoint-offset map-gamma-1.5 ISO upscale passes the file
gates with experimental ICC-aware readers, as does the separate Android XMP
upscale. Old Apple containment and upscale have their own qualified ICC-aware
file candidates with the same pending consumer limitations. Their original
source needs its headroom MakerNotes; a source missing those facts remains
original-only. New Apple containment also passes the file gates. Its original
upscale remains a failed diagnostic with either floating- or integer-DCT map
coding; the separately named FLOAT-base/FLOAT-map upscale passes. Check that
exact file against its matched SDR base and native HDR intent, retaining its
ICC-aware reader scope. Its source headroom comes from the verified
auxiliary XMP; unknown required XMP facts remain original-only. The five earlier
ISO variants remain failed diagnostics. Stock native readers assume sRGB transfer or reject ICC
in this path. Each manifest entry retains this qualification scope and its
reader limitations. Check ICC interpretation and HDR reconstruction separately
from a consumer's ability to open the JPEG; keep physical results pending.
The old Apple source-model diagnostic finds that the retained libavif source
convention fails Apple's documented full-effect comparison. Its earlier
endpoint passes establish accuracy against that legacy convention only.
Keep this source-model blocker separate from output decoding and visible HDR.
The documented full reference has a new revision; it supplies no asserted
boost-2 interpretation and does not establish the newer XMP variant's semantics.
The corrected native old Apple full-source preparation passes the documented
source comparison. It is encoder-input evidence only. Check each derivative's
separately named source model and file qualification before drawing a conclusion
from its visible appearance.
The separately named corrected old Apple containment, crop, stretch, upscale
and EXIF6 orientation have qualified boost-16 file comparisons against the
documented full effect. The bundle includes the generated EXIF6 source; check
its display orientation against the baked 173-by-130 derivative.
Each manual entry includes its HDR JPEG, matched authored SDR reference and inspected native PQ16 HDR
intent. The intent is encoder input, not an independent source reference.
Keep its documented-model label separate from earlier legacy-model files.
Their stock-reader failures and untested intermediate adaptation remain visible;
Mac, iPad, Windows and Galaxy observations are still pending.
The corrected old Apple PQ10/PQ12 P3 AVIF containment, crop, stretch and upscale
are separate fixed-luminance full-effect files. Each authored SDR companion is a
comparison image; the AVIF has no embedded SDR base or adaptive gain map. Record the viewer's tone mapping
and apparent brightness separately from the passing file comparison. Its PQ16
companion is inspected encoder intent, not an independent reference.
The gain-map JPEG endpoint comparisons use display boost 16. Check the separate
ISO upscale boost-2 rendering record before selecting a download; its measured
adaptation failure cannot be overridden by a successful endpoint or a physical
observation. Repeat gain-map comparisons at different brightness settings and
window sizes, recording changing shadow, exposure and highlight behavior.
The browser's actual effective headroom may be unknown, so do not label a
brightness setting as an exact numerical boost without measuring it.
The original ISO candidate also has a failed boost-64 full-source comparison.
Its source capacity exceeds boost 16, so that earlier comparison is not the
fully applied source HDR image. Use the joint same-file record for boosts 2,
16 and 64; successes from different output files cannot be combined into one
adaptive-HDR approval.
The separately named full-source candidate passes at boost 64 and fails at 2
and 16. Its native HDR comparison PNG belongs only to the boost-64 record.
Use the independent same-boost references for the other renderings; neither
file has passed the complete adaptive comparison.
The source-capacity variant preserves compressed coding and matches the source
weights. It improves highlight measurements at boosts 2 and 16 but still fails
their shadow/midtone gates. Its passing boost-64 comparison cannot clear those
failures. Keep the variant's separate manifest record and file hash.
The matrix inventories adaptation for every required gain-map geometry and
source dialect. It requires the same file at boosts 2 and 16, plus 64 for the
ISO source. Keep untested comparisons pending; the separate ISO measurements
cannot qualify another source dialect.
The separate ISO containment, crop, stretch and EXIF6 rendering entries retain
the same file across boosts 2, 16 and 64. Each passes only at 16. Their matched
SDR references and failed-rendering labels remain in the manual bundle.
The separate XMP containment, crop, stretch, upscale and real EXIF6 entries each
retain one file at boosts 2 and 16. Only their boost-16 renderings pass. Use
each entry's independent same-boost reference, retain its failed boost-2 label,
and record the manifest's rendering scope alongside physical observations.
Upscale requires the declared experimental ICC-aware readers. Apple intermediate
adaptation remains untested.

The optional gain-map AVIF source has separately inspected authored-SDR AVIF
derivatives for containment, crop, stretch and upscale. Compare them with the
matched SDR bases and verify privacy and geometry. Nonidentity orientation
remains unqualified.
The separately inspected SDR PNG8 files cover the same four geometries with
standard PNG sRGB signaling and square pixels. Compare their authored SDR
references separately from the AVIF renditions in each browser, viewer and
wallpaper setter.
The authored SDR WebP files cover the same four geometries with lossless RGB8
and a standard sRGB ICC profile. Compare its exact file with the matched authored SDR reference and
the PNG/AVIF versions; do not infer ICC interpretation from successful decoding.
The separate SDR JPEG containment, crop and stretch use standard sRGB ICC and
RGB8 SOF0 coding. Its standard-sRGB upscale remains a failed diagnostic.
The separately named gamma-3.2 ICC upscale passes file accuracy with the same
authored reference. Check its actual ICC interpretation on each consumer;
opening the file does not establish correct shadows or contrast.
Compare its inspected file with the same authored SDR reference and the lossless
variants. The JPEG has no separate aspect declaration; check the recorded
raster dimensions and consumer geometry independently.
The inspected SDR GIF containments from FFmpeg and libimagequant, including
the separate gamma-3.2 ICC candidate, are failed palette diagnostics. Their metadata
privacy, actual ICC, opacity and one-frame structure pass, but their shadow
and midtone color errors exceed the file gates. Do not use them as a qualified
SDR fallback even if the consumer opens it.
The gain-map AVIF source also has inspected HDR JPEG containment, crop, stretch
and upscale with a
gamma-3.2 ICC base and regenerated RGB8 map. Its file measurements pass at
display boost 16 through ICC-aware readers. Compare both SDR and HDR endpoints
against their matched references; stock-reader and intermediate-adaptation
limitations do not disappear when a consumer opens the file.
The same containment JPEG has a separate failed boost-2 record with its own
matched source reference. Keep its passing boost-16 endpoint and failed
intermediate rendering separate in the checklist; a successful endpoint does
not clear that appearance failure.
The separately resized original-map candidate has correct source capacity and
gain metadata, but fails at boost 2, source-full headroom and boost 16. All three
entries point to the same diagnostic file. Matching metadata does not make it
an approved HDR derivative.
The optional unresized gain-map AVIF-to-HDR-JPEG conversion has one file that
passes the automated comparisons at boosts 2, source-full and 16. Its three
manifest entries share the same file hash and record different `rendering_scope`
values. They are measurements of one adaptive image, not three different image
contents. Compare that file with its original-raster SDR reference and source
at each device setting, recording the consumer's actual behavior. Its ICC-aware
scope and pending physical status still apply; it does not qualify the failed
resized candidates or unmeasured headroom values.
The separately named HDR candidates emit single-layer PQ AVIF12 for containment,
crop, stretch and upscale. The original
native-map-sampling candidate remains failed; the antialiased-map candidate has
its own source, geometry and output measurements against the declared renderer
convention. Compare the exact files independently on each device. A browser may
sample the source gain map differently, so record the source rendering as well
as the derivative. These single-layer results do not establish physical HDR
presentation or gain-map interpretation.
Single-layer HDR PNG16 candidates use the same declared renderer convention.
Keep the original ambiguous-aspect diagnostic separate from the square-pixel
candidate, and compare each qualified PNG with the corresponding PQ AVIF12 and
authored SDR pair. Opening a 16-bit PNG does not establish visible HDR output.
The separate regenerated gain-map AVIF containment, crop, stretch and upscale
keep eight-bit base, map and alternate declarations. Each passes the authored
SDR endpoint and the declared log2-headroom-4 HDR reference. Its regenerated offsets and headroom differ from
the source; intermediate display adaptation remains untested. Compare source
and derivative at stable brightness, then repeat at another brightness setting
and window size. Record any changing exposure or highlight difference separately
from decoding, color signaling and the measured full-headroom result.

The optional APNG files have 16-bit samples, PQ/HLG with P3/Rec.2020 CICP, and
two full-canvas frames lasting 300 and 700 ms over three plays. Their explicit
SDR APNG counterparts carry a standard sRGB chunk; the SDR AVIF and WebP
counterparts carry gamma-2.2 CICP or ICC signaling. Keep their browser, native
viewer and wallpaper results pending independently on all four devices. The
separate EXIF-8 source variants exercise animation orientation; their inspected
derivatives bake the rotation into every frame. Check both frames' dimensions
and orientation independently from a still preview.
The inspected static extracts select the first fully composed frame. JPEG
opacity and GIF binary alpha use explicit coercion. The failed PQ GIF orientation
files are diagnostics and must not be recorded as qualified fallbacks.

## Browser procedure

- [ ] Verify the downloaded file hash against the report before opening it. Record exact file path and selectors, including range, gamut, depth, motion, transparency and geometry.
- [ ] Open both a thumbnail and a full view. Record whether each decodes, has correct dimensions and orientation, and preserves the crop and composition. Inspect portrait cases separately.
- [ ] Compare the HDR candidate with the source at matched geometry, then with its explicit SDR counterpart. Confirm highlights visibly exceed ordinary white where the source does; inspect shadow detail, midtones, ordinary white and bright highlight texture. Record any exposure shift, clipping, banding, color shift or halo.
- [ ] Compare each gain-map JPEG's SDR rendering with its authored SDR base. Confirm a visibly changed SDR grade is not being mistaken for a successful HDR transform.
- [ ] Check the saturated art and gamut patches for hue shifts or flat clipping. Compare the sRGB SDR reference independently from the preserved-gamut reference.
- [ ] Test gamma-2.2 and gamma-3.2 SDR candidates separately from standard sRGB-transfer candidates. Verify their inspected CICP `1/4/0` or embedded ICC profile, then compare the same SDR reference on each browser, viewer and wallpaper setter. A consumer that ignores the declared transfer can change shadows and contrast despite using the correct primaries.
- [ ] Play animated PQ AVIF over both dark and light checkerboard backgrounds. Verify fractional alpha and edges, first fully composed frame, frame order, frame durations, loop behavior and steady exposure across frames. Repeat playback and reload to detect adaptation or rerun exposure shifts.
- [ ] Repeat the animation checks for optional HDR APNG and its inspected SDR APNG/AVIF/WebP derivatives. Record whether the consumer displays both frames or only the PNG default image. Compare the fixed ordinary-white column across frames, fractional alpha, 300/700 ms timing and three plays. A still preview does not qualify animation.
- [ ] Test static extraction against the animation's first fully composed frame, with the same crop and background.
- [ ] If Safari's HDR AVIF animation fails, test the separately inspected animated SDR WebP with `range=sdr&gamut=srgb&depth=8`. Record its motion/alpha result independently. Keep the HDR AVIF download available; do not relabel the SDR fallback HDR.
- [ ] In Firefox and every unqualified HDR path, explicitly request a qualified SDR rendition. Confirm its format decodes and animates where required. Record both the selected format and `range=sdr&gamut=srgb`; do not count an implicit HDR flattening as the fallback.
- [ ] Download the original and each requested rendition. Recheck their hashes so browser rendering and download records refer to the same inspected bytes.

## Native viewers and built-in wallpaper setters

Test each application separately from the browser. An OS setter that flattens HDR does not invalidate the HDR download, but its wallpaper route stays unqualified for HDR. The device still needs at least one usable inspected SDR download. Start with an opaque sRGB JPEG made by the explicit alpha/background selector where needed, then test other inspected SDR encodings. A transparent source does not silently acquire a background.

| Device | Native viewer and version | HDR viewer result | HDR wallpaper result | Usable SDR wallpaper file and hash |
| --- | --- | --- | --- | --- |
| MacBook Pro | Pending | Pending | Pending | Pending |
| iPad Pro | Pending | Pending | Pending | Pending |
| Windows QD-OLED PC | Pending | Pending | Pending | Pending |
| Galaxy S26 Ultra | Pending | Pending | Pending | Pending |

- [ ] Open the exact downloaded HDR and SDR files in the native viewer. Repeat the appearance, orientation, alpha and animation checks that the viewer supports.
- [ ] Apply each still HDR candidate through the built-in wallpaper setter. Record whether it is accepted and whether the resulting wallpaper retains visible HDR. Record any flattening, color shift, exposure change, crop or rotation.
- [ ] Apply the explicit SDR candidates. Record which encodings the setter accepts, whether the result is correctly oriented and colored, and the selected OS fit/crop setting.
- [ ] Reopen the saved file after wallpaper installation to distinguish an OS rendering change from a modified download. Verify its hash where the OS exposes the original file.

## Per-observation record

Copy this record for every exact representation and consumer path. Leave a field pending if no observation was made. Optional diagnostic screenshots cannot replace the reviewer's physical-display judgment.

```text
Date / reviewer:
Device / display / OS build:
Application / version:
HDR and display settings / power / ambient light:
Input filename / SHA-256:
Output filename / SHA-256:
Conversion case ID and exact selectors:
Automated rendering scope / source-reference revision:
Actual consumer headroom: measured value and method / unknown
Declared transfer / CICP / ICC profile hash:
View: thumbnail / full / downloaded native viewer / wallpaper
Decode: pass / fail / pending
Visible HDR relative to ordinary white: pass / fail / pending / SDR requested
Shadow / midtone / highlight appearance:
Color / gamut / gradients:
Geometry / orientation:
Animation order / duration / loop / repeated exposure:
Alpha on light and dark backgrounds:
SDR authored-base or tone-map reference comparison:
OS wallpaper accepts file / retains HDR / usable SDR alternative:
Result: qualified for this consumer path / failed / pending
Observed failure and smallest remaining blocker:
```

Keep physical consumer results separate from automated codec qualification in the matrix. A passing file path is not a blanket browser capability, and an HDR browser result does not qualify an OS wallpaper setter. The [HDR resolution](https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153) remains the product authority.

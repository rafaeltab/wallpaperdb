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

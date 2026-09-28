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

Changes to fixtures require an intentional `--update-fixture-lock` run and review of the changed source hashes. Dependency changes require new lock files and native qualification. The suite never downloads a floating fixture or silently refreshes an expected hash during normal execution. `fixtures/generated-sha256.json` covers generated AVIF and selector inputs; the committed JPEG fixture manifest and fixture tests cover the camera corpus and regenerated ISO representation.

The Python color equations and request oracle exist only in this proof. FFmpeg/libplacebo, Sharp/libvips/libultrahdr, and libavif/AOM perform the native candidate conversions. dav1d, ExifTool, Pillow/libjpeg, a small reader linked to libpng, and the independent gain-map reader check the bytes. Their precise limitations are recorded in every affected case. Unit tests of the proof-side request oracle do not claim production endpoint behavior. Media's existing dependency versions, source admission, UI, migrations, generation policy and caching are unchanged.

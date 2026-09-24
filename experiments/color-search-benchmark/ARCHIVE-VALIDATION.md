# Prototype archive validation

Recorded 2026-09-24 when the user requested that all color-query prototypes and
research documents be committed and pushed before consolidating the production
direction on a new branch.

The archive preserves experiments and their historical conclusions. It does not
implement production filtering, change the saved favorite, or rerun the large
benchmark campaigns. Downloaded wallpapers, the supplied ZIP, original raster
images, runtime index data and large raw measurement streams remain external.
Small generated SVG fixtures are reproducible test inputs, not downloaded art.

## Checks at archive time

The following existing Make targets passed, totaling 53 tests. The lab target
also checks the linked-slider browser script's syntax.

```sh
make color-linked-strictness-test color-linked-strictness-lab-test \
  color-linked-strictness-feedback-test color-favorite-lab-test \
  color-favorite-performance-test
```

This is a targeted archive check, not a claim that every historical prototype or
the full application CI was rerun. Earlier service, feedback, browser and scale
validation is retained in each experiment's reports, including failed runs.
The staged whitespace check reports existing trailing spaces and blank final
lines in historical reports, verbatim judgments and some prototype sources.
These bytes are preserved to retain recorded source/evidence hashes; the archive
does not apply a blanket formatting pass.

The [external research archive](research-archive/README.md) preserves additional
research notes, source snapshots, audit scripts and generated reports, with an
inventory of what was copied or left external. Large text reports are compressed
losslessly; their uncompressed hashes distinguish archival storage from changed
evidence.

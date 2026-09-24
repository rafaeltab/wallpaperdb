# Decoded blind review

The judgments in [VISUAL-BLIND.md](VISUAL-BLIND.md) were recorded before the reviewer saw the method key. The coordinator decoded them afterward. The reviewer was a model, not a human panel, and these eight sheets were selected for visual sanity checking rather than statistical estimation.

| Query | Current cosine: convincing /5 | Raw L2: convincing /5 | Palette .06: convincing /5 | Preference |
| --- | ---: | ---: | ---: | --- |
| Orange | 1 | 1 | 3 | Palette |
| Teal | 1 | 1 | 5 | Palette |
| Sky | 0 | 1 | 1 | Palette: clear match ranked first |
| Navy | 1 | 0 | 2 | Palette |
| Magenta | 0 | 0 | 0 | None convincing; palette best fallback |
| Rose | 0 | 0 | 2 | Palette, but best match ranked fifth |
| Cream | 0 | 1 | 3 | Palette |
| Black/red | 1 | 1 | 2 | Palette, but top result weaker than ranks 2–3 |
| **Total slots** | **4/40** | **5/40** | **18/40** | |

The qualitative improvement supports the independent pixel metrics. It also rules out claiming the palette is already a finished filter: several fallbacks are weak, saturated magenta has no convincing match, rose ordering remains imperfect, and the two-color score can still overvalue an image missing substantial coverage of one color.

Letter decoding, local to each sheet:

| Query | A | B | C |
| --- | --- | --- | --- |
| Orange | Palette | L2 | Current |
| Teal | Current | L2 | Palette |
| Sky | Current | L2 | Palette |
| Navy | L2 | Current | Palette |
| Magenta | L2 | Current | Palette |
| Rose | Current | Palette | L2 |
| Cream | L2 | Current | Palette |
| Black/red | Palette | L2 | Current |

Run `make color-benchmark-blind-review` to recreate the contact sheets under `output/blind/`. Their mapping is deterministic. The interactive report also supports freshly shuffled anonymous columns for the user's own inspection.

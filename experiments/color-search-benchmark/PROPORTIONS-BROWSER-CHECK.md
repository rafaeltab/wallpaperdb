# Color-proportion prototype: browser checks

Checked on 2026-09-15 using a separate agent-browser Chromium session against the live local prototype at `http://127.0.0.1:8220/proportions.html`. These are interactive smoke checks, not a claim of production readiness or human ranking accuracy.

## Results

| Check | Observed result |
| --- | --- |
| Load real corpus | All 100 wallpaper palettes ranked; each comparison column initially shows 12 images. Original thumbnails load. |
| 40% green, target mode, controlled examples | Both 40% green examples rank first with cost 0.000; 50% green costs 0.100; excess green is penalized. The previous presence method instead puts 100% green first and 80% green second. |
| 50% green / 50% red, controlled examples | Exact 50/50 example ranks first with cost 0.000; displayed measured areas are 50% and 50%. |
| 80% red / 20% black, controlled examples | Exact 80/20 example ranks first with cost 0.000. |
| Five colors, 20% each, controlled examples | Exact five-color example ranks first with cost 0.000; all five displayed estimates are 20%. |
| Minimum mode | For at least 40% green, 40%, 50%, and 100% green examples all receive cost 0.000. Labels say “≥ 40% wanted”; the remainder explanation changes. |
| Incomplete real-corpus match | For default 40% green at tolerance 0.06, top real result estimates 10.6% green. The interface warns that the nearest result still differs by more than 15 percentage points. It does not present the requested 40% as measured coverage. |
| Total above 100% | Editing 50/50 to 80/50 shows “Requested percentages must add up to at most 100%.” Previous results clear. Percentages are not rescaled. |
| Ten-color query | Ten distinct colors at 10% each remain valid; ten estimates render per result; Add color is disabled at the interface limit. |
| Duplicate and reordered colors | URL query red 50%, green 30%, green 20% merges the green entries into 50%; reversing the color order retains the exact 50/50 match. |
| Method and dataset controls | Transport, exclusive coverage, and previous presence can be selected. Switching controlled examples to real wallpapers updates the count, image list, descriptive text, and URL. |
| URL navigation | Presets and option changes update the URL; browser back/forward restores color rows, percentages, and ranking. |
| Desktop layout | At 1440 px wide, both result columns are visible side by side with no horizontal overflow. |
| Mobile layout | At 390 × 844, controls fit the viewport and result columns stack. Document width equals viewport width; no horizontal overflow. |
| Accessibility smoke check | axe-core 4.12.1, WCAG 2 A/AA tags: 0 violations, 0 incomplete checks, 26 passes on the final controlled-example page. Added explicit group/image roles for labeled presets and palette strips after the first check. |
| JavaScript syntax | `node --check experiments/color-search-benchmark/proportions-ui.mjs` passes. |

Observed local rendering/ranking times were approximately 44–52 ms for two methods over the 100 real palettes, and 5–8 ms for 16 controlled examples. These browser observations include prototype work and are not service latency benchmarks.

## Final screenshots

Screenshots show the default 40% green query against the separate controlled examples, making the exact-proportion versus presence difference visible.

- [Desktop, 1440 × 1400](output/proportions-desktop.png)
- [Mobile controls, 390 × 844](output/proportions-mobile.png)
- [Mobile results, 390 × 844](output/proportions-mobile-results.png)

Earlier screenshots accidentally placed in the repository-root `output/` directory were removed; final screenshots are under this experiment’s `output/` directory.

## Remaining limits

No functional UI blocker was found in these checks. A narrow screen requires scrolling between the stacked comparison columns. Clipboard permission behavior was not exhaustively tested; the current query is also available in the page URL. Coverage remains an estimate from palette colors, and shade choice plus tolerance can materially change it. The real corpus does not contain a close example for every requested composition.

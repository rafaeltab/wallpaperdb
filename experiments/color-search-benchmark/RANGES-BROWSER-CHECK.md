# Color ranges: browser checks

Checked on 2026-09-16 in an isolated agent-browser Chromium session against `http://100.97.42.108:8220/ranges.html`. The new page preserves and links to the original proportions prototype.

## Interactive checks

| Check | Observed result |
| --- | --- |
| Default ranking | Left defaults to “Center 100% · edge 50%”; right defaults to “All accepted shades equal.” The optional outside-softening method remains selectable. |
| Center preference | On the 20 controlled range examples, the default 70% red / 30% black query puts exact red/black first with area error 0.000 and color preference 100%. The flat comparison ties several accepted shades and places the nearby-red-shades example first by its stable ID ordering. |
| Literal area kept separate | The exact red/black result displays 70% and 30% available and allocated, independently of color preference. Color preference is explicitly labeled as a tie-breaker for equal area errors. |
| OKLab controls | Independent radii initially display 20 for red and 50 for black, with explicit ×100 units. Changing either numeric input updates the slider and query. |
| Dark gray versus dark colors | Dark-gray preset uses HSL hue ±180°, saturation ±2 points, lightness ±10 points; preview shades are neutral. Any-dark preset uses HSV hue ±180°, saturation ±100 points, value ±25 points; preview includes dark red, green, and blue. |
| Accepted-shade previews | Swatches are checked after rounding to their displayed hex values, so a sample cannot fall outside the range because of display quantization. Hover text shows center preference without altering the displayed shade. |
| RGB axes | RGB-box preset exposes separate red, green, and blue limits of 20, 15, and 12 percentage points. |
| Combined constraints | HSV-and-RGB preset renders six independent axis controls around one anchor. Removing and adding the second constraint updates the editor; its color-space selector excludes the already used space. |
| Overlap | Expanding both default OKLab radii to 150 yields 100% available in each region but 70% and 30% allocated to the separate portions. The result explicitly reports 100% overlapping area and explains that allocation cannot count it twice. |
| Invalid total | An 80% / 30% query displays 110% requested and the maximum-100% error; prior results clear rather than being silently normalized. |
| Neutral hue validation | Restricting the black HSL anchor’s hue to ±90° produces an error and clears results. The UI explains that “all hues” means ±180° in this editor. |
| Ten-portion limit | Ten portions render and disable Add portion; zero-amount drafts do not affect ranking. Identical anchor/range definitions are combined for scoring, with an explicit explanatory note. No horizontal overflow at the limit. |
| Real wallpapers | Switching to the real dataset ranks all 100 wallpapers and initially shows 12 results per column. Original thumbnails load. Scarce matches show the missing-area notice. |
| Outside-softening comparison | Selecting the optional soft method reranks the same images and changes the cost label and explanation; literal available and allocated areas remain separately shown. |
| URL navigation | Query changes store normalized color regions, percentages, dataset, proportion mode, and comparison methods in the URL. Back/forward restores the editor and results. |
| Sharing on HTTP | When browser clipboard access is unavailable, Copy query link updates the address and prompts the user to copy it. This fallback was exercised on the HTTP tailnet origin. |
| Mobile layout | At 390 × 844, region controls and result tables fit; comparison columns stack. Document width equals viewport width. |
| Accessibility smoke check | Final axe-core 4.12.1 check with WCAG 2 A/AA tags: 0 violations, 0 incomplete checks, 28 passes. |
| Syntax | `node --check experiments/color-search-benchmark/ranges-ui.mjs` passed before the final formatting pass; final formatted code also loaded successfully in the browser. |

Observed browser ranking/rendering times included approximately 28 ms for graded plus hard ranking on 100 real wallpapers, 53 ms for graded plus outside-soft ranking, and 7–19 ms on the 20 controlled examples. These include browser scheduling and rendering overhead; they are not service benchmarks.

## Screenshots

All screenshots were captured from the final formatted page with the default controlled 70% red / 30% black query.

- [Desktop controls](output/ranges-desktop.png)
- [Desktop ranking comparison](output/ranges-results.png)
- [Mobile controls](output/ranges-mobile.png)
- [Mobile results](output/ranges-mobile-results.png)

## Remaining limitations

No functional UI blocker was found in these checks. Narrow viewports require scrolling between the comparison columns. Accepted-shade previews sample the region rather than showing every possible shade. Area estimates come from the stored palette and can be inaccurate when a narrow range cuts through a palette cluster; the page prominently links to the [source-pixel evaluation](RANGES-EVALUATION.md). The interface does not claim that the nearest available wallpaper necessarily meets the requested composition.

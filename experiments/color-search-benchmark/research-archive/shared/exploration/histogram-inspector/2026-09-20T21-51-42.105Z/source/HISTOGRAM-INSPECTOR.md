# Histogram inspector prototype

## Question

The user prefers storing color coverage and quality separately over precomputed named utilities, and proposes finer coverage-only bins with quality derived from query distance. The existing `histogram-intent-balanced` results do not feel satisfying. This inspector makes its current bins and score calculation visible so we can identify whether the problem comes from bin placement, query membership/quality, or the composition formula before changing the method.

The existing comparison on **http://zerotwo:8225/** must remain running and unchanged. The inspector is a separate process on **http://zerotwo:8226/**, using the same 545-asset scratch index and external image library. No new scoring method, image index, or human judgment is introduced.

## Work plan

1. Add a separate HTTP server and query/gallery interface. Search continues through the existing OpenSearch method and retains service order.
2. For a clicked wallpaper, ask OpenSearch for its actual score and diagnostic terms using the stored histogram and the same effective query parameters.
3. Show all 4,096 bins, including absent bins; explain coverage, query weights, per-target area and quality mass, and score terms.
4. Show each occupied bin's effect on the score if removed and the remaining colors rescaled to 100%. These effects are counterfactuals and **do not add up to the score**. Removing the only occupied bin has no defined remaining image and must be shown as unavailable.
5. Verify diagnostic reconstruction against real service scores across vibe, proportions, ranges and special accent queries; verify the two live pages independently.

## Run and inspect

```sh
make color-histogram-inspector
make color-histogram-inspector-test
make color-histogram-inspector-integration
make color-histogram-inspector-smoke
```

The inspector binds `0.0.0.0:8226` by default. Override `COLOR_HISTOGRAM_INSPECTOR_PORT` or `COLOR_HISTOGRAM_INSPECTOR_HOST` if needed. It shares the real-corpus OpenSearch service on port 19216; the million-record benchmark service remains stopped.

## Use the inspector

1. Choose a named color, picked swatch, or proportion preset and search.
2. Click a wallpaper to open its image, actual service score, formula terms and target measurements.
3. Use the color grid to examine query weights or image coverage. Select a bin to see its exact RGB center, rounded display swatch, sampled pixel count and contributions to each target.
4. Sort the bin table by coverage, weighted contribution or removal effect. Turn off **Only bins present** to inspect zero bins as well.
5. Open the formula/evidence details for the raw score terms and effective parameters. The inspection stays attached to the query that produced the gallery, even if the search controls are edited afterward.

## Implementation and validation

Search calls the existing registry method unchanged. Inspection uses its typed OpenSearch scoring script, plus a diagnostic script field that embeds the original score body verbatim. OpenSearch computes all occupied-bin measurements and removal effects. JavaScript only compiles shared query weights, adds zero-valued rows for absent bins and presents the result; bin-table sorting never reranks wallpapers.

Nine focused integration/HTTP tests pass, with no skips. They cover score parity across query modes, complete bin accounting, target contribution sums, independent removal-and-regather calculations, explicit zero-match and sole-bin cases, query/ID validation, and preservation of service ordering.

Eight live end-to-end cases also pass: named red, partial green, closed grayscale/red, partial grayscale/red, picked orange-red, HSL dark grayscale, dark/bright accents and grayscale/red accents. Each compares the new page's first twelve results with the still-running comparison, then verifies the clicked wallpaper's actual and reconstructed scores, all 4,096 rows, total coverage/counts and image loading. The largest reconstruction difference in this receipt is below 5e-8, consistent with the service's float32 score versus double diagnostic arithmetic.

Receipts and full diagnostic responses are stored outside the worktree:

`~/.local/share/wallpaperdb/color-evaluation/exploration/histogram-inspector/2026-09-20T21-51-42.105Z/`

The inspector runs as `wallpaperdb-color-histogram-inspector.service` under the user systemd manager, with restart on failure. Restart only that unit after backend changes. It is a transient unit and needs recreation after a reboot. The comparison's original unit and process remain untouched.

Desktop and mobile visual checks passed: saved-query inspection after editing controls, all-bin and present-bin views, sorting, target-specific weights, keyboard bin navigation, sole-bin undefined effects, named-to-picked switching, HSL ranges and advanced-query aliases. There are no observed JavaScript or image-loading errors. A mobile score-card overflow was corrected; final page and inspector widths are both 390 px at a 390 px viewport. Root independently reviewed the screenshots, and the read-only formula/state audit found no remaining correctness blocker.

Browser receipt: `exploration/histogram-inspector-qa/2026-09-20T22-00-46.279823+00-00.json` under the external store. Screenshots, test logs and source snapshots are preserved alongside the eight-case diagnostic receipt above. All requested inspector work is complete; both user-facing services remain active.

## Interpretation

Coverage is the fraction of the sampled image in a bin. Query weights are calculated once from bin representatives and the requested color definition. Quality mass is coverage multiplied by the matching quality weight; it is not another stored image feature. Matching area remains separate from quality mass.

The index contains a sparse packed RGB histogram; the UI expands missing bins to zero for inspection. Empty bins may still have a high query weight. The histogram represents the downsampled extraction image, so it is not an exact full-resolution pixel census. Named regions and custom ranges follow the existing method's definitions; this work does not silently switch to the proposed nearest-bin-is-100% rule.

## Findings and leads to investigate

The inspector preserves existing behavior rather than changing the method under investigation. Named-color queries use hand-authored family membership/quality rules; picked hex queries use color-distance/range rules. Bin centers can cross narrow region boundaries, especially near neutral colors. These are mechanisms to inspect, not new human relevance labels.

An independent code review identified a further existing-method lead: a target requesting 0% still contributes its color region to the union used by the outside-color penalty. Adding a 0% color can therefore reclassify some unwanted area as inside a requested region, while imposing a separate target-area error. No formula change was made; future evaluation should examine whether this matches the intended query semantics.

User findings remain pending. Preserve existing human feedback and do not infer new preference judgments from merely opening a wallpaper.

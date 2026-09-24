# Browser validation — 2026-09-20

Validated the live prototype at `http://127.0.0.1:8225/`, advertised to the user as `http://zerotwo:8225/`. The service is bound to `0.0.0.0`; actual access from a second tailnet computer was not available to this agent.

At validation time the metadata advertised **545 corpus assets and 16 methods**. The method registry and provider are loaded when the browser service starts, so restart `wallpaperdb-color-exploration.service` after backend/registry changes; static UI file changes are served immediately on reload.

## Automated checks

`make color-exploration-browser-test`: **7 tests passed** after adding the generated-findings route.

- Full normalized query, limit, method, and abort signal are forwarded to the injected service.
- Service result order is preserved exactly, with no document scoring/filtering in browser code.
- Invalid percentages, totals, hex values, method IDs, and limits fail before querying.
- Image requests use the registered corpus allowlist; arbitrary paths and unregistered images are rejected.
- Unknown service result IDs fail visibly; the server does not quietly remove them.
- Unsupported query responses stay explicit.
- The include-fixtures control is forwarded to the provider; the browser does not apply document eligibility locally.

The tests first failed because the server implementation did not yet exist, then passed after implementation.

## Actual browser and service checks

Used the installed `agent-browser` through `make color-exploration-browser-check`, with isolated session `color-exploration-browser-t3code-28be15f7`. The collaborative preview MCP had no available automation host.

- Desktop **1440 × 1000** and mobile **390 × 844** layouts inspected.
- Named red query returned three real OpenSearch result columns with scores, images, latency, and approximate/exact badges.
- **Black HSL range** (`h:1`, `s:0.02`, `l:0.1`, edge weight `0.5`) returned dark grayscale wallpapers for histogram composition. Unsupported native/vector methods displayed explanations rather than pretending they ran the query.
- **50% red + 50% green** query ran through the selected three methods and rendered all result columns on mobile.
- Original-image lightbox opened and closed, with a link to the allowlisted full image.
- `agent-browser errors` reported no page JavaScript errors after these interactions.

Screenshots are outside the repository at `/tmp/color-exploration-desktop-top.png`, `/tmp/color-exploration-hsl.png`, `/tmp/color-exploration-mobile.png`, and `/tmp/color-exploration-mobile-results.png`. They are inspection evidence, not committed assets.

## Adjustments from inspection

- Thumbnail previews use `object-fit: contain`, preserving the whole image. Cropping would distort a person's judgment of color proportions.
- Unsupported methods show **Unsupported query** without a misleading near-zero successful-query timing or an exact-retrieval badge.
- OpenSearch timing reads the provider's `evidence.serviceTookMs` field.
- The default comparison spans HSV cosine, indexed native target areas, and histogram composition instead of selecting two versions of the same HSV score.
- Search begins scrolling to the result area, especially useful on mobile.
- Named-family targets expose edge falloff only after custom ranges are enabled; otherwise their built-in family quality definition applies.

These checks establish browser behavior and integration on the real corpus. They are not million-wallpaper performance measurements, retrieval-recall evidence, or new human preference labels.

## Final expansion checks: 33, then 35 methods

After registry expansion, restarted `wallpaperdb-color-exploration.service` and confirmed **523 real wallpapers + 22 controlled fixtures** in the metadata. Choices are now grouped into five collapsible families, and defaults compare HSV cosine, `feature-intent-balanced`, and `hybrid-relative-accents`.

`browser-smoke.mjs` passed **44 live API checks across all 35 methods**. Each method used an applicable smoke query: named red for most methods, explicit 40% green for transport, and picked hex for the precision-only bounded method. The first 35-method check correctly received “unsupported” when the harness tried named red against that precision-only method; the harness was updated to choose a supported precision request. This was a test-query correction, not a backend fix.

Additional checks covered picked hex, RGB/HSV/HSL/OKLab controls, dark-with-bright-spots intent, explicit unsupported responses, full-image access, and fixture inclusion/exclusion. Across the wallpaper-only requests, no fixture ID was returned. Enabling fixtures for a precise-color request returned the expected controlled swatches.

Saved receipts outside the repository:

- 33 methods / 42 checks: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T01-16-27.695Z.json`
- 35 methods / 44 checks: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T01-21-26.846Z.json`

Actual desktop browser **All** selection at 33 methods rendered 33 columns: **8 approximate retrieval, 24 exact for the stored score, 1 unsupported** (transport without explicit proportions). It had zero error columns, zero broken loaded images, and no JavaScript errors. Unsupported queries did not display successful-query latency badges.

The actual fixture checkbox was also exercised: checked produced precision/composition fixtures; unchecked removed all those IDs through the provider's OpenSearch filter. Mobile width was **390 pixels with document width 390**, so method-result horizontal scrolling stayed within its own container. Desktop width was likewise contained at 1440 pixels.

Final inspection screenshots, outside the repo: `/tmp/color-exploration-final-desktop.png`, `/tmp/color-exploration-final-results.png`, `/tmp/color-exploration-final-mobile.png`. The isolated browser session was closed afterward.

The optional `/findings` provider route has an additional unit check covering GET, HEAD, explicit HTML type, script-disabled report policy, rejection of POST and subpaths, and metadata link forwarding.

## Discoverability and generated findings: 38 methods

After the typed-precision additions, the live registry exposes **38 methods**. `make color-exploration-browser-smoke` passed **47 live API checks**; `make color-exploration-browser-test` passed all **7 tests**. The updated smoke harness uses a picked-color request for precision-only methods. Receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T01-41-51.752Z.json`.

Modest browser improvements from this audit:

- A **Compare selected** action at the top avoids scrolling past the method list to start a comparison.
- Method-name search, **Expand families**, **Collapse families**, and a shown/total/selected count make the registry easier to explore. These controls search only method metadata; wallpaper eligibility and order still come from OpenSearch.
- Method search preserves selections; while a search is active, **All methods** clarifies that it selects the entire registry.
- Edge falloff controls appear only with an explicit custom range. A picked hex without a custom range uses each method's default distance model, preventing a visible edge control that fixed-Gaussian vector methods would ignore.

Actual browser checks confirmed 38 method checkboxes, five expandable groups, `L2` matching two methods without clearing the three selected methods, and the new top button performing the 70% reddish + 30% dark range request. The two incompatible default methods report unsupported, while the hybrid returns wallpaper results.

The generated [findings page](http://zerotwo:8225/findings) now renders through the live provider. All of its in-page anchors resolve, and the return link opens the visual browser. Its desktop document width is 1440 at a 1440-pixel viewport; its mobile document width is 390 at a 390-pixel viewport. The prototype browser likewise has no page overflow at 390 pixels, and page JavaScript errors remained empty.

Screenshots outside the repo: `/tmp/color-exploration-findings-desktop.png`, `/tmp/color-exploration-findings-mobile.png`, and `/tmp/color-exploration-38-methods-mobile.png`. The short [visual walkthrough](browser-WALKTHROUGH.md) documents representative queries, controls, and interpretation of result guarantees. This browser audit sent no requests to the separate million-document instance on port 19217.

## Registry expansion: 43 methods

The precomputed precision variants and two native area/quality refinements bring the live registry to **43 methods**. The browser loads them from registry metadata; native refinements appear under **Indexed color features**. The smoke harness chooses a picked-hex request for every precision-only query kind.

`make color-exploration-browser-smoke` passed **52 checks** across all 43 methods. Receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T01-55-53.636Z.json`. All wallpaper-only requests still exclude fixtures through OpenSearch. Native refinement formulas, explicit unsupported controls, and feedback-loop findings are documented in [NATIVE-REFINEMENTS.md](NATIVE-REFINEMENTS.md).

## Alternative service: 44 methods

The registry now exposes **43 OpenSearch methods plus one ClickHouse precision method**. The browser lists it under **Other search services**, identifies the actual engine in the chooser and result timing, and retains the default **523 wallpapers**, with the optional **22 fixtures**. Wallpaper eligibility and ranking execute in the selected service.

`make color-exploration-browser-smoke` passed **53 checks across all 44 methods**. Receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T02-42-28.765Z.json`.

Actual browser inspection selected **Precise orange-red**, searched for the ClickHouse method, and rendered 24 results. The result showed **11.4 ms** request latency, **ClickHouse 9.03 ms** backend time, and **Exact for this score**. These are one interactive request's timings, not a scale benchmark. Switching to 40% green produced an explicit unsupported response without a successful-query latency badge.

Desktop **1440 × 1000** and mobile **390 × 844** layouts were inspected. Mobile document width remained 390 pixels, loaded images were intact, and page JavaScript errors were empty. Screenshots are outside the repository: `/tmp/color-clickhouse-results-desktop.png` and `/tmp/color-clickhouse-results-mobile.png`. The isolated browser session was closed afterward.

The [findings page](http://zerotwo:8225/findings) accepts recorded ClickHouse executions only when they match the method's declared backend. Its scale evidence preserves ClickHouse table/version/container limits and RSS without labeling these as OpenSearch/JVM measurements. Focused findings tests passed **7/7**; adapter corpus/metadata tests passed **4/4**; the feedback-loop suite passed **45 tests**. See [ClickHouse integration](CLICKHOUSE-INTEGRATION.md) for feedback coverage and the saved run.

## Native picked-color grid: 45 methods

The registered grid method searches its own validated OpenSearch index, `color-exploration-precision-grid-real-v2`, containing exactly the same **545 assets**. The adapter verifies every ID and records descriptor, grid-definition, and computation fingerprints before evaluation. Browser results still default to **523 wallpapers**, with optional fixtures excluded by the service query.

`make color-exploration-browser-smoke` passed **54 checks across all 45 methods**. Receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T03-07-15.017Z.json`.

Actual browser checks used **Picked orange-red · method defaults** and selected the grid under **Indexed color features**. It displayed 24 real wallpapers and the visible badge **Interpolated color score · global indexed ranking** beside its retrieval guarantee. Switching to the custom-range **Precise orange-red** preset returned **Unsupported query**, with no false timing or exactness badge. Desktop **1440 × 1000** and mobile **390 × 844** were inspected; mobile document width remained 390 pixels, loaded wallpaper images were intact, and page JavaScript errors were empty. The unused, hidden lightbox image has no source until opened and is excluded from the loaded-image check.

Screenshots outside the repository: `/tmp/color-grid-results-desktop.png` and `/tmp/color-grid-results-mobile.png`.

Feedback run `2026-09-20T03-06-53.036Z-cafdbda3` completed **3/37 cases**, with 34 unsupported, no errors, and **17 judged pairs**. Query-macro agreement was **87.78%**, compared with **79.44%** for the continuous palette objective on those same three cases. Shade agreement stayed 80%; warm red changed from 91.67% to 100%; muted green changed from 66.67% to 83.33%. This small development set cannot establish general superiority. Thirty small-corpus timed requests had **2.92 ms p95**, **3.19 ms maximum**, and no failures.

Run `2026-09-20T03-13-00.884Z-c2f20177` then recorded the dedicated v2 index explicitly in both candidate configuration and execution metadata, in addition to the already-correct setup record. Coverage, scores, and agreement were unchanged; its 30 timed requests had **2.30 ms p95**, **2.76 ms maximum**, and no failures. The first run remains immutable. These shared-host timing differences are not treated as a scoring improvement.

The findings page displays this shared-case comparison and the separate 17-color interpolation diagnostics: **81.47% mean top20 overlap**, **0.00403 mean top20 utility loss**, and **0.4220 maximum individual score difference** from the continuous objective. These are formula comparisons, not new human relevance judgments. It also preserves separate ClickHouse one-thread/eight-thread scale configurations instead of overwriting one with the other. Focused adapter and findings tests passed **16/16**.

The final findings page was inspected at 390-pixel width: the comparison and visible interpolation labels rendered correctly, document width stayed 390 pixels, and there were no JavaScript errors. All 45 registered methods had valid default feedback results and summary generation reported no read warnings. The isolated browser session was closed.

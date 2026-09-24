# Linked color strictness prototype

## Question and scope

Can one three- or five-position quality-preference slider replace independent
quality influence and cutoff weighting, while retaining the user's favorite?
User requested a visual prototype with tabs for original and linked controls,
loaded with the existing wallpapers. This is a small-corpus experiment, not the
blocked million-record storage/performance campaign.

## Implementation

- Page: `http://zerotwo:8228/strictness.html`, beside the preserved 19-method lab.
- Two tabs: Original controls (independent settings, 5% proportions) and Combined
  slider (three/five linked settings, 10% proportions).
- Three pairs: `(0,0)`, `(0.5,1)`, `(1,3)`; five pairs: `(0,0)`, `(0.5,0)`,
  `(0.5,1)`, `(1,1)`, `(1,3)`. Pair order is (influence, cutoff weighting).
- Exact saved linear favorite remains in the middle of each slider.
- Separate compact numeric indexes: 10,044 / 16,740 utility fields per document;
  source disabled, numeric points and doc values. Same score formula and source
  measurements; all filtering and final ordering stay inside OpenSearch.
- Index all 545 source assets and exclude the 22 controlled fixtures in searches:
  the user sees the same 523 real wallpapers, including the archive corpus.
- Preserve original controls/query state when switching tabs. Copying a 5%-step
  query into a 10%-step tab must present any percentage adjustment explicitly.
- New page includes live search, multi-target/named queries and wallpaper modal.
- No changes to original favorite snapshot, extracted color measurements, old
  index data, or published million-record benchmark results.

## Ownership

Root owns HTTP routes/provider tests, Make targets, live indexing/restart and this
record. `control_support_check` owns preset/index helpers and tests;
`speedup_comparison` owns the new page files; `cache_priority_check` independently
reviews and performs browser checks after readiness. Build/index operations remain
serial; scale service 19217 stays stopped. Artifacts/images remain external.

Complete: both indexes are loaded and the page is live. Desktop/mobile browser
checks, full-corpus ranking validation and shared human-feedback evaluation pass.
The lab is left running; no build or benchmark jobs remain active.

## Recorded validation

- 10 preset/index-builder tests, six provider/UI-adjustment/HTTP tests, 19 existing
  lab tests and 11 performance-dashboard tests passed. New frontend syntax passes.
- Three-choice index: all 545 assets, 10,044 utilities/document, 30,132 original-
  encoder value comparisons on three sampled records. Five-choice index: all
  545 assets, 16,740 utilities/document, 50,220 sampled value comparisons.
  Exact corpus IDs, complete field mappings and stable generation checked.
- Settled primary store for these **545-record** indexes: 161,179,376 bytes
  (three choices) and 269,395,070 bytes (five). One primary, zero replicas,
  source disabled, numeric points and doc values, one segment each. These tiny
  indexes have substantial per-field overhead; do not extrapolate bytes per
  wallpaper from them to a million records.
- `verification-v1/verification.json`: 48 comparisons (all eight offered settings
  across six vibe/proportion/named/multi-color queries), each retrieving all 523
  real wallpapers from the compact, parent numeric and original cutoff indexes.
  All compact results exactly match parent numeric ordered IDs and scores.
  Largest per-image score difference from the original cutoff scorer is
  `1.4000000003733248e-7`; 40/48 full original orders are exact, with small float
  differences affecting the remaining near ties. Index generations stayed stable.
- Localhost and local tailnet-interface HTTP checks passed for the new page,
  metadata, old 19-method registry and performance dashboard. Both compact banks
  report available and 523 real wallpapers. User systemd service
  `wallpaperdb-color-favorite-lab.service` restarted and left running on 8228.
- Independent browser QA passed: original/three/five favorite order parity,
  independent controls and queries, explicit 45% to 50% copy proposal/cancel/
  acceptance, original query unchanged, manual mode, latest-only debounced live
  update, all 523 results for dark and grayscale/red, five-color proportions,
  full-image modal and Escape, 390px mobile layout without horizontal overflow,
  and preserved old pages. No browser errors or failed loaded images.
  `browser/interaction-evidence.json` and seven screenshots record the checks;
  the named browser session is closed. Root inspected desktop/mobile galleries.
- Saved favorite SHA-256 remains
  `0c73fec9b5c8f3844c23b5d2e3b06738852ea32b8f333896b6bb4fd3c89ca7ad`.

## Human-feedback rerun

Uses the existing feedback harness and unchanged 38-case dataset including the
pagoda preference. Thirteen candidates cover five matched original references
and all eight offered linked positions. All use the same real-image/10%-step
comparison scope. Fixture judgments and unsupported percentages remain visible
as unsupported; this shared subset does not reduce the original UI's controls.

Initial run `2026-09-23T22-51-52.860Z-f92cd9ff` is retained as failed setup evidence:
the harness injects an empty `parameters` object, which the first adapter rejected
as an override. This affects only the new evaluation adapter, not indexes or the
live UI. The fix permits an empty normalized object while rejecting actual
parameter overrides, with a regression through the harness's candidate expansion.

Successful run: `2026-09-23T22-53-05.476Z-115e5722`, under
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/`.
All 13 candidates have zero errors and zero timing failures. Each assesses the
same 28 complete cases / 184 preference pairs. Ten records remain unsupported:
four fixture cases, four accent/relative-contrast objectives and two conceptual
cases without images. The adapter also rejects intermediate 5% percentages;
this dataset has no additional real-image case excluded solely for that reason.

| Slider setting | Influence | Cutoff weighting | Query-macro agreement |
| --- | ---: | ---: | ---: |
| Relaxed | 0 | 0 | 68.33% |
| Gentler | 0.5 | 0 | 70.95% |
| Favorite | 0.5 | 1 | 70.36% |
| Stricter | 1 | 1 | 70.24% |
| Strictest | 1 | 3 | 72.26% |

Every offered linked position exactly matches its original reference's per-case
accuracy and timed-accuracy records, not merely the aggregate. Three-choice
settings are the first/middle/last rows. Evidence summary:
`feedback-parity.json` in this prototype's external root. These development
judgments do not establish a best setting for everyone and do not replace the
user's saved favorite. Real-corpus repeated-query timings in the run are
diagnostic; no million-record performance conclusion follows.

Seven adapter tests pass, including the actual harness candidate-expansion
boundary and metadata key reordering. Independent review found no blocking
issue after the fixes. The failed first run remains preserved.

## Interpretation and limits

- The linked path selects existing preset pairs; it does not change the underlying
  favorite formula. Slider steps are an experimental preference path, not equally
  spaced perceptual distances. Named abstract features do not change with cutoff
  weighting, because they have no cutoff layers.
- The original tab uses the original OpenSearch cutoff scorer at independently
  selectable preset values. The linked tab uses precomputed numeric utilities.
  Float rounding/grouping can alter extremely close ties.
- The numeric parent retains its known repeated-target limitation: targets that
  resolve to the identical utility field can have duplicate query clauses
  collapsed. Ordinary distinct-target comparisons are unaffected. The existing
  multiplicity refinement remains a separate prototype; this page does not
  silently adopt a changed scorer. The comparison suite below covers distinct
  resolved targets, not this edge case.
- This small real-corpus build establishes a usable comparison and score fidelity;
  it does not measure million-record storage or production concurrency. Earlier
  performance results and their limitations remain unchanged.

## Reproduction

Use a fresh external directory for each operation. Keep these commands serial:

```bash
make color-linked-strictness-test color-linked-strictness-lab-test
make color-linked-strictness-feedback-test
make color-linked-strictness-index COLOR_FAVORITE_ARGS='--bank linked-3 --directory EXTERNAL/linked-3-real-v1'
make color-linked-strictness-index COLOR_FAVORITE_ARGS='--bank linked-5 --directory EXTERNAL/linked-5-real-v1'
make color-linked-strictness-verify COLOR_FAVORITE_ARGS='EXTERNAL/verification-v1'
COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216 make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/linked-strictness-feedback.json'
```

Evidence root for this build:
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/linked-strictness/2026-09-23`.
The index builder retains its source snapshot, plan, bulk receipts, complete-field
value audits on three sampled documents, mapping and storage statistics. The
read-only verifier retains all 523 hits from each compared service execution.

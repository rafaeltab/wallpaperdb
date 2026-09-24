# Final query and browser correctness audit

## Scope

Read the 43-method registry, its query/support dispatch, bounded retrieval paths, browser provider, shared query parser, and feedback-loop normalization. Focused service checks used the complete 545-asset real index on port 19216. No requests were sent to the million-document instance on port 19217.

## Finding 1: structured accent queries used a different objective

**Fixed.** Before the correction, legacy text such as “Mostly dark, with small bright areas” selected `dark_bright_accents`, but the browser's identically labeled preset sent structured `dark` + `bright` targets and selected ordinary average vibe scoring. Grayscale/red accent intent had the same discrepancy. The relative-contrast hybrids already recognized structured dark/bright pairs, so comparing methods visually did not reproduce the evaluation's comparison.

Concrete real-service reproduction on four previously judged wallpapers:

| Method | Evaluated text, before fix | Browser preset, before fix |
| --- | --- | --- |
| `feature-composition-exact` | 015, 032, 022, 005 | 005, 015, 032, 022 |
| `palette-direct-precision` | 015, 032, 022, 005 | 005, 015, 032, 022 |
| `hybrid-relative-accents` | 005, 022, 032, 015 | 005, 022, 032, 015 |

Rank-feature methods also rejected the evaluated accent text while accepting the browser's structured equivalent.

The shared query parser now recognizes exactly two named targets, in vibe mode, without custom ranges:

- `dark` + `bright` becomes `dark_bright_accents`.
- `grayscale` + `red` becomes `gray_red_accents`.

Target positions are canonicalized because the existing accent scripts expect background first, accent second. Explicit proportions, custom ranges, duplicate names, and larger combinations retain ordinary query behavior. Browser helper text now makes these two inferred accent intents visible.

Behavior version: **`color-intent-v2-structured-accents`**, exported from `query.mjs`. No scoring formula changed.

## Finding 2: area-only methods silently ignored edge falloff

**Fixed by disclosure.** `histogram-area-exact` and `palette-area-exact` accepted a custom red OKLab region with edge values zero and one and returned byte-identical scores and order for all 545 assets. This is consistent with their pure-area objective, but support metadata did not disclose that the visible control had no effect. Typed area methods inherit the same behavior.

Support metadata now states: “This area-only scorer ignores color quality and edge falloff; every color inside the region counts equally.” The browser shows it in Method notes. This preserves useful area-only controls as comparison baselines without changing their formulas. Composition and perceptual-kernel methods continue to apply their quality definitions.

## Validation and unchanged evidence

`query-intent.test.mjs` covers canonicalized accent targets, both input orders, ordinary-query exclusions, consistent rank-feature/native unsupported states, and inherited area-only warnings. The optional real-service test compares **all 545 scores and IDs** between evaluated text and both structured target orders for both accent intents across five representative execution paths: feature composition, native control, direct palette, typed histogram composition, and relative hybrid. All five focused tests pass with integration enabled.

Every one of the **37 existing feedback-loop requests** was normalized through the runner and compiled by both the frozen round-10 query parser and the corrected parser. The complete compiled objects were identical. Consequently, existing feedback scores and coverage do not change, and no historical run or human answer was rewritten. Receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/query-audit/2026-09-20T02-04-44.771Z.json`.

The 43-method browser registry had already passed 52 live API smoke checks before this correction. The audit found no application-side document scoring, filtering, or reordering: the browser maps service hits to allowlisted image URLs in their returned order. Exact bounded methods use service-generated thresholds to build necessary global filters; they retain their documented stable-index requirement and weak-bound fallback. Their exactness claims apply to the stored scoring objective, not human preference or lossless pixel representation.

Remaining known limitations stay explicit in the method notes: partial distributions in vector controls, palette/histogram quantization, overlapping named areas, native closed-palette impurity, unsupported precise controls, and the absence of production consistency across multi-query bounded searches. This bounded audit is not a proof that every representation or future query is correct.

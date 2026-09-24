# Color review batch 001

Created 2026-09-18. **Status: all 24 rankings received on 2026-09-19**, with the user's caveat that this was a quick pass and different people may rank the images differently. [Results and original notes](batch-001-results.md) preserve the submitted orders, five specific uncertain pairs and the whole-batch qualification. The version 1 presentation manifest remains unchanged.

## Purpose

The user requested many comparisons at once because chat-by-chat reviews were taking too long. This batch makes 24 comparisons available together, using four real photographs or existing illustrated wallpapers per comparison. It is preference elicitation only: no color method, evaluation scoring formula, model benchmark or OpenSearch experiment is implemented here.

The previously pending `composition-green-red-real-002` is comparison 1, preserving its exact query text and A–D image mapping. Its existing standalone record links to this submission as the same logical case, not an additional independent observation.

## Review contract

- Ranking is the principal response; notes are optional. Ties, uncertainty, skipping and “none matches well” must be possible.
- Candidate percentages, computed scores, historical judgments, source titles and method names are not shown during ranking.
- Candidate labels are stable after authoring. New comparisons use a one-time Fisher–Yates shuffle; related pairs have different persisted mappings.
- Keep the full composition visible with `object-fit: contain`. Do not crop, recolor, normalize brightness or apply saturation changes.
- Query percentages are whole-image targets, not minimums. Never normalize a partial composition to 100%.
- Swatches are selected query colors, not extracted candidate colors. Close shades may match; no exact-hex requirement is implied.

## Curation and evidence limits

The curator inspected the four existing contact sheets and all five added evaluation photographs. Choices use visible scenes and colors, without consulting any historical method rankings, vector distances, extracted candidate coverage or search results. There are 62 distinct source images across 96 appearances. Sources and SHA-256 hashes are preserved in the JSON from the shared 105-image catalog.

These are development cases from a small, already-seen corpus. The batch is not a held-out set and is not representative of all wallpaper searches. Repeated images and related queries must stay together when splitting later evaluation data; check overlap by source ID and content hash, not only case ID. Do not count adjacent preferences from one order as independent users or independent cases.

No expected rank, match grade, amount, numerical distance or confidence is assigned. Visual curation observations below explain selection, not relevance ground truth. Existing user judgments do not carry over to changed queries. Any explicit rejection or acceptance must come from the new response, not from rank position.

The grayscale/red and blue/orange paired queries change both target amounts and remainder flexibility. A preference change cannot be attributed solely to allowing another color. Repeated sources and fixed case order can create recognition and context effects.

The original wallpaper collection has unknown license metadata, retained as such; this batch makes no new license claim. Added photographs retain their source/author/license records. No new downloads, file edits or crops are needed for this batch. Future coverage gaps include additional blue/pink/white mixtures, fall palettes, five-color percentage requests and independent source images; this batch does not claim exhaustive coverage.

## Cases and curator notes

The notes in this section are for maintainers, not the review prompt.

### 1. 40% green, 40% red; the remaining 20% is unspecified

Case: `composition-green-red-real-002` · Category: Combinations

Previously pending real-image query carried over unchanged: exact query text, A–D labels, source IDs and hashes. Existing previous-query judgments remain separate.

Mapping: A = `evaluation-green-red-leaves`; B = `wallpaper-082`; C = `evaluation-green-red-tulip-field`; D = `evaluation-green-red-tulips`.

### 2. Red

Case: `perceived-red-batch-001` · Category: Perceived color

Adjacent orange and pink impressions, a red object and a subdued red-containing painting; no candidate is assigned a degree of redness.

Mapping: A = `wallpaper-084`; B = `wallpaper-095`; C = `wallpaper-037`; D = `wallpaper-044`.

### 3. Orange

Case: `perceived-orange-batch-001` · Category: Perceived color

Orange-like clouds, flowers and rocks in different surrounding colors and area distributions.

Mapping: A = `wallpaper-046`; B = `wallpaper-031`; C = `wallpaper-087`; D = `wallpaper-036`.

### 4. Pink

Case: `perceived-pink-batch-001` · Category: Perceived color

Flowers, rose imagery and skies span soft pink through red- and purple-adjacent impressions.

Mapping: A = `wallpaper-033`; B = `wallpaper-044`; C = `wallpaper-048`; D = `wallpaper-039`.

### 5. Green

Case: `perceived-green-batch-001` · Category: Perceived color

Bamboo, forest, lily pads and a muted garden painting vary scene, color strength and apparent green area.

Mapping: A = `wallpaper-083`; B = `wallpaper-093`; C = `wallpaper-050`; D = `wallpaper-086`.

### 6. Blue

Case: `perceived-blue-batch-001` · Category: Perceived color

Strong blue illumination, architecture against sky and small flowers vary blue strength and area; cyan-adjacent sky is included.

Mapping: A = `wallpaper-091`; B = `wallpaper-010`; C = `wallpaper-030`; D = `wallpaper-047`.

### 7. 40% green; the remaining 60% is unspecified

Case: `proportion-green-real-batch-001` · Category: Proportions

Natural green scenes selected visually without measuring their green share; user decides how color quality and amount interact.

Mapping: A = `wallpaper-093`; B = `wallpaper-083`; C = `wallpaper-081`; D = `wallpaper-050`.

### 8. 70% green; the remaining 30% is unspecified

Case: `proportion-green-real-batch-002` · Category: Proportions

Broad natural green regions mixed with water, earth, light and shadow; no image is presumed to meet 70%.

Mapping: A = `wallpaper-090`; B = `wallpaper-050`; C = `wallpaper-012`; D = `wallpaper-086`.

### 9. 20% red; the remaining 80% is unspecified

Case: `proportion-red-real-batch-001` · Category: Proportions

Red structures, leaves and small marks vary apparent area and saturation; red recognition alone is not given an expected score.

Mapping: A = `wallpaper-060`; B = `wallpaper-029`; C = `wallpaper-084`; D = `wallpaper-082`.

### 10. Dark

Case: `vibe-dark-batch-001` · Category: Vibe

Mountains, textured stones and water provide different dark-region distributions and highlight structure.

Mapping: A = `wallpaper-067`; B = `wallpaper-011`; C = `wallpaper-075`; D = `wallpaper-079`.

### 11. Light

Case: `vibe-light-batch-001` · Category: Vibe

High-value sky and backgrounds, warm rock and pale painting vary lightness, contrast and muted color.

Mapping: A = `wallpaper-073`; B = `wallpaper-051`; C = `wallpaper-096`; D = `wallpaper-088`.

### 12. Bright, vivid colors

Case: `vibe-vivid-batch-001` · Category: Vibe

Colorful painting, fantasy light, pool illustration and muted fish imagery explore vividness; this wording does not define a brightness formula.

Mapping: A = `wallpaper-032`; B = `wallpaper-094`; C = `wallpaper-052`; D = `wallpaper-098`.

### 13. Grayscale

Case: `vibe-strict-grayscale-batch-001` · Category: Vibe

Compare grayscale photographs against near-neutral cool and warm imagery. Source category names are not ground-truth saturation measurements.

Mapping: A = `wallpaper-071`; B = `wallpaper-068`; C = `wallpaper-070`; D = `wallpaper-007`.

### 14. Almost grayscale

Case: `vibe-near-neutral-batch-001` · Category: Vibe

Warm, cool, pale and black-and-white imagery explore tolerance of restrained color; not a predefined saturation threshold.

Mapping: A = `wallpaper-062`; B = `wallpaper-096`; C = `wallpaper-007`; D = `wallpaper-071`.

### 15. One hue overall

Case: `vibe-monochromatic-batch-001` · Category: Vibe

Warm statue composition, blue compositions and multicolor marbling distinguish one-hue impression from strict grayscale.

Mapping: A = `wallpaper-008`; B = `wallpaper-091`; C = `wallpaper-009`; D = `wallpaper-004`.

### 16. Grayscale with red accents

Case: `combination-gray-red-batch-001` · Category: Combinations

Selective-color photo, minimal white-and-red composition, subdued painting and grayscale architecture; user may reject white-with-red as the same vibe. Prior telephone judgment is not copied.

Mapping: A = `wallpaper-095`; B = `wallpaper-060`; C = `evaluation-gray-red-002-telephone`; D = `wallpaper-063`.

### 17. 80% grayscale, 20% red

Case: `composition-gray-red-batch-001` · Category: Combinations

Selective-color street, roses, mixed bouquet and minimal red-on-white image; no candidate area percentages are asserted.

Mapping: A = `evaluation-gray-red-002-umbrella`; B = `wallpaper-042`; C = `wallpaper-048`; D = `wallpaper-060`.

### 18. 80% grayscale, 10% red; the remaining 10% is unspecified

Case: `composition-gray-red-batch-002` · Category: Combinations

Same sources as the preceding query, shuffled again. Both red target and unrestricted remainder change; effects are not causally isolated.

Mapping: A = `wallpaper-048`; B = `wallpaper-042`; C = `wallpaper-060`; D = `evaluation-gray-red-002-umbrella`.

### 19. Mostly dark, with small bright areas

Case: `vibe-dark-accents-batch-001` · Category: Vibe

City lights, an illuminated aerial scene, fine bright linework and a fantasy sky vary bright-area scale and color. No subject or city-tag eligibility test.

Mapping: A = `wallpaper-005`; B = `wallpaper-032`; C = `wallpaper-022`; D = `wallpaper-015`.

### 20. 50% blue, 50% orange

Case: `composition-blue-orange-batch-001` · Category: Combinations

Textured abstraction, canyon illustration, pool illustration and fish scene mix blue/orange-adjacent shades with different other colors. None is certified 50/50.

Mapping: A = `wallpaper-057`; B = `wallpaper-002`; C = `wallpaper-058`; D = `wallpaper-040`.

### 21. 40% blue, 40% orange; the remaining 20% is unspecified

Case: `composition-blue-orange-batch-002` · Category: Combinations

Same sources as full blue/orange composition, shuffled again; compare fresh preferences without assuming an image improves.

Mapping: A = `wallpaper-040`; B = `wallpaper-058`; C = `wallpaper-057`; D = `wallpaper-002`.

### 22. Close to #FF2200

Case: `precision-warm-red-batch-001` · Category: Precision

Chosen warm red swatch is a query target, not a sampled candidate pixel. No candidate is claimed to contain or closely match the exact hex.

Mapping: A = `wallpaper-046`; B = `wallpaper-082`; C = `wallpaper-087`; D = `wallpaper-037`.

### 23. Close to #4C8C72

Case: `precision-muted-green-batch-001` · Category: Precision

Chosen muted green swatch explores a less vivid precise target in aerial, illustrated and natural imagery; no measured distances or target area assigned.

Mapping: A = `wallpaper-086`; B = `wallpaper-052`; C = `wallpaper-093`; D = `wallpaper-013`.

### 24. Rainbow-like colors

Case: `palette-rainbow-batch-001` · Category: Palette

Marbling, pastel abstraction, autumn painting and colorful illustration vary hue breadth and vividness. This is a palette request, with no object/tag constraint.

Mapping: A = `wallpaper-094`; B = `wallpaper-034`; C = `wallpaper-003`; D = `wallpaper-004`.

## Validation

Authoring validation passed: all 24 IDs are unique; labels are A–D once per case; each case has four distinct sources; all 62 source files exist and their SHA-256 hashes match the shared catalog. Comparison 1 matches the pending standalone case by exact query text, labels, IDs and hashes. Both paired new compositions have different persisted label mappings. Browser/UI validation and response persistence belong to the batch review interface, separately from curation.

Do not change images, query text or label mappings after responses begin. Issue a new batch version if a correction is required; preserve the old version and its responses.

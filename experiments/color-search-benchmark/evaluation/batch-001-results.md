# Batch 001 — submitted preferences

Received **2026-09-19T22:42:19.251Z**: **24 complete rankings**, one reviewer. All orders and notes are recorded; no ties or skips were submitted. The previous 13 cases plus these 24 are 37 logical judgment records, not 37 independent samples.

[Structured results](batch-001-results.json) · [Original immutable receipt](responses/30b36a99-4c94-4f15-9e18-27373dea04c5.json)

## Reliability and scope

The following caveat applies to every case in this batch:

> I have submitted the answers, I went quite quickly, so dont regard this as 100% accurate human perception preference, some of these will be ranked very differently by different people

Treat these as provisional development preferences. Retain submitted order, uncertainty and explanation separately. No numerical confidence or weighting is assigned, and disagreement with an order is not automatically an algorithm failure. Differences between reviewers are expected by the user, not measured here. Earlier records retain their original caveats.

## Signals worth carrying into method discussion

- Requested amounts can change preferences among the same images. The roses move below `wallpaper-042` when the gray/red target changes from 20% to 10% red; the user explicitly says the roses then have too much red. Both target amount and unspecified remainder change, so this does not isolate a remainder penalty.
- Amount and color strength remain separate observations: for 70% green, A is not very green while C lacks enough green. No actual pixel fractions follow.
- Named-color and grayscale requests describe perceived appearance. Notes distinguish pink from red and white-heavy imagery from the desired grayscale look. Preserve these within their cases; do not redefine technical grayscale to exclude white.
- The blue note proposes focal prominence as a possible explanation. It is a hypothesis, not proof that spatial features are required.
- The new 40%/40% green/red order differs from the earlier 50%/50% order, and the blue/orange pair swaps its middle images. These deserve later sensitivity checks; quick judgment, changed targets and context all limit causal interpretation.

## Specific uncertainty

The five pairs below retain their submitted order; no ties or score gaps are invented. Every other relation still carries the whole-batch caveat.

| Case | Submitted pair | Stable image IDs |
| --- | --- | --- |
| perceived-green-batch-001 | A > B | `wallpaper-083` > `wallpaper-093` |
| perceived-blue-batch-001 | D > B | `wallpaper-047` > `wallpaper-010` |
| proportion-green-real-batch-001 | B > D | `wallpaper-083` > `wallpaper-050` |
| precision-muted-green-batch-001 | C > A | `wallpaper-093` > `wallpaper-086` |
| palette-rainbow-batch-001 | B > D | `wallpaper-034` > `wallpaper-004` |

The dark-with-bright-areas note also questions a placement, but does not identify a clear pair. Keep that ambiguity. In contrast, “I dont know why I put C above B, but it definitely feels better” lacks an explanation while still explicitly preferring C; it is not a sixth uncertain pair.

## Recorded orders

Letters are local to each comparison. These are submitted preferences, not exact relevance scores.

| # | Request | Order |
| --- | --- | --- |
| 1 | 40% green, 40% red; the remaining 20% is unspecified | A > B > D > C |
| 2 | Red | C > B > A > D |
| 3 | Orange | B > A > D > C |
| 4 | Pink | B > D > A > C |
| 5 | Green | D > C > A > B |
| 6 | Blue | A > C > D > B |
| 7 | 40% green; the remaining 60% is unspecified | A > C > B > D |
| 8 | 70% green; the remaining 30% is unspecified | D > B > C > A |
| 9 | 20% red; the remaining 80% is unspecified | B > A > C > D |
| 10 | Dark | A > B > D > C |
| 11 | Light | D > B > A > C |
| 12 | Bright, vivid colors | B > A > C > D |
| 13 | Grayscale | B > C > A > D |
| 14 | Almost grayscale | C > D > A > B |
| 15 | One hue overall | C > B > A > D |
| 16 | Grayscale with red accents | C > B > D > A |
| 17 | 80% grayscale, 20% red | A > C > B > D |
| 18 | 80% grayscale, 10% red; the remaining 10% is unspecified | D > B > A > C |
| 19 | Mostly dark, with small bright areas | A > C > B > D |
| 20 | 50% blue, 50% orange | C > B > D > A |
| 21 | 40% blue, 40% orange; the remaining 20% is unspecified | B > A > D > C |
| 22 | Close to #FF2200 | D > B > C > A |
| 23 | Close to #4C8C72 | B > D > C > A |
| 24 | Rainbow-like colors | A > C > B > D |

## Original notes

Notes below preserve spelling, whitespace and line breaks in fenced blocks. Empty notes remain empty in the structured record; they do not imply certainty.

### 2. perceived-red-batch-001

```text
pink doesnt feel red at all
```

### 3. perceived-orange-batch-001

```text
Rock doesnt feel orange
```

### 4. perceived-pink-batch-001

```text
The roses  don't feel pink
```

### 5. perceived-green-batch-001

```text
Not sure about A and B order
```

### 6. perceived-blue-batch-001

```text
Not sure about B and D order. 

A feels very brightly blue, C has a lot of less bright blue, B doesnt feel as convincingly blue as D, maybe because D has the blue as the focus point?
```

### 7. proportion-green-real-batch-001

```text
not sure about B and D order
```

### 8. proportion-green-real-batch-002

```text
A isn't very green. C doesnt have enough green
```

### 9. proportion-red-real-batch-001

```text
B feels more red than A. C feels like it has too much red. D definitely has too much red.
```

### 14. vibe-near-neutral-batch-001

```text
those flowers dont feel close to grayscale
```

### 17. composition-gray-red-batch-001

```text
white just isn't grayscale, its just white. I mean technically it isnt, but when you search for grayscale you're not looking for white, you're looking for grayscale. I dont know why I put C above B, but it definitely feels better.
```

### 18. composition-gray-red-batch-002

```text
with this percentage, the roses just have too much red to justify. 
```

### 19. vibe-dark-accents-batch-001

```text
B has a dark vibe. I wouldn't necessarily describe black as dark, so maybe it should be lower ranked?
```

### 23. precision-muted-green-batch-001

```text
not sure about the last two
```

### 24. palette-rainbow-batch-001

```text
Not sure about the last two
```

## Storage and next step

The original source receipt at `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/reviews/color-review-batch-001/30b36a99-4c94-4f15-9e18-27373dea04c5.json` is unchanged; its SHA256 is `36a41bccdff3313eccbbf612ccb0057944b44e2a8b9e40524310d552592a0b76`. Its submission fingerprint and batch snapshot checksum were verified. An exact repository copy and a shared annotation sidecar preserve the receipt and later conversation caveat separately.

The live version 1 presentation manifest is unchanged to keep browser drafts and label mappings stable. The standalone green/red partial-composition record is linked to this same submission, not counted again.

Next, discuss candidate representations and OpenSearch retrieval/ranking options against these provisional examples. Agree how to handle disputed pairs and validate preferences from other reviewers before treating small ranking differences as decisive. Implementation, method benchmarks and a scoring formula remain deferred.
